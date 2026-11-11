import type { Core } from '../composition/createCore.ts';
import type { CoreInput, CoreOutput, CoreRoute } from '../controllers/routes.ts';
import type { TransactionResponse } from '../dto/transactions/TransactionResponse.ts';

/**
 * As chamadas interativas com orçamento de p95 ≤ 50 ms (mobile-shell-design §4.3): lançar,
 * editar uma transação antiga — o pior caso, que recalcula os meses seguintes da conta —,
 * consultar um mês e abrir uma fatura.
 */
export type InteractiveOperation = 'lançar' | 'editar antiga' | 'consultar mês' | 'abrir fatura';

/** Ordem fixa das operações, a mesma do relatório e do log. */
export const INTERACTIVE_OPERATIONS: readonly InteractiveOperation[] = ['lançar', 'editar antiga', 'consultar mês', 'abrir fatura'];

/** Orçamento de p95 das chamadas interativas, em milissegundos (mobile-shell-design §4.3). */
export const INTERACTIVE_P95_BUDGET_MS = 50;

/** Estatística de uma operação, em milissegundos. */
export interface OperationStats {
    readonly operation: InteractiveOperation;
    readonly samples: number;
    readonly p50: number;
    readonly p95: number;
    readonly max: number;
}

/** Como rodar a medição. */
export interface InteractiveBenchmarkOptions {
    /**
     * Relógio de alta resolução em milissegundos (`performance.now`). Vem de fora porque o
     * núcleo não lê relógio fora das portas (backend-design §3.4), e a porta `Clock` dá datas,
     * não durações.
     */
    readonly now: () => number;
    /** Quantas vezes cada operação roda; o p95 de poucas amostras é só o máximo. */
    readonly rounds: number;
    /** Competência mais antiga do banco, `YYYY-MM`: de onde sai a transação antiga editada. */
    readonly oldestPeriod: string;
    /** Competência consultada e de onde sai a fatura aberta, `YYYY-MM`. */
    readonly recentPeriod: string;
    /** "Hoje" do aparelho, `YYYY-MM-DD`: a data dos lançamentos novos. */
    readonly today: string;
}

/** O que a medição precisa achar no banco antes de começar. */
interface BenchmarkFixture {
    readonly profileId: string;
    readonly oldTransaction: TransactionResponse & { readonly container: { readonly kind: 'statement' } };
    readonly invoiceId: string;
}

/**
 * Mede as chamadas interativas sobre um banco já povoado — o de dez anos da Fase 1 — e devolve
 * p50, p95 e máximo de cada uma (mobile-mvp-plan, Fase 5). Fica no núcleo, e não no app, para
 * rodar igual no Node (a linha de base do desktop, `pnpm bench:core`) e no Hermes do aparelho:
 * a comparação só vale se o roteiro for o mesmo.
 *
 * Mede a chamada ao núcleo (`core.call`), que é o tempo em que a thread JavaScript fica presa;
 * o agendamento pós-frame do `DirectCoreClient` só adia esse tempo. Deixa as transações vivas
 * como encontrou: o lançamento novo é excluído fora da medição, e a edição alterna o valor um
 * centavo para cima e de volta, para que rodar de novo meça o mesmo banco. A exclusão é lógica
 * (a lápide da sincronização), então cada rodada deixa uma linha excluída — irrelevante perto
 * das dezenas de milhares do banco de dez anos.
 *
 * @param core Núcleo aberto sobre o banco a medir.
 * @param options Relógio, rodadas e as competências do banco.
 * @return As estatísticas, na ordem de `INTERACTIVE_OPERATIONS`.
 * @throws {Error} Quando o banco não tem o que a medição precisa (perfil, transação antiga numa
 * conta, fatura no mês recente), ou quando uma chamada falha: número de chamada que falhou não
 * mede nada.
 */
export async function runInteractiveBenchmark(core: Core, options: InteractiveBenchmarkOptions): Promise<readonly OperationStats[]> {
    const fixture = await findFixture(core, options);
    const samples = new Map<InteractiveOperation, number[]>(INTERACTIVE_OPERATIONS.map((operation) => [operation, []]));

    /**
     * @param operation Operação a que a amostra pertence.
     * @param work A chamada medida.
     * @return O que a chamada devolveu.
     */
    const timed = async <T>(operation: InteractiveOperation, work: () => Promise<T>): Promise<T> => {
        const startedAt = options.now();
        const result = await work();
        samples.get(operation)?.push(options.now() - startedAt);
        return result;
    };

    let edited = fixture.oldTransaction;
    for (let round = 0; round < options.rounds; round++) {
        const created = await timed('lançar', () => call(core, 'transactions.create', newTransaction(fixture, options.today, round)));
        await call(core, 'transactions.delete', { id: created.id });

        const delta = round % 2 === 0 ? 0.01 : -0.01;
        edited = statementExpense(await timed('editar antiga', () => call(core, 'transactions.update', editedValue(edited, delta))));

        await timed('consultar mês', () => call(core, 'transactions.listByPeriod', { profileId: fixture.profileId, period: options.recentPeriod }));
        await timed('abrir fatura', () => call(core, 'invoices.get', { invoiceId: fixture.invoiceId }));
    }
    if (edited.value.amount !== fixture.oldTransaction.value.amount) {
        await call(core, 'transactions.update', editedValue(edited, fixture.oldTransaction.value.amount - edited.value.amount));
    }
    return INTERACTIVE_OPERATIONS.map((operation) => summarize(operation, samples.get(operation) ?? []));
}

/**
 * Chama uma rota e devolve o dado, ou lança: a medição não tem como seguir sem o resultado.
 *
 * @param core Núcleo sob medição.
 * @param route Rota chamada.
 * @param input Entrada da rota.
 * @return O dado devolvido pela rota.
 * @throws {Error} Quando a rota devolve erro.
 */
async function call<R extends CoreRoute>(core: Core, route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
    const result = await core.call(route, input);
    if (!result.ok) {
        throw new Error(`medição: ${route} falhou (${result.error.code}): ${result.error.message}`);
    }
    return result.data;
}

/**
 * Acha no banco o perfil, a transação antiga e a fatura, pelas mesmas rotas que as telas usam,
 * em vez de ids fixos: o banco do aparelho pode ter vindo de outra geração.
 *
 * @param core Núcleo sobre o banco a medir.
 * @param options Competências de onde tirar a transação antiga e a fatura.
 * @return O que a medição usa.
 * @throws {Error} Quando falta perfil, transação antiga numa conta ou fatura no mês recente.
 */
async function findFixture(core: Core, options: InteractiveBenchmarkOptions): Promise<BenchmarkFixture> {
    const [profile] = await call(core, 'profiles.list', {});
    if (profile === undefined) {
        throw new Error('medição: o banco não tem perfil');
    }
    const oldest = await call(core, 'transactions.listByPeriod', { profileId: profile.id, period: options.oldestPeriod });
    const oldTransaction = oldest.find(isEditableStatementExpense);
    if (oldTransaction === undefined) {
        throw new Error(`medição: nenhuma despesa avulsa em conta em ${options.oldestPeriod}`);
    }
    const recent = await call(core, 'transactions.listByPeriod', { profileId: profile.id, period: options.recentPeriod });
    const invoice = recent.find((transaction) => transaction.container.kind === 'invoice')?.container;
    if (invoice?.kind !== 'invoice') {
        throw new Error(`medição: nenhuma fatura com compras em ${options.recentPeriod}`);
    }
    return { profileId: profile.id, oldTransaction, invoiceId: invoice.invoiceId };
}

/**
 * Despesa avulsa numa conta: editar só ela não pede escopo de série nem mexe em fatura, e o
 * recálculo que se quer medir é o da cadeia de saldos da conta.
 *
 * @param transaction Transação da competência mais antiga.
 * @return `true` quando serve de transação antiga da medição.
 */
function isEditableStatementExpense(transaction: TransactionResponse): transaction is BenchmarkFixture['oldTransaction'] {
    return transaction.container.kind === 'statement' && transaction.type === 'expense' && transaction.recurrenceId === null;
}

/**
 * Confere que a edição devolveu a transação ainda como despesa avulsa em conta, para a próxima
 * rodada editar a mesma transação com o tipo certo.
 *
 * @param transaction Transação devolvida pela edição.
 * @return A mesma transação, com o tipo estreitado.
 * @throws {Error} Quando a edição mudou o que a medição edita (o que seria defeito do núcleo).
 */
function statementExpense(transaction: TransactionResponse): BenchmarkFixture['oldTransaction'] {
    if (!isEditableStatementExpense(transaction)) {
        throw new Error('medição: a edição tirou a transação antiga da conta');
    }
    return transaction;
}

/**
 * @param fixture Conta e categoria tiradas da transação antiga.
 * @param today Data do lançamento.
 * @param round Rodada, para o nome variar como num uso real.
 * @return Um lançamento rápido, como o do celular: só os campos essenciais.
 */
function newTransaction(fixture: BenchmarkFixture, today: string, round: number): CoreInput<'transactions.create'> {
    return {
        profileId: fixture.profileId,
        type: 'expense',
        source: { kind: 'account', accountId: fixture.oldTransaction.container.accountId },
        subCategoryId: fixture.oldTransaction.subCategoryId,
        name: `Medição ${round + 1}`,
        value: 10 + round,
        dueDate: today,
        paymentDate: today,
    };
}

/**
 * Monta a edição completa que o formulário do desktop manda, mudando só o valor.
 *
 * @param transaction A transação como está.
 * @param delta Quanto somar ao valor.
 * @return A entrada de `transactions.update`.
 */
function editedValue(transaction: BenchmarkFixture['oldTransaction'], delta: number): CoreInput<'transactions.update'> {
    return {
        id: transaction.id,
        type: transaction.type,
        source: { kind: 'account', accountId: transaction.container.accountId },
        subCategoryId: transaction.subCategoryId,
        destinationAccountId: transaction.destinationAccountId,
        partnerId: transaction.partnerId,
        goalId: transaction.goalId,
        goalWithdrawal: transaction.goalWithdrawal,
        name: transaction.name,
        description: transaction.description,
        value: Math.round((transaction.value.amount + delta) * 100) / 100,
        charges: transaction.charges.amount,
        originCurrency: transaction.originCurrency,
        conversionRate: transaction.conversionRate,
        dueDate: transaction.dueDate,
        paymentDate: transaction.paymentDate,
        tagIds: [...transaction.tagIds],
    };
}

/**
 * Percentil pelo posto mais próximo, sem interpolação: com 40 amostras o p95 é a 38ª, um tempo
 * que de fato aconteceu, e não um valor inventado entre dois.
 *
 * @param operation Operação medida.
 * @param samples Durações em milissegundos.
 * @return As estatísticas arredondadas a 0,1 ms.
 */
function summarize(operation: InteractiveOperation, samples: readonly number[]): OperationStats {
    const sorted = [...samples].sort((a, b) => a - b);
    /**
     * @param ratio Percentil entre 0 e 1.
     * @return A amostra do posto mais próximo, ou 0 sem amostras.
     */
    const percentile = (ratio: number): number => round1(sorted[Math.max(0, Math.ceil(ratio * sorted.length) - 1)] ?? 0);
    return { operation, samples: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: round1(sorted.at(-1) ?? 0) };
}

/**
 * @param value Duração em milissegundos.
 * @return A duração com uma casa decimal, a precisão que o relatório usa.
 */
function round1(value: number): number {
    return Math.round(value * 10) / 10;
}

/**
 * Formata o resultado em linhas estáveis, iguais no terminal do Node e no `adb logcat`, para que
 * os números do desktop e do aparelho se comparem lado a lado.
 *
 * @param stats Estatísticas da medição.
 * @return Uma linha por operação, com o veredito contra o orçamento.
 */
export function formatBenchmarkLog(stats: readonly OperationStats[]): string {
    return stats
        .map((item) => {
            const verdict = item.p95 <= INTERACTIVE_P95_BUDGET_MS ? 'ok' : 'ESTOUROU';
            return `[medição] ${item.operation}: p50=${item.p50} ms p95=${item.p95} ms max=${item.max} ms (n=${item.samples}, ${verdict})`;
        })
        .join('\n');
}

import { LocalDate, YearMonth, type Core, type CoreInput, type CoreOutput, type CoreRoute } from '../../src/index.ts';
import { DEFAULT_HISTORY_OPTIONS, type HistoryOptions } from '../../src/benchmark/referenceHistory.ts';
import type { FixedClock } from './adapters.ts';

// As opções e as competências do banco de referência moram em `src/benchmark`, porque o app do
// celular também as usa; reexportadas aqui para os testes e os scripts do gerador.
export { DEFAULT_HISTORY_OPTIONS, historyPeriods, type HistoryOptions, type HistoryPeriods } from '../../src/benchmark/referenceHistory.ts';

/** O que o gerador criou, para o teste e o script conferirem o tamanho do banco. */
export interface HistorySummary {
    readonly months: number;
    readonly profiles: number;
    readonly transactions: number;
    readonly paidInvoices: number;
}

/** Origem de um lançamento, no formato da rota. */
type Source = CoreInput<'transactions.create'>['source'];

/** Os cadastros de um perfil que os lançamentos do mês usam. */
interface ProfileFixture {
    readonly profileId: string;
    readonly checking: Source;
    readonly checkingId: string;
    readonly savingsId: string;
    readonly cards: readonly { readonly id: string; readonly source: Source }[];
    readonly subCategories: readonly string[];
    readonly goalId: string;
}

/**
 * Gerador pseudoaleatório com semente (mulberry32). Existe porque o banco precisa ser
 * reproduzível — a medição da Fase 5 compara números entre aparelhos e entre versões, e um
 * banco diferente a cada geração tornaria a comparação inútil —, e o `Math.random` não aceita
 * semente.
 */
class SeededRandom {
    private state: number;

    /**
     * @param seed Semente inteira; a mesma semente dá a mesma sequência.
     */
    public constructor(seed: number) {
        this.state = seed >>> 0;
    }

    /**
     * @return O próximo número em [0, 1).
     */
    public next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    /**
     * @param min Menor inteiro possível.
     * @param max Maior inteiro possível.
     * @return Um inteiro em [min, max].
     */
    public integer(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    /**
     * @param min Menor valor.
     * @param max Maior valor.
     * @return Um valor em reais com centavos, para exercitar o arredondamento como dado real.
     */
    public amount(min: number, max: number): number {
        return this.integer(min * 100, max * 100) / 100;
    }

    /**
     * @param items Lista não vazia.
     * @return Um item sorteado.
     * @throws {Error} Quando a lista é vazia — o gerador montou o cenário errado.
     */
    public pick<T>(items: readonly T[]): T {
        const item = items[this.integer(0, items.length - 1)];
        if (item === undefined) {
            throw new Error('sorteio numa lista vazia');
        }
        return item;
    }
}

/**
 * Chama uma rota e devolve os dados, interrompendo a geração no primeiro erro. Um banco
 * gerado pela metade mediria menos do que deveria sem ninguém perceber.
 *
 * @param core Núcleo montado sobre o banco de destino.
 * @param route Rota chamada.
 * @param input Entrada da rota.
 * @return Os dados de sucesso.
 * @throws {Error} Quando a rota falha, com o código e os detalhes do erro.
 */
async function call<R extends CoreRoute>(core: Core, route: R, input: CoreInput<R>): Promise<CoreOutput<R>> {
    const result = await core.call(route, input);
    if (!result.ok) {
        throw new Error(`${route} falhou: ${result.error.code} ${result.error.message} ${JSON.stringify(result.error.details)}`);
    }
    return result.data;
}

/**
 * Monta um perfil completo pelas rotas do primeiro uso e dos cadastros: conta corrente, conta
 * de investimento, dois cartões com ciclos diferentes, as categorias sugeridas, uma meta por
 * lançamentos e uma meta vinculada à conta de investimento, e as séries fixas que um usuário
 * real teria (salário, aluguel, assinatura no cartão).
 *
 * @param core Núcleo montado sobre o banco de destino.
 * @param name Nome do perfil.
 * @param type Pessoal ou empresarial.
 * @param start Primeiro dia do histórico; as séries fixas começam nele.
 * @return Os cadastros que os lançamentos do mês usam.
 */
async function createProfile(core: Core, name: string, type: 'personal' | 'business', start: LocalDate): Promise<ProfileFixture> {
    const onboarding = await call(core, 'onboarding.start', {
        profile: { name, type, currency: 'BRL' },
        account: { name: 'Conta corrente', type: 'checking', openingBalance: 3500 },
        suggestedCategories: true,
    });
    const profileId = onboarding.profile.id;
    const checkingId = onboarding.account.id;
    const checking: Source = { kind: 'account', accountId: checkingId };
    const savings = await call(core, 'accounts.create', { profileId, name: 'Investimentos', type: 'investment', openingBalance: 10000 });
    // Em sequência, e não em `Promise.all`, para os ids sequenciais saírem sempre na mesma ordem.
    const cards = [
        await call(core, 'creditCards.create', { profileId, accountId: checkingId, name: 'Cartão principal', limit: 12000, closingDay: 3, dueDay: 10 }),
        await call(core, 'creditCards.create', { profileId, accountId: checkingId, name: 'Cartão adicional', limit: 5000, closingDay: 25, dueDay: 5 }),
    ];
    const tree = await call(core, 'categories.tree', { profileId });
    const subCategories = tree.flatMap((category) => category.subCategories.map((subCategory) => subCategory.id));
    const goal = await call(core, 'goals.create', { profileId, name: 'Viagem', value: 30000, targetDate: null });
    await call(core, 'goals.create', { profileId, name: 'Reserva de emergência', value: 60000, funding: { kind: 'account', accountId: savings.id } });

    const fixture: ProfileFixture = {
        profileId,
        checking,
        checkingId,
        savingsId: savings.id,
        cards: cards.map((card) => ({ id: card.id, source: { kind: 'creditCard', creditCardId: card.id, invoicePeriod: null } })),
        subCategories,
        goalId: goal.id,
    };
    const day = (n: number): string => LocalDate.clampedTo(start.period, n).toString();
    const fixed = { kind: 'fixed', frequency: 'monthly', endAt: null } as const;
    const firstSub = subCategories[0] ?? '';
    await call(core, 'transactions.create', { profileId, type: 'income', source: checking, subCategoryId: firstSub, name: type === 'business' ? 'Faturamento' : 'Salário', value: 9800, dueDate: day(5), repeat: fixed });
    await call(core, 'transactions.create', { profileId, type: 'expense', source: checking, subCategoryId: subCategories[1] ?? firstSub, name: 'Aluguel', value: 2450, dueDate: day(8), repeat: fixed });
    await call(core, 'transactions.create', { profileId, type: 'expense', source: fixture.cards[0]?.source ?? checking, subCategoryId: subCategories[2] ?? firstSub, name: 'Streaming', value: 39.9, dueDate: day(15), repeat: fixed });
    return fixture;
}

/**
 * Nomes dos lançamentos avulsos, com acento e caixa variados, para que a ordenação por nome
 * e as sugestões de nome trabalhem com o mesmo tipo de texto que o usuário digita.
 */
const EXPENSE_NAMES: readonly string[] = ['Mercado', 'Padaria', 'Farmácia', 'Posto de combustível', 'Restaurante', 'Açougue', 'Uber', 'Ótica', 'Cinema', 'Água e esgoto', 'Energia elétrica', 'Presente'];

/**
 * Lança o movimento de um mês num perfil: compras avulsas na conta e nos cartões, um
 * parcelado a cada poucos meses, a transferência para a meta e o pagamento das faturas e dos
 * lançamentos de conta que já venceram — o que um usuário real faria, para que o banco tenha
 * extratos pagos, faturas pagas e em aberto e cadeias de saldo longas.
 *
 * @param core Núcleo montado sobre o banco de destino.
 * @param clock Relógio do gerador, já no dia 28 do mês.
 * @param random Sorteio com semente.
 * @param profile Cadastros do perfil.
 * @return Quantos lançamentos e faturas pagas o mês criou.
 */
async function seedMonth(core: Core, clock: FixedClock, random: SeededRandom, profile: ProfileFixture): Promise<{ readonly transactions: number; readonly paidInvoices: number }> {
    const period = clock.today().period;
    const day = (n: number): string => LocalDate.clampedTo(period, n).toString();
    const base = { profileId: profile.profileId } as const;
    let transactions = 0;

    for (let index = random.integer(30, 50); index > 0; index--) {
        const onCard = random.next() < 0.6;
        const dueDate = day(random.integer(1, 28));
        await call(core, 'transactions.create', {
            ...base,
            type: 'expense',
            source: onCard ? random.pick(profile.cards).source : profile.checking,
            subCategoryId: random.pick(profile.subCategories),
            name: random.pick(EXPENSE_NAMES),
            value: random.amount(8, 480),
            dueDate,
            paymentDate: onCard ? null : dueDate,
        });
        transactions++;
    }
    if (period.month % 3 === 0) {
        await call(core, 'transactions.create', {
            ...base,
            type: 'expense',
            source: random.pick(profile.cards).source,
            subCategoryId: random.pick(profile.subCategories),
            name: random.pick(['Notebook', 'Geladeira', 'Passagem aérea', 'Sofá']),
            value: random.amount(900, 6000),
            dueDate: day(random.integer(1, 28)),
            repeat: { kind: 'installments', frequency: 'monthly', installments: random.integer(3, 12), valueType: 'total' },
        });
        transactions++;
    }
    await call(core, 'transactions.create', {
        ...base,
        type: 'transference',
        source: profile.checking,
        destinationAccountId: profile.savingsId,
        subCategoryId: random.pick(profile.subCategories),
        name: 'Guardar para a viagem',
        value: random.amount(200, 600),
        dueDate: day(20),
        paymentDate: day(20),
        goalId: profile.goalId,
    });
    transactions++;

    await call(core, 'recurrences.topUp', {});
    const paidInvoices = await payDueInvoices(core, clock, profile);
    await payDueAccountEntries(core, clock, profile.profileId);
    return { transactions, paidInvoices };
}

/**
 * Paga, no vencimento, as faturas com valor a pagar que vencem até hoje. É o que mantém o
 * saldo da conta corrente realista ao longo de dez anos e enche o banco de faturas pagas,
 * cujo vínculo com o extrato é o caminho mais caro das consultas de mês.
 *
 * @param core Núcleo montado sobre o banco de destino.
 * @param clock Relógio do gerador.
 * @param profile Cadastros do perfil.
 * @return Quantas faturas foram pagas.
 */
async function payDueInvoices(core: Core, clock: FixedClock, profile: ProfileFixture): Promise<number> {
    const today = clock.today();
    let paid = 0;
    for (const card of profile.cards) {
        const cycles = await call(core, 'invoices.listByCard', { creditCardId: card.id, from: today.period.plusMonths(-3).toString() });
        for (const cycle of cycles) {
            const invoice = cycle.invoice;
            if (invoice !== null && invoice.status === 'open' && invoice.amountDue.amount > 0 && !today.isBefore(LocalDate.parse(cycle.dueDate))) {
                await call(core, 'invoices.pay', { invoiceId: invoice.id, paymentDate: cycle.dueDate });
                paid++;
            }
        }
    }
    return paid;
}

/**
 * Marca como pagos os lançamentos de conta já vencidos — as ocorrências das séries fixas
 * nascem em aberto. Sem isso o histórico teria dez anos de salário e aluguel "atrasados",
 * o que nenhum usuário tem e distorceria a lista de pendências medida no Início.
 *
 * @param core Núcleo montado sobre o banco de destino.
 * @param clock Relógio do gerador.
 * @param profileId Perfil cujo mês corrente é conferido.
 */
async function payDueAccountEntries(core: Core, clock: FixedClock, profileId: string): Promise<void> {
    const today = clock.today();
    const entries = await call(core, 'transactions.listByPeriod', { profileId, period: today.period.toString() });
    for (const entry of entries) {
        if (!entry.paid && entry.container.kind === 'statement' && !today.isBefore(LocalDate.parse(entry.dueDate))) {
            await call(core, 'transactions.setPaid', { id: entry.id, paid: true });
        }
    }
}

/**
 * Gera um histórico de vários anos pelas rotas do núcleo, mês a mês, com o relógio andando
 * junto. Existe para a medição da Fase 5 do mobile-mvp-plan: o p95 de lançar, editar e
 * consultar só é significativo num banco do tamanho de um usuário antigo, e o mesmo arquivo
 * serve para medir o desktop. Passa pelas rotas, e não por SQL direto, para que extratos,
 * faturas e saldos em cache sejam os que o código de produção grava.
 *
 * @param core Núcleo montado sobre um banco vazio e já migrado.
 * @param clock Relógio que o núcleo usa; o gerador o move até o fim do histórico.
 * @param options Período e semente.
 * @return O tamanho do que foi gerado.
 */
export async function seedHistory(core: Core, clock: FixedClock, options: HistoryOptions = DEFAULT_HISTORY_OPTIONS): Promise<HistorySummary> {
    const random = new SeededRandom(options.seed);
    const months = options.years * 12;
    const first = YearMonth.parse(options.endMonth).plusMonths(1 - months);
    clock.set(LocalDate.of(first.year, first.month, 1).toString());

    const profiles = [
        await createProfile(core, 'Pessoal', 'personal', clock.today()),
        await createProfile(core, 'Empresa', 'business', clock.today()),
    ];
    let transactions = profiles.length * 3;
    let paidInvoices = 0;
    for (let offset = 0; offset < months; offset++) {
        const period = first.plusMonths(offset);
        clock.set(LocalDate.of(period.year, period.month, 28).toString());
        for (const profile of profiles) {
            const month = await seedMonth(core, clock, random, profile);
            transactions += month.transactions;
            paidInvoices += month.paidInvoices;
        }
    }
    return { months, profiles: profiles.length, transactions, paidInvoices };
}

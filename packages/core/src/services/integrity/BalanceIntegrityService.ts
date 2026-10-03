import type { Account } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import { BEGINNING_OF_TIME, type BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { BalanceDrift, BalanceIntegrityReport } from './BalanceIntegrity.ts';

/** Um saldo em cache lido do banco, identificado para ser pareado com o recalculado. */
type BalanceReading = Omit<BalanceDrift, 'cached' | 'recalculated'> & { readonly value: Money };

/**
 * Os saldos de uma conta lidos num instante da verificação. O cache da própria conta fica
 * separado das leituras da cadeia porque não é comparado campo a campo: o valor legítimo
 * dele depende de quando foi gravado, não só das transações.
 */
interface AccountSnapshot {
    readonly account: Account;
    /** Os quatro saldos de cada extrato vivo e o total de cada fatura que a conta quita. */
    readonly chain: readonly BalanceReading[];
    /**
     * Todo par que o cache da conta pode exibir sem ser desvio: o saldo inicial e o
     * fechamento de cada extrato até o mês corrente.
     */
    readonly displayable: readonly BalancePair[];
}

/**
 * Verificação de integridade mínima da abertura (backend-design §4.5, passo 5): confere
 * cada saldo em cache contra o que a rotina de recálculo produz do zero.
 * Regra de negócio (Saldos): um saldo recalculado que diverge do armazenado além do epsilon
 * da moeda é bug a ser **exposto, não corrigido em silêncio** (database-design §3.7) — por
 * isso o recálculo roda numa unidade de trabalho desfeita ao final e o resultado é só um
 * relatório para log. A correção continua sendo a ação explícita `balances.rebuildAccount`.
 *
 * Usa a própria rotina de recálculo como oráculo, em vez de um cálculo paralelo só de
 * leitura, porque duas implementações da mesma regra poderiam discordar entre si e o
 * relatório acusaria a divergência errada. Órfãs e anexos ausentes, as outras verificações
 * da rotina completa (database-design §3.10), ficam para quando houver o que as produza.
 */
export class BalanceIntegrityService {
    /**
     * @param unitOfWork Fornece a transação desfeita em que o recálculo roda.
     * @param accounts Contas conferidas e seus caches de saldo.
     * @param statements Cadeia de extratos de cada conta.
     * @param invoices Faturas dos cartões quitados por cada conta, cujo total entra no
     * extrato do pagamento.
     * @param recalculation A rotina de recálculo, oráculo da verificação.
     * @param clock Define o mês corrente, limite dos fechamentos que o cache da conta pode
     * exibir.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly accounts: AccountRepository,
        private readonly statements: BankStatementRepository,
        private readonly invoices: InvoiceRepository,
        private readonly recalculation: BalanceRecalculationService,
        private readonly clock: Clock,
    ) {}

    /**
     * O cache da conta é lido como está gravado — atualizá-lo antes da leitura apagaria
     * justamente o desvio que só existe nele.
     *
     * @return As contas conferidas e cada saldo em cache que o recálculo não reproduz; vazio
     * quando o banco está coerente. Nada é gravado.
     */
    public verifyBalances(): BalanceIntegrityReport {
        return this.unitOfWork.rehearse(() => {
            const currentMonth = this.clock.today().period;
            const before = this.accounts.listAll().map((account) => this.snapshotOf(account, currentMonth));

            for (const { account } of before) {
                this.recalculation.recalculateAccountFully(account.id);
            }
            const drifts = before.flatMap((cached) => {
                const rebuilt = this.accounts.findById(cached.account.id);
                if (rebuilt === null) {
                    return [];
                }
                const recalculated = this.snapshotOf(rebuilt, currentMonth);
                return [...accountCacheDrifts(cached, recalculated), ...compareReadings(cached.chain, recalculated.chain)];
            });

            return { checkedAccounts: before.length, drifts };
        });
    }

    /**
     * @param account Conta lida, com o cache de saldo.
     * @param currentMonth Mês corrente; extratos posteriores não entram nos pares exibíveis
     * porque nenhum cache gravado até hoje poderia apontá-los.
     * @return Os saldos derivados da cadeia da conta e os pares que o cache dela pode exibir.
     */
    private snapshotOf(account: Account, currentMonth: YearMonth): AccountSnapshot {
        const accountId = account.id;
        const chain: BalanceReading[] = [];
        const displayable = [BalancePair.same(account.openingBalance.rounded())];

        for (const statement of this.statements.listFrom(accountId, BEGINNING_OF_TIME)) {
            const fields = [
                ...pairReadings(statement.opening, 'openingConsolidated', 'openingProjected'),
                ...pairReadings(statement.closing, 'closingConsolidated', 'closingProjected'),
            ];
            for (const { field, value } of fields) {
                chain.push({ accountId, subject: 'statement', subjectId: statement.id, period: statement.period, field, value });
            }
            if (!currentMonth.isBefore(statement.period)) {
                displayable.push(statement.closing);
            }
        }

        for (const invoiceId of this.invoices.listIdsByPayingAccount(accountId)) {
            const invoice = this.invoices.findById(invoiceId);
            if (invoice !== null) {
                chain.push({ accountId, subject: 'invoice', subjectId: invoice.id, period: invoice.period, field: 'total', value: invoice.balance });
            }
        }
        return { account, chain, displayable };
    }
}

/**
 * Confere o cache gravado da conta. Ele não precisa ser igual ao recalculado: na virada do
 * mês ainda aponta o fechamento de um mês anterior, o que não é desvio — é o que a leitura
 * de saldos já corrige a cada consulta (`AccountBalanceService`). Desvio é o cache não
 * corresponder a nenhum estado que ele poderia ter tido legitimamente: o saldo inicial ou o
 * fechamento de algum extrato até o mês corrente, na cadeia gravada ou na recalculada — a
 * recalculada entra para que um extrato adulterado seja acusado só nele, e não também na
 * conta que ainda exibe o valor certo.
 *
 * A troca aceita: um cache errado que coincida com um fechamento antigo passa despercebido,
 * porque sem a data da última gravação do saldo não há como distingui-lo de um cache
 * legítimo de meses atrás.
 *
 * @param cached A conta e a cadeia como estavam gravadas.
 * @param recalculated A conta e a cadeia depois do recálculo completo.
 * @return Os lados do par da conta que divergem do recalculado; vazio quando o cache gravado
 * é um estado legítimo.
 */
function accountCacheDrifts(cached: AccountSnapshot, recalculated: AccountSnapshot): readonly BalanceDrift[] {
    const stored = cached.account.balances;
    const legitimate = [...cached.displayable, ...recalculated.displayable].some((pair) => pair.equals(stored));
    if (legitimate) {
        return [];
    }

    const accountId = cached.account.id;
    const current = new Map(pairReadings(recalculated.account.balances, 'consolidated', 'projected').map(({ field, value }) => [field, value]));
    return pairReadings(stored, 'consolidated', 'projected').flatMap(({ field, value }): readonly BalanceDrift[] => {
        const rebuilt = current.get(field);
        return rebuilt === undefined || value.equals(rebuilt)
            ? []
            : [{ accountId, subject: 'account', subjectId: accountId, period: null, field, cached: value, recalculated: rebuilt }];
    });
}

/**
 * @param pair Par consolidado/previsto lido do cache.
 * @param consolidated Nome do campo do lado consolidado.
 * @param projected Nome do campo do lado previsto.
 * @return Os dois lados como leituras separadas, para que o log diga qual deles divergiu.
 */
function pairReadings<F extends BalanceDrift['field']>(pair: BalancePair, consolidated: F, projected: F): readonly { readonly field: F; readonly value: Money }[] {
    return [{ field: consolidated, value: pair.consolidated }, { field: projected, value: pair.projected }];
}

/**
 * Pareia pelo id do objeto e pelo campo. Um extrato que só existe depois do recálculo é
 * desvio também: um mês com movimento ficou fora da cadeia.
 *
 * @param cached Saldos como estavam gravados.
 * @param recalculated Saldos depois do recálculo completo.
 * @return Os desvios além do epsilon da moeda, na ordem das leituras recalculadas.
 */
function compareReadings(cached: readonly BalanceReading[], recalculated: readonly BalanceReading[]): readonly BalanceDrift[] {
    const before = new Map(cached.map((reading) => [readingKey(reading), reading.value]));
    return recalculated.flatMap(({ value, ...identity }) => {
        const stored = before.get(readingKey(identity)) ?? null;
        return stored !== null && stored.equals(value) ? [] : [{ ...identity, cached: stored, recalculated: value }];
    });
}

/**
 * @param reading Identificação de uma leitura.
 * @return Chave única do saldo: ids são UUIDs distintos entre tabelas, então o id e o campo
 * bastam.
 */
function readingKey(reading: Pick<BalanceReading, 'subjectId' | 'field'>): string {
    return `${reading.subjectId}:${reading.field}`;
}

import type { Account } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import { invoiceBalance, MonthlyMovement } from '../../domain/balance/MonthlyMovement.ts';
import { currentAccountBalances, periodsMissingStatement, recomputeChain } from '../../domain/balance/StatementChain.ts';
import type { AccountId, InvoiceId } from '../../domain/shared/ids.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import { BankStatement } from '../../domain/statement/BankStatement.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { BalanceLedgerRepository } from '../../repositories/BalanceLedgerRepository.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { BalanceImpact } from './BalanceImpact.ts';

/** Primeira competência que o schema aceita; recalcular dela em diante é recalcular tudo. */
export const BEGINNING_OF_TIME = YearMonth.of(1900, 1);

/**
 * A rotina de recálculo de saldos — **uma** rotina, chamada pelo lançamento, pelo
 * pagamento de fatura e pelo reparo (backend-design §3.3). Saldos em cache nunca são
 * incrementados: são sempre reconstruídos a partir das transações, porque incrementar
 * acumula erro de float a cada escrita e transforma qualquer bug pontual em desvio
 * permanente. O custo é uma consulta agregada por conta afetada.
 */
export class BalanceRecalculationService {
    /**
     * @param unitOfWork Garante que o recálculo aconteça na mesma transação da escrita que o
     * motivou — um saldo nunca fica visível pela metade.
     * @param accounts Fonte do saldo inicial da conta e destino do cache de saldo.
     * @param statements Cadeia de extratos a reconstruir.
     * @param invoices Faturas cujo total é refeito antes da cadeia das contas.
     * @param ledger Somas agregadas no SQL que alimentam o movimento mensal.
     * @param clock Define o mês corrente, cujo fechamento vira o saldo exibido da conta.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly accounts: AccountRepository,
        private readonly statements: BankStatementRepository,
        private readonly invoices: InvoiceRepository,
        private readonly ledger: BalanceLedgerRepository,
        private readonly clock: Clock,
    ) {}

    /**
     * Aplica um impacto acumulado. As faturas vêm **antes** das contas porque o total de uma
     * fatura paga entra no extrato do pagamento: recalcular a conta com o total antigo da
     * fatura gravaria um fechamento errado.
     *
     * @param impact Faturas e contas afetadas pela escrita.
     * @return void
     */
    public apply(impact: BalanceImpact): void {
        this.unitOfWork.run(() => {
            for (const invoiceId of impact.invoices) {
                this.recalculateInvoice(invoiceId);
            }
            for (const [accountId, from] of impact.accounts) {
                this.recalculateAccount(accountId, from);
            }
        });
    }

    /**
     * Reconstrói todos os saldos de uma conta desde o primeiro extrato — faturas dos cartões
     * que ela quita, cadeia inteira e cache. É a ferramenta de reparo e o oráculo dos testes
     * (database-design §3.7).
     *
     * @param accountId Conta a reconstruir.
     * @return void
     */
    public recalculateAccountFully(accountId: AccountId): void {
        this.unitOfWork.run(() => {
            for (const invoiceId of this.invoices.listIdsByPayingAccount(accountId)) {
                this.recalculateInvoice(invoiceId);
            }
            this.recalculateAccount(accountId, BEGINNING_OF_TIME);
        });
    }

    /**
     * Atualiza só o cache de saldo exibido da conta, sem refazer a cadeia. Existe para a
     * virada do mês: o "mês corrente" muda sem que nenhuma transação mude, e o cache passaria
     * a mostrar o fechamento do mês anterior.
     *
     * @param account Conta cujo cache é conferido.
     * @return A conta com o cache em dia; gravada só quando algo mudou.
     */
    public refreshCurrentBalance(account: Account): Account {
        return this.unitOfWork.run(() => {
            const current = this.currentBalancesOf(account);
            if (current.equals(account.balances)) {
                return account;
            }
            const refreshed = account.withBalances(current);
            this.accounts.saveBalances(refreshed);
            return refreshed;
        });
    }

    /**
     * @param invoiceId Fatura cujo total é refeito; ignorada se tiver sido excluída na mesma
     * unidade de trabalho.
     * @return void
     */
    private recalculateInvoice(invoiceId: InvoiceId): void {
        const invoice = this.invoices.findById(invoiceId);
        if (invoice === null) {
            return;
        }
        const balance = invoiceBalance(invoice.balance.currency, this.ledger.invoiceTypeTotals(invoiceId, invoice.balance.currency));
        if (!balance.equals(invoice.balance)) {
            this.invoices.saveBalance(invoice.withBalance(balance));
        }
    }

    /**
     * Refaz a cadeia de fechamentos de `from` em diante.
     * Regra de negócio (Extrato): o inicial do trecho é o fechamento do extrato vivo
     * anterior, ou o `opening_balance` da conta quando não há anterior (database-design §4.6);
     * meses com movimento e sem extrato ganham um, para que nada fique fora da cadeia.
     *
     * @param accountId Conta a recalcular; ignorada se tiver sido excluída.
     * @param from Primeiro mês afetado pela escrita.
     * @return void
     */
    private recalculateAccount(accountId: AccountId, from: YearMonth): void {
        const account = this.accounts.findById(accountId);
        if (account === null) {
            return;
        }
        const currency = account.openingBalance.currency;
        const movement = MonthlyMovement.from(currency, this.ledger.movementSources(accountId, from, currency));
        const previous = this.statements.findLatestBefore(accountId, from);
        const start = previous?.closing ?? BalancePair.same(account.openingBalance.rounded());

        const existing = this.statements.listFrom(accountId, from);
        const missing = periodsMissingStatement(from, existing.map((statement) => statement.period), movement);
        for (const period of missing) {
            this.statements.insertOrRevive(BankStatement.open(accountId, period, start));
        }
        // Relê depois de abrir os meses que faltavam: a linha revivida traz saldos antigos, e
        // a cadeia precisa da lista completa e ordenada que o banco devolve.
        const chain = missing.length === 0 ? existing : this.statements.listFrom(accountId, from);
        const recomputed = recomputeChain(start, chain, movement);
        recomputed.forEach((statement, index) => {
            // Só grava o que mudou: um recálculo que não altera nada não deve carimbar
            // `updated_at` em meses inteiros, que é o rastro de revisão do histórico.
            const before = chain[index];
            if (before === undefined || !statement.hasSameBalancesAs(before)) {
                this.statements.saveBalances(statement);
            }
        });

        const current = this.currentBalancesOf(account);
        if (!current.equals(account.balances)) {
            this.accounts.saveBalances(account.withBalances(current));
        }
    }

    /**
     * @param account Conta consultada.
     * @return O fechamento do último extrato até o mês corrente, ou o saldo inicial da conta.
     */
    private currentBalancesOf(account: Account): BalancePair {
        const nextMonth = this.clock.today().period.next();
        return currentAccountBalances(
            BalancePair.same(account.openingBalance.rounded()),
            this.statements.findLatestBefore(account.id, nextMonth),
        );
    }
}

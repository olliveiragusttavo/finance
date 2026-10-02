import type { Account } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import { Invoice } from '../../domain/invoice/Invoice.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import type { AccountId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { BankStatement } from '../../domain/statement/BankStatement.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { StatementView } from './StatementView.ts';

/**
 * Consolidação mensal: garante os contêineres (extrato e fatura) em que as transações
 * caem e monta o extrato do mês. Os saldos são lidos do cache que a rotina de recálculo
 * mantém — esta camada nunca soma transações para chegar a um saldo, para que exista uma
 * só fonte do número (backend-design §3.3).
 */
export class StatementConsolidationService {
    /**
     * @param unitOfWork Unidade de trabalho compartilhada com quem garante contêineres.
     * @param accounts Conta dona do extrato e seu saldo inicial.
     * @param statements Extratos mensais.
     * @param invoices Faturas pagas no mês e em aberto que vencem nele.
     * @param transactions Transações do extrato e transferências que chegam.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly accounts: AccountRepository,
        private readonly statements: BankStatementRepository,
        private readonly invoices: InvoiceRepository,
        private readonly transactions: TransactionRepository,
    ) {}

    /**
     * Garante o extrato de uma conta num mês, criando ou revivendo a linha.
     * Regra de negócio (Extrato): uma linha por conta por mês (database-design §4.6). O
     * extrato nasce com saldos provisórios; quem o garante precisa incluir a conta no
     * impacto de recálculo da mesma unidade de trabalho, que os corrige.
     *
     * @param account Conta dona do extrato.
     * @param period Competência do extrato.
     * @return O extrato vivo.
     */
    public ensureStatement(account: Account, period: YearMonth): BankStatement {
        return this.unitOfWork.run(() => {
            const existing = this.statements.findByPeriod(account.id, period);
            if (existing !== null) {
                return existing;
            }
            this.statements.insertOrRevive(BankStatement.open(account.id, period, BalancePair.zero(account.openingBalance.currency)));
            return this.require(this.statements.findByPeriod(account.id, period), 'BankStatement', `${account.id}:${period.toString()}`);
        });
    }

    /**
     * Garante a fatura de um cartão num mês, criando ou revivendo a linha, em aberto.
     * Regra de negócio (Fatura): uma linha por cartão por mês (database-design §4.7).
     *
     * @param creditCard Cartão dono da fatura.
     * @param period Competência da fatura.
     * @return A fatura viva.
     */
    public ensureInvoice(creditCard: CreditCard, period: YearMonth): Invoice {
        return this.unitOfWork.run(() => {
            const existing = this.invoices.findByPeriod(creditCard.id, period);
            if (existing !== null) {
                return existing;
            }
            this.invoices.insertOrRevive(Invoice.open(creditCard.id, period, Money.zero(creditCard.limit.currency)));
            return this.require(this.invoices.findByPeriod(creditCard.id, period), 'Invoice', `${creditCard.id}:${period.toString()}`);
        });
    }

    /**
     * Monta o extrato consolidado de um mês. Um mês sem linha não é erro — é um mês sem
     * movimento, cujo inicial e final são o fechamento anterior (database-design §4.6).
     *
     * @param accountId Conta consultada.
     * @param period Competência consultada.
     * @return O extrato do mês com os saldos e o que os compõe.
     * @throws {NotFoundError} Quando a conta não existe ou foi excluída.
     */
    public getStatement(accountId: AccountId, period: YearMonth): StatementView {
        return this.unitOfWork.run(() => {
            const account = this.require(this.accounts.findById(accountId), 'Account', accountId);
            const statement = this.statements.findByPeriod(accountId, period);
            const opening = statement?.opening
                ?? this.statements.findLatestBefore(accountId, period)?.closing
                ?? BalancePair.same(account.openingBalance.rounded());
            return {
                account,
                period,
                exists: statement !== null,
                opening,
                closing: statement?.closing ?? opening,
                transactions: statement === null ? [] : this.transactions.listByStatement(statement.id),
                incomingTransfers: this.transactions.listIncoming(accountId, period),
                paidInvoices: statement === null ? [] : this.invoices.listPaidInStatement(statement.id),
                openInvoicesDue: this.invoices
                    .listOpenByPayingAccount(accountId, period.year === 1900 && period.month === 1 ? period : period.previous())
                    .filter(({ invoice, creditCard }) => creditCard.billingCycle.dueDateOf(invoice.period).period.equals(period)),
            };
        });
    }

    /**
     * @param value Resultado de uma busca.
     * @param entity Entidade buscada, para o erro.
     * @param id Identificador buscado, para o erro.
     * @return O valor encontrado.
     * @throws {NotFoundError} Quando a busca não encontrou nada.
     */
    private require<T>(value: T | null, entity: string, id: string): T {
        if (value === null) {
            throw new NotFoundError(entity, id);
        }
        return value;
    }
}

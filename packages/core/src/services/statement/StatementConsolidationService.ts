import type { Account } from '../../domain/account/Account.ts';
import { BalancePair } from '../../domain/balance/BalancePair.ts';
import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import { Invoice } from '../../domain/invoice/Invoice.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import type { AccountId, BankStatementId, ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { BankStatement } from '../../domain/statement/BankStatement.ts';
import { statementFlows } from '../../domain/statement/StatementFlows.ts';
import { destinationEffect } from '../../domain/transaction/TransactionType.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { BankStatementRepository } from '../../repositories/BankStatementRepository.ts';
import type { InvoiceRepository, InvoiceWithCard } from '../../repositories/InvoiceRepository.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { OpenInvoiceDue, ProfileInvoiceView, StatementView } from './StatementView.ts';

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
     * @param profiles Perfil dono das contas, conferido nas faturas do perfil no mês.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly accounts: AccountRepository,
        private readonly statements: BankStatementRepository,
        private readonly invoices: InvoiceRepository,
        private readonly transactions: TransactionRepository,
        private readonly profiles: ProfileRepository,
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
     * Entradas e saídas saem dos mesmos movimentos listados, com a regra de efeito e de
     * consolidado × previsto do recálculo, para que a tela nunca mostre um total que a tabela
     * não explica.
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
            const transactions = statement === null ? [] : this.transactions.listByStatement(statement.id);
            const incomingTransfers = this.transactions.listIncoming(accountId, period);
            const { paidInvoices, openInvoicesDue } = this.monthInvoices(accountId, statement?.id ?? null, period);
            const flows = statementFlows(opening.consolidated.currency, [
                ...transactions.map((transaction) => ({ effect: transaction.originEffect(), settled: transaction.isPaid() })),
                ...incomingTransfers.map((transaction) => ({ effect: destinationEffect(transaction.value), settled: transaction.isPaid() })),
                ...paidInvoices.map(({ invoice }) => ({ effect: invoice.balance, settled: true })),
                ...openInvoicesDue.map(({ invoice }) => ({ effect: invoice.balance, settled: false })),
            ]);
            return {
                account,
                period,
                exists: statement !== null,
                opening,
                closing: statement?.closing ?? opening,
                inflows: flows.inflows,
                outflows: flows.outflows,
                transactions,
                incomingTransfers,
                paidInvoices,
                openInvoicesDue,
            };
        });
    }

    /**
     * Faturas que pesam no saldo das contas do perfil num mês, com a data de caixa de cada uma.
     * Regra de negócio (Extrato e Transações): a fatura paga conta no dia do pagamento, no
     * extrato em que foi paga; a em aberto, no dia do vencimento (database-design §4.7 e §4.13).
     * Usa o mesmo critério do extrato de cada conta (`openFrom` e `dueIn`), para que a linha da
     * fatura em Transações e a do extrato nunca discordem sobre o mês, o dia e o valor
     * (desktop-mvp-plan Fase 11.1). As consultas são por perfil, e não por conta, porque a lista é
     * refeita a cada escrita de transação: por conta, o custo cresceria com o número de contas.
     *
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @return As faturas do mês de todas as contas do perfil, desativadas incluídas, pela data de
     * caixa; a paga sem dia gravado vem por último, com a data `null`.
     * @throws {NotFoundError} Quando o perfil não existe ou foi excluído.
     */
    public listProfileInvoices(profileId: ProfileId, period: YearMonth): readonly ProfileInvoiceView[] {
        return this.unitOfWork.run(() => {
            this.require(this.profiles.findById(profileId), 'Profile', profileId);
            const accounts = new Map(this.accounts.listByProfile(profileId).map((account) => [account.id, account]));
            const paid = this.invoices.listPaidInProfileStatements(profileId, period).flatMap(({ accountId, ...entry }): ProfileInvoiceView[] => {
                const account = accounts.get(accountId);
                return account === undefined ? [] : [{ ...entry, account, cashDate: entry.invoice.payment?.date ?? null }];
            });
            const open = dueIn(this.invoices.listOpenByPayingProfile(profileId, openFrom(period)), period).flatMap((entry): ProfileInvoiceView[] => {
                const account = accounts.get(entry.creditCard.accountId);
                return account === undefined ? [] : [{ invoice: entry.invoice, creditCard: entry.creditCard, account, cashDate: entry.dueDate }];
            });
            return [...paid, ...open].sort((a, b) => compareCashDates(a.cashDate?.toString() ?? null, b.cashDate?.toString() ?? null));
        });
    }

    /**
     * As duas fontes de fatura do extrato de uma conta. Num lugar só porque o extrato e as
     * faturas do perfil precisam usar exatamente o mesmo critério.
     * Regra de negócio (Extrato): a fatura paga entra no extrato em que foi paga; a em aberto,
     * no mês do vencimento — que é o da competência seguinte ou o da própria, conforme o ciclo,
     * por isso a busca começa na competência anterior (database-design §4.7).
     *
     * @param accountId Conta que quita os cartões.
     * @param statementId Extrato da conta no mês; `null` quando o mês não tem extrato, e então
     * nenhuma fatura foi paga nele.
     * @param period Mês do extrato.
     * @return As faturas pagas no extrato e as em aberto que vencem no mês.
     */
    private monthInvoices(accountId: AccountId, statementId: BankStatementId | null, period: YearMonth): { readonly paidInvoices: readonly InvoiceWithCard[]; readonly openInvoicesDue: readonly OpenInvoiceDue[] } {
        const paidInvoices = statementId === null ? [] : this.invoices.listPaidInStatement(statementId);
        const openInvoicesDue = dueIn(this.invoices.listOpenByPayingAccount(accountId, openFrom(period)), period);
        return { paidInvoices, openInvoicesDue };
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

/**
 * Primeira competência em que uma fatura em aberto pode vencer no mês: a do mês anterior, porque
 * o vencimento cai na competência seguinte ou na própria, conforme o ciclo (database-design §4.7).
 * Num lugar só para que o extrato de uma conta e as faturas do perfil usem o mesmo corte.
 *
 * @param period Mês do extrato.
 * @return A competência anterior; no primeiro mês do calendário, que não tem anterior, o próprio.
 */
function openFrom(period: YearMonth): YearMonth {
    return period.year === 1900 && period.month === 1 ? period : period.previous();
}

/**
 * Regra de negócio (Extrato): a fatura em aberto pesa no previsto do mês do vencimento
 * (database-design §4.7). Compartilhado pelo extrato e pelas faturas do perfil, para que os dois
 * nunca discordem sobre o mês.
 *
 * @param entries Faturas em aberto a partir de `openFrom(period)`, com o cartão.
 * @param period Mês do extrato.
 * @return As que vencem no mês, com a data do vencimento.
 */
function dueIn(entries: readonly InvoiceWithCard[], period: YearMonth): readonly OpenInvoiceDue[] {
    return entries
        .map((entry) => ({ ...entry, dueDate: entry.creditCard.billingCycle.dueDateOf(entry.invoice.period) }))
        .filter(({ dueDate }) => dueDate.period.equals(period));
}

/**
 * @param a Primeira data `YYYY-MM-DD`, ou `null`.
 * @param b Segunda data, ou `null`.
 * @return Ordem cronológica, com as datas desconhecidas depois de todas as conhecidas — a fatura
 * paga sem dia gravado não tem lugar certo no mês.
 */
function compareCashDates(a: string | null, b: string | null): number {
    if (a === null || b === null) {
        return a === b ? 0 : a === null ? 1 : -1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
}

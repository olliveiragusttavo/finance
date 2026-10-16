import type { Account } from '../../domain/account/Account.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import type { AccountId, CreditCardId } from '../../domain/shared/ids.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { DeletionRepository, DeletionScope } from '../../repositories/DeletionRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { DeletionImpact } from './DeletionImpact.ts';

/**
 * Exclusão em cadeia de conta e de cartão, e o alerta que a antecede.
 * Regra de negócio (Contas e Cartões): excluir é a ação explícita; o app mostra antes
 * **tudo o que será apagado junto** e nomeia as outras contas cujo saldo vai mudar, e só
 * depois da confirmação apaga a cadeia inteira — soft delete numa única unidade de
 * trabalho, seguido do recálculo das contas afetadas (desktop-mvp-plan §5.1). É soft, e não
 * `DELETE`, porque a sincronização propaga exclusões por `deleted_at` (database-design §3.6).
 *
 * Alerta e exclusão partem do mesmo `DeletionScope`, calculado pela mesma consulta: é a
 * mitigação do risco de apagar mais (ou menos) do que o alerta mostrou.
 */
export class CascadeDeletionService {
    /**
     * @param unitOfWork Exclusão e recálculo numa transação só: um saldo nunca fica visível
     * com metade da cadeia apagada.
     * @param deletions Calcula e aplica o escopo.
     * @param accounts Conta excluída e contas afetadas.
     * @param creditCards Cartão excluído.
     * @param invoices Faturas que voltam a ficar em aberto.
     * @param transactions Soft delete de cada transação, com tags e anexos.
     * @param recalculation A rotina única de recálculo.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly deletions: DeletionRepository,
        private readonly accounts: AccountRepository,
        private readonly creditCards: CreditCardRepository,
        private readonly invoices: InvoiceRepository,
        private readonly transactions: TransactionRepository,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * @param accountId Conta que o usuário quer excluir.
     * @return O que a exclusão apagaria e as outras contas cujo saldo mudaria. Nada é gravado.
     * @throws {NotFoundError} Quando a conta não existe.
     */
    public accountImpact(accountId: AccountId): DeletionImpact {
        return this.unitOfWork.run(() => this.describe(this.accountScope(accountId)));
    }

    /**
     * @param accountId Conta a excluir, com a cadeia inteira.
     * @return void
     * @throws {NotFoundError} Quando a conta não existe.
     */
    public deleteAccount(accountId: AccountId): void {
        this.unitOfWork.run(() => {
            this.execute(this.accountScope(accountId));
        });
    }

    /**
     * @param creditCardId Cartão que o usuário quer excluir.
     * @return O que a exclusão apagaria e as contas cujo saldo mudaria. Nada é gravado.
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public creditCardImpact(creditCardId: CreditCardId): DeletionImpact {
        return this.unitOfWork.run(() => this.describe(this.creditCardScope(creditCardId)));
    }

    /**
     * @param creditCardId Cartão a excluir, com faturas e lançamentos.
     * @return void
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public deleteCreditCard(creditCardId: CreditCardId): void {
        this.unitOfWork.run(() => {
            this.execute(this.creditCardScope(creditCardId));
        });
    }

    /**
     * @param accountId Conta a excluir.
     * @return O escopo da exclusão.
     * @throws {NotFoundError} Quando a conta não existe.
     */
    private accountScope(accountId: AccountId): DeletionScope {
        if (this.accounts.findById(accountId) === null) {
            throw new NotFoundError('Account', accountId);
        }
        return this.deletions.accountScope(accountId);
    }

    /**
     * @param creditCardId Cartão a excluir.
     * @return O escopo da exclusão.
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    private creditCardScope(creditCardId: CreditCardId): DeletionScope {
        if (this.creditCards.findById(creditCardId) === null) {
            throw new NotFoundError('CreditCard', creditCardId);
        }
        return this.deletions.creditCardScope(creditCardId);
    }

    /**
     * @param scope Escopo calculado.
     * @return O escopo e as contas sobreviventes afetadas.
     */
    private describe(scope: DeletionScope): DeletionImpact {
        return {
            scope,
            affectedAccounts: this.survivingAccounts(scope).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
        };
    }

    /**
     * Apaga o escopo e recalcula as contas que sobrevivem. O recálculo é completo, e não a
     * partir de um mês, porque uma exclusão em cadeia toca meses quaisquer de cada conta; é
     * uma ação rara, e o recálculo completo é o mesmo oráculo do reparo (database-design §3.7).
     *
     * @param scope Escopo calculado na mesma unidade de trabalho.
     * @return void
     */
    private execute(scope: DeletionScope): void {
        const survivors = this.survivingAccounts(scope);
        for (const transaction of scope.transactions) {
            this.transactions.softDelete(transaction.id);
        }
        for (const invoiceId of scope.reopenedInvoices) {
            const invoice = this.invoices.findById(invoiceId);
            if (invoice?.isPaid() === true) {
                this.invoices.savePayment(invoice.reopen());
            }
        }
        this.deletions.softDeleteContainers(scope);
        for (const account of survivors) {
            this.recalculation.recalculateAccountFully(account.id);
        }
    }

    /**
     * @param scope Escopo calculado.
     * @return As contas tocadas pelo escopo que não são excluídas por ele e continuam vivas.
     */
    private survivingAccounts(scope: DeletionScope): Account[] {
        return scope.touchedAccounts
            .filter((accountId) => !scope.accounts.includes(accountId))
            .map((accountId) => this.accounts.findById(accountId))
            .filter((account): account is Account => account !== null);
    }
}

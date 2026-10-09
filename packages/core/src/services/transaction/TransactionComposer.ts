import type { Account } from '../../domain/account/Account.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import type { AccountId, CreditCardId, ProfileId, TransactionId } from '../../domain/shared/ids.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Transaction, TransactionContent } from '../../domain/transaction/Transaction.ts';
import type { TransactionContainer } from '../../domain/transaction/TransactionContainer.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { GoalRepository } from '../../repositories/GoalRepository.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import type { ReferenceRepository } from '../../repositories/ReferenceRepository.ts';
import type { TagRepository } from '../../repositories/TagRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import { BalanceImpact } from '../balance/BalanceImpact.ts';
import type { InvoiceService } from '../invoice/InvoiceService.ts';
import type { StatementConsolidationService } from '../statement/StatementConsolidationService.ts';
import type { TransactionInput } from './TransactionCommands.ts';

/** Contêiner resolvido para uma escrita, com o que a resolução em si obrigou a recalcular. */
export interface ResolvedContainer {
    readonly container: TransactionContainer;
    readonly impact: BalanceImpact;
}

/**
 * Como a escrita trata conta e cartão desativados.
 * - `newChoice`: lançamento escolhido pelo usuário — desativado é recusado, menos o que o
 *   lançamento editado já usava (desktop-mvp-plan §5.1);
 * - `generated`: ocorrência emitida por uma recorrência — aceito, porque a série continua
 *   emitindo com a conta ou o cartão desativado (database-design §4.12).
 */
export type SelectionPolicy = 'newChoice' | 'generated';

/**
 * Monta e confere o conteúdo de um lançamento antes de gravá-lo. É o **ponto único de
 * controle** das regras que relacionam colunas e linhas e que o banco deliberadamente não
 * garante — posse das referências pelo mesmo perfil, sócio só em perfil empresarial, fatura do
 * mesmo cartão (database-design §3.10). Fica fora do `TransactionService` porque o
 * `RecurrenceService` grava lançamentos pelas mesmas regras: duas cópias divergiriam.
 */
export class TransactionComposer {
    /**
     * @param profiles Perfil dono: moeda e tipo.
     * @param accounts Conta de origem ou de destino.
     * @param creditCards Cartão de origem e o ciclo que sugere a fatura.
     * @param transactions Transações.
     * @param references Posse do sócio.
     * @param categories Posse da subcategoria.
     * @param tags Posse das tags.
     * @param goals Posse da meta.
     * @param consolidation Garante extrato e fatura em que a transação cai.
     * @param invoiceService Reabre a fatura paga escolhida para um lançamento.
     */
    public constructor(
        private readonly profiles: ProfileRepository,
        private readonly accounts: AccountRepository,
        private readonly creditCards: CreditCardRepository,
        private readonly transactions: TransactionRepository,
        private readonly references: ReferenceRepository,
        private readonly categories: CategoryRepository,
        private readonly tags: TagRepository,
        private readonly goals: GoalRepository,
        private readonly consolidation: StatementConsolidationService,
        private readonly invoiceService: InvoiceService,
    ) {}

    /**
     * Verifica que toda referência existe e pertence ao perfil. A chave estrangeira só
     * garante a existência; perfis pessoal e empresarial precisam ficar estritamente
     * separados (database-design §3.8) — a única exceção é a conta de destino de uma
     * transferência (`requireDestination`).
     *
     * @param profile Perfil dono da transação.
     * @param input Referências a verificar.
     * @param current Estado atual numa edição; `null` num lançamento novo.
     * @return void
     * @throws {NotFoundError} Quando uma referência não existe.
     * @throws {BusinessRuleViolation} Quando pertence a outro perfil (fora a transferência entre
     * perfis aceita por `requireDestination`), há sócio num perfil pessoal ou a conta de destino
     * escolhida está desativada.
     */
    public assertReferences(profile: Profile, input: TransactionInput, current: Transaction | null): void {
        this.assertOwnedBy(profile, 'subCategoryId', input.subCategoryId, this.categories.findSubCategory(input.subCategoryId)?.profileId ?? null);
        if (input.partnerId !== null) {
            // Regra de negócio (Perfil): sócios só existem em perfis empresariais
            // (database-design §4.2), então só eles registram quem pagou.
            if (!profile.acceptsPartners()) {
                throw new BusinessRuleViolation('partner-requires-business-profile', 'só perfis empresariais registram o sócio que pagou');
            }
            this.assertOwnedBy(profile, 'partnerId', input.partnerId, this.references.partnerOwner(input.partnerId));
        }
        if (input.goalId !== null) {
            this.assertOwnedBy(profile, 'goalId', input.goalId, this.goals.findById(input.goalId)?.profileId ?? null);
        }
        for (const tagId of input.tagIds) {
            this.assertOwnedBy(profile, 'tagIds', tagId, this.tags.findById(tagId)?.profileId ?? null);
        }
        if (input.destinationAccountId !== null) {
            const destination = this.requireDestination(profile, input, input.destinationAccountId);
            this.assertSelectable(destination, 'destinationAccountId', current?.destinationAccountId === destination.id);
        }
    }

    /**
     * Carrega a conta de destino e confere se ela pode receber o dinheiro deste lançamento.
     * Regra de negócio (Transferência entre perfis): a transferência é a única referência que
     * atravessa a separação entre perfis (database-design §3.8), porque mover dinheiro da
     * conta pessoal para a da empresa é um fato real que os dois lados precisam registrar.
     * O resto continua preso ao perfil: um investimento só leva dinheiro a outra conta do
     * mesmo perfil. A origem precisa ser uma conta, porque o pagamento parcial de fatura
     * (a transferência que sai de um cartão) não tem mês de caixa próprio no perfil de
     * destino. Os dois perfis precisam ter a mesma moeda, porque a transação grava um único
     * `value` e o extrato do destino o soma como está (database-design §4.13) — com moedas
     * diferentes o saldo de lá mudaria de unidade sem conversão.
     *
     * @param profile Perfil dono da transação, o da origem.
     * @param input Tipo e origem do lançamento, que decidem se o destino pode ser de outro perfil.
     * @param id Conta de destino escolhida.
     * @return A conta de destino, já verificada.
     * @throws {NotFoundError} Quando a conta ou o perfil dela não existe.
     * @throws {BusinessRuleViolation} Quando a conta é de outro perfil e o lançamento não é uma
     * transferência que sai de uma conta, ou quando os perfis têm moedas diferentes.
     */
    private requireDestination(profile: Profile, input: TransactionInput, id: AccountId): Account {
        const destination = this.accounts.findById(id);
        if (destination === null) {
            throw new NotFoundError('destinationAccountId', id);
        }
        if (destination.profileId === profile.id) {
            return destination;
        }
        if (input.type !== 'transference') {
            throw new BusinessRuleViolation('reference-outside-profile', 'destinationAccountId pertence a outro perfil', { field: 'destinationAccountId' });
        }
        if (input.source.kind !== 'account') {
            throw new BusinessRuleViolation('cross-profile-transfer-requires-account', 'transferência para outro perfil precisa sair de uma conta', { field: 'destinationAccountId' });
        }
        const destinationProfile = this.requireProfile(destination.profileId);
        if (!destinationProfile.currency.equals(profile.currency)) {
            throw new BusinessRuleViolation('cross-profile-transfer-currency-mismatch', 'os perfis da transferência têm moedas diferentes', { field: 'destinationAccountId' });
        }
        return destination;
    }

    /**
     * Resolve o contêiner da transação.
     * Regra de negócio (Extrato): transação de conta cai no extrato do mês do pagamento, ou
     * do vencimento enquanto está em aberto (`Transaction.cashDate`).
     * Regra de negócio (Cartão de crédito): transação de cartão cai na fatura escolhida; sem
     * escolha, a sugestão pela data da compra — mas numa edição no mesmo cartão a fatura
     * atual é mantida, porque a sugestão nunca é recalculada depois, nem quando a data da
     * compra muda (database-design §4.7). Escolher uma fatura já paga a **reabre**.
     * Regra de negócio (Contas e Cartões): conta ou cartão desativado não é escolha para um
     * lançamento novo, mas o lançamento antigo que já está nele continua editável
     * (desktop-mvp-plan §5.1), e a recorrência continua emitindo nele (database-design §4.12).
     *
     * @param profile Perfil dono; a conta ou o cartão precisa ser dele.
     * @param input Origem e data da transação.
     * @param current Estado atual numa edição; `null` num lançamento novo.
     * @param policy Se a escolha é do usuário ou de uma recorrência.
     * @return O contêiner e o impacto de uma eventual reabertura de fatura.
     * @throws {NotFoundError} Quando a conta ou o cartão não existe.
     * @throws {BusinessRuleViolation} Quando pertence a outro perfil ou foi escolhido desativado.
     */
    public resolveContainer(profile: Profile, input: TransactionInput, current: Transaction | null, policy: SelectionPolicy = 'newChoice'): ResolvedContainer {
        const generated = policy === 'generated';
        if (input.source.kind === 'account') {
            const account = this.requireOwned(profile, 'accountId', input.source.accountId, this.accounts.findById(input.source.accountId));
            this.assertSelectable(account, 'accountId', generated || (current?.container.kind === 'statement' && current.container.accountId === account.id));
            const statement = this.consolidation.ensureStatement(account, (input.paymentDate ?? input.dueDate).period);
            return {
                container: { kind: 'statement', statementId: statement.id, accountId: statement.accountId, period: statement.period },
                impact: BalanceImpact.none(),
            };
        }

        const card = this.requireOwned(profile, 'creditCardId', input.source.creditCardId, this.creditCards.findById(input.source.creditCardId));
        this.assertSelectable(card, 'creditCardId', generated || (current?.container.kind === 'invoice' && current.container.creditCardId === card.id));
        const currentInvoice = current?.container.kind === 'invoice' && current.container.creditCardId === card.id
            ? current.container
            : null;
        const period = input.source.invoicePeriod
            ?? currentInvoice?.period
            ?? card.billingCycle.suggestedInvoicePeriod(input.dueDate);
        const invoice = this.consolidation.ensureInvoice(card, period);
        const chosenAnotherInvoice = currentInvoice?.invoiceId !== invoice.id;
        return {
            container: { kind: 'invoice', invoiceId: invoice.id, creditCardId: card.id, period: invoice.period },
            impact: invoice.isPaid() && chosenAnotherInvoice ? this.invoiceService.markReopened(invoice, card) : BalanceImpact.none(),
        };
    }

    /**
     * @param creditCardId Cartão da compra.
     * @param purchaseDate Data da compra.
     * @return A fatura que o ciclo do cartão sugere para a data (database-design §4.5).
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public suggestedInvoicePeriod(creditCardId: CreditCardId, purchaseDate: LocalDate): YearMonth {
        const card = this.creditCards.findById(creditCardId);
        if (card === null) {
            throw new NotFoundError('creditCardId', creditCardId);
        }
        return card.billingCycle.suggestedInvoicePeriod(purchaseDate);
    }

    /**
     * @param profile Perfil dono; dá a moeda em que o dinheiro é denominado.
     * @param input Conteúdo validado.
     * @param container Contêiner já resolvido.
     * @return O conteúdo de domínio da transação.
     */
    public toContent(profile: Profile, input: TransactionInput, container: TransactionContainer): TransactionContent {
        return {
            type: input.type,
            container,
            subCategoryId: input.subCategoryId,
            destinationAccountId: input.destinationAccountId,
            partnerId: input.partnerId,
            goalId: input.goalId,
            name: input.name,
            description: input.description,
            value: Money.of(input.value, profile.currency),
            charges: Money.of(input.charges, profile.currency),
            origin: {
                currency: input.originCurrency === null ? profile.currency : Currency.of(input.originCurrency),
                conversionRate: input.conversionRate,
            },
            dueDate: input.dueDate,
            paymentDate: input.paymentDate,
            tagIds: input.tagIds,
        };
    }

    /**
     * @param id Perfil procurado.
     * @return O perfil vivo.
     * @throws {NotFoundError} Quando não existe.
     */
    public requireProfile(id: ProfileId): Profile {
        const profile = this.profiles.findById(id);
        if (profile === null) {
            throw new NotFoundError('Profile', id);
        }
        return profile;
    }

    /**
     * @param id Transação procurada.
     * @return A transação viva.
     * @throws {NotFoundError} Quando não existe.
     */
    public requireTransaction(id: TransactionId): Transaction {
        const transaction = this.transactions.findById(id);
        if (transaction === null) {
            throw new NotFoundError('Transaction', id);
        }
        return transaction;
    }

    /**
     * @param profile Perfil dono da transação.
     * @param field Campo da referência, para a UI apontar o erro.
     * @param id Id referenciado.
     * @param owner Perfil dono da referência, ou `null` quando ela não existe.
     * @return void
     * @throws {NotFoundError} Quando a referência não existe.
     * @throws {BusinessRuleViolation} Quando pertence a outro perfil.
     */
    private assertOwnedBy(profile: Profile, field: string, id: string, owner: ProfileId | null): void {
        if (owner === null) {
            throw new NotFoundError(field, id);
        }
        if (owner !== profile.id) {
            throw new BusinessRuleViolation('reference-outside-profile', `${field} pertence a outro perfil`, { field });
        }
    }

    /**
     * Variante de `assertOwnedBy` para entidades carregadas: devolve a entidade já sem
     * `null`, para que o chamador não precise de cast depois da verificação.
     *
     * @param profile Perfil dono da transação.
     * @param field Campo da referência, para a UI apontar o erro.
     * @param id Id referenciado.
     * @param entity Entidade carregada, ou `null` quando não existe.
     * @return A entidade, garantidamente do perfil.
     * @throws {NotFoundError} Quando a entidade não existe.
     * @throws {BusinessRuleViolation} Quando pertence a outro perfil.
     */
    private requireOwned<T extends { readonly profileId: ProfileId }>(profile: Profile, field: string, id: string, entity: T | null): T {
        if (entity === null) {
            throw new NotFoundError(field, id);
        }
        this.assertOwnedBy(profile, field, id, entity.profileId);
        return entity;
    }

    /**
     * Regra de negócio (Contas e Cartões): desativado some das escolhas de lançamentos novos
     * (desktop-mvp-plan §5.1). "Novo" é a escolha, não a transação: editar um lançamento que
     * já está na conta desativada continua permitido, para que corrigir o histórico não
     * exija reativar a conta.
     *
     * @param entity Conta ou cartão escolhido.
     * @param field Campo da escolha, para a UI apontar o erro.
     * @param alreadyChosen `true` quando a transação editada já usava esta conta ou cartão, ou
     * quando quem escolheu foi uma recorrência.
     * @return void
     * @throws {BusinessRuleViolation} Quando a escolha nova está desativada.
     */
    private assertSelectable(entity: { readonly disabled: boolean }, field: string, alreadyChosen: boolean): void {
        if (entity.disabled && !alreadyChosen) {
            const rule = field === 'creditCardId' ? 'credit-card-disabled' : 'account-disabled';
            throw new BusinessRuleViolation(rule, `${field} está desativado(a) e não aceita lançamentos novos`, { field });
        }
    }
}

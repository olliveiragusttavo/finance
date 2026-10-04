import type { Profile } from '../../domain/profile/Profile.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { TransactionId, type ProfileId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { Transaction, type TransactionContent } from '../../domain/transaction/Transaction.ts';
import type { TransactionContainer } from '../../domain/transaction/TransactionContainer.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import type { ReferenceRepository } from '../../repositories/ReferenceRepository.ts';
import type { TagRepository } from '../../repositories/TagRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import { BalanceImpact } from '../balance/BalanceImpact.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { ImpactCalculator } from '../balance/ImpactCalculator.ts';
import type { InvoiceService } from '../invoice/InvoiceService.ts';
import type { StatementConsolidationService } from '../statement/StatementConsolidationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateTransactionCommand, TransactionInput, UpdateTransactionCommand } from './TransactionCommands.ts';

/** Contêiner resolvido para uma escrita, com o que a resolução em si obrigou a recalcular. */
interface ResolvedContainer {
    readonly container: TransactionContainer;
    readonly impact: BalanceImpact;
}

/**
 * CRUD de transações. É o **ponto único de controle** das regras que relacionam colunas e
 * linhas e que o banco deliberadamente não garante — posse das referências pelo mesmo
 * perfil, sócio só em perfil empresarial, fatura do mesmo cartão (database-design §3.10).
 * Toda escrita grava, garante o contêiner e recalcula os saldos afetados numa única
 * unidade de trabalho: um saldo nunca fica visível pela metade.
 *
 * A edição é sempre "somente esta"; os escopos "esta e as futuras" e "todas" de uma
 * recorrência são do serviço de recorrências (database-design §4.12), ainda não entregue.
 */
export class TransactionService {
    /**
     * @param unitOfWork Escrita e recálculo na mesma transação de banco.
     * @param ids Gera o UUID v4 da transação nova (database-design §3.5).
     * @param profiles Perfil dono: moeda e tipo.
     * @param accounts Conta de origem ou de destino.
     * @param creditCards Cartão de origem.
     * @param transactions Transações.
     * @param references Posse de sócio e meta.
     * @param categories Posse da subcategoria.
     * @param tags Posse das tags.
     * @param consolidation Garante extrato e fatura em que a transação cai.
     * @param invoiceService Reabre a fatura paga escolhida para um lançamento.
     * @param impacts Traduz o estado da transação nos saldos afetados.
     * @param recalculation A rotina única de recálculo.
     * @param clock "Hoje" do usuário, a data de pagamento do atalho de marcar pago.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileRepository,
        private readonly accounts: AccountRepository,
        private readonly creditCards: CreditCardRepository,
        private readonly transactions: TransactionRepository,
        private readonly references: ReferenceRepository,
        private readonly categories: CategoryRepository,
        private readonly tags: TagRepository,
        private readonly consolidation: StatementConsolidationService,
        private readonly invoiceService: InvoiceService,
        private readonly impacts: ImpactCalculator,
        private readonly recalculation: BalanceRecalculationService,
        private readonly clock: Clock,
    ) {}

    /**
     * Lança uma transação nova e recalcula os saldos que ela afeta.
     *
     * @param command Conteúdo validado pela camada Request, com o perfil dono.
     * @return A transação gravada, relida do banco (valores já arredondados).
     * @throws {NotFoundError} Quando o perfil ou alguma referência não existe.
     * @throws {BusinessRuleViolation} Quando uma regra de negócio é violada.
     */
    public create(command: CreateTransactionCommand): Transaction {
        return this.unitOfWork.run(() => {
            const profile = this.requireProfile(command.profileId);
            this.assertReferences(profile, command, null);
            const resolved = this.resolveContainer(profile, command, null);
            const transaction = Transaction.create({
                ...this.toContent(profile, command, resolved.container),
                id: TransactionId(this.ids.random()),
                profileId: profile.id,
                recurrenceId: null,
            });
            this.transactions.insert(transaction);
            this.recalculation.apply(resolved.impact.merge(this.impacts.ofTransaction(transaction)));
            return this.requireTransaction(transaction.id);
        });
    }

    /**
     * Edita uma transação e recalcula os saldos do estado antigo **e** do novo: mudar de mês,
     * de conta ou de fatura precisa recalcular os dois contêineres (backend-design §5.1).
     *
     * @param command Novo conteúdo completo, com o id da transação.
     * @return A transação editada, relida do banco.
     * @throws {NotFoundError} Quando a transação ou alguma referência não existe.
     * @throws {BusinessRuleViolation} Quando uma regra de negócio é violada.
     */
    public update(command: UpdateTransactionCommand): Transaction {
        return this.unitOfWork.run(() => {
            const current = this.requireTransaction(command.id);
            const profile = this.requireProfile(current.profileId);
            // O impacto do estado antigo é calculado antes de qualquer escrita, enquanto a
            // fatura antiga ainda está no estado (pago ou em aberto) que pesava nos saldos.
            const before = this.impacts.ofTransaction(current);
            this.assertReferences(profile, command, current);
            this.assertOccurrenceDateFree(current, command.dueDate);
            const resolved = this.resolveContainer(profile, command, current);
            const revised = current.revise(this.toContent(profile, command, resolved.container));
            this.transactions.update(revised);
            this.recalculation.apply(before.merge(resolved.impact).merge(this.impacts.ofTransaction(revised)));
            return this.requireTransaction(revised.id);
        });
    }

    /**
     * Soft delete da transação e recálculo. Excluir um pagamento parcial de fatura devolve o
     * valor à conta e à fatura (database-design §4.7) — sai naturalmente do recálculo.
     *
     * @param id Transação a excluir.
     * @return void
     * @throws {NotFoundError} Quando a transação não existe ou já foi excluída.
     */
    public delete(id: TransactionId): void {
        this.unitOfWork.run(() => {
            const current = this.requireTransaction(id);
            const impact = this.impacts.ofTransaction(current);
            this.transactions.softDelete(id);
            this.recalculation.apply(impact);
        });
    }

    /**
     * Marca ou desmarca o pagamento — o atalho `P` da tela de Transações.
     * Regra de negócio (Transações): marcar como paga usa a data de **hoje** como data de
     * pagamento, porque pago e data de pagamento andam juntos (brief §3, Transação); desmarcar
     * limpa a data. Regra de negócio (Extrato): numa transação de conta, a nova data decide o
     * extrato (`Transaction.cashDate`), então pagar em outro mês move a transação para o
     * extrato do pagamento, e desmarcar a devolve ao do vencimento. Recalcula o estado antigo
     * e o novo, como qualquer edição. Pedir o estado em que a transação já está não muda
     * nada — nem a data de um pagamento já registrado.
     *
     * @param id Transação a marcar.
     * @param paid `true` para paga, `false` para em aberto.
     * @return A transação com a situação pedida, relida do banco.
     * @throws {NotFoundError} Quando a transação não existe ou foi excluída.
     */
    public setPaid(id: TransactionId, paid: boolean): Transaction {
        return this.unitOfWork.run(() => {
            const current = this.requireTransaction(id);
            if (current.isPaid() === paid) {
                return current;
            }
            const before = this.impacts.ofTransaction(current);
            const paymentDate = paid ? this.clock.today() : null;
            const revised = current.withPaymentDate(paymentDate, this.containerOnPayment(current, paymentDate ?? current.dueDate));
            this.transactions.update(revised);
            this.recalculation.apply(before.merge(this.impacts.ofTransaction(revised)));
            return this.requireTransaction(id);
        });
    }

    /**
     * Contêiner de uma transação existente depois de mudar a data de pagamento.
     *
     * @param current Transação marcada ou desmarcada.
     * @param cashDate Nova data de caixa: a de pagamento, ou o vencimento ao desmarcar.
     * @return O extrato do mês da data, garantido; numa transação de cartão, a fatura atual,
     * porque a fatura escolhida é a verdade (database-design §4.7).
     * @throws {NotFoundError} Quando a conta do extrato não existe mais.
     */
    private containerOnPayment(current: Transaction, cashDate: LocalDate): TransactionContainer {
        if (current.container.kind === 'invoice') {
            return current.container;
        }
        const account = this.accounts.findById(current.container.accountId);
        if (account === null) {
            throw new NotFoundError('Account', current.container.accountId);
        }
        const statement = this.consolidation.ensureStatement(account, cashDate.period);
        return { kind: 'statement', statementId: statement.id, accountId: statement.accountId, period: statement.period };
    }

    /**
     * @param id Transação procurada.
     * @return A transação viva.
     * @throws {NotFoundError} Quando não existe ou foi excluída.
     */
    public get(id: TransactionId): Transaction {
        return this.unitOfWork.run(() => this.requireTransaction(id));
    }

    /**
     * Transações do perfil num mês, pelo `due_date` — a lista "Transações do mês" (brief M5).
     *
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @return As transações vivas do mês, por data.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public listByPeriod(profileId: ProfileId, period: YearMonth): readonly Transaction[] {
        return this.unitOfWork.run(() => {
            this.requireProfile(profileId);
            return this.transactions.listByProfileBetween(
                profileId,
                LocalDate.of(period.year, period.month, 1),
                LocalDate.of(period.year, period.month, period.lengthInDays()),
            );
        });
    }

    /**
     * Verifica que toda referência existe e pertence ao perfil. A chave estrangeira só
     * garante a existência; perfis pessoal e empresarial precisam ficar estritamente
     * separados (database-design §3.8).
     *
     * @param profile Perfil dono da transação.
     * @param input Referências a verificar.
     * @param current Estado atual numa edição; `null` num lançamento novo.
     * @return void
     * @throws {NotFoundError} Quando uma referência não existe.
     * @throws {BusinessRuleViolation} Quando pertence a outro perfil, há sócio num perfil
     * pessoal ou a conta de destino escolhida está desativada.
     */
    private assertReferences(profile: Profile, input: TransactionInput, current: Transaction | null): void {
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
            this.assertOwnedBy(profile, 'goalId', input.goalId, this.references.goalOwner(input.goalId));
        }
        for (const tagId of input.tagIds) {
            this.assertOwnedBy(profile, 'tagIds', tagId, this.tags.findById(tagId)?.profileId ?? null);
        }
        if (input.destinationAccountId !== null) {
            const destination = this.requireOwned(profile, 'destinationAccountId', input.destinationAccountId, this.accounts.findById(input.destinationAccountId));
            this.assertSelectable(destination, 'destinationAccountId', current?.destinationAccountId === destination.id);
        }
    }

    /**
     * Regra de negócio (Recorrências): uma série não tem duas ocorrências vivas na mesma
     * data de vencimento — o índice `uq_transactions_recurrence_due_date` é a rede de
     * segurança contra geração dupla (database-design §4.12). Mover uma ocorrência para a
     * data de outra esbarraria nele como erro de SQL, que chegaria à UI como falha genérica;
     * verificar antes devolve uma violação de regra que a tela consegue explicar.
     *
     * @param current Ocorrência sendo editada; transações avulsas passam direto.
     * @param dueDate Nova data de vencimento pedida.
     * @return void
     * @throws {BusinessRuleViolation} Quando outra ocorrência viva da série já vence nessa data.
     */
    private assertOccurrenceDateFree(current: Transaction, dueDate: LocalDate): void {
        if (current.recurrenceId === null || current.dueDate.equals(dueDate)) {
            return;
        }
        if (this.transactions.hasOccurrenceOn(current.recurrenceId, dueDate, current.id)) {
            throw new BusinessRuleViolation(
                'recurrence-occurrence-date-taken',
                'outra ocorrência da mesma recorrência já vence nesta data',
                { field: 'dueDate', dueDate: dueDate.toString() },
            );
        }
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
     * (desktop-mvp-plan §5.1).
     *
     * @param profile Perfil dono; a conta ou o cartão precisa ser dele.
     * @param input Origem e data da transação.
     * @param current Estado atual numa edição; `null` num lançamento novo.
     * @return O contêiner e o impacto de uma eventual reabertura de fatura.
     * @throws {NotFoundError} Quando a conta ou o cartão não existe.
     * @throws {BusinessRuleViolation} Quando pertence a outro perfil ou foi escolhido desativado.
     */
    private resolveContainer(profile: Profile, input: TransactionInput, current: Transaction | null): ResolvedContainer {
        if (input.source.kind === 'account') {
            const account = this.requireOwned(profile, 'accountId', input.source.accountId, this.accounts.findById(input.source.accountId));
            this.assertSelectable(account, 'accountId', current?.container.kind === 'statement' && current.container.accountId === account.id);
            const statement = this.consolidation.ensureStatement(account, (input.paymentDate ?? input.dueDate).period);
            return {
                container: { kind: 'statement', statementId: statement.id, accountId: statement.accountId, period: statement.period },
                impact: BalanceImpact.none(),
            };
        }

        const card = this.requireOwned(profile, 'creditCardId', input.source.creditCardId, this.creditCards.findById(input.source.creditCardId));
        this.assertSelectable(card, 'creditCardId', current?.container.kind === 'invoice' && current.container.creditCardId === card.id);
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
     * @param profile Perfil dono; dá a moeda em que o dinheiro é denominado.
     * @param input Conteúdo validado.
     * @param container Contêiner já resolvido.
     * @return O conteúdo de domínio da transação.
     */
    private toContent(profile: Profile, input: TransactionInput, container: TransactionContainer): TransactionContent {
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
     * @param alreadyChosen `true` quando a transação editada já usava esta conta ou cartão.
     * @return void
     * @throws {BusinessRuleViolation} Quando a escolha nova está desativada.
     */
    private assertSelectable(entity: { readonly disabled: boolean }, field: string, alreadyChosen: boolean): void {
        if (entity.disabled && !alreadyChosen) {
            const rule = field === 'creditCardId' ? 'credit-card-disabled' : 'account-disabled';
            throw new BusinessRuleViolation(rule, `${field} está desativado(a) e não aceita lançamentos novos`, { field });
        }
    }

    /**
     * @param id Perfil procurado.
     * @return O perfil vivo.
     * @throws {NotFoundError} Quando não existe.
     */
    private requireProfile(id: ProfileId): Profile {
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
    private requireTransaction(id: TransactionId): Transaction {
        const transaction = this.transactions.findById(id);
        if (transaction === null) {
            throw new NotFoundError('Transaction', id);
        }
        return transaction;
    }
}

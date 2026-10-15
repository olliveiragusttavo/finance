import type { Account } from '../../domain/account/Account.ts';
import type { CreditCard } from '../../domain/creditCard/CreditCard.ts';
import { analyzeImport, type PlannedRow, type PlannedSeries } from '../../domain/import/ImportAnalysis.ts';
import type { RecurrenceTerms } from '../../domain/recurrence/Recurrence.ts';
import { anchorDayFromHistory, RecurrenceSchedule } from '../../domain/recurrence/RecurrenceSchedule.ts';
import { BusinessRuleViolation, InvalidValueError, NotFoundError } from '../../domain/shared/errors.ts';
import { TransactionId, type CategoryId, type ProfileId, type SubCategoryId, type TagId } from '../../domain/shared/ids.ts';
import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { foldName } from '../../domain/shared/names.ts';
import { Transaction } from '../../domain/transaction/Transaction.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { TagRepository } from '../../repositories/TagRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { AccountService } from '../account/AccountService.ts';
import { BalanceImpact } from '../balance/BalanceImpact.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { ImpactCalculator } from '../balance/ImpactCalculator.ts';
import type { CategoryService } from '../category/CategoryService.ts';
import type { CreditCardService } from '../creditCard/CreditCardService.ts';
import type { InvoiceService } from '../invoice/InvoiceService.ts';
import type { RecurrenceService } from '../recurrence/RecurrenceService.ts';
import type { TagService } from '../tag/TagService.ts';
import type { TransactionInput } from '../transaction/TransactionCommands.ts';
import type { TransactionComposer } from '../transaction/TransactionComposer.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { ImportAccountDecision, ImportCommand, ImportCreditCardDecision, ImportOutcome } from './ImportCommands.ts';

/** Fatura com compra paga no arquivo, e a maior data de pagamento entre essas compras. */
interface InvoicePayment {
    readonly creditCard: CreditCard;
    readonly period: YearMonth;
    readonly date: LocalDate;
}

/** Contas e cartões do arquivo já resolvidos, pelo nome dobrado. */
interface ResolvedRegistries {
    readonly accounts: ReadonlyMap<string, Account>;
    readonly creditCards: ReadonlyMap<string, CreditCard>;
    readonly accountsCreated: number;
    readonly creditCardsCreated: number;
}

/**
 * Importação de transações históricas (import-design; desktop-mvp-plan Fase 13.1). Recebe as
 * linhas já lidas pelo client e as decisões da revisão, e grava tudo — cadastros, lançamentos,
 * séries e pagamentos de fatura — numa única unidade de trabalho: ou o arquivo entra inteiro, ou
 * nada muda (import-design §7). Cada lançamento passa pelo `TransactionComposer`, as mesmas
 * regras do lançamento manual; só o recálculo é adiado para o fim, uma vez sobre o impacto
 * acumulado, porque um recálculo por linha tornaria quadrática a importação de milhares delas.
 */
export class ImportService {
    /**
     * @param unitOfWork Toda a importação numa transação de banco.
     * @param clock "Hoje", que a análise usa para o horizonte das fixas e o "pagas até hoje".
     * @param ids Gera o UUID v4 dos lançamentos avulsos.
     * @param composer Regras de montar e conferir um lançamento.
     * @param transactions Lançamentos avulsos.
     * @param accounts Contas ligadas pela revisão.
     * @param creditCards Cartões ligados pela revisão.
     * @param invoices Faturas a pagar depois de recebidas as compras.
     * @param categories Categorias existentes de cada perfil, procuradas pelo nome.
     * @param tags Tags existentes de cada perfil, procuradas pelo nome.
     * @param accountService Cria as contas novas pelas regras do cadastro.
     * @param creditCardService Cria os cartões novos pelas regras do cadastro.
     * @param categoryService Cria as categorias e subcategorias que faltam.
     * @param tagService Cria as tags que faltam.
     * @param recurrenceService Grava as séries com as ocorrências do arquivo.
     * @param invoiceService Paga as faturas sem recalcular.
     * @param impacts Traduz cada lançamento nos saldos afetados.
     * @param recalculation A rotina única de recálculo, chamada uma vez no fim.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly clock: Clock,
        private readonly ids: IdGenerator,
        private readonly composer: TransactionComposer,
        private readonly transactions: TransactionRepository,
        private readonly accounts: AccountRepository,
        private readonly creditCards: CreditCardRepository,
        private readonly invoices: InvoiceRepository,
        private readonly categories: CategoryRepository,
        private readonly tags: TagRepository,
        private readonly accountService: AccountService,
        private readonly creditCardService: CreditCardService,
        private readonly categoryService: CategoryService,
        private readonly tagService: TagService,
        private readonly recurrenceService: RecurrenceService,
        private readonly invoiceService: InvoiceService,
        private readonly impacts: ImpactCalculator,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * Importa um arquivo. Refaz a análise sobre a mesma entrada da revisão, para que o que é
     * gravado seja exatamente o que o usuário aprovou (import-design §6); as linhas recusadas pela
     * análise ficam de fora e entram na contagem.
     *
     * @param command Linhas, opções e decisões da revisão.
     * @return O que foi gravado.
     * @throws {InvalidValueError} Quando falta a decisão de uma conta ou cartão do arquivo, ou a
     * conta pagadora de um cartão novo não é uma conta do arquivo.
     * @throws {NotFoundError} Quando um perfil, conta ou cartão escolhido não existe.
     * @throws {BusinessRuleViolation} Quando uma escolha viola uma regra do cadastro ou do
     * lançamento — conta de outro perfil, desativada, transferência entre moedas diferentes.
     */
    public run(command: ImportCommand): ImportOutcome {
        return this.unitOfWork.run(() => {
            const analysis = analyzeImport(command.rows, command.options, this.clock.today());
            const registries = this.resolveRegistries(command, analysis.accounts.map(({ name }) => name), analysis.creditCards.map(({ name }) => name));
            const vocabulary = new ImportVocabulary(this.categories, this.tags, this.categoryService, this.tagService);
            const payments = new Map<string, InvoicePayment>();
            let impact = BalanceImpact.none();

            for (const item of analysis.standalone) {
                const input = this.inputOf(item, command, registries, vocabulary, payments);
                const profile = this.composer.requireProfile(input.profileId);
                this.composer.assertReferences(profile, input, null);
                const resolved = this.composer.resolveContainer(profile, input, null);
                const transaction = Transaction.create({
                    ...this.composer.toContent(profile, input, resolved.container),
                    id: TransactionId(this.ids.random()),
                    profileId: profile.id,
                    recurrenceId: null,
                    occurrence: null,
                });
                this.transactions.insert(transaction);
                impact = impact.merge(resolved.impact).merge(this.impacts.ofTransaction(transaction));
            }

            for (const series of analysis.series) {
                const occurrences = series.occurrences.map((item) => ({ occurrence: item.occurrence ?? 1, input: this.inputOf(item, command, registries, vocabulary, payments) }));
                const reference = occurrences[occurrences.length - 1];
                if (reference === undefined) {
                    continue;
                }
                const profile = this.composer.requireProfile(reference.input.profileId);
                impact = impact.merge(this.recurrenceService.importSeries(profile, {
                    terms: termsOf(series),
                    schedule: RecurrenceSchedule.of({
                        frequency: series.frequency,
                        startsOn: reference.input.dueDate,
                        startsAt: reference.occurrence,
                        anchorDay: anchorDayFromHistory(series.frequency, reference.input.dueDate, occurrences.map(({ input }) => input.dueDate)),
                    }),
                    template: reference.input,
                    occurrences,
                }));
            }

            let invoicesPaid = 0;
            for (const payment of payments.values()) {
                // Regra de negócio (Importação, import-design §5.4): a fatura com compra paga é paga
                // na maior data de pagamento entre as compras importadas nela. As compras já
                // reabriram a fatura que estava paga (database-design §4.7), então ela é paga de novo.
                const invoice = this.invoices.findByPeriod(payment.creditCard.id, payment.period);
                if (invoice !== null && !invoice.isPaid()) {
                    impact = impact.merge(this.invoiceService.markPaid(invoice, payment.creditCard, payment.date));
                    invoicesPaid++;
                }
            }

            this.recalculation.apply(impact);
            return {
                transactions: analysis.standalone.length + analysis.series.reduce((total, series) => total + series.occurrences.length, 0),
                fixedSeries: analysis.series.filter((series) => series.kind === 'fixed').length,
                installmentSeries: analysis.series.filter((series) => series.kind === 'installments').length,
                invoicesPaid,
                accountsCreated: registries.accountsCreated,
                creditCardsCreated: registries.creditCardsCreated,
                ...vocabulary.created(),
                skipped: analysis.issues.length,
            };
        });
    }

    /**
     * Cria ou liga cada conta e cada cartão citado pelas linhas aceitas (import-design §5.1).
     *
     * @param command Decisões da revisão.
     * @param accountNames Contas citadas no arquivo.
     * @param creditCardNames Cartões citados no arquivo.
     * @return As contas e os cartões resolvidos, pelo nome dobrado, e quantos foram criados.
     * @throws {InvalidValueError} Quando falta a decisão de uma conta ou cartão citado.
     * @throws {NotFoundError} Quando a conta ou o cartão ligado não existe.
     * @throws {BusinessRuleViolation} Quando a conta ligada é de outro perfil ou está desativada.
     */
    private resolveRegistries(command: ImportCommand, accountNames: readonly string[], creditCardNames: readonly string[]): ResolvedRegistries {
        const accountDecisions = new Map(command.accounts.map((decision) => [foldName(decision.name), decision]));
        const accounts = new Map<string, Account>();
        let accountsCreated = 0;
        for (const name of accountNames) {
            const decision = accountDecisions.get(foldName(name));
            if (decision === undefined) {
                throw new InvalidValueError('accounts', `falta decidir a conta "${name}" do arquivo`);
            }
            const account = this.resolveAccount(decision);
            accounts.set(foldName(name), account.account);
            accountsCreated += account.created ? 1 : 0;
        }
        // A pagadora de um cartão novo pode ser uma conta do arquivo citada só pelo cartão.
        for (const decision of command.accounts) {
            if (!accounts.has(foldName(decision.name)) && command.creditCards.some((card) => card.target.kind === 'create' && foldName(card.target.payingAccount) === foldName(decision.name))) {
                const account = this.resolveAccount(decision);
                accounts.set(foldName(decision.name), account.account);
                accountsCreated += account.created ? 1 : 0;
            }
        }

        const cardDecisions = new Map(command.creditCards.map((decision) => [foldName(decision.name), decision]));
        const creditCards = new Map<string, CreditCard>();
        let creditCardsCreated = 0;
        for (const name of creditCardNames) {
            const decision = cardDecisions.get(foldName(name));
            if (decision === undefined) {
                throw new InvalidValueError('creditCards', `falta decidir o cartão "${name}" do arquivo`);
            }
            creditCards.set(foldName(name), this.resolveCreditCard(decision, accounts));
            creditCardsCreated += decision.target.kind === 'create' ? 1 : 0;
        }
        return { accounts, creditCards, accountsCreated, creditCardsCreated };
    }

    /**
     * Regra de negócio (Contas): conta desativada não recebe lançamento novo (desktop-mvp-plan
     * §5.1), e a conta ligada precisa ser do perfil escolhido para ela — é o perfil que decide
     * onde os lançamentos dela caem.
     *
     * @param decision Decisão sobre a conta.
     * @return A conta e se ela foi criada agora.
     * @throws {NotFoundError} Quando a conta ligada não existe.
     * @throws {BusinessRuleViolation} Quando ela é de outro perfil ou está desativada.
     */
    private resolveAccount(decision: ImportAccountDecision): { readonly account: Account; readonly created: boolean } {
        const { target } = decision;
        if (target.kind === 'create') {
            const account = this.accountService.create({
                profileId: decision.profileId,
                name: decision.name,
                type: target.type,
                currencyLabel: null,
                considerBalance: target.considerBalance,
                openingBalance: 0,
            });
            return { account, created: true };
        }
        const account = this.accounts.findById(target.accountId);
        if (account === null) {
            throw new NotFoundError('accountId', target.accountId);
        }
        if (account.profileId !== decision.profileId) {
            throw new BusinessRuleViolation('reference-outside-profile', `a conta ligada a "${decision.name}" é de outro perfil`, { field: 'accountId' });
        }
        if (account.disabled) {
            throw new BusinessRuleViolation('account-disabled', `a conta ligada a "${decision.name}" está desativada`, { field: 'accountId' });
        }
        return { account, created: false };
    }

    /**
     * Regra de negócio (Importação, import-design §5.1): o cartão novo fica no perfil da conta
     * que paga a fatura, uma conta do arquivo; o ligado precisa estar ativo.
     *
     * @param decision Decisão sobre o cartão.
     * @param accounts Contas do arquivo já resolvidas.
     * @return O cartão.
     * @throws {InvalidValueError} Quando a pagadora do cartão novo não é uma conta do arquivo.
     * @throws {NotFoundError} Quando o cartão ligado não existe.
     * @throws {BusinessRuleViolation} Quando o cartão ligado está desativado.
     */
    private resolveCreditCard(decision: ImportCreditCardDecision, accounts: ReadonlyMap<string, Account>): CreditCard {
        const { target } = decision;
        if (target.kind === 'create') {
            const paying = accounts.get(foldName(target.payingAccount));
            if (paying === undefined) {
                throw new InvalidValueError('payingAccount', `a conta "${target.payingAccount}" que paga o cartão "${decision.name}" não está no arquivo`);
            }
            return this.creditCardService.create({
                profileId: paying.profileId,
                accountId: paying.id,
                name: decision.name,
                limit: target.limit,
                closingDay: target.closingDay,
                dueDay: target.dueDay,
            });
        }
        const card = this.creditCards.findById(target.creditCardId);
        if (card === null) {
            throw new NotFoundError('creditCardId', target.creditCardId);
        }
        if (card.disabled) {
            throw new BusinessRuleViolation('credit-card-disabled', `o cartão ligado a "${decision.name}" está desativado`, { field: 'creditCardId' });
        }
        return card;
    }

    /**
     * Monta o lançamento de uma linha aceita e anota o pagamento da fatura dela.
     * Regra de negócio (Importação, import-design §5.4): a compra no cartão vai para a fatura que
     * vence no mês do Vencimento da linha, e não para a sugerida pela data da compra.
     * Regra de negócio (Importação, import-design §5.1): o perfil do lançamento é o da conta de
     * origem; no cartão, o do cartão — o da conta que paga a fatura.
     *
     * @param item Linha planejada pela análise.
     * @param command Categoria padrão das transferências.
     * @param registries Contas e cartões resolvidos.
     * @param vocabulary Categorias e tags de cada perfil, criadas quando faltam.
     * @param payments Faturas a pagar, atualizadas com a data desta compra quando ela está paga.
     * @return O lançamento, com o perfil dono.
     */
    private inputOf(
        item: PlannedRow,
        command: ImportCommand,
        registries: ResolvedRegistries,
        vocabulary: ImportVocabulary,
        payments: Map<string, InvoicePayment>,
    ): TransactionInput & { readonly profileId: ProfileId } {
        const { row } = item;
        const account = requireResolved(registries.accounts, row.account, 'accounts');
        const card = item.creditCard === null ? null : requireResolved(registries.creditCards, item.creditCard, 'creditCards');
        const profileId = card?.profileId ?? account.profileId;
        const invoicePeriod = card?.billingCycle.invoicePeriodDueIn(row.dueDate.period) ?? null;
        if (card !== null && invoicePeriod !== null && item.paymentDate !== null) {
            const key = `${card.id}|${invoicePeriod.toString()}`;
            const current = payments.get(key);
            if (current === undefined || current.date.isBefore(item.paymentDate)) {
                payments.set(key, { creditCard: card, period: invoicePeriod, date: item.paymentDate });
            }
        }
        const classification = row.type === 'transference' ? command.transferCategory : { category: row.category ?? '', subCategory: row.subCategory ?? '' };
        return {
            profileId,
            type: row.type,
            source: card === null || invoicePeriod === null
                ? { kind: 'account', accountId: account.id }
                : { kind: 'creditCard', creditCardId: card.id, invoicePeriod },
            subCategoryId: vocabulary.subCategory(profileId, classification.category, classification.subCategory),
            destinationAccountId: row.type === 'transference' && row.destination !== null ? requireResolved(registries.accounts, row.destination, 'accounts').id : null,
            partnerId: null,
            goalId: null,
            name: item.name,
            description: row.description,
            value: row.value,
            charges: row.charges,
            originCurrency: null,
            conversionRate: 1,
            dueDate: item.date,
            paymentDate: item.paymentDate,
            tagIds: item.tags.map((name) => vocabulary.tag(profileId, name)),
        };
    }
}

/**
 * Categorias, subcategorias e tags de cada perfil, procuradas pelo nome e criadas quando faltam
 * (import-design §5.2). Lê cada perfil uma vez e guarda o que criou, porque milhares de linhas
 * repetem as mesmas poucas dezenas de nomes. A criação passa pelos Services do cadastro, que
 * aplicam a mesma unicidade por nome — a importação nunca cria um nome que o cadastro recusaria.
 */
class ImportVocabulary {
    /** Categorias por perfil, pelo nome dobrado. */
    private readonly categoryIds = new Map<ProfileId, Map<string, CategoryId>>();
    /** Subcategorias por categoria, pelo nome dobrado. */
    private readonly subCategoryIds = new Map<CategoryId, Map<string, SubCategoryId>>();
    /** Tags por perfil, pelo nome dobrado. */
    private readonly tagIds = new Map<ProfileId, Map<string, TagId>>();
    /** Quanto foi criado até aqui; só cresce, e só esta classe escreve. */
    private readonly counts = { categoriesCreated: 0, subCategoriesCreated: 0, tagsCreated: 0 };

    /**
     * @param categories Categorias existentes.
     * @param tags Tags existentes.
     * @param categoryService Cria categoria e subcategoria.
     * @param tagService Cria tag.
     */
    public constructor(
        private readonly categories: CategoryRepository,
        private readonly tags: TagRepository,
        private readonly categoryService: CategoryService,
        private readonly tagService: TagService,
    ) {}

    /**
     * @return Quantas categorias, subcategorias e tags foram criadas — o resumo da importação.
     */
    public created(): { readonly categoriesCreated: number; readonly subCategoriesCreated: number; readonly tagsCreated: number } {
        return { ...this.counts };
    }

    /**
     * @param profileId Perfil da linha.
     * @param category Nome da categoria no arquivo.
     * @param subCategory Nome da subcategoria no arquivo.
     * @return A subcategoria do perfil com esses nomes, criada (com a categoria) quando falta.
     */
    public subCategory(profileId: ProfileId, category: string, subCategory: string): SubCategoryId {
        const categoryId = this.categoryOf(profileId, category);
        const subs = this.subCategoriesOf(categoryId);
        const existing = subs.get(foldName(subCategory));
        if (existing !== undefined) {
            return existing;
        }
        const created = this.categoryService.createSubCategory({ categoryId, name: subCategory });
        subs.set(foldName(subCategory), created.id);
        this.counts.subCategoriesCreated++;
        return created.id;
    }

    /**
     * @param profileId Perfil da linha.
     * @param name Nome da tag.
     * @return A tag do perfil com esse nome, criada quando falta.
     */
    public tag(profileId: ProfileId, name: string): TagId {
        let byName = this.tagIds.get(profileId);
        if (byName === undefined) {
            byName = new Map(this.tags.listByProfile(profileId).map((tag) => [foldName(tag.name), tag.id]));
            this.tagIds.set(profileId, byName);
        }
        const existing = byName.get(foldName(name));
        if (existing !== undefined) {
            return existing;
        }
        const created = this.tagService.create({ profileId, name });
        byName.set(foldName(name), created.id);
        this.counts.tagsCreated++;
        return created.id;
    }

    /**
     * @param profileId Perfil da linha.
     * @param name Nome da categoria.
     * @return A categoria do perfil com esse nome, criada quando falta.
     */
    private categoryOf(profileId: ProfileId, name: string): CategoryId {
        let byName = this.categoryIds.get(profileId);
        if (byName === undefined) {
            byName = new Map(this.categories.listCategories(profileId).map((category) => [foldName(category.name), category.id]));
            this.categoryIds.set(profileId, byName);
            for (const sub of this.categories.listSubCategories(profileId)) {
                const subs = this.subCategoryIds.get(sub.categoryId) ?? new Map<string, SubCategoryId>();
                subs.set(foldName(sub.name), sub.id);
                this.subCategoryIds.set(sub.categoryId, subs);
            }
        }
        const existing = byName.get(foldName(name));
        if (existing !== undefined) {
            return existing;
        }
        const created = this.categoryService.createCategory({ profileId, name });
        byName.set(foldName(name), created.id);
        this.counts.categoriesCreated++;
        return created.id;
    }

    /**
     * @param categoryId Categoria, de um perfil já carregado por `categoryOf`.
     * @return As subcategorias da categoria, pelo nome dobrado — vazia numa categoria nova.
     */
    private subCategoriesOf(categoryId: CategoryId): Map<string, SubCategoryId> {
        let subs = this.subCategoryIds.get(categoryId);
        if (subs === undefined) {
            subs = new Map();
            this.subCategoryIds.set(categoryId, subs);
        }
        return subs;
    }
}

/**
 * @param resolved Contas ou cartões resolvidos.
 * @param name Nome no arquivo.
 * @param field Grupo, para apontar o erro.
 * @return O cadastro resolvido para o nome.
 * @throws {InvalidValueError} Quando o nome não foi resolvido — uma decisão faltando que a
 * resolução já teria recusado; fica como guarda para não gravar um lançamento sem origem.
 */
function requireResolved<T>(resolved: ReadonlyMap<string, T>, name: string, field: string): T {
    const found = resolved.get(foldName(name));
    if (found === undefined) {
        throw new InvalidValueError(field, `"${name}" não foi resolvido na revisão`);
    }
    return found;
}

/**
 * Regra de negócio (Importação, import-design §5.5): o parcelamento importado é por parcela — o
 * arquivo traz o valor de cada uma, com o ajuste de arredondamento onde a origem o pôs —, e a fixa
 * termina onde a análise decidiu.
 *
 * @param series Série planejada.
 * @return A forma da recorrência.
 */
function termsOf(series: PlannedSeries): RecurrenceTerms {
    return series.kind === 'installments'
        ? { kind: 'installments', installments: series.installments ?? series.occurrences.length, valueType: 'perInstallment' }
        : { kind: 'fixed', endAt: series.endAt };
}

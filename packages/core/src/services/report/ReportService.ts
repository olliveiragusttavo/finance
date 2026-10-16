import type { Account } from '../../domain/account/Account.ts';
import { accountFlowWindow, flowLineOf, flowMonthTiming, sumFlowLines, type AccountFlowLine, type AccountFlowReport, type AccountFlowScope } from '../../domain/report/AccountFlowReport.ts';
import { buildBalanceEvolution, evolutionWindow } from '../../domain/report/BalanceEvolution.ts';
import { buildCardImpactReport, cardImpactWindow, type CardImpactReport } from '../../domain/report/CardImpactReport.ts';
import { buildCategoryReport, type CategoryReport } from '../../domain/report/CategoryReport.ts';
import type { CategoryScope } from '../../domain/report/CategoryScope.ts';
import { ComparisonBasis, sumMoney, type ComparisonMode } from '../../domain/report/Comparison.ts';
import { buildMonthSummary, type MonthSummary } from '../../domain/report/MonthSummary.ts';
import { buildPartnerReport, type PartnerReport } from '../../domain/report/PartnerReport.ts';
import { incomeInflow } from '../../domain/report/ReportTotals.ts';
import { buildTagReport, type TagReport, type TagReportRange } from '../../domain/report/TagReport.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import type { AccountId, ProfileId, TagId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { statementMovements } from '../../domain/statement/StatementFlows.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { PartnerRepository } from '../../repositories/PartnerRepository.ts';
import type { ReportRepository } from '../../repositories/ReportRepository.ts';
import type { TagRepository } from '../../repositories/TagRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { StatementConsolidationService } from '../statement/StatementConsolidationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { BalanceEvolutionView, CategoryTransactionsView, EntriesWithoutPartnerView, TagTransactionsView } from './ReportViews.ts';

/**
 * Relatórios do perfil: Visão geral, relatório por categoria, impacto do cartão, fluxo por
 * conta, por tag e por sócio (desktop-mvp-plan §6, Fases 2, 12.1, 12.2 e 13.6). Só lê: a agregação roda no SQL do `ReportRepository`, com
 * o mês de pagamento da fonte única (reports-design §2), e as regras de comparação, variação
 * e peso ficam nos montadores puros de `domain/report`. Cada caso de uso lê numa unidade de
 * trabalho para que as consultas de um mesmo relatório vejam o mesmo estado do banco.
 */
export class ReportService {
    /**
     * @param unitOfWork Leituras do relatório na mesma transação de banco.
     * @param profiles Perfil dono: existência e moeda.
     * @param reports Somas por mês de pagamento.
     * @param transactions Lançamentos do drill-down.
     * @param creditCards Colunas do impacto do cartão.
     * @param categories Posse da categoria do drill-down.
     * @param accounts Contas do fluxo por conta e a posse da conta pedida.
     * @param tags Posse da tag da lista de lançamentos.
     * @param partners Sócios do perfil, que o relatório por sócio lista mesmo sem despesa no mês.
     * @param statements Extrato de cada conta, a fonte do fluxo por conta (F2).
     * @param clock "Hoje", que separa fatura futura de fatura em aberto e mês futuro de passado.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly profiles: ProfileService,
        private readonly reports: ReportRepository,
        private readonly transactions: TransactionRepository,
        private readonly creditCards: CreditCardRepository,
        private readonly categories: CategoryRepository,
        private readonly accounts: AccountRepository,
        private readonly tags: TagRepository,
        private readonly partners: PartnerRepository,
        private readonly statements: StatementConsolidationService,
        private readonly clock: Clock,
    ) {}

    /**
     * Indicadores do mês na Visão geral: receitas, despesas com a variação contra o mês
     * anterior e as faturas em aberto que vencem no mês.
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @return Os indicadores.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public monthSummary(profileId: ProfileId, reference: YearMonth): MonthSummary {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const cards = new Map(this.creditCards.listByProfile(profileId).map((card) => [card.id, card]));
            const openInvoices = this.reports
                .invoicesByPaymentPeriod(profileId, [reference], profile.currency)
                .filter((invoice) => !invoice.paid)
                .flatMap((invoice) => {
                    const card = cards.get(invoice.creditCardId);
                    return card === undefined ? [] : [{ invoice, dueDate: card.billingCycle.dueDateOf(invoice.invoicePeriod) }];
                });
            return buildMonthSummary({
                reference,
                cashFlow: this.reports.cashFlowTotals(profileId, [reference, reference.previous()], profile.currency),
                openInvoices,
                zero: Money.zero(profile.currency),
            });
        });
    }

    /**
     * Consolidado e previsto do perfil no fim de cada mês da série, para o gráfico da Visão
     * geral. Lê os extratos já calculados, sem recalcular.
     *
     * @param profileId Perfil consultado.
     * @param reference Último mês da série.
     * @param months Quantos meses a série cobre, contando o de referência.
     * @return A série, do mês mais antigo ao de referência.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public balanceEvolution(profileId: ProfileId, reference: YearMonth, months: number): BalanceEvolutionView {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const periods = evolutionWindow(reference, months);
            const from = periods[0] ?? reference;
            const histories = this.reports.closingHistories(profileId, from, reference, profile.currency);
            return { reference, points: buildBalanceEvolution(periods, histories, profile.currency) };
        });
    }

    /**
     * Relatório por categoria: árvore categoria → subcategoria do mês contra a base escolhida.
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @param mode Base de comparação.
     * @return O relatório.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public byCategory(profileId: ProfileId, reference: YearMonth, mode: ComparisonMode): CategoryReport {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const basis = ComparisonBasis.of(reference, mode);
            const totals = this.reports.expenseTotalsBySubCategory(profileId, [reference, ...basis.periods], profile.currency);
            return buildCategoryReport(reference, basis, totals, Money.zero(profile.currency));
        });
    }

    /**
     * Lançamentos de uma categoria ou subcategoria no mês, para o drill-down — com o mesmo
     * critério de período da árvore, para que a lista some exatamente o valor da linha.
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @param scope Categoria ou subcategoria aberta.
     * @return As despesas e o total delas.
     * @throws {NotFoundError} Quando o perfil não existe, ou a categoria/subcategoria não
     * existe ou é de outro perfil.
     */
    public categoryTransactions(profileId: ProfileId, reference: YearMonth, scope: CategoryScope): CategoryTransactionsView {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            this.assertScopeOwnedBy(profile, scope);
            const transactions = this.transactions.listExpensesByPaymentPeriod(profileId, reference, scope);
            const zero = Money.zero(profile.currency);
            return {
                period: reference,
                scope,
                transactions,
                total: sumMoney(transactions.map((transaction) => transaction.originEffect().negate()), zero),
            };
        });
    }

    /**
     * Impacto do cartão: grade mês × cartão com as faturas pelo mês de pagamento, as receitas
     * de cada mês e o peso.
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @return O relatório.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public cardImpact(profileId: ProfileId, reference: YearMonth): CardImpactReport {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const window = cardImpactWindow(reference);
            const zero = Money.zero(profile.currency);
            const incomeByPeriod = new Map<string, Money>();
            for (const row of this.reports.cashFlowTotals(profileId, window, profile.currency)) {
                if (row.type === 'income') {
                    const key = row.period.toString();
                    incomeByPeriod.set(key, (incomeByPeriod.get(key) ?? zero).add(incomeInflow(row.value, row.charges)));
                }
            }
            return buildCardImpactReport({
                reference,
                creditCards: this.creditCards.listByProfile(profileId),
                invoices: this.reports.invoicesByPaymentPeriod(profileId, window, profile.currency),
                incomeByPeriod,
                today: this.clock.today(),
                zero,
            });
        });
    }

    /**
     * Fluxo por conta: os extratos encadeados de uma conta, ou das contas do total somadas, na
     * janela do mês de referência.
     * Regra de negócio (Relatórios, F2): os números vêm do extrato de cada conta
     * (`getStatement`), o mesmo da tela Contas, para que o relatório nunca discorde dela; o
     * relatório só separa as faturas (F3) e soma as contas (F4) (desktop-mvp-plan §3.4).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @param accountId Conta pedida; `null` soma as contas com "considerar no saldo" ligado,
     * desativadas incluídas.
     * @return O fluxo dos cinco meses.
     * @throws {NotFoundError} Quando o perfil não existe, ou a conta não existe ou é de outro
     * perfil.
     */
    public accountFlow(profileId: ProfileId, reference: YearMonth, accountId: AccountId | null): AccountFlowReport {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const scope = this.flowScope(profile, accountId);
            const accounts = scope.kind === 'account' ? [scope.account] : scope.accounts;
            const today = this.clock.today();
            const months = accountFlowWindow(reference).map((period) => ({
                period,
                timing: flowMonthTiming(period, today),
                ...sumFlowLines(accounts.map((account) => this.flowLine(account, period, profile)), profile.currency),
            }));
            return { reference, scope, months };
        });
    }

    /**
     * Relatório por tag: cada tag com lançamento no período, com o total líquido e a divisão por
     * categoria (desktop-mvp-plan §3.5, T1–T4).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @param range Só o mês de referência ou todo o período.
     * @return As tags pelo total líquido.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public byTag(profileId: ProfileId, reference: YearMonth, range: TagReportRange): TagReport {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const rows = this.reports.tagTotalsByCategory(profileId, range === 'month' ? reference : null, profile.currency);
            return buildTagReport(reference, range, rows, Money.zero(profile.currency));
        });
    }

    /**
     * Lançamentos de uma tag no período, com o mesmo critério das somas da tag, para que a lista
     * some o total líquido da linha (T5).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @param range Só o mês de referência ou todo o período.
     * @param tagId Tag aberta.
     * @return As receitas e despesas da tag e o total líquido (despesas − receitas).
     * @throws {NotFoundError} Quando o perfil não existe, ou a tag não existe ou é de outro perfil.
     */
    public tagTransactions(profileId: ProfileId, reference: YearMonth, range: TagReportRange, tagId: TagId): TagTransactionsView {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            // Sem a conferência, a tag de outro perfil devolveria uma lista vazia e a tela diria
            // "sem lançamentos" em vez de acusar o erro, como no drill-down por categoria.
            if (this.tags.findById(tagId)?.profileId !== profile.id) {
                throw new NotFoundError('Tag', tagId);
            }
            const transactions = this.transactions.listIncomeAndExpensesByTag(profileId, tagId, range === 'month' ? reference : null);
            return {
                period: reference,
                range,
                tagId,
                transactions,
                // O líquido é o negativo do efeito somado: despesa tira, receita põe (T2).
                total: sumMoney(transactions.map((transaction) => transaction.originEffect()), Money.zero(profile.currency)).negate(),
            };
        });
    }

    /**
     * Relatório por sócio: quanto cada sócio aportou, em todos os períodos, contra quanto deveria
     * pela participação no total de aportes, os números do mês e o acerto (reports-design §8, P1–P5).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência, que recorta os aportes e as entradas sem sócio do mês.
     * @return O relatório.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    public byPartner(profileId: ProfileId, reference: YearMonth): PartnerReport {
        return this.unitOfWork.run(() => {
            const profile = this.requireBusiness(profileId);
            return buildPartnerReport({
                reference,
                partners: this.partners.listByProfile(profileId),
                totals: this.reports.contributionTotalsByPartner(profileId, reference, profile.currency),
                zero: Money.zero(profile.currency),
            });
        });
    }

    /**
     * Entradas do mês sem sócio, para a lista em que a tela pede para atribuir as que são aporte —
     * com o mesmo critério das somas, para que a lista some o valor do indicador (P5). Cada entrada
     * vale o que pôs no saldo do perfil: a receita sem os encargos (`originEffect`), a
     * transferência pelo valor que chega (`destinationEffect`).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @return As entradas e o total delas.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    public entriesWithoutPartner(profileId: ProfileId, reference: YearMonth): EntriesWithoutPartnerView {
        return this.unitOfWork.run(() => {
            const profile = this.requireBusiness(profileId);
            const transactions = this.transactions.listEntriesWithoutPartner(profileId, reference);
            const zero = Money.zero(profile.currency);
            return {
                period: reference,
                transactions,
                total: sumMoney(transactions.map((transaction) => (transaction.type === 'income' ? transaction.originEffect() : transaction.destinationEffect() ?? zero)), zero),
            };
        });
    }

    /**
     * Regra de negócio (Perfil): sócio só existe em perfil empresarial, e o relatório por sócio
     * não está disponível no pessoal (database-design §4.1). Recusar, em vez de devolver um
     * relatório vazio, impede que a tela mostre "nenhum sócio" num perfil em que sócio nem existe.
     *
     * @param profileId Perfil consultado.
     * @return O perfil empresarial.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    private requireBusiness(profileId: ProfileId): Profile {
        const profile = this.profiles.require(profileId);
        if (!profile.acceptsPartners()) {
            throw new BusinessRuleViolation('partner-requires-business-profile', 'o relatório por sócio só existe em perfil empresarial');
        }
        return profile;
    }

    /**
     * @param profile Perfil consultado.
     * @param accountId Conta pedida, ou `null` para as contas do total.
     * @return A conta pedida, ou as contas com "considerar no saldo" ligado, desativadas
     * incluídas, porque o histórico delas não muda (desktop-mvp-plan §3.4, F4).
     * @throws {NotFoundError} Quando a conta não existe ou é de outro perfil.
     */
    private flowScope(profile: Profile, accountId: AccountId | null): AccountFlowScope {
        if (accountId === null) {
            return { kind: 'total', accounts: this.accounts.listByProfile(profile.id).filter((account) => account.considerBalance) };
        }
        const account = this.accounts.findById(accountId);
        if (account?.profileId !== profile.id) {
            throw new NotFoundError('Account', accountId);
        }
        return { kind: 'account', account };
    }

    /**
     * @param account Conta somada.
     * @param period Mês da coluna.
     * @param profile Perfil dono, para a moeda do zero.
     * @return As linhas da conta no mês, lidas do extrato.
     */
    private flowLine(account: Account, period: YearMonth, profile: Profile): AccountFlowLine {
        const view = this.statements.getStatement(account.id, period);
        const movements = statementMovements({
            transactions: view.transactions,
            incomingTransfers: view.incomingTransfers,
            paidInvoices: view.paidInvoices.map(({ invoice }) => invoice),
            openInvoicesDue: view.openInvoicesDue.map(({ invoice }) => invoice),
        });
        return flowLineOf({ opening: view.opening, closing: view.closing, movements }, profile.currency);
    }

    /**
     * Confere a posse antes de listar: sem isso, um id de outro perfil devolveria uma lista
     * vazia, e a tela mostraria "sem lançamentos" em vez de acusar o erro.
     *
     * @param profile Perfil consultado.
     * @param scope Categoria ou subcategoria pedida.
     * @return void
     * @throws {NotFoundError} Quando não existe ou pertence a outro perfil.
     */
    private assertScopeOwnedBy(profile: Profile, scope: CategoryScope): void {
        if (scope.kind === 'category') {
            if (this.categories.findCategory(scope.categoryId)?.profileId !== profile.id) {
                throw new NotFoundError('Category', scope.categoryId);
            }
        } else if (this.categories.findSubCategory(scope.subCategoryId)?.profileId !== profile.id) {
            throw new NotFoundError('SubCategory', scope.subCategoryId);
        }
    }
}

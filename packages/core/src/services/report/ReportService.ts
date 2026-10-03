import { buildBalanceEvolution, evolutionWindow } from '../../domain/report/BalanceEvolution.ts';
import { buildCardImpactReport, cardImpactWindow, type CardImpactReport } from '../../domain/report/CardImpactReport.ts';
import { buildCategoryReport, type CategoryReport } from '../../domain/report/CategoryReport.ts';
import type { CategoryScope } from '../../domain/report/CategoryScope.ts';
import { ComparisonBasis, sumMoney, type ComparisonMode } from '../../domain/report/Comparison.ts';
import { buildMonthSummary, type MonthSummary } from '../../domain/report/MonthSummary.ts';
import { incomeInflow } from '../../domain/report/ReportTotals.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { NotFoundError } from '../../domain/shared/errors.ts';
import type { ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { ReportRepository } from '../../repositories/ReportRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { BalanceEvolutionView, CategoryTransactionsView } from './ReportViews.ts';

/**
 * Relatórios do perfil: Visão geral, relatório por categoria e impacto do cartão
 * (desktop-mvp-plan §6, Fase 2). Só lê: a agregação roda no SQL do `ReportRepository`, com
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
     * @param clock "Hoje", que separa fatura futura de fatura em aberto.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly profiles: ProfileService,
        private readonly reports: ReportRepository,
        private readonly transactions: TransactionRepository,
        private readonly creditCards: CreditCardRepository,
        private readonly categories: CategoryRepository,
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

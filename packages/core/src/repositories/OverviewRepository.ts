import type { CategorySpending } from '../domain/overview/SpendingSummary.ts';
import type { PendingTransaction } from '../domain/overview/PendingItems.ts';
import type { MonthAmount } from '../domain/report/ReportTotals.ts';
import type { Currency } from '../domain/shared/Currency.ts';
import type { ProfileId } from '../domain/shared/ids.ts';
import type { LocalDate } from '../domain/shared/LocalDate.ts';
import type { Money } from '../domain/shared/Money.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';

/**
 * Consultas agregadas da Visão geral, só leitura. Separadas dos relatórios porque respondem
 * perguntas fixas da tela (quanto saiu no mês, para onde foi, o que está em aberto), sem uma
 * definição salva — e a agregação roda no SQL (backend-design §3.2), como nos relatórios fixos.
 */
export interface OverviewRepository {
    /**
     * @param profileId Perfil consultado.
     * @param from Primeiro mês pedido.
     * @param to Último mês pedido.
     * @param currency Moeda do perfil.
     * @return As despesas do perfil por mês; mês sem despesa não tem linha.
     */
    expensesByMonth(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly MonthAmount[];

    /**
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @param currency Moeda do perfil.
     * @return As entradas do mês: receitas do perfil e transferências que chegam de outro perfil.
     */
    incomeOfMonth(profileId: ProfileId, period: YearMonth, currency: Currency): Money;

    /**
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @param currency Moeda do perfil.
     * @return As despesas do mês por categoria, em qualquer ordem; categoria sem despesa não tem linha.
     */
    expensesByCategory(profileId: ProfileId, period: YearMonth, currency: Currency): readonly CategorySpending[];

    /**
     * @param profileId Perfil consultado.
     * @param until Último dia de vencimento pedido.
     * @param currency Moeda do perfil.
     * @return Os lançamentos de conta não pagos que vencem até `until` — de qualquer data
     * anterior, para que um atraso antigo não suma —, inclusive as transferências de outro perfil
     * que chegam às contas deste.
     */
    pendingTransactions(profileId: ProfileId, until: LocalDate, currency: Currency): readonly PendingTransaction[];
}

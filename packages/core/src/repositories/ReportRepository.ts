import type {
    AccountClosingHistory,
    CashFlowTotals,
    InvoiceExpenseTotals,
    SubCategoryExpenseTotals,
} from '../domain/report/ReportTotals.ts';
import type { Currency } from '../domain/shared/Currency.ts';
import type { ProfileId } from '../domain/shared/ids.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';

/**
 * Consultas agregadas dos relatórios, só leitura. Separadas dos Repositories de entidade
 * pelo mesmo motivo do `BalanceLedgerRepository`: devolvem somas, e a agregação roda no SQL
 * (backend-design §3.2) — o núcleo só aplica as regras sobre os totais. Toda consulta usa
 * o mês de pagamento da fonte única `REPORT_SOURCES_CTE` (reports-design §2).
 */
export interface ReportRepository {
    /**
     * @param profileId Perfil consultado.
     * @param periods Meses de pagamento pedidos.
     * @param currency Moeda do perfil, em que as somas estão denominadas.
     * @return Somas de receitas e de despesas por mês de pagamento; meses sem lançamento
     * não têm linha. Transferências e investimentos ficam fora: no perfil, somam zero.
     */
    cashFlowTotals(profileId: ProfileId, periods: readonly YearMonth[], currency: Currency): readonly CashFlowTotals[];

    /**
     * @param profileId Perfil consultado.
     * @param periods Meses de pagamento pedidos (o de referência e os da comparação).
     * @param currency Moeda do perfil.
     * @return Somas das despesas por subcategoria e mês de pagamento, com os nomes da
     * subcategoria e da categoria.
     */
    expenseTotalsBySubCategory(profileId: ProfileId, periods: readonly YearMonth[], currency: Currency): readonly SubCategoryExpenseTotals[];

    /**
     * @param profileId Perfil consultado.
     * @param periods Meses de pagamento pedidos.
     * @param currency Moeda do perfil.
     * @return As faturas com ao menos uma transação viva cujo mês de pagamento está entre os
     * pedidos, com as somas das despesas de cada uma.
     */
    invoicesByPaymentPeriod(profileId: ProfileId, periods: readonly YearMonth[], currency: Currency): readonly InvoiceExpenseTotals[];

    /**
     * @param profileId Perfil consultado.
     * @param from Primeiro mês da série.
     * @param to Último mês da série.
     * @param currency Moeda do perfil.
     * @return Os fechamentos das contas vivas que entram no saldo do perfil, com o último
     * extrato anterior a `from` para os meses sem movimento no começo da série.
     */
    closingHistories(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly AccountClosingHistory[];
}

import type { AccountClosingHistory, MonthAmount, PartnerContributionTotals } from '../domain/report/ReportTotals.ts';
import type { Currency } from '../domain/shared/Currency.ts';
import type { ProfileId } from '../domain/shared/ids.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';

/**
 * Consultas agregadas dos relatórios fixos (reports-design §8 e §9), só leitura. Separadas do
 * `ReportQueryRepository` porque não saem de uma definição: cada relatório fixo tem a própria
 * pergunta, e a agregação roda no SQL (backend-design §3.2) — o núcleo só aplica as regras.
 */
export interface FixedReportRepository {
    /**
     * @param profileId Perfil consultado.
     * @param from Primeiro mês da série.
     * @param to Último mês da série.
     * @param currency Moeda do perfil.
     * @return Os fechamentos das contas vivas que entram no saldo do perfil, com o último
     * extrato anterior a `from` para os meses sem movimento no começo da série.
     */
    closingHistories(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly AccountClosingHistory[];

    /**
     * @param profileId Perfil consultado.
     * @return O mês do primeiro extrato vivo das contas que entram no saldo do perfil — o começo
     * do histórico —, ou `null` quando nenhuma delas teve movimento.
     */
    firstStatementPeriod(profileId: ProfileId): YearMonth | null;

    /**
     * @param profileId Perfil consultado.
     * @param from Primeiro mês pedido.
     * @param to Último mês pedido.
     * @param currency Moeda do perfil.
     * @return O efeito no saldo das contas do total dos lançamentos **avulsos** (sem série) pagos,
     * por mês de caixa — a parte do resultado que não fica lançada com antecedência
     * (reports-design §9, B3); mês sem avulso não tem linha.
     */
    nonRecurringResults(profileId: ProfileId, from: YearMonth, to: YearMonth, currency: Currency): readonly MonthAmount[];

    /**
     * @param profileId Perfil empresarial consultado.
     * @param period Mês de referência, que recorta a parte do mês de cada soma.
     * @param currency Moeda do perfil.
     * @return Somas das entradas (receitas e transferências vindas de outro perfil) por sócio que
     * aportou, de todos os períodos e do mês, com uma linha de `partnerId` nulo para as sem sócio
     * vivo do perfil; perfil sem entrada não tem linha.
     */
    contributionTotalsByPartner(profileId: ProfileId, period: YearMonth, currency: Currency): readonly PartnerContributionTotals[];
}

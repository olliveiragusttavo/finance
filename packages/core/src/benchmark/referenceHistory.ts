import { LocalDate } from '../domain/shared/LocalDate.ts';
import { YearMonth } from '../domain/shared/YearMonth.ts';

/** O que muda de um banco de histórico para outro; o resto é fixo para o arquivo ser reproduzível. */
export interface HistoryOptions {
    /** Último mês com movimento, `YYYY-MM`; "hoje" termina no dia 28 dele. */
    readonly endMonth: string;
    /** Quantos anos de movimento terminam no `endMonth`. */
    readonly years: number;
    /** Semente dos valores e dias sorteados; a mesma semente gera o mesmo banco byte a byte. */
    readonly seed: number;
}

/**
 * Padrão do banco da medição da Fase 5 (mobile-mvp-plan): dez anos até o mês corrente do plano.
 * Fica no código de produção, e não junto do gerador nos testes, porque o app do celular
 * precisa saber as competências do banco que vai medir e não pode importar código de teste.
 */
export const DEFAULT_HISTORY_OPTIONS: HistoryOptions = { endMonth: '2026-10', years: 10, seed: 20261111 };

/** As competências e o "hoje" de um banco gerado, no formato das opções da medição. */
export interface HistoryPeriods {
    readonly oldestPeriod: string;
    readonly recentPeriod: string;
    readonly today: string;
}

/**
 * Deriva das opções do gerador o que a medição precisa saber do banco, para que o script, o
 * teste e o app não repitam a conta do primeiro mês e errem por um.
 *
 * @param options Opções com que o banco foi gerado.
 * @return O primeiro e o último mês com movimento, e o dia 28 do último, que é o "hoje" do gerador.
 */
export function historyPeriods(options: HistoryOptions = DEFAULT_HISTORY_OPTIONS): HistoryPeriods {
    const end = YearMonth.parse(options.endMonth);
    return {
        oldestPeriod: end.plusMonths(1 - options.years * 12).toString(),
        recentPeriod: end.toString(),
        today: LocalDate.of(end.year, end.month, 28).toString(),
    };
}

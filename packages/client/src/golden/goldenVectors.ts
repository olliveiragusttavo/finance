import type { GoldenVectors } from '@finance/core/golden';
import { formatDate, formatDayMonth, formatMonthAbbreviation, formatMonthLong, formatMonthShort } from '../format/dates.ts';
import { formatMoney, formatMoneyCompact, formatMoneyDigits, formatMoneyForInput, type MoneySign } from '../format/money.ts';
import { parseMoneyInput } from '../format/parseMoneyInput.ts';
import { formatPercent } from '../format/percent.ts';
import { matchesAllTerms, normalizeForSearch } from '../format/searchText.ts';

/**
 * Valores que a tela formata: zero, centavo, a meia unidade que o double guarda abaixo do
 * decimal (`1.005`), milhar, milhão, negativos e o teto do `Money`. Cobrem o agrupamento de
 * milhar, o sinal tipográfico e o arredondamento que o formatador herda do núcleo.
 */
const AMOUNTS: readonly number[] = [0, 0.004, 0.005, -0.005, 0.01, 1.005, -1.005, 9.9, 100, 1234.56, -1234.565, 9500, 1000000, -987654321.12, 999999999999.99];

/** Moedas com símbolo próprio, uma sem símbolo (vai pelo código) e uma sem centavos. */
const CURRENCIES: readonly string[] = ['BRL', 'USD', 'EUR', 'GBP', 'CHF', 'JPY'];

/** Todas as regras de sinal, para que nenhuma fique sem vetor. */
const SIGNS: readonly MoneySign[] = ['negative', 'always', 'absolute'];

/**
 * Textos como o usuário digita num campo de dinheiro: com e sem símbolo, sinais nas duas
 * posições, milhar com ponto, decimais a mais (arredondados), o ponto como decimal (recusado)
 * e o valor além do teto.
 */
const TYPED_AMOUNTS: readonly string[] = [
    '', '   ', '0', '1', '1,5', '1,005', '-1,005', '1.234,56', '1234,56', 'R$ 10', '-R$ 10', 'R$-10', '−23,90', '+7',
    '1.5', '1.23', ',99', '-', 'abc', '1.000.000,00', '1000000000000', '1000000000000,01', '9'.repeat(400),
];

/** Proporções com meia unidade nas duas precisões e o zero arredondado (`0,0004`). */
const RATIOS: readonly number[] = [0, 0.0004, -0.0004, 0.0005, 0.166, -0.12, 0.3225, 1, -1, 2.5];

/** Datas e competências nas pontas do ano e num ano bissexto. */
const DATES: readonly string[] = ['2026-01-01', '2026-10-08', '2024-02-29', '2026-12-31'];

/** Competências de janeiro a dezembro, para cobrir todo nome de mês. */
const PERIODS: readonly string[] = Array.from({ length: 12 }, (_, index) => `2026-${String(index + 1).padStart(2, '0')}`);

/**
 * Textos de busca com acento composto e decomposto, caixa mista, cedilha e letras fora do
 * português: a normalização da busca usa `normalize` e `\p{Diacritic}`, que no Hermes
 * dependem do ICU embutido e são o primeiro lugar onde uma divergência apareceria.
 */
const SEARCH_TEXTS: readonly string[] = ['Café', 'café', 'AÇÚCAR', 'Alimentação › Mercado', 'Ångström', 'Straße', 'Œuvre', 'naïve', 'São João'];

/** Pares busca × texto, inclusive busca vazia e termo fora de ordem. */
const SEARCHES: readonly (readonly [string, string])[] = [
    ['cafe', 'Café da manhã'],
    ['mercado alim', 'Alimentação › Mercado'],
    ['acucar', 'AÇÚCAR'],
    ['', 'qualquer coisa'],
    ['sao joao', 'São João'],
    ['agua', 'Aguardente'],
    ['luz', 'Água'],
];

/**
 * Calcula os vetores de ouro do `client`: as saídas dos formatadores e do leitor de valor
 * digitado, que precisam sair iguais no Chromium do desktop e no Hermes do celular — a promessa
 * de que os dois nunca mostram o mesmo saldo de dois jeitos (mobile-shell-design §8). Mesma
 * divisão do núcleo: o Node gera o arquivo, o `apps/mobile-contract` recalcula no Hermes.
 *
 * @return Os vetores por grupo, em ordem estável.
 */
export function computeClientGoldenVectors(): GoldenVectors {
    const money = CURRENCIES.flatMap((currency) => AMOUNTS.map((amount) => ({ amount, currency })));
    return {
        'format.money': money.flatMap((value) => SIGNS.map((sign) => ({ input: { ...value, sign }, output: formatMoney(value, sign) }))),
        'format.moneyCompact': money.map((value) => ({ input: value, output: formatMoneyCompact(value) })),
        'format.moneyDigits': money.map((value) => ({ input: value, output: formatMoneyDigits(value) })),
        'format.moneyForInput': money.map((value) => ({ input: value, output: formatMoneyForInput(value) })),
        'format.percent': RATIOS.flatMap((ratio) =>
            (['always', 'negative'] as const).flatMap((sign) =>
                ([0, 1] as const).map((decimals) => ({ input: { ratio, sign, decimals }, output: formatPercent(ratio, { sign, decimals }) })),
            ),
        ),
        'format.date': DATES.map((date) => ({ input: date, output: { dayMonth: formatDayMonth(date), full: formatDate(date) } })),
        'format.month': PERIODS.map((period) => ({
            input: period,
            output: { long: formatMonthLong(period), short: formatMonthShort(period), abbreviation: formatMonthAbbreviation(period) },
        })),
        'parse.moneyInput': ['BRL', 'JPY'].flatMap((currency) =>
            TYPED_AMOUNTS.map((text) => ({ input: { text, currency }, output: parseMoneyInput(text, currency) })),
        ),
        'search.normalize': SEARCH_TEXTS.map((text) => ({ input: text, output: normalizeForSearch(text) })),
        'search.matchesAllTerms': SEARCHES.map(([query, haystack]) => ({ input: { query, haystack }, output: matchesAllTerms(query, haystack) })),
    };
}

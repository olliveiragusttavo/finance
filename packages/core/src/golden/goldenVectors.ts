import { Currency } from '../domain/shared/Currency.ts';
import { deriveUuid, uuidV5 } from '../domain/shared/DeterministicIds.ts';
import { Money, roundHalfAwayFromZero } from '../domain/shared/Money.ts';
import { compareNames, nameSortKey } from '../domain/shared/textOrder.ts';

/**
 * Valor que cabe num vetor de ouro: só o que o `JSON` representa sem perda, para que o
 * arquivo gerado no Node seja lido igual no Hermes. `undefined`, `NaN` e classes ficam de
 * fora de propósito, porque não sobreviveriam à ida e volta pelo JSON.
 */
export type GoldenValue = string | number | boolean | null | readonly GoldenValue[] | { readonly [key: string]: GoldenValue };

/** Um caso: a entrada e a saída que o runtime de referência (o Node) calculou para ela. */
export interface GoldenCase {
    readonly input: GoldenValue;
    readonly output: GoldenValue;
}

/**
 * Vetores agrupados por assunto (`money.rounded`, `uuid.v5`...). O nome do grupo é o que
 * aparece no relatório de divergência, então diz o que foi calculado, e não onde.
 */
export type GoldenVectors = Readonly<Record<string, readonly GoldenCase[]>>;

/** Uma divergência entre o arquivo gerado no Node e o recálculo em outro runtime. */
export interface GoldenDivergence {
    readonly group: string;
    readonly input: GoldenValue;
    readonly expected: GoldenValue;
    readonly actual: GoldenValue;
}

/**
 * Valores em que o arredondamento costuma divergir: a meia unidade exata que o double guarda
 * abaixo do decimal (`1.005`), negativos, dízimas, os extremos do teto do `Money` e o ruído de
 * soma de float (`0.1 + 0.2`). São o mesmo tipo de valor que a persistência e a tela arredondam.
 */
const ROUNDING_AMOUNTS: readonly number[] = [
    0, 0.005, -0.005, 0.015, 1.005, -1.005, 2.345, -2.345, 1.115, 8.675, 10.235, 0.1 + 0.2, 1 / 3, -2 / 3,
    1234.565, 99999.995, 123456789.125, -987654321.555, 999999999999.99, -999999999999.99,
];

/** Moedas com 0, 2 e 3 casas, para cobrir as três escalas que o `Money` trata. */
const ROUNDING_CURRENCIES: readonly string[] = ['BRL', 'JPY', 'BHD'];

/**
 * Totais e quantidades de parcelas em que a divisão deixa resto, inclusive o exemplo da regra
 * de negócio (R$ 1.000,00 em 3) e o máximo de parcelas aceito pela rota (360).
 */
const SPLITS: readonly (readonly [number, number, string])[] = [
    [1000, 3, 'BRL'],
    [100, 7, 'BRL'],
    [0.1, 3, 'BRL'],
    [-250.01, 4, 'BRL'],
    [1999.99, 12, 'BRL'],
    [12345.67, 360, 'BRL'],
    [10, 3, 'JPY'],
    [1, 3, 'BHD'],
];

/**
 * Chaves naturais no formato das linhas determinísticas (extrato, fatura, ocorrência), com
 * texto não ASCII para exercitar a codificação UTF-8 do nome antes do SHA-1.
 */
const UUID_NAMES: readonly string[] = [
    'bank_statements:00000000-0000-4000-8000-000000000001:2026-03',
    'invoices:00000000-0000-4000-8000-000000000002:2026-12',
    'transactions:00000000-0000-4000-8000-000000000003:12',
    'Ação — São João ☕',
    '',
];

/** Namespace DNS do RFC 9562, cujo exemplo `www.example.com` tem resultado publicado. */
const RFC_DNS_NAMESPACE = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Nomes que o comparador precisa ordenar como um leitor de português: acentos, caixa, nomes
 * que só diferem no acento, letras fora do português, acento decomposto (`e` + U+0301), espaço
 * nas pontas, dígitos e um emoji, que cai fora da tabela e vai pelo código do caractere.
 */
const NAMES: readonly string[] = [
    'Bebida', 'água', 'Água', 'Agua', 'ônibus', 'Ótica', 'Óleo', 'café', 'Café', 'café', 'Cafeteria',
    'Çedilha', 'Zebra', 'zebra', 'Ångström', 'Straße', 'Œuvre', 'Mercado', ' Mercado ', '10 Pães', '2 Pães',
    'Ελλάδα', 'Ônibus', 'Éclair', 'Saúde', 'SAÚDE', 'Salário', 'Sala', '☕ Café',
];

/**
 * Calcula os vetores de ouro do núcleo: as operações cujo resultado precisa ser idêntico, bit a
 * bit, no Node do desktop e no Hermes do celular (mobile-shell-design §8). O Node gera o arquivo
 * versionado; o `apps/mobile-contract` chama esta mesma função no Hermes e compara. As entradas
 * ficam aqui, e não no JSON, para que o caso e o cálculo nunca se desencontrem.
 *
 * @return Os vetores por grupo, em ordem estável.
 */
export function computeCoreGoldenVectors(): GoldenVectors {
    return {
        'money.rounded': ROUNDING_CURRENCIES.flatMap((currency) =>
            ROUNDING_AMOUNTS.map((amount) => ({
                input: { amount, currency },
                output: Money.of(amount, Currency.of(currency)).rounded().toString(),
            })),
        ),
        'money.roundHalfAwayFromZero': [0, 1, 2, 3].flatMap((decimals) =>
            ROUNDING_AMOUNTS.map((value) => ({ input: { value, decimals }, output: roundHalfAwayFromZero(value, decimals) })),
        ),
        'money.split': SPLITS.map(([amount, parts, currency]) => ({
            input: { amount, parts, currency },
            output: Money.of(amount, Currency.of(currency)).split(parts).map((part) => part.toString()),
        })),
        'uuid.deriveUuid': UUID_NAMES.map((name) => ({ input: name, output: deriveUuid(name) })),
        'uuid.v5': [{ input: { namespace: RFC_DNS_NAMESPACE, name: 'www.example.com' }, output: uuidV5(RFC_DNS_NAMESPACE, 'www.example.com') }],
        'text.nameSortKey': NAMES.map((name) => ({ input: name, output: nameSortKey(name) })),
        'text.compareNames': [{ input: NAMES, output: [...NAMES].sort(compareNames) }],
    };
}

/**
 * @param value Valor lido do JSON, ainda sem tipo.
 * @return `true` quando o valor é representável num vetor de ouro.
 */
function isGoldenValue(value: unknown): value is GoldenValue {
    if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return true;
    }
    if (Array.isArray(value)) {
        return value.every((item: unknown) => isGoldenValue(item));
    }
    return typeof value === 'object' && Object.values(value).every((item: unknown) => isGoldenValue(item));
}

/**
 * @param value Item de um grupo, ainda sem tipo.
 * @return `true` quando o item tem entrada e saída válidas.
 */
function isGoldenCase(value: unknown): value is GoldenCase {
    return typeof value === 'object' && value !== null && 'input' in value && 'output' in value && isGoldenValue(value.input) && isGoldenValue(value.output);
}

/**
 * Lê o arquivo de vetores conferindo a forma, em vez de confiar no tipo. O app de contrato e
 * os testes recebem o JSON como texto ou valor sem tipo; um arquivo corrompido ou de outro
 * formato precisa falhar aqui, com a causa, e não virar uma lista de divergências sem sentido.
 *
 * @param text Conteúdo do arquivo `vectors.json`.
 * @return Os vetores tipados.
 * @throws {Error} Quando o texto não é JSON ou não tem a forma de `GoldenVectors`.
 */
export function parseGoldenVectors(text: string): GoldenVectors {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('vetores de ouro: o arquivo não é um objeto de grupos');
    }
    const vectors: Record<string, readonly GoldenCase[]> = {};
    for (const [group, cases] of Object.entries(raw)) {
        if (!Array.isArray(cases) || !cases.every(isGoldenCase)) {
            throw new Error(`vetores de ouro: o grupo "${group}" não é uma lista de casos { input, output }`);
        }
        vectors[group] = cases;
    }
    return vectors;
}

/**
 * Compara os vetores do arquivo com os recalculados, caso a caso, pela forma JSON de cada saída.
 * Existe para que o app de contrato mostre a lista do que divergiu, e não só "falhou": uma
 * divergência de arredondamento e uma de UUID pedem correções diferentes. Um grupo ou caso que
 * falte de um lado também é divergência, para um vetor esquecido não passar em silêncio.
 *
 * @param expected Vetores lidos do arquivo gerado no Node.
 * @param actual Vetores recalculados no runtime sob teste.
 * @return As divergências, vazia quando os dois lados concordam em tudo.
 */
export function diffGoldenVectors(expected: GoldenVectors, actual: GoldenVectors): readonly GoldenDivergence[] {
    const groups = [...new Set([...Object.keys(expected), ...Object.keys(actual)])];
    return groups.flatMap((group) => {
        const expectedCases = expected[group] ?? [];
        const actualCases = actual[group] ?? [];
        const length = Math.max(expectedCases.length, actualCases.length);
        return Array.from({ length }, (_, index): GoldenDivergence | null => {
            const want = expectedCases[index];
            const got = actualCases[index];
            const input = want?.input ?? got?.input ?? null;
            if (want === undefined || got === undefined || JSON.stringify(want.input) !== JSON.stringify(got.input) || JSON.stringify(want.output) !== JSON.stringify(got.output)) {
                return { group, input, expected: want?.output ?? null, actual: got?.output ?? null };
            }
            return null;
        }).filter((divergence): divergence is GoldenDivergence => divergence !== null);
    });
}

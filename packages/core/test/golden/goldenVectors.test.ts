import { describe, expect, it } from 'vitest';
import { computeCoreGoldenVectors, diffGoldenVectors, parseGoldenVectors, type GoldenVectors } from '../../src/golden/goldenVectors.ts';

/**
 * Serializa os vetores como o arquivo versionado: indentação de 4 espaços (a do
 * `.editorconfig`) e quebra de linha final, para o diff do JSON ser legível no review.
 *
 * @param vectors Vetores calculados.
 * @return O conteúdo exato do arquivo.
 */
function serialize(vectors: GoldenVectors): string {
    return `${JSON.stringify(vectors, null, 4)}\n`;
}

describe('vetores de ouro do núcleo', () => {
    it('o arquivo versionado está em dia com o código (rode pnpm golden:generate se mudou)', async () => {
        await expect(serialize(computeCoreGoldenVectors())).toMatchFileSnapshot('../../src/golden/vectors.json');
    });

    it('sobrevive à ida e volta pelo JSON sem divergência, como o app de contrato vai ler', () => {
        const vectors = computeCoreGoldenVectors();
        const parsed = parseGoldenVectors(serialize(vectors));

        expect(diffGoldenVectors(parsed, vectors)).toEqual([]);
    });

    it('confere o UUID v5 com o exemplo publicado no RFC 9562', () => {
        expect(computeCoreGoldenVectors()['uuid.v5']).toEqual([
            { input: { namespace: '6ba7b810-9dad-11d1-80b4-00c04fd430c8', name: 'www.example.com' }, output: '2ed6657d-e927-568b-95e1-2665a8aea6a2' },
        ]);
    });

    it('confere a regra do parcelamento: o resto do arredondamento vai para a primeira parcela', () => {
        const split = computeCoreGoldenVectors()['money.split']?.[0];

        expect(split).toEqual({ input: { amount: 1000, parts: 3, currency: 'BRL' }, output: ['333.34', '333.33', '333.33'] });
    });
});

describe('parseGoldenVectors', () => {
    it('recusa arquivo fora do formato com a causa, em vez de gerar divergências sem sentido', () => {
        expect(() => parseGoldenVectors('[]')).toThrow('não é um objeto de grupos');
        expect(() => parseGoldenVectors('{"soma": [{"input": 1}]}')).toThrow('o grupo "soma"');
    });
});

describe('diffGoldenVectors', () => {
    const expected: GoldenVectors = { soma: [{ input: [1, 2], output: 3 }, { input: [2, 2], output: 4 }] };

    it('não acusa nada quando os dois lados concordam', () => {
        expect(diffGoldenVectors(expected, { soma: [{ input: [1, 2], output: 3 }, { input: [2, 2], output: 4 }] })).toEqual([]);
    });

    it('aponta o grupo, a entrada e os dois valores do caso que divergiu', () => {
        const actual: GoldenVectors = { soma: [{ input: [1, 2], output: 3 }, { input: [2, 2], output: 5 }] };

        expect(diffGoldenVectors(expected, actual)).toEqual([{ group: 'soma', input: [2, 2], expected: 4, actual: 5 }]);
    });

    it('acusa grupo e caso que faltam de um dos lados, para nenhum vetor sumir em silêncio', () => {
        expect(diffGoldenVectors(expected, { soma: [{ input: [1, 2], output: 3 }], extra: [{ input: 'x', output: 'y' }] })).toEqual([
            { group: 'soma', input: [2, 2], expected: 4, actual: null },
            { group: 'extra', input: 'x', expected: null, actual: 'y' },
        ]);
    });
});

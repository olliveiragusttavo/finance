import { diffGoldenVectors, parseGoldenVectors, type GoldenVectors } from '@finance/core/golden';
import { describe, expect, it } from 'vitest';
import { computeClientGoldenVectors } from '../../src/golden/goldenVectors.ts';

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

describe('vetores de ouro do client', () => {
    it('o arquivo versionado está em dia com o código (rode pnpm golden:generate se mudou)', async () => {
        await expect(serialize(computeClientGoldenVectors())).toMatchFileSnapshot('../../src/golden/vectors.json');
    });

    it('sobrevive à ida e volta pelo JSON sem divergência, como o app de contrato vai ler', () => {
        const vectors = computeClientGoldenVectors();
        const parsed = parseGoldenVectors(serialize(vectors));

        expect(diffGoldenVectors(parsed, vectors)).toEqual([]);
    });

    it('formata com o sinal tipográfico e o agrupamento pt-BR dos mockups', () => {
        const money = computeClientGoldenVectors()['format.money'] ?? [];

        expect(money).toContainEqual({ input: { amount: -1234.565, currency: 'BRL', sign: 'negative' }, output: '−R$ 1.234,57' });
        expect(money).toContainEqual({ input: { amount: 1234.56, currency: 'CHF', sign: 'always' }, output: '+CHF 1.234,56' });
    });
});

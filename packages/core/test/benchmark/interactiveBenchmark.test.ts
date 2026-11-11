import { describe, expect, it } from 'vitest';
import { formatBenchmarkLog, INTERACTIVE_OPERATIONS, runInteractiveBenchmark } from '../../src/benchmark/interactiveBenchmark.ts';
import { historyPeriods, seedHistory, type HistoryOptions } from '../support/HistorySeeder.ts';
import { openHistoryCore } from '../support/historyCore.ts';

/** Um ano basta: o teste confere o roteiro, não os números, que são da Fase 5 no aparelho. */
const ONE_YEAR: HistoryOptions = { endMonth: '2026-10', years: 1, seed: 11 };

describe('medição das chamadas interativas (mobile-mvp-plan, Fase 5)', () => {
    it('mede as quatro operações e deixa as transações vivas como encontrou', async () => {
        const { core, clock, database } = openHistoryCore(':memory:');
        try {
            await seedHistory(core, clock, ONE_YEAR);
            const before = database.all('SELECT id, value FROM transactions WHERE deleted_at IS NULL ORDER BY id');
            let tick = 0;

            const stats = await runInteractiveBenchmark(core, { ...historyPeriods(ONE_YEAR), rounds: 5, now: () => (tick += 2) });

            expect(stats.map((item) => item.operation)).toEqual(INTERACTIVE_OPERATIONS);
            expect(stats.every((item) => item.samples === 5 && item.p95 === 2 && item.max === 2)).toBe(true);
            expect(database.all('SELECT id, value FROM transactions WHERE deleted_at IS NULL ORDER BY id')).toEqual(before);
            const integrity = await core.call('integrity.verifyBalances', {});
            expect(integrity.ok && integrity.data.drifts).toEqual([]);
        } finally {
            database.close();
        }
    }, 120_000);

    it('recusa medir um banco sem histórico, em vez de medir nada', async () => {
        const { core, database } = openHistoryCore(':memory:');
        try {
            await expect(runInteractiveBenchmark(core, { ...historyPeriods(ONE_YEAR), rounds: 1, now: () => 0 })).rejects.toThrow('o banco não tem perfil');
        } finally {
            database.close();
        }
    });

    it('formata uma linha por operação, com o veredito contra o orçamento de 50 ms', () => {
        const log = formatBenchmarkLog([
            { operation: 'lançar', samples: 40, p50: 3.2, p95: 7.9, max: 12 },
            { operation: 'editar antiga', samples: 40, p50: 41, p95: 63.5, max: 80.1 },
        ]);

        expect(log).toBe(
            '[medição] lançar: p50=3.2 ms p95=7.9 ms max=12 ms (n=40, ok)\n[medição] editar antiga: p50=41 ms p95=63.5 ms max=80.1 ms (n=40, ESTOUROU)',
        );
    });
});

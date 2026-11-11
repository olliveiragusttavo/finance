import { describe, expect, it } from 'vitest';
import { seedHistory, type HistoryOptions } from '../support/HistorySeeder.ts';
import { openHistoryCore } from '../support/historyCore.ts';

/**
 * Período curto: o que o teste confere — saldos íntegros e reprodutibilidade — não depende do
 * tamanho, e dez anos deixariam a suíte lenta. O script gera os dez anos com o mesmo código.
 */
const SHORT_HISTORY: HistoryOptions = { endMonth: '2026-10', years: 2, seed: 7 };

/**
 * Gera um histórico em memória e devolve uma impressão digital do conteúdo.
 *
 * @param options Período e semente.
 * @return O resumo do gerador, o relatório de integridade e a impressão digital das transações.
 */
async function generate(options: HistoryOptions): Promise<{ readonly summary: Awaited<ReturnType<typeof seedHistory>>; readonly drifts: number; readonly fingerprint: string }> {
    const { core, clock, database } = openHistoryCore(':memory:');
    try {
        const summary = await seedHistory(core, clock, options);
        const report = await core.call('integrity.verifyBalances', {});
        const rows = database.all('SELECT id, name, value, due_date, payment_date FROM transactions ORDER BY id');
        return { summary, drifts: report.ok ? report.data.drifts.length : -1, fingerprint: JSON.stringify(rows) };
    } finally {
        database.close();
    }
}

describe('gerador do banco de histórico', () => {
    it('gera um banco cujos saldos em cache batem com o recálculo (integrity.verifyBalances)', async () => {
        const { summary, drifts } = await generate(SHORT_HISTORY);

        expect(drifts).toBe(0);
        expect(summary.months).toBe(24);
        expect(summary.profiles).toBe(2);
        expect(summary.paidInvoices).toBeGreaterThan(0);
        expect(summary.transactions).toBeGreaterThan(24 * 2 * 30);
    }, 120_000);

    it('é reproduzível: a mesma semente gera as mesmas transações', async () => {
        const options: HistoryOptions = { ...SHORT_HISTORY, years: 1 };

        const [first, second] = [await generate(options), await generate(options)];

        expect(second.fingerprint).toBe(first.fingerprint);
    }, 120_000);
});

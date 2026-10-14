import type { AccountFlowMonthResponse, AccountFlowResponse, BalancePairResponse, FlowMonthTiming } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { buildAccountFlowTable, type AccountFlowRow } from '../src/index.ts';
import { ClientWorld } from './support/ClientWorld.ts';

/**
 * @param consolidated Consolidado.
 * @param projected Previsto; sem ele, igual ao consolidado.
 * @return O par em BRL como vem do núcleo.
 */
function pair(consolidated: number, projected = consolidated): BalancePairResponse {
    return { consolidated: { amount: consolidated, currency: 'BRL' }, projected: { amount: projected, currency: 'BRL' } };
}

/**
 * @param period Mês.
 * @param timing Situação do mês em relação a hoje.
 * @param lines Linhas do mês; as ausentes são zero.
 * @return O mês como vem do núcleo.
 */
function month(period: string, timing: FlowMonthTiming, lines: Partial<Omit<AccountFlowMonthResponse, 'period' | 'timing'>>): AccountFlowMonthResponse {
    return { period, timing, opening: pair(0), inflows: pair(0), outflows: pair(0), invoices: pair(0), closing: pair(0), ...lines };
}

/** O exemplo do mockup `DesktopRelFluxo`, com outubro como mês corrente e de referência. */
const REPORT: AccountFlowResponse = {
    period: '2026-10',
    scope: { kind: 'account', accountId: 'nubank', accountName: 'Nubank' },
    months: [
        month('2026-07', 'past', { opening: pair(3100), inflows: pair(9500), outflows: pair(-4210), invoices: pair(-2890), closing: pair(5500) }),
        month('2026-08', 'past', { opening: pair(5500), inflows: pair(9500), outflows: pair(-6900), invoices: pair(-3120), closing: pair(4980) }),
        month('2026-09', 'past', { opening: pair(4980), inflows: pair(9500), outflows: pair(-9528.6), invoices: pair(-2611.25), closing: pair(2340.15) }),
        month('2026-10', 'current', { opening: pair(2340.15), inflows: pair(9500), outflows: pair(-7020, -7520), invoices: pair(0, -2449.75), closing: pair(4820.15, 1870.4) }),
        month('2026-11', 'future', { opening: pair(4820.15, 1870.4), inflows: pair(0, 9500), outflows: pair(0, -7520), invoices: pair(0, -863.42), closing: pair(4820.15, 2986.98) }),
    ],
};

/**
 * @param rows Linhas da tabela.
 * @param key Linha pedida.
 * @return A linha.
 * @throws {Error} Quando a tabela não tem a linha — o view-model mudou de forma.
 */
function row(rows: readonly AccountFlowRow[], key: AccountFlowRow['key']): AccountFlowRow {
    const found = rows.find((candidate) => candidate.key === key);
    if (found === undefined) {
        throw new Error(`sem a linha ${key}`);
    }
    return found;
}

describe('tabela do fluxo por conta', () => {
    it('título, colunas com o mês corrente e os futuros marcados, e a referência', () => {
        const table = buildAccountFlowTable(REPORT);
        expect(table.title).toBe('Nubank — extratos encadeados');
        expect(table.columns.map((column) => [column.label, column.note, column.isReference])).toEqual([
            ['jul/2026', null, false],
            ['ago/2026', null, false],
            ['set/2026', null, false],
            ['out/2026', 'atual', true],
            ['nov/2026', 'previsto', false],
        ]);
        expect(table.rows.map((candidate) => candidate.label)).toEqual(['Saldo inicial', '↑ Entradas', '↓ Saídas', '↓ Faturas', 'Saldo final consolidado', 'Saldo final previsto']);
    });

    it('movimento mostra o previsto com sinal e diz quanto está em aberto', () => {
        const table = buildAccountFlowTable(REPORT);
        expect(row(table.rows, 'inflows').cells[0]).toEqual({ text: '+R$ 9.500,00', sub: null, tone: 'in' });
        expect(row(table.rows, 'outflows').cells[3]).toEqual({ text: '−R$ 7.520,00', sub: '−R$ 500,00 em aberto', tone: 'out' });
        expect(row(table.rows, 'invoices').cells[3]).toEqual({ text: '−R$ 2.449,75', sub: 'em aberto · só no previsto', tone: 'out' });
    });

    it('no mês futuro o inicial é o previsto, não há nota de aberto e o consolidado final é traço', () => {
        const table = buildAccountFlowTable(REPORT);
        expect(row(table.rows, 'opening').cells[4]?.text).toBe('R$ 1.870,40');
        expect(row(table.rows, 'invoices').cells[4]).toEqual({ text: '−R$ 863,42', sub: null, tone: 'out' });
        expect(row(table.rows, 'closing').cells[4]?.text).toBe('—');
        expect(row(table.rows, 'projectedClosing').cells[4]?.text).toBe('R$ 2.986,98');
    });

    it('inicial com previsto diferente mostra os dois; zero fica neutro e sem sinal', () => {
        const report: AccountFlowResponse = { ...REPORT, months: [month('2026-10', 'current', { opening: pair(100, 80) })] };
        const table = buildAccountFlowTable(report);
        expect(row(table.rows, 'opening').cells[0]).toEqual({ text: 'R$ 100,00', sub: 'previsto R$ 80,00', tone: 'neutral' });
        expect(row(table.rows, 'outflows').cells[0]).toEqual({ text: 'R$ 0,00', sub: null, tone: 'neutral' });
    });

    it('as contas do total dizem quantas foram somadas, contra o núcleo real', async () => {
        const world = new ClientWorld();
        const scenario = await world.seed();
        const table = buildAccountFlowTable(await world.ok('reports.accountFlow', { profileId: scenario.profileId, period: '2026-10' }));
        expect(table.title).toBe('Todas as contas do total — extratos encadeados');
        expect(table.subtitle).toContain('soma de 2 contas');
        // A transferência do Nubank para o Tesouro aparece nas entradas e nas saídas da soma (F4).
        expect(row(table.rows, 'inflows').cells[3]?.text).toBe('+R$ 10.000,00');
        expect(row(table.rows, 'outflows').cells[3]?.sub).toBe('em aberto · só no previsto');
    });
});

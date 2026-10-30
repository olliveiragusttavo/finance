import { describe, expect, it } from 'vitest';
import { parseStatementSearch, resolveStatementRange } from '../src/renderer/src/statement/statementSearch.ts';

/** Um instante em 28/10/2026, no fuso do aparelho, para o mês corrente dos atalhos. */
const NOW = new Date(2026, 9, 28, 12);

describe('URL do Extrato (mockup DesktopExtrato)', () => {
    it('aceita o período inteiro, o tipo e os filtros de Transações', () => {
        const account = '0b9f2e2a-3c1d-4e5f-8a7b-6c5d4e3f2a1b';
        expect(parseStatementSearch({ from: '2026-01', to: '2026-10', kind: 'expense', account, q: 'mercado' })).toEqual({
            from: '2026-01',
            to: '2026-10',
            kind: 'expense',
            account,
            q: 'mercado',
        });
    });

    it('descarta o período invertido, maior que 24 meses ou pela metade, e o tipo desconhecido', () => {
        expect(parseStatementSearch({ from: '2026-10', to: '2026-01' })).toEqual({});
        expect(parseStatementSearch({ from: '2024-01', to: '2026-10' })).toEqual({});
        expect(parseStatementSearch({ from: '2026-01' })).toEqual({});
        expect(parseStatementSearch({ kind: 'all' })).toEqual({});
    });

    it('sem período na URL, abre os últimos 12 meses até o mês corrente', () => {
        expect(resolveStatementRange({}, NOW)).toEqual({ from: '2025-11', to: '2026-10' });
        expect(resolveStatementRange({ from: '2026-01', to: '2026-03' }, NOW)).toEqual({ from: '2026-01', to: '2026-03' });
    });
});

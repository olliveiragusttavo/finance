import { describe, expect, it } from 'vitest';
import { formatDateChoice, monthGrid } from '../src/index.ts';

describe('escolha de data no celular (mobile-mvp-plan, Fase 10)', () => {
    it('a grade do mês começa no domingo, com as casas vazias antes do dia 1', () => {
        // 01/10/2026 é uma quinta-feira; outubro tem 31 dias.
        const weeks = monthGrid('2026-10');

        expect(weeks[0]).toEqual([null, null, null, null, '2026-10-01', '2026-10-02', '2026-10-03']);
        expect(weeks.at(-1)).toEqual(['2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31']);
        expect(weeks.flat().filter((day) => day !== null)).toHaveLength(31);
        expect(monthGrid('2028-02').flat().filter((day) => day !== null)).toHaveLength(29);
    });

    it('hoje e ontem pelo nome, os demais pelo dia da semana e, de outro ano, com o ano', () => {
        expect(formatDateChoice('2026-10-06', '2026-10-06')).toBe('Hoje, 06/10');
        expect(formatDateChoice('2026-10-05', '2026-10-06')).toBe('Ontem, 05/10');
        expect(formatDateChoice('2026-10-12', '2026-10-06')).toBe('Seg, 12/10');
        expect(formatDateChoice('2025-12-31', '2026-01-01')).toBe('Ontem, 31/12');
        expect(formatDateChoice('2025-12-30', '2026-01-01')).toBe('Ter, 30/12/2025');
    });
});

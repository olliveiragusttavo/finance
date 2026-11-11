import { describe, expect, it } from 'vitest';
import { currentDate, currentPeriod, isValidPeriod, pickActiveProfile, shiftPeriod } from '../src/index.ts';

describe('mês de referência (desktop-mvp-plan Fase 4; mobile-mvp-plan Fase 6)', () => {
    it('o mês corrente e a data de hoje são os do calendário local', () => {
        expect(currentPeriod(new Date(2026, 9, 31, 23, 59))).toBe('2026-10');
        expect(currentPeriod(new Date(2027, 0, 1, 0, 0))).toBe('2027-01');
        expect(currentDate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31');
        expect(currentDate(new Date(2027, 0, 1, 0, 0))).toBe('2027-01-01');
    });

    it('anda um mês para cada lado, com a virada de ano', () => {
        expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
        expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
    });

    it('aceita só o mês que o núcleo aceita', () => {
        expect(isValidPeriod('2026-10')).toBe(true);
        expect(isValidPeriod('2026-13')).toBe(false);
        expect(isValidPeriod('2026-1')).toBe(false);
        expect(isValidPeriod('1899-12')).toBe(false);
        expect(isValidPeriod('2026-10-01')).toBe(false);
    });
});

describe('perfil ativo', () => {
    const personal = { id: 'a', name: 'Gustavo', type: 'personal', currency: 'BRL', defaultAccountId: null, defaultCreditCardId: null } as const;
    const business = { id: 'b', name: 'Estúdio GO', type: 'business', currency: 'BRL', defaultAccountId: null, defaultCreditCardId: null } as const;

    it('reabre o último perfil do aparelho e cai no primeiro quando ele não existe mais', () => {
        expect(pickActiveProfile([personal, business], 'b')).toBe(business);
        expect(pickActiveProfile([personal, business], 'excluído')).toBe(personal);
        expect(pickActiveProfile([personal, business], null)).toBe(personal);
        expect(pickActiveProfile([], 'b')).toBeNull();
    });
});

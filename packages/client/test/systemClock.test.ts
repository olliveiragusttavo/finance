import { describe, expect, it } from 'vitest';
import { SystemClock } from '../src/startup/SystemClock.ts';

describe('SystemClock (backend-design §5.7)', () => {
    it('hoje é o dia do calendário local, mesmo quando o UTC já virou o mês', () => {
        // 22h do dia 31 no fuso do aparelho: em São Paulo, o UTC já está no dia 1º.
        const instant = new Date(2026, 9, 31, 22, 0, 0);
        const clock = new SystemClock(() => instant);

        expect(clock.today().toString()).toBe('2026-10-31');
        expect(clock.now()).toBe(instant.toISOString().slice(0, 19).replace('T', ' '));
    });
});

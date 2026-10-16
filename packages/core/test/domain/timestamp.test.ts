import { describe, expect, it } from 'vitest';
import { parseTimestamp } from '../../src/index.ts';

describe('parseTimestamp (porta Clock dos adaptadores de plataforma)', () => {
    it('aceita o formato do CHECK de timestamp do schema', () => {
        expect(parseTimestamp('2026-10-03 23:59:59')).toBe('2026-10-03 23:59:59');
    });

    it.each(['2026-10-03T12:00:00', '2026-10-03 12:00', '2026-13-01 00:00:00', '2026-10-03 24:00:00', '2026-10-03 12:00:00Z'])(
        'recusa %s, que o schema também recusaria',
        (raw) => {
            expect(() => parseTimestamp(raw)).toThrow(/timestamp/);
        },
    );
});

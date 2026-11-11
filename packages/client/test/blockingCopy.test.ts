import { describe, expect, it } from 'vitest';
import { blockingCopy, canTryRestore, restoreMessage, type BlockedStatus } from '../src/startup/blockingCopy.ts';

describe('textos das telas de bloqueio (iguais no desktop e no celular)', () => {
    it('todo bloqueio tem título e explicação do que aconteceu com os dados', () => {
        const statuses: readonly BlockedStatus[] = [
            { kind: 'schemaNewerThanApp', databaseVersion: 9, appVersion: 7 },
            { kind: 'migrationFailed', backupFile: 'pre-v4.sqlite' },
            { kind: 'migrationFailed', backupFile: null },
            { kind: 'backupFailed' },
            { kind: 'openFailed' },
            { kind: 'restoreIncomplete', failedCopy: 'falha-1.sqlite' },
            { kind: 'unexpected' },
        ];
        for (const status of statuses) {
            const copy = blockingCopy(status);
            expect(copy.title, status.kind).not.toBe('');
            expect(copy.body, status.kind).not.toBe('');
        }
        expect(blockingCopy({ kind: 'schemaNewerThanApp', databaseVersion: 9, appVersion: 7 }).body).toContain('versão 9');
        expect(blockingCopy({ kind: 'restoreIncomplete', failedCopy: 'falha-1.sqlite' }).body).toContain('falha-1.sqlite');
    });

    it('diz onde estão os dados depois da restauração, dê certo ou não', () => {
        expect(restoreMessage({ ok: true, restoredFrom: 'pre-v4.sqlite', failedCopy: 'falha-2.sqlite' })).toContain('falha-2.sqlite');
        expect(restoreMessage({ ok: false, reason: 'database-moved', failedCopy: 'falha-3.sqlite' })).toContain('falha-3.sqlite');
    });

    it('só libera nova tentativa quando nada foi alterado', () => {
        expect(canTryRestore(null)).toBe(true);
        expect(canTryRestore('running')).toBe(false);
        expect(canTryRestore({ ok: false, reason: 'io-error' })).toBe(true);
        expect(canTryRestore({ ok: false, reason: 'database-moved', failedCopy: 'x' })).toBe(false);
        expect(canTryRestore({ ok: true, restoredFrom: 'a', failedCopy: 'b' })).toBe(false);
    });
});

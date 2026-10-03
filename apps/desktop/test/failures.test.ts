import type { CoreClient } from '@finance/client';
import { describe, expect, it } from 'vitest';
import { FailFastCoreClient, FailureStore, fatalProcessFailure } from '../src/renderer/src/lib/failures.ts';

describe('falha fatal no renderer', () => {
    it('guarda só a primeira falha, que é a causa; as seguintes costumam ser sintoma', () => {
        const store = new FailureStore();
        let notified = 0;
        store.subscribe(() => {
            notified++;
        });
        store.report(fatalProcessFailure({ source: 'core-process', message: 'saiu com código 1' }));
        store.report({ title: 'outra', message: 'outra', details: '' });
        expect(store.snapshot()?.title).toBe('O núcleo do app parou');
        expect(notified).toBe(1);
    });

    it('erro INTERNAL do núcleo vira falha fatal; erro de regra continua com a tela', async () => {
        const store = new FailureStore();
        const failing: CoreClient = {
            call: (route) => Promise.resolve(route === 'profiles.list'
                ? { ok: false, error: { code: 'INTERNAL', message: 'boom', details: {} } }
                : { ok: false, error: { code: 'VALIDATION_FAILED', message: 'campo', details: {} } }),
        };
        const client = new FailFastCoreClient(failing, store);

        const validation = await client.call('accounts.list', { profileId: 'p', period: '2026-10' });
        expect(validation.ok).toBe(false);
        expect(store.snapshot()).toBeNull();

        const internal = await client.call('profiles.list', {});
        expect(internal.ok).toBe(false);
        expect(store.snapshot()?.details).toContain('profiles.list: boom');
    });
});

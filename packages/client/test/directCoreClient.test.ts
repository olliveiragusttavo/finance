import type { CoreApi } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { DirectCoreClient, type CoreCallScheduler } from '../src/core/CoreClient.ts';

/**
 * Agendador falso: guarda as tarefas até o teste "desenhar o frame", como o agendador
 * pós-frame do mobile guarda até o fim do frame corrente.
 */
class FakeFrameScheduler {
    private readonly pending: (() => void)[] = [];

    /** O agendador a injetar no cliente. */
    public readonly schedule: CoreCallScheduler = (task) => {
        this.pending.push(task);
    };

    /** Simula o fim do frame: roda o que ficou agendado, na ordem de chegada. */
    public flush(): void {
        for (const task of this.pending.splice(0)) {
            task();
        }
    }
}

/**
 * @param calls Onde registrar as rotas na ordem em que o núcleo as recebeu.
 * @return Um núcleo falso que responde na hora com a própria rota.
 */
function fakeCore(calls: string[]): Pick<CoreApi, 'call'> {
    return {
        call: (route) => {
            calls.push(route);
            return Promise.resolve({ ok: false, error: { code: 'NOT_FOUND', message: route, details: {} } });
        },
    };
}

describe('DirectCoreClient com agendador', () => {
    it('não toca o núcleo antes do fim do frame, para o toque desenhar o retorno antes', async () => {
        const calls: string[] = [];
        const frames = new FakeFrameScheduler();
        const client = new DirectCoreClient(fakeCore(calls), frames.schedule);

        const pending = client.call('profiles.list', {});
        expect(calls).toEqual([]);

        frames.flush();
        expect(calls).toEqual(['profiles.list']);
        expect(await pending).toMatchObject({ ok: false, error: { message: 'profiles.list' } });
    });

    it('mantém a ordem de chegada: a escrita da tela roda antes da leitura que veio depois', () => {
        const calls: string[] = [];
        const frames = new FakeFrameScheduler();
        const client = new DirectCoreClient(fakeCore(calls), frames.schedule);

        void client.call('transactions.setPaid', { id: '00000000-0000-4000-8000-000000000001', paid: true });
        void client.call('transactions.listByPeriod', { profileId: '00000000-0000-4000-8000-000000000002', period: '2026-03' });
        frames.flush();

        expect(calls).toEqual(['transactions.setPaid', 'transactions.listByPeriod']);
    });

    it('propaga a rejeição de um bug do núcleo para quem chamou', async () => {
        const frames = new FakeFrameScheduler();
        const client = new DirectCoreClient({ call: () => Promise.reject(new Error('quebrou')) }, frames.schedule);

        const pending = client.call('profiles.list', {});
        frames.flush();

        await expect(pending).rejects.toThrow('quebrou');
    });

    it('sem agendador, chama o núcleo na hora, como nos testes e no desktop', () => {
        const calls: string[] = [];

        void new DirectCoreClient(fakeCore(calls)).call('profiles.list', {});

        expect(calls).toEqual(['profiles.list']);
    });
});

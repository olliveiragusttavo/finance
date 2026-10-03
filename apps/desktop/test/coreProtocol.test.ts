import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { createCore, openDatabase, type CoreApi, type CoreResult } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { afterEach, describe, expect, it } from 'vitest';
import { IpcCoreClient, type MessageEndpoint } from '../src/shared/coreProtocol.ts';
import { serveCore } from '../src/utility/serveCore.ts';
import { CryptoIdGenerator, SystemClock } from '../src/utility/systemAdapters.ts';

const ports: MessagePort[] = [];

afterEach(() => {
    for (const port of ports.splice(0)) {
        port.close();
    }
});

/**
 * @param port Ponta do `MessageChannel` do Node, que faz o papel do `MessagePortMain` e do
 * `MessagePort` do DOM nos testes.
 * @return A ponta no formato do protocolo.
 */
function endpointOf(port: MessagePort): MessageEndpoint {
    ports.push(port);
    return {
        postMessage: (message) => {
            port.postMessage(message);
        },
        onMessage: (listener) => {
            port.on('message', listener);
        },
    };
}

/** @return Núcleo de verdade sobre SQLite em memória, com as portas reais do desktop. */
function memoryCore(): CoreApi {
    const clock = new SystemClock();
    const database = BetterSqliteDatabase.open(':memory:');
    openDatabase(database, { backups: null, clock });
    return createCore({ database, clock, ids: new CryptoIdGenerator() });
}

/**
 * Liga um `IpcCoreClient` a um despacho, pelos dois lados de um canal real.
 *
 * @param core Despacho do lado do processo do núcleo.
 * @param invalid Recebe as mensagens fora do protocolo.
 * @return O cliente e a ponta crua do lado do renderer, para injetar mensagens.
 */
function connect(core: Pick<CoreApi, 'dispatch'>, invalid: unknown[] = []): { readonly client: IpcCoreClient; readonly raw: MessagePort } {
    const channel = new MessageChannel();
    serveCore(endpointOf(channel.port1), core, (message) => invalid.push(message));
    const client = new IpcCoreClient();
    client.connect(endpointOf(channel.port2));
    return { client, raw: channel.port2 };
}

describe('IpcCoreClient e serveCore (desktop-mvp-plan Fase 3.3)', () => {
    it('leva a rota pelo canal até o núcleo e devolve o resultado tipado', async () => {
        const { client } = connect(memoryCore());
        const created = await client.call('onboarding.start', {
            profile: { name: 'Pessoal', type: 'personal', currency: 'BRL' },
            account: { name: 'Nubank', type: 'checking', openingBalance: 100 },
        });
        expect(created.ok).toBe(true);
        const profiles = await client.call('profiles.list', {});
        expect(profiles.ok ? profiles.data.map((profile) => profile.name) : []).toEqual(['Pessoal']);
    });

    it('correlaciona respostas que chegam fora de ordem', async () => {
        const gate = { release: (): void => undefined };
        const slow: Pick<CoreApi, 'dispatch'> = {
            dispatch: (route) => new Promise((resolve) => {
                const result: CoreResult<unknown> = { ok: true, data: route };
                if (route === 'profiles.list') {
                    gate.release = () => {
                        resolve(result);
                    };
                } else {
                    resolve(result);
                }
            }),
        };
        const { client } = connect(slow);
        const first = client.call('profiles.list', {});
        const second = await client.call('integrity.verifyBalances', {});
        expect(second).toEqual({ ok: true, data: 'integrity.verifyBalances' });
        gate.release();
        expect(await first).toEqual({ ok: true, data: 'profiles.list' });
    });

    it('guarda as chamadas feitas antes de a ponta chegar e as envia ao conectar', async () => {
        const client = new IpcCoreClient();
        const early = client.call('profiles.list', {});
        const channel = new MessageChannel();
        serveCore(endpointOf(channel.port1), memoryCore(), () => undefined);
        client.connect(endpointOf(channel.port2));
        expect(await early).toEqual({ ok: true, data: [] });
    });

    it('rota desconhecida, vinda de um renderer adulterado, volta como VALIDATION_FAILED do núcleo', async () => {
        const { raw } = connect(memoryCore());
        const response = new Promise<unknown>((resolve) => {
            raw.on('message', resolve);
        });
        raw.postMessage({ kind: 'core.request', id: 7, route: 'fs.readFile', input: { path: '/etc/passwd' } });
        expect(await response).toMatchObject({ kind: 'core.response', id: 7, result: { ok: false, error: { code: 'VALIDATION_FAILED' } } });
    });

    it('descarta mensagem fora do protocolo sem derrubar o canal', async () => {
        const invalid: unknown[] = [];
        const { client, raw } = connect(memoryCore(), invalid);
        raw.postMessage({ kind: 'core.request', id: -1, route: 'profiles.list', input: {} });
        raw.postMessage('lixo');
        expect(await client.call('profiles.list', {})).toEqual({ ok: true, data: [] });
        expect(invalid).toEqual([{ kind: 'core.request', id: -1, route: 'profiles.list', input: {} }, 'lixo']);
    });

    it('quando o processo do núcleo cai, as chamadas pendentes e as novas recebem erro de transporte', async () => {
        const never: Pick<CoreApi, 'dispatch'> = { dispatch: () => new Promise(() => undefined) };
        const { client } = connect(never);
        const pending = client.call('profiles.list', {});
        client.close();
        const closed = { ok: false, error: { code: 'INTERNAL', message: 'Canal com o núcleo fechado', details: { reason: 'transport-closed' } } };
        expect(await pending).toEqual(closed);
        expect(await client.call('profiles.list', {})).toEqual(closed);
    });
});

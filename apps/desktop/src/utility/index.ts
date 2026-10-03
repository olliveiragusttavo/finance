import type { MessagePortMain } from 'electron';
import { join } from 'node:path';
import type { CoreApi } from '@finance/core';
import type { MessageEndpoint } from '../shared/coreProtocol.ts';
import { databaseFiles } from './databaseFiles.ts';
import { FileLog } from './FileLog.ts';
import { openCore } from './openCore.ts';
import { serveCore } from './serveCore.ts';
import { CryptoIdGenerator, SystemClock } from './systemAdapters.ts';
import { parseUtilityArguments, type MainToUtilityMessage, type UtilityToMainMessage } from './utilityMessages.ts';

/*
 * Processo do núcleo (desktop-shell-design §5.2): dono da única conexão com o banco, fora da
 * thread de UI e do processo principal. Recebe do principal uma ponta de `MessageChannel` por
 * janela carregada e atende as rotas por ela; ao principal só diz como a abertura terminou.
 */

const parentPort = process.parentPort;
const { userData } = parseUtilityArguments(process.argv);
const log = new FileLog(join(userData, 'logs', 'core.log'));

// Depois de uma exceção não tratada o estado do processo é desconhecido, e continuar
// atendendo rotas poderia gravar no banco a partir dele. O processo sai; o principal avisa as
// janelas, que mostram a tela de erro.
process.on('uncaughtException', (error) => {
    log.write('error', 'utility.uncaught', { error });
    process.exit(1);
});

const opened = await openCore({
    ...databaseFiles(userData),
    clock: new SystemClock(),
    ids: new CryptoIdGenerator(),
    log,
});

/**
 * Despacho usado quando o banco está bloqueado: a janela mostra a tela de bloqueio e não
 * deveria chamar rotas, mas se chamar recebe erro em vez de ficar sem resposta.
 */
const blockedCore: Pick<CoreApi, 'dispatch'> = {
    dispatch: () => Promise.resolve({
        ok: false,
        error: opened.status.kind === 'schemaNewerThanApp'
            ? { code: 'SCHEMA_NEWER_THAN_APP', message: 'Banco mais novo que o app', details: {} }
            : { code: 'INTERNAL', message: 'Banco não aberto', details: { reason: opened.status.kind } },
    }),
};

parentPort.on('message', (event: { readonly data: MainToUtilityMessage; readonly ports: readonly MessagePortMain[] }) => {
    const port = event.ports[0];
    if (event.data.kind === 'connect' && port !== undefined) {
        serveCore(endpointOf(port), opened.core ?? blockedCore, (message) => {
            log.write('warn', 'ipc.invalid-message', { message });
        });
    }
    if (event.data.kind === 'close-database') {
        opened.close();
        post({ kind: 'database-closed' });
    }
});

post({ kind: 'startup', status: opened.status });

/**
 * @param message Mensagem ao processo principal.
 */
function post(message: UtilityToMainMessage): void {
    parentPort.postMessage(message);
}

/**
 * @param port Ponta do canal entregue pelo processo principal.
 * @return A ponta no formato do protocolo; `start` é obrigatório no `MessagePortMain`, que
 * segura as mensagens até ser iniciado.
 */
function endpointOf(port: MessagePortMain): MessageEndpoint {
    const endpoint: MessageEndpoint = {
        postMessage: (message) => {
            port.postMessage(message);
        },
        onMessage: (listener) => {
            port.on('message', (event) => {
                listener(event.data);
            });
            port.start();
        },
    };
    return endpoint;
}

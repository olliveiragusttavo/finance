import { contextBridge, ipcRenderer } from 'electron';
import {
    BRIDGE_KEY,
    IPC_CHANNELS,
    type DevicePreferences,
    type FatalFailure,
    type FinanceBridge,
    type ReportResult,
    type RestoreResult,
    type StartupStatus,
} from '../shared/bridge.ts';
import { IpcCoreClient } from '../shared/coreProtocol.ts';

/*
 * Preload (sandbox, isolamento de contexto): a única ponte entre o renderer e o resto do app
 * (desktop-shell-design §3.6). O `MessagePort` do núcleo fica aqui, no mundo isolado, e o
 * renderer recebe só a função `call` — nunca a ponta crua nem o `ipcRenderer`.
 */

const client = new IpcCoreClient();
const fatalListeners = new Set<(failure: FatalFailure) => void>();
// A falha pode chegar antes de a tela se inscrever (o núcleo caindo durante a abertura).
let lastFailure: FatalFailure | null = null;

/**
 * Repassa a falha fatal às telas inscritas. Fica no preload, e não em cada tela, porque o
 * aviso chega pelo `ipcRenderer`, que o renderer não enxerga.
 *
 * @param failure O que derrubou o app.
 */
function notifyFatal(failure: FatalFailure): void {
    lastFailure ??= failure;
    for (const listener of fatalListeners) {
        listener(failure);
    }
}

ipcRenderer.on(IPC_CHANNELS.corePort, (event) => {
    const port = event.ports[0];
    if (port === undefined) {
        return;
    }
    client.connect({
        postMessage: (message) => {
            port.postMessage(message);
        },
        onMessage: (listener) => {
            port.onmessage = (messageEvent: MessageEvent<unknown>): void => {
                listener(messageEvent.data);
            };
        },
    });
});

ipcRenderer.on(IPC_CHANNELS.coreClosed, () => {
    client.close();
    notifyFatal({ source: 'core-process', message: 'O processo do núcleo terminou inesperadamente.' });
});

ipcRenderer.on(IPC_CHANNELS.mainFailed, (_event, failure: FatalFailure) => {
    notifyFatal(failure);
});

const bridge: FinanceBridge = {
    core: {
        call: (route, input) => client.call(route, input),
    },
    preferences: {
        get: (): Promise<DevicePreferences> => invoke(IPC_CHANNELS.preferencesGet),
        update: (patch): Promise<DevicePreferences> => invoke(IPC_CHANNELS.preferencesUpdate, patch),
    },
    startup: {
        status: (): Promise<StartupStatus> => invoke(IPC_CHANNELS.startupStatus),
        restoreBackup: (): Promise<RestoreResult> => invoke(IPC_CHANNELS.startupRestore),
    },
    failures: {
        onFatal: (listener) => {
            fatalListeners.add(listener);
            if (lastFailure !== null) {
                listener(lastFailure);
            }
            return () => {
                fatalListeners.delete(listener);
            };
        },
    },
    report: {
        logTail: (): Promise<string> => invoke(IPC_CHANNELS.reportLogTail),
        send: (channel, report): Promise<ReportResult> => invoke(IPC_CHANNELS.reportSend, channel, report),
    },
};

contextBridge.exposeInMainWorld(BRIDGE_KEY, bridge);

/**
 * `ipcRenderer.invoke` devolve `any`; este invólucro dá a cada canal o tipo da resposta que o
 * processo principal registrou para ele, num lugar só.
 *
 * @param channel Canal registrado no processo principal.
 * @param args Argumentos do canal.
 * @return A resposta do processo principal.
 */
function invoke<T>(channel: string, ...args: readonly unknown[]): Promise<T> {
    return ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

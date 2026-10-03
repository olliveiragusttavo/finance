import { app, BrowserWindow, ipcMain, nativeTheme, shell, webContents } from 'electron';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { colorTokens } from '@finance/tokens';
import { IPC_CHANNELS, type FatalFailure, type ReportResult, type RestoreResult } from '../shared/bridge.ts';
import { databaseFiles, type DatabaseFiles } from '../utility/databaseFiles.ts';
import { errorReplacer } from '../utility/FileLog.ts';
import { CoreProcess } from './CoreProcess.ts';
import { DevicePreferencesStore } from './DevicePreferencesStore.ts';
import { buildReportUrl, problemReportSchema, readLogTail, reportChannelSchema } from './problemReport.ts';
import { restoreBackup } from './restoreBackup.ts';
import { installSecurityGuards } from './security.ts';

/*
 * Processo principal: cria a janela e o processo do núcleo, costura o canal entre eles e
 * atende as poucas operações que só ele pode fazer (preferências do aparelho, restaurar
 * backup). Não executa rota alguma (desktop-shell-design §5.2).
 */

// Pasta de dados alternativa para os testes de ponta a ponta, que não podem tocar no banco
// real do usuário. Precisa vir antes de qualquer `app.getPath`.
const userDataOverride = process.env['FINANCE_USER_DATA'];
if (userDataOverride !== undefined && userDataOverride !== '') {
    app.setPath('userData', userDataOverride);
}

const rendererDevUrl = process.env['ELECTRON_RENDERER_URL'];
const rendererFile = join(import.meta.dirname, '../renderer/index.html');
const appUrl = rendererDevUrl ?? pathToFileURL(rendererFile).href;

/**
 * Grava uma linha em `userData/logs/main.log`. Nunca lança: é chamado também de dentro do
 * tratamento de falhas, e um erro no log ali derrubaria o próprio aviso de erro.
 *
 * @param event Evento do processo principal.
 * @param data Dados do evento; um `Error` vira um objeto com nome, mensagem, pilha e causa,
 * que o `JSON.stringify` descartaria.
 */
function log(event: string, data: Readonly<Record<string, unknown>> = {}): void {
    try {
        const logs = join(app.getPath('userData'), 'logs');
        mkdirSync(logs, { recursive: true });
        const line = JSON.stringify({ at: new Date().toISOString(), event, ...data }, errorReplacer());
        appendFileSync(join(logs, 'main.log'), `${line}\n`);
    } catch (error) {
        console.error('Falha ao gravar o log', event, error);
    }
}

/**
 * Avisa todas as janelas de uma falha fatal do processo principal. Sem o aviso, a janela
 * seguiria aberta sobre um processo principal em estado desconhecido, e o usuário continuaria
 * lançando sem saber que as preferências ou a restauração podem não funcionar.
 *
 * @param error O que foi lançado sem tratamento.
 */
function reportMainFailure(error: unknown): void {
    log('main.uncaught', { error });
    const failure: FatalFailure = { source: 'main-process', message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    for (const contents of webContents.getAllWebContents()) {
        if (!contents.isDestroyed()) {
            contents.send(IPC_CHANNELS.mainFailed, failure);
        }
    }
}

process.on('uncaughtException', reportMainFailure);
process.on('unhandledRejection', reportMainFailure);

/**
 * @param date Instante atual.
 * @return O instante como `YYYYMMDD-HHMMSS` em UTC, para nomes de arquivo.
 */
function fileInstant(date: Date): string {
    return date.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '').replace('T', '-');
}

/**
 * Cria a janela com a configuração de segurança obrigatória (desktop-shell-design §3.6). O
 * fundo inicial vem do token `bg` no tema que o aparelho vai mostrar, para que a janela não
 * pisque em branco antes do primeiro quadro no tema escuro.
 *
 * @param core Processo do núcleo, ligado à janela a cada carregamento.
 * @return A janela.
 */
function createWindow(core: CoreProcess): BrowserWindow {
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1024,
        minHeight: 640,
        show: false,
        title: 'Finanças',
        backgroundColor: nativeTheme.shouldUseDarkColors ? colorTokens.bg.dark : colorTokens.bg.light,
        webPreferences: {
            preload: join(import.meta.dirname, '../preload/index.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            nodeIntegrationInWorker: false,
            webSecurity: true,
            spellcheck: false,
        },
    });
    window.once('ready-to-show', () => {
        window.show();
    });
    window.webContents.on('did-finish-load', () => {
        core.connect(window.webContents);
    });
    if (rendererDevUrl === undefined) {
        void window.loadFile(rendererFile);
    } else {
        void window.loadURL(rendererDevUrl);
    }
    return window;
}

/**
 * Registra os canais de IPC que o preload usa. Cada um valida a entrada no lado de cá: o
 * renderer é entrada não confiável.
 *
 * @param core Processo do núcleo.
 * @param preferences Arquivo de preferências do aparelho.
 */
function registerIpc(core: CoreProcess, preferences: DevicePreferencesStore): void {
    const userData = app.getPath('userData');
    const files = databaseFiles(userData);
    const logFiles = [join(userData, 'logs', 'core.log'), join(userData, 'logs', 'main.log')];
    // Um pedido de restauração por vez: um segundo pedido (duplo clique, recarga da janela)
    // recebe o resultado do primeiro, em vez de tirar do lugar o banco que acabou de ser
    // restaurado. Só as falhas que não mexeram em nada liberam uma nova tentativa.
    let restoring: Promise<RestoreResult> | null = null;
    ipcMain.handle(IPC_CHANNELS.preferencesGet, () => preferences.read());
    ipcMain.handle(IPC_CHANNELS.preferencesUpdate, (_event, patch: unknown) => {
        const next = preferences.update(patch);
        nativeTheme.themeSource = next.theme;
        return next;
    });
    ipcMain.handle(IPC_CHANNELS.startupStatus, () => core.status());
    ipcMain.handle(IPC_CHANNELS.startupRestore, (): Promise<RestoreResult> => {
        restoring ??= runRestore(core, files).then((result) => {
            if (!result.ok && (result.reason === 'core-busy' || result.reason === 'io-error')) {
                restoring = null;
            }
            return result;
        });
        return restoring;
    });
    ipcMain.handle(IPC_CHANNELS.reportLogTail, () => readLogTail(logFiles, homedir()));
    ipcMain.handle(IPC_CHANNELS.reportSend, async (_event, rawChannel: unknown, rawReport: unknown): Promise<ReportResult> => {
        const channel = reportChannelSchema.safeParse(rawChannel);
        const report = problemReportSchema.safeParse(rawReport);
        if (!channel.success || !report.success) {
            return { ok: false };
        }
        const environment = [
            `App: ${app.getVersion()}`,
            `Electron: ${process.versions.electron}`,
            `Sistema: ${process.platform} ${release()} (${process.arch})`,
        ];
        const { url, logTruncated } = buildReportUrl(channel.data, report.data, { environment, logTail: readLogTail(logFiles, homedir()) });
        try {
            await shell.openExternal(url);
        } catch (error) {
            log('report.open-failed', { channel: channel.data, error });
            return { ok: false };
        }
        log('report.opened', { channel: channel.data, logTruncated });
        return { ok: true, logTruncated };
    });
}

/**
 * Restaura o backup da migration que falhou. Toda falha vira resultado, e não exceção: uma
 * promessa rejeitada deixaria a tela de bloqueio parada em "restaurando", sem saída.
 *
 * @param core Processo do núcleo, que precisa soltar o arquivo antes.
 * @param files Caminhos do banco, dos backups e da marca de restauração.
 * @return O resultado da restauração; `core-busy` quando o núcleo não soltou o banco a tempo.
 */
async function runRestore(core: CoreProcess, files: DatabaseFiles): Promise<RestoreResult> {
    const status = await core.status();
    if (status.kind !== 'migrationFailed') {
        return { ok: false, reason: 'not-blocked' };
    }
    if (status.backupFile === null) {
        return { ok: false, reason: 'no-backup' };
    }
    try {
        await core.closeDatabase();
    } catch (error) {
        log('startup.restore-backup', { error });
        return { ok: false, reason: 'core-busy' };
    }
    const result = restoreBackup(files, status.backupFile, fileInstant(new Date()));
    log('startup.restore-backup', { result });
    return result;
}

/**
 * Sobe o app quando o Electron está pronto. Não é `await` no nível do módulo de propósito: o
 * evento `ready` só dispara depois que o módulo de entrada termina de avaliar, e o `await`
 * no topo de um main em ESM esperaria por ele para sempre.
 */
function start(): void {
    installSecurityGuards(appUrl);
    const preferences = new DevicePreferencesStore(join(app.getPath('userData'), 'preferences.json'));
    nativeTheme.themeSource = preferences.read().theme;
    const core = new CoreProcess(join(import.meta.dirname, 'utility.js'), app.getPath('userData'), (code) => {
        log('utility.exit', { code });
    });
    registerIpc(core, preferences);
    createWindow(core);
    app.on('window-all-closed', () => {
        core.stop();
        app.quit();
    });
}

void app.whenReady().then(start);

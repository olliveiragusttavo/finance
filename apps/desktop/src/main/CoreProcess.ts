import { MessageChannelMain, utilityProcess, type MessagePortMain, type UtilityProcess, type WebContents } from 'electron';
import type { StartupStatus } from '../shared/bridge.ts';
import { IPC_CHANNELS } from '../shared/bridge.ts';
import type { DatabaseExportOutcome } from '../utility/exportDatabase.ts';
import type { DatabaseImportPreparation } from '../utility/importDatabase.ts';
import { utilityArguments, type MainToUtilityMessage, type UtilityToMainMessage } from '../utility/utilityMessages.ts';
import { CloseHandshake } from './CloseHandshake.ts';

/** Prazo para o processo do núcleo confirmar que fechou o banco antes da restauração. */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * O processo do núcleo visto pelo processo principal: cria o `utilityProcess`, entrega a cada
 * janela uma ponta de `MessageChannelMain` e guarda como a abertura do banco terminou. As
 * chamadas de rota não passam por aqui (desktop-shell-design §5.2) — o principal só costura
 * o canal, e fica livre para janelas e menus.
 *
 * Desde a importação de cópia em Ajustes, o processo pode ser trocado por um novo
 * (`restart`): o banco que entrou no lugar só é aberto, migrado e verificado por uma abertura
 * nova, e repetir a sequência de abertura num processo novo é mais seguro que reabrir o banco
 * dentro de um processo que já serviu outro.
 */
export class CoreProcess {
    private child: CoreChild;
    private readonly windows = new Set<WebContents>();

    /**
     * @param modulePath Caminho do bundle do processo do núcleo.
     * @param userData Pasta de dados do app, onde ficam o banco, os backups e o log.
     * @param onExit Avisado quando o processo do núcleo termina, para o log. As janelas são
     * avisadas à parte, pelo canal `coreClosed`, e mostram a tela de erro.
     */
    public constructor(private readonly modulePath: string, private readonly userData: string, private readonly onExit: (code: number) => void) {
        this.child = this.spawn();
    }

    /** @return Como a abertura do banco terminou; espera o processo do núcleo responder. */
    public status(): Promise<StartupStatus> {
        return this.child.startup;
    }

    /**
     * Liga uma janela ao núcleo com um canal novo. Chamado a cada carregamento da página —
     * um recarregamento descarta o preload antigo junto com a ponta que ele tinha.
     *
     * @param contents Janela recém-carregada.
     */
    public connect(contents: WebContents): void {
        const { port1, port2 } = new MessageChannelMain();
        this.child.post({ kind: 'connect' }, [port1]);
        contents.postMessage(IPC_CHANNELS.corePort, null, [port2]);
        this.windows.add(contents);
        contents.once('destroyed', () => this.windows.delete(contents));
    }

    /**
     * Pede ao processo do núcleo que feche a conexão com o banco, antes de restaurar um
     * backup ou importar uma cópia sobre o arquivo.
     *
     * @return Promessa resolvida quando a conexão foi fechada ou o processo já terminou.
     * @throws {DatabaseCloseTimeoutError} (na promessa) Quando o núcleo não confirma no prazo.
     */
    public closeDatabase(): Promise<void> {
        return this.child.closeDatabase();
    }

    /**
     * Pede ao processo do núcleo, dono da única conexão, a cópia exportada do banco
     * (desktop-mvp-plan Fase 13). Sem prazo, ao contrário do fechamento: o `VACUUM INTO` de um
     * banco grande num disco lento pode demorar, e desistir no meio deixaria a cópia sendo
     * gravada sem ninguém para avisar quando termina.
     *
     * @param destination Arquivo escolhido no diálogo de salvar.
     * @return Promessa com o resultado; `unavailable` quando o processo do núcleo termina antes
     * de responder.
     */
    public exportDatabase(destination: string): Promise<DatabaseExportOutcome> {
        return this.child.exportDatabase(destination);
    }

    /**
     * Pede ao processo do núcleo que confira a cópia a importar e a grave ao lado do banco. Sem
     * prazo, pelo mesmo motivo da exportação: é o mesmo `VACUUM INTO`.
     *
     * @param source Arquivo escolhido no diálogo de abrir.
     * @param staged Arquivo provisório, na pasta do banco.
     * @return Promessa com o resultado; `unavailable` quando o processo do núcleo termina antes
     * de responder.
     */
    public prepareImport(source: string, staged: string): Promise<DatabaseImportPreparation> {
        return this.child.prepareImport(source, staged);
    }

    /**
     * Troca o processo do núcleo por um novo, que abre o banco do zero: migrations com backup,
     * verificação de integridade e complemento das recorrências (backend-design §4.5). O processo
     * antigo sai sem avisar as janelas — a saída é pedida, não uma queda, e a tela de erro estaria
     * errada. As janelas continuam ligadas ao antigo até `reloadWindows`.
     *
     * @return Como terminou a abertura no processo novo.
     */
    public async restart(): Promise<StartupStatus> {
        await this.child.stop();
        this.child = this.spawn();
        return this.child.startup;
    }

    /**
     * Recarrega as janelas depois de `restart`. O recarregamento descarta o estado do renderer —
     * perfil aberto, consultas em cache, formulários —, que descrevia o banco anterior, e o
     * `did-finish-load` liga cada janela ao processo novo.
     */
    public reloadWindows(): void {
        for (const contents of this.windows) {
            if (!contents.isDestroyed()) {
                contents.reload();
            }
        }
    }

    /** Encerra o processo do núcleo ao sair do app. */
    public stop(): void {
        void this.child.stop();
    }

    /**
     * @return Um processo do núcleo novo; a queda dele avisa as janelas, a saída pedida não.
     */
    private spawn(): CoreChild {
        return new CoreChild(this.modulePath, this.userData, (code, requested) => {
            if (!requested) {
                for (const contents of this.windows) {
                    if (!contents.isDestroyed()) {
                        contents.send(IPC_CHANNELS.coreClosed);
                    }
                }
            }
            this.onExit(code);
        });
    }
}

/**
 * Um `utilityProcess` do núcleo, do `fork` à saída. Fica separado do `CoreProcess` para que o
 * estado de cada processo — pedidos pendentes, fechamento, saída — morra com ele: um processo
 * novo depois de `restart` não pode receber a resposta, nem herdar o "já fechou", do anterior.
 */
class CoreChild {
    public readonly startup: Promise<StartupStatus>;
    private readonly utility: UtilityProcess;
    private readonly exit: Promise<void>;
    private readonly closing = new CloseHandshake(CLOSE_TIMEOUT_MS);
    /** Exportações esperando a resposta do processo do núcleo, pelo `requestId`. */
    private readonly exports = new Map<number, (outcome: DatabaseExportOutcome) => void>();
    /** Preparos de importação esperando a resposta, pelo `requestId`. */
    private readonly imports = new Map<number, (outcome: DatabaseImportPreparation) => void>();
    private nextRequestId = 1;
    /** Depois da saída, um pedido postado nunca teria resposta. */
    private exited = false;
    /** A saída foi pedida por `stop`, e não uma queda. */
    private stopping = false;

    /**
     * @param modulePath Caminho do bundle do processo do núcleo.
     * @param userData Pasta de dados do app.
     * @param onExit Avisado na saída, com o código e se ela foi pedida por `stop`.
     */
    public constructor(modulePath: string, userData: string, onExit: (code: number, requested: boolean) => void) {
        this.utility = utilityProcess.fork(modulePath, [...utilityArguments(userData)], { serviceName: 'Finanças — núcleo' });
        this.startup = new Promise((resolve) => {
            this.utility.on('message', (message: UtilityToMainMessage) => {
                if (message.kind === 'startup') {
                    resolve(message.status);
                }
                if (message.kind === 'database-closed') {
                    this.closing.confirm();
                }
                if (message.kind === 'database-exported') {
                    this.exports.get(message.requestId)?.(message.outcome);
                    this.exports.delete(message.requestId);
                }
                if (message.kind === 'import-prepared') {
                    this.imports.get(message.requestId)?.(message.outcome);
                    this.imports.delete(message.requestId);
                }
            });
            // Se o processo cair antes de responder, a janela precisa sair do "abrindo".
            this.utility.once('exit', () => {
                resolve({ kind: 'unexpected' });
            });
        });
        this.exit = new Promise((resolve) => {
            this.utility.on('exit', (code) => {
                this.closing.processExited();
                this.exited = true;
                for (const settle of this.exports.values()) {
                    settle({ ok: false, reason: 'unavailable' });
                }
                this.exports.clear();
                for (const settle of this.imports.values()) {
                    settle({ ok: false, reason: 'unavailable' });
                }
                this.imports.clear();
                onExit(code, this.stopping);
                resolve();
            });
        });
    }

    /**
     * @param message Mensagem ao processo do núcleo.
     * @param ports Pontas de canal que acompanham a mensagem.
     */
    public post(message: MainToUtilityMessage, ports: MessagePortMain[] = []): void {
        this.utility.postMessage(message, ports);
    }

    /**
     * @return Promessa resolvida quando a conexão foi fechada ou o processo já terminou.
     * @throws {DatabaseCloseTimeoutError} (na promessa) Quando o núcleo não confirma no prazo.
     */
    public closeDatabase(): Promise<void> {
        return this.closing.request(() => {
            this.post({ kind: 'close-database' });
        });
    }

    /**
     * @param destination Arquivo escolhido no diálogo de salvar.
     * @return O resultado da cópia; `unavailable` quando o processo termina antes de responder.
     */
    public exportDatabase(destination: string): Promise<DatabaseExportOutcome> {
        if (this.exited) {
            return Promise.resolve({ ok: false, reason: 'unavailable' });
        }
        const requestId = this.nextRequestId++;
        return new Promise((resolve) => {
            this.exports.set(requestId, resolve);
            this.post({ kind: 'export-database', requestId, destination });
        });
    }

    /**
     * @param source Arquivo escolhido no diálogo de abrir.
     * @param staged Arquivo provisório, na pasta do banco.
     * @return O resultado do preparo; `unavailable` quando o processo termina antes de responder.
     */
    public prepareImport(source: string, staged: string): Promise<DatabaseImportPreparation> {
        if (this.exited) {
            return Promise.resolve({ ok: false, reason: 'unavailable' });
        }
        const requestId = this.nextRequestId++;
        return new Promise((resolve) => {
            this.imports.set(requestId, resolve);
            this.post({ kind: 'prepare-import', requestId, source, staged });
        });
    }

    /**
     * Encerra o processo e espera a saída, para que quem troca o processo só abra o banco de novo
     * depois de a conexão antiga ter sumido junto com ele.
     *
     * @return Promessa resolvida quando o processo saiu.
     */
    public stop(): Promise<void> {
        if (!this.exited) {
            this.stopping = true;
            this.utility.kill();
        }
        return this.exit;
    }
}

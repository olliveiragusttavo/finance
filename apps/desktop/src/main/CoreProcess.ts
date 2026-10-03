import { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from 'electron';
import type { StartupStatus } from '../shared/bridge.ts';
import { IPC_CHANNELS } from '../shared/bridge.ts';
import { utilityArguments, type MainToUtilityMessage, type UtilityToMainMessage } from '../utility/utilityMessages.ts';
import { CloseHandshake } from './CloseHandshake.ts';

/** Prazo para o processo do núcleo confirmar que fechou o banco antes da restauração. */
const CLOSE_TIMEOUT_MS = 10_000;

/**
 * O processo do núcleo visto pelo processo principal: cria o `utilityProcess`, entrega a cada
 * janela uma ponta de `MessageChannelMain` e guarda como a abertura do banco terminou. As
 * chamadas de rota não passam por aqui (desktop-shell-design §5.2) — o principal só costura
 * o canal, e fica livre para janelas e menus.
 */
export class CoreProcess {
    private readonly child: UtilityProcess;
    private readonly startup: Promise<StartupStatus>;
    private readonly windows = new Set<WebContents>();
    private readonly closing = new CloseHandshake(CLOSE_TIMEOUT_MS);

    /**
     * @param modulePath Caminho do bundle do processo do núcleo.
     * @param userData Pasta de dados do app, onde ficam o banco, os backups e o log.
     * @param onExit Avisado quando o processo do núcleo termina, para o log. As janelas são
     * avisadas à parte, pelo canal `coreClosed`, e mostram a tela de erro.
     */
    public constructor(modulePath: string, userData: string, onExit: (code: number) => void) {
        this.child = utilityProcess.fork(modulePath, [...utilityArguments(userData)], { serviceName: 'Finanças — núcleo' });
        this.startup = new Promise((resolve) => {
            this.child.on('message', (message: UtilityToMainMessage) => {
                if (message.kind === 'startup') {
                    resolve(message.status);
                }
                if (message.kind === 'database-closed') {
                    this.closing.confirm();
                }
            });
            // Se o processo cair antes de responder, a janela precisa sair do "abrindo".
            this.child.once('exit', () => {
                resolve({ kind: 'unexpected' });
            });
        });
        this.child.on('exit', (code) => {
            this.closing.processExited();
            for (const contents of this.windows) {
                if (!contents.isDestroyed()) {
                    contents.send(IPC_CHANNELS.coreClosed);
                }
            }
            onExit(code);
        });
    }

    /** @return Como a abertura do banco terminou; espera o processo do núcleo responder. */
    public status(): Promise<StartupStatus> {
        return this.startup;
    }

    /**
     * Liga uma janela ao núcleo com um canal novo. Chamado a cada carregamento da página —
     * um recarregamento descarta o preload antigo junto com a ponta que ele tinha.
     *
     * @param contents Janela recém-carregada.
     */
    public connect(contents: WebContents): void {
        const { port1, port2 } = new MessageChannelMain();
        const message: MainToUtilityMessage = { kind: 'connect' };
        this.child.postMessage(message, [port1]);
        contents.postMessage(IPC_CHANNELS.corePort, null, [port2]);
        this.windows.add(contents);
        contents.once('destroyed', () => this.windows.delete(contents));
    }

    /**
     * Pede ao processo do núcleo que feche a conexão com o banco, antes de restaurar um
     * backup sobre o arquivo.
     *
     * @return Promessa resolvida quando a conexão foi fechada ou o processo já terminou.
     * @throws {DatabaseCloseTimeoutError} (na promessa) Quando o núcleo não confirma no prazo.
     */
    public closeDatabase(): Promise<void> {
        return this.closing.request(() => {
            const message: MainToUtilityMessage = { kind: 'close-database' };
            this.child.postMessage(message);
        });
    }

    /** Encerra o processo do núcleo ao sair do app. */
    public stop(): void {
        this.child.kill();
    }
}

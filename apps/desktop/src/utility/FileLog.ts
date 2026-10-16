import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Gravidade de uma linha do log. */
export type LogLevel = 'info' | 'warn' | 'error';

/** Destino das linhas de log do processo do núcleo. */
export interface Log {
    /**
     * @param level Gravidade.
     * @param event Nome estável do evento (`integrity.drift`), para filtrar o arquivo.
     * @param data Dados serializáveis do evento.
     */
    write(level: LogLevel, event: string, data?: Readonly<Record<string, unknown>>): void;
}

/**
 * Log em JSON Lines em `userData/logs/core.log`. Arquivo, e não só o console, porque o app
 * empacotado não tem terminal: os desvios da verificação de integridade e as falhas
 * inesperadas do núcleo (desktop-mvp-plan Fase 3.3) só são úteis se ficarem gravados.
 * Síncrono como o resto do processo do núcleo: o volume é de poucas linhas por sessão.
 */
export class FileLog implements Log {
    /**
     * @param path Caminho do arquivo; a pasta é criada na primeira escrita.
     * @param now Fonte do instante de cada linha; trocada nos testes.
     */
    public constructor(private readonly path: string, private readonly now: () => Date = () => new Date()) {}

    /**
     * @param level Gravidade.
     * @param event Nome estável do evento.
     * @param data Dados do evento; um `Error` vira um objeto com nome, mensagem, pilha e causa,
     * que o `JSON.stringify` descartaria.
     */
    public write(level: LogLevel, event: string, data: Readonly<Record<string, unknown>> = {}): void {
        const line = JSON.stringify({ at: this.now().toISOString(), level, event, ...data }, errorReplacer());
        try {
            mkdirSync(dirname(this.path), { recursive: true });
            appendFileSync(this.path, `${line}\n`);
        } catch (error) {
            // Sem disco para o log, o console é o último recurso; o núcleo segue funcionando.
            console.error('Falha ao gravar o log', error, line);
        }
    }
}

/**
 * Replacer de `JSON.stringify` para as linhas de log. Leva a `cause` e os campos próprios do
 * erro (`version`, `fileName`, `code` do SQLite), e não só nome, mensagem e pilha, porque erros
 * como `MigrationFailedError` e `MigrationBackupError` embrulham a falha real: sem a causa, o
 * log — e o relato de problema que o anexa — diria só que a migration falhou, sem dizer o
 * erro de SQL ou de disco que a derrubou.
 *
 * Um replacer novo por linha, porque guarda os erros já vistos: uma cadeia de causas circular
 * recursaria até estourar a pilha dentro do próprio log.
 *
 * @return A função a passar ao `JSON.stringify`.
 */
export function errorReplacer(): (key: string, value: unknown) => unknown {
    const seen = new WeakSet<Error>();
    return (_key, value) => {
        if (!(value instanceof Error)) {
            return value;
        }
        if (seen.has(value)) {
            return `[Circular ${value.name}]`;
        }
        seen.add(value);
        return { ...Object.fromEntries(Object.entries(value)), name: value.name, message: value.message, stack: value.stack, cause: value.cause };
    };
}

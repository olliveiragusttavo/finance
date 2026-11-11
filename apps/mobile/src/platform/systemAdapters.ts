import { parseUuid, type IdGenerator, type Uuid } from '@finance/core';
import type { StartupLog, StartupLogLevel } from '@finance/client/startup';
import { randomUUID } from 'expo-crypto';
import type { AppFileSystem } from './AppFileSystem.ts';

/**
 * Gerador de UUID v4 sobre o `expo-crypto`, que usa o gerador seguro do sistema. O Hermes não
 * tem `crypto.randomUUID`, e o `Math.random` geraria ids previsíveis e com colisão possível
 * entre aparelhos — fatal quando a sincronização mesclar os bancos (backend-design §3.4).
 */
export class ExpoIdGenerator implements IdGenerator {
    /** @return Um UUID v4, validado pelo mesmo parser do núcleo. */
    public random(): Uuid {
        return parseUuid(randomUUID());
    }
}

/**
 * Log em JSON Lines no diretório do app (`logs/core.log`), como o do desktop. O app instalado
 * não tem terminal: os desvios da verificação de integridade, as falhas inesperadas do núcleo
 * e o motivo de um bloqueio da abertura só ajudam se ficarem gravados (mobile-mvp-plan,
 * Fase 4). Um log que não consegue gravar não derruba o app: a linha vai para o console.
 */
export class FileAppLog implements StartupLog {
    /**
     * @param files Disco do aparelho.
     * @param uri Arquivo do log.
     * @param now Fonte do instante de cada linha; trocada nos testes.
     */
    public constructor(
        private readonly files: AppFileSystem,
        private readonly uri: string,
        private readonly now: () => Date = () => new Date(),
    ) {}

    /**
     * @param level Gravidade.
     * @param event Nome estável do evento.
     * @param data Dados do evento; erros viram nome, mensagem e pilha, que o `JSON` perderia.
     */
    public write(level: StartupLogLevel, event: string, data: Readonly<Record<string, unknown>> = {}): void {
        const line = `${JSON.stringify({ at: this.now().toISOString(), level, event, ...data }, errorReplacer)}\n`;
        try {
            this.files.appendText(this.uri, line);
        } catch (error: unknown) {
            console.warn('não foi possível gravar o log', error, line);
        }
    }
}

/**
 * @param _key Chave do valor (não usada).
 * @param value Valor a serializar.
 * @return O erro como objeto simples; o resto como veio.
 */
function errorReplacer(_key: string, value: unknown): unknown {
    return value instanceof Error ? { name: value.name, message: value.message, stack: value.stack } : value;
}

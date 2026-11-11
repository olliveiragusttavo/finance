import type { AppFileSystem } from '../../src/platform/AppFileSystem.ts';

/** Operação do disco em que o teste pode injetar uma falha. */
export type FailingOperation = 'copy' | 'move' | 'writeText';

/**
 * Disco em memória com falhas injetáveis, para testar a restauração passo a passo: o que fica
 * em cada caminho depois de cada falha é o que decide se o usuário perde o banco ou não.
 */
export class MemoryFileSystem implements AppFileSystem {
    public readonly files = new Map<string, string>();
    private readonly failures: { readonly operation: FailingOperation; readonly afterCalls: number; readonly times: number; calls: number }[] = [];

    /**
     * Faz a operação falhar a partir da chamada `afterCalls + 1`.
     *
     * @param operation Operação que vai falhar.
     * @param afterCalls Quantas chamadas passam antes da primeira falha.
     * @param times Quantas chamadas seguidas falham; as seguintes voltam a funcionar, para
     * separar a falha da troca da falha do desfazer.
     */
    public failOn(operation: FailingOperation, afterCalls = 0, times = Number.POSITIVE_INFINITY): void {
        this.failures.push({ operation, afterCalls, times, calls: 0 });
    }

    /** @param uri Arquivo. @return Se existe. */
    public exists(uri: string): boolean {
        return this.files.has(uri);
    }

    /**
     * @param uri Arquivo.
     * @return O conteúdo.
     * @throws {Error} Quando o arquivo não existe.
     */
    public readText(uri: string): string {
        const content = this.files.get(uri);
        if (content === undefined) {
            throw new Error(`não existe: ${uri}`);
        }
        return content;
    }

    /** @param uri Arquivo. @param text Conteúdo. */
    public writeText(uri: string, text: string): void {
        this.maybeFail('writeText');
        this.files.set(uri, text);
    }

    /** @param uri Arquivo. @param text Texto a acrescentar. */
    public appendText(uri: string, text: string): void {
        this.files.set(uri, (this.files.get(uri) ?? '') + text);
    }

    /** @param from Origem. @param to Destino. */
    public copy(from: string, to: string): void {
        this.maybeFail('copy');
        this.files.set(to, this.readText(from));
    }

    /** @param from Origem. @param to Destino. */
    public move(from: string, to: string): void {
        this.maybeFail('move');
        const content = this.readText(from);
        this.files.delete(from);
        this.files.set(to, content);
    }

    /** @param uri Arquivo a apagar. */
    public remove(uri: string): void {
        this.files.delete(uri);
    }

    /** Pastas não existem no disco em memória: todo caminho pode receber arquivo. */
    public ensureFolder(): void {
        // Nada a fazer.
    }

    /**
     * @param operation Operação em curso.
     * @throws {Error} Quando o teste pediu falha para esta chamada.
     */
    private maybeFail(operation: FailingOperation): void {
        for (const failure of this.failures) {
            if (failure.operation === operation) {
                failure.calls++;
                if (failure.calls > failure.afterCalls && failure.calls <= failure.afterCalls + failure.times) {
                    throw new Error(`falha injetada em ${operation}`);
                }
            }
        }
    }
}

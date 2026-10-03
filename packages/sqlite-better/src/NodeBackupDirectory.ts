import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Adaptador da porta `BackupDirectory` do `@finance/core` sobre `node:fs`, para o desktop e
 * para os testes. Fica neste pacote, e não no app, porque é o lado Node do mesmo banco que o
 * `BetterSqliteDatabase` abre; e, como ele, espelha a porta por tipagem estrutural em vez de
 * importá-la — a suíte do `core` atribui esta classe a uma variável `BackupDirectory`.
 *
 * Fino e sem regra: quando copiar, como nomear e quantas cópias guardar é decisão do núcleo
 * (backend-design §4.6).
 */
export class NodeBackupDirectory {
    /**
     * @param path Pasta `backups/` ao lado do banco; criada sob demanda, porque um banco que
     * nunca migrou não precisa dela.
     */
    public constructor(private readonly path: string) {}

    /**
     * @param fileName Nome do arquivo de backup.
     * @return O caminho completo; a pasta é criada aqui porque o `VACUUM INTO` não cria
     * diretórios.
     */
    public pathOf(fileName: string): string {
        mkdirSync(this.path, { recursive: true });
        return join(this.path, fileName);
    }

    /**
     * @return Os nomes dos arquivos da pasta; vazio quando ela ainda não existe.
     */
    public list(): readonly string[] {
        return existsSync(this.path) ? readdirSync(this.path) : [];
    }

    /**
     * @param fileName Arquivo a apagar; ausente não é erro.
     * @return void
     */
    public remove(fileName: string): void {
        rmSync(join(this.path, fileName), { force: true });
    }
}

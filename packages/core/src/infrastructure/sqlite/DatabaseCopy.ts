import type { Database } from '../../ports/Database.ts';

/**
 * A cópia exportada não pôde ser gravada. É um tipo próprio para que o shell diga "não foi
 * possível gravar a cópia" sem confundir com falha do banco: o arquivo vivo não muda com uma
 * exportação que falha, e o app segue aberto.
 */
export class DatabaseCopyError extends Error {
    /**
     * @param path Arquivo que deveria ter sido gravado; ajuda a diagnosticar disco cheio ou
     * permissão no destino.
     * @param cause Erro original do SQLite ou do sistema de arquivos.
     */
    public constructor(public readonly path: string, cause: unknown) {
        super(`Não foi possível gravar a cópia do banco em ${path}`, { cause });
        this.name = 'DatabaseCopyError';
    }
}

/**
 * Grava uma cópia consistente do banco aberto, para o usuário guardar onde quiser: sem backup
 * em nuvem, a cópia exportada é a única defesa contra perder o aparelho (mobile-shell-design
 * §6.2; desktop-mvp-plan Fase 13). Usa `VACUUM INTO`, a mesma operação do backup antes de
 * migrar, e não cópia de arquivo, porque o banco está em WAL: copiar só o `.sqlite` perderia o
 * que ainda está no `-wal`. A cópia leva o `user_version`, então abre como qualquer banco do app.
 *
 * Fica no núcleo, e não em cada shell, para que desktop e mobile exportem pela mesma regra; o
 * destino (diálogo de salvar, folha de compartilhamento) é da plataforma.
 *
 * @param database Conexão com o banco; precisa estar fora de transação, porque o SQLite recusa
 * `VACUUM` dentro de uma.
 * @param path Arquivo de destino. Não pode existir: o `VACUUM INTO` recusa sobrescrever, e quem
 * precisa trocar um arquivo existente grava num temporário e renomeia.
 * @throws {DatabaseCopyError} Quando o SQLite não grava a cópia (destino existente, disco
 * cheio, pasta sem permissão).
 */
export function copyDatabaseTo(database: Database, path: string): void {
    try {
        // O caminho vai como parâmetro, e não interpolado: uma pasta com apóstrofo não quebra o SQL.
        database.run('VACUUM INTO :path', { path });
    } catch (error) {
        throw new DatabaseCopyError(path, error);
    }
}

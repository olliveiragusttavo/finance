import type { Database } from '../../ports/Database.ts';
import { embeddedMigrations } from '../migrations/embedded.generated.ts';
import type { Migration } from '../migrations/Migration.ts';
import { RowReader } from './RowReader.ts';

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

/**
 * Por que um arquivo não pode substituir o banco do app. `unreadable`: não é SQLite, ou está
 * corrompido. `not-app-database`: é SQLite, mas não foi gravado por este app (sem schema ou sem
 * as tabelas dele). `newer-than-app`: foi gravado por uma versão mais nova, que esta não abre.
 */
export type DatabaseCopyRejection = 'unreadable' | 'not-app-database' | 'newer-than-app';

/** Resultado de conferir uma cópia antes de importá-la. */
export type DatabaseCopyInspection =
    /** `schemaVersion`: o `user_version` da cópia; menor que o do app, ela migra ao abrir. */
    | { readonly ok: true; readonly schemaVersion: number }
    | { readonly ok: false; readonly reason: DatabaseCopyRejection };

/**
 * Confere se um arquivo pode entrar no lugar do banco do app, **antes** de o banco atual sair do
 * lugar. Regra de negócio (Cópia do banco): só entra uma cópia legível, gravada pelo app e de
 * versão igual ou anterior à dele. Sem a conferência, a troca só falharia na reabertura — o arquivo
 * ilegível bloquearia o app em "não foi possível abrir", e a cópia mais nova na tela de banco mais
 * novo que o app (backend-design §4.8) —, com os dados do usuário já fora do lugar. A cópia de
 * versão anterior é aceita porque a abertura a migra, com backup antes (backend-design §4.5).
 *
 * A conferência só lê: quem abre a cópia o faz em modo somente leitura, e nada aqui liga WAL nem
 * chaves estrangeiras, ao contrário da `configureConnection`, para não gravar no arquivo do
 * usuário. O `quick_check`, e não o `integrity_check`, porque basta detectar página corrompida: o
 * custo do completo, que confere cada índice, cresce com o banco e travaria a importação.
 *
 * Fica no núcleo, ao lado da exportação, para que desktop e mobile importem pela mesma regra.
 *
 * @param database Conexão aberta sobre a cópia, de preferência somente leitura.
 * @param migrations Migrations do app, cuja última versão é o limite; parametrizável só nos testes.
 * @return A versão da cópia, ou por que ela foi recusada; nunca lança, porque o arquivo vem do
 * usuário e qualquer falha de leitura é só um motivo de recusa.
 */
export function inspectDatabaseCopy(database: Database, migrations: readonly Migration[] = embeddedMigrations): DatabaseCopyInspection {
    let version: number;
    try {
        const check = database.all('PRAGMA quick_check');
        if (check.length !== 1 || check[0]?.['quick_check'] !== 'ok') {
            return { ok: false, reason: 'unreadable' };
        }
        const row = database.get('PRAGMA user_version');
        version = row === undefined ? 0 : new RowReader('pragma', row).number('user_version');
        // Um perfil é o mínimo de qualquer banco do app: toda conta, cartão e transação pertence a um.
        const profiles = database.get("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'profiles'");
        if (version === 0 || profiles === undefined) {
            return { ok: false, reason: 'not-app-database' };
        }
    } catch {
        // O SQLite só descobre que o arquivo não é um banco na primeira leitura (SQLITE_NOTADB).
        return { ok: false, reason: 'unreadable' };
    }
    const latest = migrations.at(-1)?.version ?? 0;
    return version > latest ? { ok: false, reason: 'newer-than-app' } : { ok: true, schemaVersion: version };
}

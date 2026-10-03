import { DomainError } from '../../domain/shared/errors.ts';
import type { Database } from '../../ports/Database.ts';
import { RowReader } from '../sqlite/RowReader.ts';
import type { Migration } from './Migration.ts';
import type { MigrationBackup } from './PreMigrationBackup.ts';

/**
 * O banco foi gravado por uma versão mais nova do app. Recusar é a única resposta que não
 * produz número errado: um app antigo escreveria linhas que violam regras que ele nunca
 * viu (backend-design §4.8).
 */
export class SchemaNewerThanAppError extends DomainError {
    public readonly code = 'SCHEMA_NEWER_THAN_APP';

    /**
     * @param databaseVersion `user_version` encontrado no arquivo.
     * @param appVersion Última migration que este app conhece.
     */
    public constructor(databaseVersion: number, appVersion: number) {
        super(`Banco na versão ${databaseVersion}, app conhece até ${appVersion}`, { databaseVersion, appVersion });
    }
}

/** Uma migration terminou com chave estrangeira violada e foi desfeita. */
export class MigrationIntegrityError extends Error {
    /**
     * @param version Migration que falhou; as anteriores continuam aplicadas.
     * @param violations Quantas violações o `foreign_key_check` encontrou.
     */
    public constructor(public readonly version: number, violations: number) {
        super(`Migration ${version} deixou ${violations} violação(ões) de chave estrangeira`);
        this.name = 'MigrationIntegrityError';
    }
}

/** O que a execução fez, para log e para a tela de erro de abertura. */
export interface MigrationReport {
    readonly fromVersion: number;
    readonly toVersion: number;
    readonly applied: readonly number[];
    /** Cópia gravada antes de migrar; `null` quando não houve migration ou o banco era novo. */
    readonly backupFile: string | null;
}

/**
 * Runner próprio de migrations sobre a porta `Database` (backend-design §4.10): as
 * alternativas prontas pressupõem API assíncrona ou leitura de diretório com `fs`, e não
 * cobrem a recusa de versão mais nova, que é a parte que importa.
 *
 * Ainda não coberto aqui: o desligamento de `foreign_keys` para migrations que reconstroem
 * tabelas (§4.7), necessário antes da primeira migration desse tipo.
 */
export class MigrationRunner {
    /**
     * @param database Conexão já configurada (`configureConnection`).
     * @param migrations Migrations embutidas, em ordem de versão.
     * @param backup Cópia de segurança antes de migrar (§4.6); `null` só para banco em
     * memória, que não tem arquivo a preservar.
     */
    public constructor(
        private readonly database: Database,
        private readonly migrations: readonly Migration[],
        private readonly backup: MigrationBackup | null,
    ) {}

    /**
     * Aplica as migrations pendentes, cada uma **na sua própria transação**: um aparelho
     * que pula da versão 3 para a 9 e falha na 7 fica na 6, utilizável, em vez de voltar à
     * 3 (backend-design §4.5).
     *
     * A cópia de segurança vem antes da primeira migration e só quando há o que preservar:
     * banco em dia não muda, e banco novo (versão 0) não tem dado algum — copiá-lo só
     * gastaria uma das três vagas de backup.
     *
     * @return O relatório do que foi aplicado; vazio quando o banco já estava em dia.
     * @throws {SchemaNewerThanAppError} Quando o banco é mais novo que o app.
     * @throws {MigrationBackupError} Quando a cópia falha; nada é migrado.
     * @throws {MigrationIntegrityError} Quando uma migration deixa chave estrangeira quebrada.
     */
    public migrate(): MigrationReport {
        const fromVersion = this.currentVersion();
        const latest = this.migrations.at(-1)?.version ?? 0;
        if (fromVersion > latest) {
            throw new SchemaNewerThanAppError(fromVersion, latest);
        }

        const pending = this.migrations.filter((candidate) => candidate.version > fromVersion);
        const backupFile = pending.length > 0 && fromVersion > 0 && this.backup !== null ? this.backup.create(fromVersion) : null;

        const applied: number[] = [];
        for (const migration of pending) {
            this.database.transaction(() => {
                this.database.exec(migration.sql);
                const violations = this.database.all('PRAGMA foreign_key_check');
                if (violations.length > 0) {
                    throw new MigrationIntegrityError(migration.version, violations.length);
                }
                // PRAGMA não aceita parâmetro; a versão é um inteiro do próprio bundle.
                this.database.exec(`PRAGMA user_version = ${String(Math.trunc(migration.version))}`);
            });
            applied.push(migration.version);
        }
        return { fromVersion, toVersion: this.currentVersion(), applied, backupFile };
    }

    /**
     * @return O `user_version` gravado no cabeçalho do arquivo; 0 num banco novo.
     */
    private currentVersion(): number {
        const row = this.database.get('PRAGMA user_version');
        return row === undefined ? 0 : new RowReader('pragma', row).number('user_version');
    }
}

import { DomainError } from '../../domain/shared/errors.ts';
import type { Database } from '../../ports/Database.ts';
import { RowReader } from '../sqlite/RowReader.ts';
import type { Migration } from './Migration.ts';

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
}

/**
 * Runner próprio de migrations sobre a porta `Database` (backend-design §4.10): as
 * alternativas prontas pressupõem API assíncrona ou leitura de diretório com `fs`, e não
 * cobrem a recusa de versão mais nova, que é a parte que importa.
 *
 * Ainda não cobertos aqui, e necessários antes da primeira atualização em produção: o
 * backup com `VACUUM INTO` antes de migrar (§4.6), o `checksums.lock` de imutabilidade
 * (§4.3) e o desligamento de `foreign_keys` para migrations que reconstroem tabelas (§4.7).
 */
export class MigrationRunner {
    /**
     * @param database Conexão já configurada (`configureConnection`).
     * @param migrations Migrations embutidas, em ordem de versão.
     */
    public constructor(private readonly database: Database, private readonly migrations: readonly Migration[]) {}

    /**
     * Aplica as migrations pendentes, cada uma **na sua própria transação**: um aparelho
     * que pula da versão 3 para a 9 e falha na 7 fica na 6, utilizável, em vez de voltar à
     * 3 (backend-design §4.5).
     *
     * @return O relatório do que foi aplicado; vazio quando o banco já estava em dia.
     * @throws {SchemaNewerThanAppError} Quando o banco é mais novo que o app.
     * @throws {MigrationIntegrityError} Quando uma migration deixa chave estrangeira quebrada.
     */
    public migrate(): MigrationReport {
        const fromVersion = this.currentVersion();
        const latest = this.migrations.at(-1)?.version ?? 0;
        if (fromVersion > latest) {
            throw new SchemaNewerThanAppError(fromVersion, latest);
        }

        const applied: number[] = [];
        for (const migration of this.migrations.filter((candidate) => candidate.version > fromVersion)) {
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
        return { fromVersion, toVersion: this.currentVersion(), applied };
    }

    /**
     * @return O `user_version` gravado no cabeçalho do arquivo; 0 num banco novo.
     */
    private currentVersion(): number {
        const row = this.database.get('PRAGMA user_version');
        return row === undefined ? 0 : new RowReader('pragma', row).number('user_version');
    }
}

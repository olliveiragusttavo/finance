import type { Database } from '@finance/core';
import { isSqliteVersionAtLeast, MINIMUM_SQLITE_VERSION } from '@finance/core/contract';

/**
 * O SQLite do aparelho não tem o que o schema exige. Erro próprio para a tela de bloqueio
 * da abertura dizer "atualize o app", e não mostrar o erro de SQL da primeira migration.
 */
export class UnsupportedSqliteError extends Error {
    /**
     * @param reason O que falta, para o log da abertura.
     */
    public constructor(reason: string) {
        super(`SQLite sem suporte ao banco do app: ${reason}`);
        this.name = 'UnsupportedSqliteError';
    }
}

/**
 * Confere, antes das migrations, que o SQLite tem o que o schema usa: a versão mínima, as
 * tabelas `STRICT` e o JSON embutido (`json_valid`). O `expo-sqlite` embarca o próprio
 * SQLite, mas uma configuração de build (`useSQLCipher`, uma versão fixada no `app.json`)
 * pode trocá-lo; sem esta conferência, a falha apareceria no meio de uma migration, com o
 * banco já copiado e a mensagem de SQL como única pista.
 *
 * @param database Conexão recém-aberta, antes de `openDatabase`.
 * @return A versão do SQLite encontrada, para o log da abertura.
 * @throws {UnsupportedSqliteError} Quando falta versão, `STRICT` ou JSON.
 */
export function assertSqliteCapabilities(database: Database): string {
    const version = database.get('SELECT sqlite_version() AS v')?.['v'];
    if (typeof version !== 'string' || !isSqliteVersionAtLeast(version, MINIMUM_SQLITE_VERSION)) {
        throw new UnsupportedSqliteError(`versão ${String(version)}, mínima ${MINIMUM_SQLITE_VERSION}`);
    }
    try {
        database.exec('CREATE TEMP TABLE capability_probe (v INTEGER) STRICT; DROP TABLE temp.capability_probe;');
        database.get('SELECT json_valid(:j) AS ok', { j: '{}' });
    } catch (error: unknown) {
        throw new UnsupportedSqliteError(error instanceof Error ? error.message : String(error));
    }
    return version;
}

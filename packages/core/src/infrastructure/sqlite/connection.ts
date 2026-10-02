import type { Database } from '../../ports/Database.ts';
import { RowReader } from './RowReader.ts';

const MINIMUM_SQLITE_VERSION = [3, 37, 0] as const;

/** A conexão não atende o contrato do schema e não pode ser usada. */
export class ConnectionContractError extends Error {
    /**
     * @param reason Qual parte do contrato falhou.
     */
    public constructor(reason: string) {
        super(`Conexão SQLite fora do contrato: ${reason}`);
        this.name = 'ConnectionContractError';
    }
}

/**
 * Aplica a configuração obrigatória em toda conexão, num lugar só (database-design §3.2).
 * Sem `foreign_keys = ON` toda ação `ON DELETE` silenciosamente não faz nada — por isso o
 * pragma é lido de volta e conferido, em vez de confiar que o driver o aceitou.
 *
 * @param database Conexão recém-aberta pelo adaptador da plataforma.
 * @return void
 * @throws {ConnectionContractError} Quando o SQLite é anterior à 3.37 (sem `STRICT`) ou as
 * chaves estrangeiras não ficaram ligadas.
 */
export function configureConnection(database: Database): void {
    const versionRow = database.get('SELECT sqlite_version() AS version');
    const version = versionRow === undefined ? '0' : new RowReader('pragma', versionRow).text('version');
    if (!isAtLeast(version, MINIMUM_SQLITE_VERSION)) {
        throw new ConnectionContractError(`SQLite ${version} não suporta tabelas STRICT (mínimo ${MINIMUM_SQLITE_VERSION.join('.')})`);
    }

    database.exec('PRAGMA foreign_keys = ON');
    // WAL persiste no arquivo; num banco em memória o SQLite mantém "memory", o que é esperado.
    database.exec('PRAGMA journal_mode = WAL');

    const foreignKeys = database.get('PRAGMA foreign_keys');
    if (foreignKeys === undefined || new RowReader('pragma', foreignKeys).number('foreign_keys') !== 1) {
        throw new ConnectionContractError('PRAGMA foreign_keys não ficou ligado');
    }
}

/**
 * @param version Versão do SQLite no formato `3.46.1`.
 * @param minimum Versão mínima exigida.
 * @return `true` quando `version` é igual ou maior que o mínimo.
 */
function isAtLeast(version: string, minimum: readonly [number, number, number]): boolean {
    const parts = version.split('.').map(Number);
    for (let index = 0; index < minimum.length; index++) {
        const actual = parts[index] ?? 0;
        const required = minimum[index] ?? 0;
        if (actual !== required) {
            return actual > required;
        }
    }
    return true;
}

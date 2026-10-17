import { rmSync } from 'node:fs';
import { copyDatabaseTo, inspectDatabaseCopy } from '@finance/core';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import type { DatabaseImportFailure } from '../shared/bridge.ts';
import { isDatabaseFile } from './exportDatabase.ts';

/** Como terminou, no processo do núcleo, o preparo da cópia a importar. */
export type DatabaseImportPreparation =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: Extract<DatabaseImportFailure, 'same-as-database' | 'unreadable' | 'not-app-database' | 'newer-than-app' | 'write-failed' | 'unavailable'> };

/**
 * Confere a cópia escolhida e a grava em `staged`, ao lado do banco, pronta para entrar no lugar
 * dele. Tudo acontece com o banco atual ainda aberto e intocado: uma cópia recusada, ou um disco
 * que não aceita o arquivo provisório, termina aqui sem que o app precise fechar nada.
 *
 * A cópia vai por `VACUUM INTO` a partir de uma conexão somente leitura, e não por cópia de
 * arquivo, por dois motivos: um banco em WAL copiado sem o `-wal` perderia o que ainda está nele,
 * e o provisório precisa estar na pasta do banco para que a troca seja um `rename`, que não grava
 * dados. O arquivo do usuário não é alterado.
 *
 * @param databasePath Caminho do `finance.sqlite`, para recusá-lo como origem.
 * @param source Arquivo escolhido no diálogo de abrir.
 * @param staged Arquivo provisório, na pasta do banco; um que sobrou de tentativa anterior é
 * descartado.
 * @return `ok` com o provisório gravado, ou o motivo da recusa; nunca lança, porque o processo do
 * núcleo responde ao principal em qualquer caso.
 */
export function prepareDatabaseImport(databasePath: string, source: string, staged: string): DatabaseImportPreparation {
    if (isDatabaseFile(source, databasePath)) {
        return { ok: false, reason: 'same-as-database' };
    }
    let copy: BetterSqliteDatabase;
    try {
        copy = BetterSqliteDatabase.open(source, { readOnly: true });
    } catch {
        return { ok: false, reason: 'unreadable' };
    }
    try {
        const inspection = inspectDatabaseCopy(copy);
        if (!inspection.ok) {
            return inspection;
        }
        rmSync(staged, { force: true });
        copyDatabaseTo(copy, staged);
        return { ok: true };
    } catch {
        discardStaged(staged);
        return { ok: false, reason: 'write-failed' };
    } finally {
        copy.close();
    }
}

/**
 * Apaga o provisório de uma cópia que falhou no meio sem deixar a falha da remoção esconder o
 * motivo real, que é o que o usuário precisa saber; o que sobrar é descartado na próxima tentativa.
 *
 * @param staged Arquivo provisório.
 */
function discardStaged(staged: string): void {
    try {
        rmSync(staged, { force: true });
    } catch {
        // Sobra o provisório; o banco do app não foi tocado.
    }
}

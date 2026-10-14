import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { copyDatabaseTo, type Database } from '@finance/core';
import type { DatabaseExportFailure } from '../shared/bridge.ts';

/** Como terminou a gravação da cópia no processo do núcleo. */
export type DatabaseExportOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: Exclude<DatabaseExportFailure, 'canceled'> };

/** Sufixos dos arquivos que o SQLite mantém ao lado do banco em WAL. */
const DATABASE_COMPANIONS = ['', '-wal', '-shm'] as const;

/**
 * Grava a cópia exportada no destino escolhido no diálogo de salvar (desktop-mvp-plan Fase 13).
 *
 * O `VACUUM INTO` recusa arquivo existente, mas o diálogo deixa o usuário confirmar que quer
 * substituir uma cópia anterior. Por isso a cópia vai para um temporário na mesma pasta e só
 * então é renomeada sobre o destino: a substituição é atômica, e uma gravação que falha no meio
 * (disco cheio) deixa a cópia anterior intacta em vez de um arquivo truncado no lugar dela.
 *
 * O próprio banco, ou o `-wal`/`-shm` dele, é recusado como destino: o `rename` trocaria o
 * arquivo vivo por debaixo da conexão aberta, e o app passaria a gravar num banco que já não
 * está no disco.
 *
 * @param database Conexão do núcleo, fora de transação — os casos de uso são síncronos, então
 * entre duas mensagens nunca há uma aberta.
 * @param databasePath Caminho do `finance.sqlite`, para recusá-lo como destino.
 * @param destination Arquivo escolhido pelo usuário.
 * @return `ok`, ou o motivo de a cópia não ter sido gravada; nunca lança, porque o processo do
 * núcleo responde ao principal em qualquer caso.
 */
export function exportDatabaseFile(database: Database, databasePath: string, destination: string): DatabaseExportOutcome {
    if (isDatabaseFile(destination, databasePath)) {
        return { ok: false, reason: 'same-as-database' };
    }
    const target = resolve(destination);
    const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.partial`);
    try {
        copyDatabaseTo(database, temporary);
        renameSync(temporary, target);
        return { ok: true };
    } catch {
        rmSync(temporary, { force: true });
        return { ok: false, reason: 'write-failed' };
    }
}

/**
 * Compara pelos caminhos reais, e não pelo texto: um link simbólico para a pasta de dados, ou
 * `..` no caminho, levaria ao mesmo arquivo com outro nome.
 *
 * @param destination Arquivo escolhido no diálogo.
 * @param databasePath Caminho do banco aberto.
 * @return Se o destino é o banco ou um dos arquivos que o SQLite mantém ao lado dele.
 */
function isDatabaseFile(destination: string, databasePath: string): boolean {
    const target = canonical(destination);
    const database = canonical(databasePath);
    return DATABASE_COMPANIONS.some((suffix) => target === `${database}${suffix}`);
}

/**
 * @param path Caminho de um arquivo que pode ainda não existir.
 * @return O caminho absoluto com a pasta resolvida pelos links simbólicos; o arquivo entra pelo
 * nome, porque o destino de uma cópia nova ainda não existe para o `realpath`.
 */
function canonical(path: string): string {
    const absolute = resolve(path);
    const folder = dirname(absolute);
    return join(existsSync(folder) ? realpathSync(folder) : folder, basename(absolute));
}

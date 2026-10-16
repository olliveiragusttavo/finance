import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Onde estão o banco, os backups e a marca de restauração em andamento. */
export interface DatabaseFiles {
    /** `userData/finance.sqlite`. */
    readonly databasePath: string;
    /** `userData/backups`, ao lado do banco (backend-design §4.6). */
    readonly backupsPath: string;
    /** `userData/restore-pending.json`, presente só enquanto uma restauração não terminou. */
    readonly restoreMarkerPath: string;
    /**
     * `userData/migration-failed.json`, presente enquanto a migration não passar e nenhum backup
     * for restaurado.
     */
    readonly migrationFailureMarkerPath: string;
}

/** O que a marca de restauração guarda: onde ficou o banco tirado do lugar. */
export interface RestoreMarker {
    /** Cópia do banco que falhou; `null` quando a marca não pôde ser lida. */
    readonly failedCopy: string | null;
}

/** Formato gravado no arquivo da marca. */
const restoreMarkerSchema = z.object({ failedCopy: z.string() });

/** O que a marca de migration que falhou guarda: o backup de antes da primeira tentativa. */
export interface MigrationFailureMarker {
    /** Backup gravado na primeira tentativa que falhou; `null` quando o banco era novo. */
    readonly backupFile: string | null;
}

/** Formato gravado no arquivo da marca de migration que falhou. */
const migrationFailureMarkerSchema = z.object({ backupFile: z.string().nullable() });

/**
 * Monta os caminhos num lugar só, porque o processo principal (que restaura) e o processo do
 * núcleo (que abre) precisam concordar sobre eles — um caminho divergente da marca faria a
 * abertura ignorar uma restauração pela metade.
 *
 * @param userData Pasta de dados do app.
 * @return Os caminhos do banco, dos backups e da marca.
 */
export function databaseFiles(userData: string): DatabaseFiles {
    return {
        databasePath: join(userData, 'finance.sqlite'),
        backupsPath: join(userData, 'backups'),
        restoreMarkerPath: join(userData, 'restore-pending.json'),
        migrationFailureMarkerPath: join(userData, 'migration-failed.json'),
    };
}

/**
 * Lê a marca de restauração. Existe para a abertura não criar um banco vazio por cima de uma
 * restauração interrompida: sem a marca, um `finance.sqlite` ausente parece primeiro uso.
 *
 * @param path Caminho da marca.
 * @return A marca quando existe; `failedCopy` nulo quando o conteúdo está ilegível, e mesmo
 * assim a abertura bloqueia. `null` quando não há restauração pendente.
 */
export function readRestoreMarker(path: string): RestoreMarker | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        const parsed = restoreMarkerSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
        return { failedCopy: parsed.success ? parsed.data.failedCopy : null };
    } catch {
        return { failedCopy: null };
    }
}

/**
 * Lê a marca de migration que falhou. Ela existe porque cada migration roda na própria
 * transação (backend-design §4.5): as anteriores à que falhou ficam aplicadas, e a próxima
 * abertura grava um backup novo já com elas. Esse backup não serve à versão anterior do app,
 * que recusaria o banco por ser mais novo; o que serve é o da primeira tentativa, que a marca
 * guarda.
 *
 * @param path Caminho da marca.
 * @return A marca quando existe e está legível; `null` quando não há falha pendente ou o
 * conteúdo está ilegível — aí a abertura volta a oferecer o backup da tentativa atual.
 */
export function readMigrationFailureMarker(path: string): MigrationFailureMarker | null {
    if (!existsSync(path)) {
        return null;
    }
    try {
        const parsed = migrationFailureMarkerSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/**
 * Grava a marca na primeira falha de migration, para as aberturas seguintes oferecerem o
 * mesmo backup em vez do gravado por cima das migrations que já tinham passado.
 *
 * @param path Caminho da marca.
 * @param marker Backup de antes da primeira tentativa.
 */
export function writeMigrationFailureMarker(path: string, marker: MigrationFailureMarker): void {
    writeFileSync(path, JSON.stringify(marker));
}

/**
 * Apaga a marca quando a migration enfim passa: o backup que ela protegia volta à rotação
 * normal das três cópias (backend-design §4.6). A restauração bem-sucedida também apaga a
 * marca, direto em `restoreBackup`, porque o banco que ela descrevia saiu do lugar.
 *
 * @param path Caminho da marca; ausente não é erro.
 */
export function clearMigrationFailureMarker(path: string): void {
    rmSync(path, { force: true });
}

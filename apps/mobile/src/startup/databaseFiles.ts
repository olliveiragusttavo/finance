import type { MigrationFailureMarker, RestoreMarker, StartupMarkers } from '@finance/client/startup';
import { z } from 'zod';
import { joinUri, type AppFileSystem } from '../platform/AppFileSystem.ts';

/** Onde estão o banco, os backups, as marcas e o log, por URI. */
export interface DatabaseFiles {
    /** `SQLite/finance.sqlite`. */
    readonly databaseUri: string;
    /** `SQLite/backups`, ao lado do banco (backend-design §4.6). */
    readonly backupsUri: string;
    /** `SQLite/restore-pending.json`, presente só enquanto uma restauração não terminou. */
    readonly restoreMarkerUri: string;
    /** `SQLite/migration-failed.json`, presente enquanto a migration não passar. */
    readonly migrationFailureMarkerUri: string;
    /** `logs/core.log`. */
    readonly logUri: string;
}

/**
 * Monta os caminhos num lugar só, porque a abertura e a restauração precisam concordar sobre
 * eles: uma marca num caminho divergente faria a abertura ignorar uma restauração pela metade e
 * criar um banco vazio no lugar dos dados.
 *
 * @param databaseFolder URI da pasta do banco.
 * @param databaseFileName Nome do arquivo do banco.
 * @param documentFolder URI do diretório de documentos do app, onde fica o log.
 * @return Os caminhos.
 */
export function databaseFiles(databaseFolder: string, databaseFileName: string, documentFolder: string): DatabaseFiles {
    return {
        databaseUri: joinUri(databaseFolder, databaseFileName),
        backupsUri: joinUri(databaseFolder, 'backups'),
        restoreMarkerUri: joinUri(databaseFolder, 'restore-pending.json'),
        migrationFailureMarkerUri: joinUri(databaseFolder, 'migration-failed.json'),
        logUri: joinUri(joinUri(documentFolder, 'logs'), 'core.log'),
    };
}

/** Formato gravado na marca de restauração. */
const restoreMarkerSchema = z.object({ failedCopy: z.string() });

/** Formato gravado na marca de migration que falhou. */
const migrationFailureMarkerSchema = z.object({ backupFile: z.string().nullable() });

/**
 * As marcas da abertura em arquivos JSON ao lado do banco, no mesmo formato do desktop. A regra
 * de quando ler, gravar e apagar é da sequência do `client`; aqui só o disco.
 *
 * @param files Disco do aparelho.
 * @param paths Caminhos das marcas.
 * @return As marcas para a sequência de abertura.
 */
export function fileMarkers(files: AppFileSystem, paths: DatabaseFiles): StartupMarkers {
    return {
        readRestore: (): RestoreMarker | null => {
            if (!files.exists(paths.restoreMarkerUri)) {
                return null;
            }
            // Marca ilegível ainda bloqueia: a restauração pela metade é o que importa, e não o conteúdo.
            const parsed = safeJson(files, paths.restoreMarkerUri, restoreMarkerSchema);
            return { failedCopy: parsed?.failedCopy ?? null };
        },
        readMigrationFailure: (): MigrationFailureMarker | null => {
            if (!files.exists(paths.migrationFailureMarkerUri)) {
                return null;
            }
            return safeJson(files, paths.migrationFailureMarkerUri, migrationFailureMarkerSchema);
        },
        writeMigrationFailure: (marker) => {
            files.writeText(paths.migrationFailureMarkerUri, JSON.stringify(marker));
        },
        clearMigrationFailure: () => {
            files.remove(paths.migrationFailureMarkerUri);
        },
    };
}

/**
 * @param files Disco do aparelho.
 * @param uri Arquivo JSON.
 * @param schema Formato esperado.
 * @return O conteúdo validado, ou `null` quando não é JSON ou não tem o formato.
 */
function safeJson<T>(files: AppFileSystem, uri: string, schema: z.ZodType<T>): T | null {
    try {
        const raw: unknown = JSON.parse(files.readText(uri));
        const parsed = schema.safeParse(raw);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

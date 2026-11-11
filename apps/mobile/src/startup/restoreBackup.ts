import type { RestoreResult } from '@finance/client/startup';
import { joinUri, type AppFileSystem } from '../platform/AppFileSystem.ts';
import type { DatabaseFiles } from './databaseFiles.ts';

/** O banco e os arquivos que o SQLite mantém ao lado dele no modo WAL. */
const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const;

/**
 * Restaura a cópia de antes da migration que falhou (backend-design §4.5, passo 4), com os
 * mesmos passos e proteções do desktop (`replaceDatabase`): o banco que falhou não é apagado,
 * vai com o `-wal` e o `-shm` para `backups/falha-{instante}.sqlite`, fora do padrão da
 * rotação, para que nada se perca se o problema estiver no backup e não na migration.
 *
 * O backup é copiado antes para um arquivo provisório ao lado do banco: é a etapa que costuma
 * falhar (memória cheia), e até ali nada foi tocado. A troca é protegida pela marca de
 * restauração: se o app morrer no meio, a próxima abertura bloqueia apontando onde o banco
 * ficou, em vez de criar um banco vazio no lugar. A restauração que dá certo apaga também a
 * marca de migration que falhou, que descrevia o banco que acabou de sair do lugar.
 *
 * A conexão precisa estar fechada antes; no celular, a tela de bloqueio só existe com ela fechada.
 *
 * @param files Disco do aparelho.
 * @param paths Caminhos do banco, dos backups e das marcas.
 * @param backupFile Nome do backup a restaurar, dentro da pasta de backups.
 * @param instant Instante no nome da cópia do banco que falhou (`YYYYMMDD-HHMMSS`).
 * @return O backup restaurado e onde ficou o banco que falhou; `io-error` quando o disco
 * recusou uma etapa e tudo foi desfeito; `database-moved` quando nem o desfazer funcionou.
 */
export function restoreBackup(files: AppFileSystem, paths: DatabaseFiles, backupFile: string, instant: string): RestoreResult {
    // Só o nome: um caminho vindo da marca não pode apontar para fora da pasta de backups.
    const name = backupFile.split('/').pop() ?? backupFile;
    const source = joinUri(paths.backupsUri, name);
    if (!files.exists(source)) {
        return { ok: false, reason: 'no-backup' };
    }
    const failedCopy = joinUri(paths.backupsUri, `falha-${instant}.sqlite`);
    const staged = `${paths.databaseUri}.restaurando`;

    try {
        files.ensureFolder(paths.backupsUri);
        files.remove(staged);
        files.copy(source, staged);
        files.writeText(paths.restoreMarkerUri, JSON.stringify({ failedCopy }));
    } catch {
        discard(files, staged);
        discard(files, paths.restoreMarkerUri);
        return { ok: false, reason: 'io-error' };
    }

    const moved: { readonly from: string; readonly to: string }[] = [];
    try {
        for (const suffix of DATABASE_SUFFIXES) {
            const from = `${paths.databaseUri}${suffix}`;
            if (files.exists(from)) {
                const to = `${failedCopy}${suffix}`;
                files.move(from, to);
                moved.push({ from, to });
            }
        }
        files.move(staged, paths.databaseUri);
    } catch {
        try {
            for (const { from, to } of moved.reverse()) {
                files.move(to, from);
            }
        } catch {
            // A marca fica: a próxima abertura bloqueia apontando onde o banco está.
            return { ok: false, reason: 'database-moved', failedCopy };
        }
        discard(files, staged);
        discard(files, paths.restoreMarkerUri);
        return { ok: false, reason: 'io-error' };
    }
    discard(files, paths.restoreMarkerUri);
    discard(files, paths.migrationFailureMarkerUri);
    return { ok: true, restoredFrom: name, failedCopy: `falha-${instant}.sqlite` };
}

/**
 * Apaga um arquivo auxiliar sem deixar a falha mudar o resultado: o banco já está no estado
 * que o resultado descreve, e sobra no máximo um arquivo a mais.
 *
 * @param files Disco do aparelho.
 * @param uri Arquivo a apagar.
 */
function discard(files: AppFileSystem, uri: string): void {
    try {
        files.remove(uri);
    } catch {
        // Sobra um arquivo auxiliar; nada a fazer.
    }
}

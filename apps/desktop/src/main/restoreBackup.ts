import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RestoreResult } from '../shared/bridge.ts';
import type { DatabaseFiles } from '../utility/databaseFiles.ts';

/** Arquivos que formam o banco: o principal e os do modo WAL, que só valem junto dele. */
const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const;

/**
 * Restaura a cópia de antes da migration que falhou (backend-design §4.5, passo 4). O banco
 * que falhou não é apagado: vai, com os seus `-wal` e `-shm`, para
 * `backups/falha-{instante}.sqlite`, fora do padrão da rotação automática, para que nada se
 * perca se o problema estiver no backup e não na migration.
 *
 * A ordem existe para que nenhuma falha deixe o app sem banco no lugar. O backup é copiado
 * primeiro para um arquivo provisório ao lado do banco: é a etapa que costuma falhar (disco
 * cheio), e até ali nada foi tocado. Só então o banco sai do lugar, e o provisório entra por
 * `rename`, que não grava dados. Se uma etapa falhar, as anteriores são desfeitas. Uma marca
 * em disco cobre o resto — o app cair no meio ou o desfazer falhar: enquanto ela existir, a
 * abertura bloqueia em vez de criar um banco vazio no lugar do que sumiu.
 *
 * A restauração que dá certo também apaga a marca de migration que falhou: ela descreve o banco
 * que acabou de sair do lugar. Se ficasse, a próxima falha de migration — talvez semanas depois,
 * com outra atualização — ofereceria a cópia antiga da marca em vez da gravada naquela abertura,
 * e restaurar levaria embora os lançamentos feitos desde então.
 *
 * A conexão com o banco precisa estar fechada antes — quem garante é o processo principal,
 * que pede ao processo do núcleo para fechá-la.
 *
 * @param files Caminhos do banco, da pasta de backups e das marcas de restauração e de
 * migration que falhou.
 * @param backupFile Nome do backup a restaurar, dentro da pasta de backups.
 * @param instant Instante usado no nome da cópia do banco que falhou (`YYYYMMDD-HHMMSS`).
 * @return O backup restaurado e onde ficou o banco que falhou; `io-error` quando o disco
 * recusou uma etapa e tudo foi desfeito; `database-moved` quando nem o desfazer funcionou e o
 * banco ficou só na cópia.
 */
export function restoreBackup(files: DatabaseFiles, backupFile: string, instant: string): RestoreResult {
    const source = join(files.backupsPath, basename(backupFile));
    if (!existsSync(source)) {
        return { ok: false, reason: 'no-backup' };
    }
    const failedCopy = join(files.backupsPath, `falha-${instant}.sqlite`);
    const staged = `${files.databasePath}.restaurando`;

    try {
        mkdirSync(files.backupsPath, { recursive: true });
        copyFileSync(source, staged);
        writeFileSync(files.restoreMarkerPath, JSON.stringify({ failedCopy }));
    } catch {
        discard(staged);
        discard(files.restoreMarkerPath);
        return { ok: false, reason: 'io-error' };
    }

    const moved: { readonly from: string; readonly to: string }[] = [];
    try {
        for (const suffix of DATABASE_SUFFIXES) {
            const from = `${files.databasePath}${suffix}`;
            if (existsSync(from)) {
                const to = `${failedCopy}${suffix}`;
                renameSync(from, to);
                moved.push({ from, to });
            }
        }
        renameSync(staged, files.databasePath);
    } catch {
        try {
            for (const { from, to } of moved.reverse()) {
                renameSync(to, from);
            }
        } catch {
            // A marca fica: a próxima abertura bloqueia apontando onde o banco está.
            return { ok: false, reason: 'database-moved', failedCopy };
        }
        discard(staged);
        discard(files.restoreMarkerPath);
        return { ok: false, reason: 'io-error' };
    }
    discard(files.restoreMarkerPath);
    discard(files.migrationFailureMarkerPath);
    return { ok: true, restoredFrom: basename(source), failedCopy };
}

/**
 * Remove um arquivo auxiliar sem deixar a falha da remoção esconder o resultado da
 * restauração, que é o que o usuário precisa saber.
 *
 * @param path Arquivo provisório ou marca.
 */
function discard(path: string): void {
    try {
        rmSync(path, { force: true });
    } catch {
        // Sobra um arquivo auxiliar; o banco já está no estado que o resultado descreve.
    }
}

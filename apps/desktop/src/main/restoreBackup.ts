import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { RestoreResult } from '../shared/bridge.ts';
import type { DatabaseFiles } from '../utility/databaseFiles.ts';
import { discard, replaceDatabase } from './replaceDatabase.ts';

/**
 * Restaura a cópia de antes da migration que falhou (backend-design §4.5, passo 4). O banco
 * que falhou não é apagado: vai, com os seus `-wal` e `-shm`, para
 * `backups/falha-{instante}.sqlite`, fora do padrão da rotação automática, para que nada se
 * perca se o problema estiver no backup e não na migration.
 *
 * O backup é copiado primeiro para um arquivo provisório ao lado do banco: é a etapa que costuma
 * falhar (disco cheio), e até ali nada foi tocado. A troca em si, com a marca que protege contra
 * o app cair no meio, é a de `replaceDatabase`, a mesma da importação de uma cópia em Ajustes.
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
    } catch {
        discard(staged);
        return { ok: false, reason: 'io-error' };
    }

    const outcome = replaceDatabase(files, staged, failedCopy);
    if (!outcome.ok) {
        return outcome.reason === 'database-moved' ? { ok: false, reason: 'database-moved', failedCopy } : { ok: false, reason: 'io-error' };
    }
    discard(files.migrationFailureMarkerPath);
    return { ok: true, restoredFrom: basename(source), failedCopy };
}

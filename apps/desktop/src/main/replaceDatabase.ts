import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import type { DatabaseFiles } from '../utility/databaseFiles.ts';

/** Arquivos que formam o banco: o principal e os do modo WAL, que só valem junto dele. */
const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const;

/**
 * Como terminou a troca. `io-error`: o disco recusou uma etapa e tudo foi desfeito, o banco está
 * no lugar. `database-moved`: nem o desfazer funcionou, e o banco ficou só em `displacedCopy`.
 */
export type ReplaceOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: 'io-error' | 'database-moved' };

/**
 * Põe um arquivo já preparado ao lado do banco no lugar dele, guardando o banco que sai (com os
 * seus `-wal` e `-shm`) em `displacedCopy`. É a troca comum à restauração do backup da migration
 * que falhou (backend-design §4.5, passo 4) e à importação de uma cópia em Ajustes: nas duas, o
 * banco que sai não é apagado, para que nada se perca se a cópia que entra for a errada.
 *
 * A ordem existe para que nenhuma falha deixe o app sem banco no lugar. O arquivo que entra já
 * está gravado — a etapa que costuma falhar (disco cheio) ficou com quem o preparou, antes de
 * nada ser tocado. Só então o banco sai do lugar, e o preparado entra por `rename`, que não grava
 * dados. Se uma etapa falhar, as anteriores são desfeitas. Uma marca em disco cobre o resto — o
 * app cair no meio ou o desfazer falhar: enquanto ela existir, a abertura bloqueia em vez de criar
 * um banco vazio no lugar do que sumiu.
 *
 * A conexão com o banco precisa estar fechada antes — quem garante é o processo principal,
 * que pede ao processo do núcleo para fechá-la.
 *
 * @param files Caminhos do banco, da pasta de backups e da marca de restauração.
 * @param staged Arquivo preparado, na mesma pasta do banco para que o `rename` não copie dados;
 * descartado quando a troca é desfeita.
 * @param displacedCopy Para onde vai o banco que sai do lugar, dentro da pasta de backups.
 * @return `ok` com o preparado no lugar do banco, ou o motivo de a troca não ter terminado.
 */
export function replaceDatabase(files: DatabaseFiles, staged: string, displacedCopy: string): ReplaceOutcome {
    try {
        mkdirSync(files.backupsPath, { recursive: true });
        writeFileSync(files.restoreMarkerPath, JSON.stringify({ failedCopy: displacedCopy }));
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
                const to = `${displacedCopy}${suffix}`;
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
            return { ok: false, reason: 'database-moved' };
        }
        discard(staged);
        discard(files.restoreMarkerPath);
        return { ok: false, reason: 'io-error' };
    }
    discard(files.restoreMarkerPath);
    return { ok: true };
}

/**
 * Remove um arquivo auxiliar sem deixar a falha da remoção esconder o resultado da troca, que é o
 * que o usuário precisa saber.
 *
 * @param path Arquivo provisório ou marca.
 */
export function discard(path: string): void {
    try {
        rmSync(path, { force: true });
    } catch {
        // Sobra um arquivo auxiliar; o banco já está no estado que o resultado descreve.
    }
}

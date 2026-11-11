import type { DatabaseImportResult } from '@finance/client';
import { joinUri, type AppFileSystem } from '../platform/AppFileSystem.ts';
import type { DatabaseFiles } from './databaseFiles.ts';

/** O banco e os arquivos do WAL, que andam juntos: o `-wal` guarda o que ainda não foi para o banco. */
const DATABASE_SUFFIXES = ['', '-wal', '-shm'] as const;

/** Resultado de exportar a cópia: o arquivo temporário a compartilhar, ou a falha. */
export type DatabaseExportOutcome = { readonly ok: true; readonly uri: string; readonly fileName: string } | { readonly ok: false; readonly reason: 'write-failed' | 'unavailable' };

/**
 * O que a tela de Ajustes faz com o banco do aparelho (mobile-mvp-plan, Fase 18). Vem da raiz de
 * composição, a única que conhece o banco aberto; nos testes, um dublê.
 */
export interface DatabaseCopies {
    /**
     * Grava uma cópia consistente do banco num arquivo temporário, para a folha de
     * compartilhamento.
     *
     * @return O arquivo, ou a falha; o banco vivo não muda em nenhum caso.
     */
    readonly exportCopy: () => DatabaseExportOutcome;
    /**
     * Apaga o arquivo temporário depois de compartilhado: a cópia não fica esquecida no cache do
     * app com o histórico financeiro inteiro.
     *
     * @param uri Arquivo devolvido por `exportCopy`.
     */
    readonly discard: (uri: string) => void;
    /**
     * Confere a cópia escolhida e, se ela serve, fecha o banco e a põe no lugar.
     *
     * @param uri Cópia escolhida, já no cache do app (`file://`).
     * @param fileName Nome do arquivo como o usuário o escolheu, para a mensagem.
     * @return O resultado, e se o banco foi fechado — quando foi, o app precisa reabrir o núcleo,
     * qualquer que seja o resultado.
     */
    readonly importCopy: (uri: string, fileName: string) => { readonly result: DatabaseImportResult; readonly closed: boolean };
    /** Arquivo de log do app, para "Relatar problema"; `null` quando ainda não há log. */
    readonly logUri: () => string | null;
}

/**
 * Põe a cópia conferida no lugar do banco. Regra de negócio (Cópia do banco, desktop-mvp-plan
 * Fase 13.9): a cópia **substitui** os dados do aparelho, não se soma a eles — juntar dois bancos
 * duplicaria tudo o que têm em comum —, e o banco que sai vai para
 * `backups/antes-da-importacao-{instante}.sqlite`, fora da rotação automática, para o usuário
 * voltar a ele se escolheu a cópia errada.
 *
 * A troca é a mesma da restauração de backup (`restoreBackup`): a cópia vai primeiro para
 * `{banco}.importando`, ao lado do banco, e a marca `restore-pending.json` é gravada antes de
 * mexer no banco, para que o app que cair no meio abra bloqueado apontando onde o banco ficou, e
 * não sobre um banco pela metade. Se a troca falhar, o que andou volta; se nem isso der, a marca
 * fica.
 *
 * @param files Disco do aparelho.
 * @param paths Onde ficam o banco, os backups e as marcas.
 * @param copyUri Cópia já conferida, no cache do app; o `-wal` dela, se houver, vai junto.
 * @param fileName Nome da cópia como o usuário a escolheu, para a mensagem.
 * @param instant Instante `YYYYMMDD-HHMMSS` do nome do banco guardado.
 * @return O resultado; o banco precisa estar fechado antes da chamada.
 */
export function replaceWithCopy(files: AppFileSystem, paths: DatabaseFiles, copyUri: string, fileName: string, instant: string): DatabaseImportResult {
    const previousName = `antes-da-importacao-${instant}.sqlite`;
    const previous = joinUri(paths.backupsUri, previousName);
    const staged = `${paths.databaseUri}.importando`;
    const stagedFiles: string[] = [];

    try {
        files.ensureFolder(paths.backupsUri);
        for (const suffix of DATABASE_SUFFIXES) {
            discard(files, `${staged}${suffix}`);
            if (files.exists(`${copyUri}${suffix}`)) {
                files.copy(`${copyUri}${suffix}`, `${staged}${suffix}`);
                stagedFiles.push(suffix);
            }
        }
        files.writeText(paths.restoreMarkerUri, JSON.stringify({ failedCopy: previousName }));
    } catch {
        for (const suffix of DATABASE_SUFFIXES) {
            discard(files, `${staged}${suffix}`);
        }
        discard(files, paths.restoreMarkerUri);
        return { ok: false, reason: 'write-failed' };
    }

    const moved: { readonly from: string; readonly to: string }[] = [];
    // Arquivos da cópia que já chegaram ao lugar do banco: na reversão saem antes de o banco voltar.
    const placed: string[] = [];
    try {
        for (const suffix of DATABASE_SUFFIXES) {
            const from = `${paths.databaseUri}${suffix}`;
            if (files.exists(from)) {
                const to = `${previous}${suffix}`;
                files.move(from, to);
                moved.push({ from, to });
            }
        }
        for (const suffix of stagedFiles) {
            const to = `${paths.databaseUri}${suffix}`;
            files.move(`${staged}${suffix}`, to);
            placed.push(to);
        }
    } catch {
        try {
            for (const uri of placed) {
                files.remove(uri);
            }
            for (const { from, to } of [...moved].reverse()) {
                files.move(to, from);
            }
        } catch {
            // A marca fica: a próxima abertura bloqueia apontando onde o banco está.
            return { ok: false, reason: 'database-moved', failedCopy: previousName };
        }
        for (const suffix of DATABASE_SUFFIXES) {
            discard(files, `${staged}${suffix}`);
        }
        discard(files, paths.restoreMarkerUri);
        return { ok: false, reason: 'io-error' };
    }
    discard(files, paths.restoreMarkerUri);
    for (const suffix of DATABASE_SUFFIXES) {
        discard(files, `${copyUri}${suffix}`);
    }
    return { ok: true, file: fileName, previousCopy: previousName };
}

/**
 * Remove um arquivo auxiliar sem deixar a falha esconder o resultado da troca.
 *
 * @param files Disco do aparelho.
 * @param uri Arquivo a remover; não existir não é erro.
 */
function discard(files: AppFileSystem, uri: string): void {
    try {
        files.remove(uri);
    } catch {
        // Sobra um arquivo auxiliar; nada a fazer.
    }
}

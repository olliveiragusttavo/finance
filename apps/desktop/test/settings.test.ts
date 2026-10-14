import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultExportFileName } from '../src/main/databaseExport.ts';
import { exportFailureMessage, formatExportInstant, formatSchemaVersion, lastExportText, SHORTCUT_GUIDE } from '../src/renderer/src/settings/settingsView.ts';
import { shortcutFor, type KeyPress, type ShortcutAction } from '../src/renderer/src/shell/shortcuts.ts';
import { exportDatabaseFile } from '../src/utility/exportDatabase.ts';
import { openCore } from '../src/utility/openCore.ts';
import type { Log } from '../src/utility/FileLog.ts';
import { CryptoIdGenerator, SystemClock } from '../src/utility/systemAdapters.ts';

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

/** @return Uma pasta temporária real, apagada no fim do teste. */
function temporaryFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'finance-settings-'));
    folders.push(folder);
    return folder;
}

/** Log que descarta tudo: estes testes conferem a cópia, não o que foi registrado. */
const silentLog: Log = { write: () => undefined };

/**
 * @param folder Pasta de dados do teste.
 * @return O núcleo aberto como no app, com um perfil gravado — o dado que a cópia precisa levar.
 */
async function openedWithProfile(folder: string): Promise<Awaited<ReturnType<typeof openCore>>> {
    const opened = await openCore({
        databasePath: join(folder, 'finance.sqlite'),
        backupsPath: join(folder, 'backups'),
        restoreMarkerPath: join(folder, 'restore-pending.json'),
        migrationFailureMarkerPath: join(folder, 'migration-failed.json'),
        clock: new SystemClock(),
        ids: new CryptoIdGenerator(),
        log: silentLog,
    });
    const created = await opened.core?.call('profiles.create', { name: 'Pessoal', type: 'personal', currency: 'BRL' });
    expect(created?.ok).toBe(true);
    return opened;
}

/**
 * @param path Arquivo exportado.
 * @return Os nomes dos perfis na cópia.
 */
function profileNames(path: string): readonly unknown[] {
    const copy = BetterSqliteDatabase.open(path);
    const names = copy.all('SELECT name FROM profiles ORDER BY name').map((row) => row['name']);
    copy.close();
    return names;
}

describe('exportar cópia do banco (desktop-mvp-plan Fase 13)', () => {
    it('grava a cópia no destino e substitui uma cópia anterior que o usuário confirmou no diálogo', async () => {
        const folder = temporaryFolder();
        const opened = await openedWithProfile(folder);
        const destination = join(temporaryFolder(), 'financas-2026-10-14.sqlite');
        writeFileSync(destination, 'cópia antiga');

        expect(opened.exportCopy(destination)).toEqual({ ok: true });

        expect(profileNames(destination)).toEqual(['Pessoal']);
        // Nenhum temporário sobra ao lado da cópia.
        expect(readdirSync(join(destination, '..'))).toEqual(['financas-2026-10-14.sqlite']);
        opened.close();
    });

    it('recusa o próprio banco e os arquivos do WAL como destino, inclusive por outro caminho', async () => {
        const folder = temporaryFolder();
        const opened = await openedWithProfile(folder);
        const alias = join(temporaryFolder(), 'atalho');
        symlinkSync(folder, alias);

        for (const destination of [join(folder, 'finance.sqlite'), join(folder, 'finance.sqlite-wal'), join(folder, 'backups', '..', 'finance.sqlite'), join(alias, 'finance.sqlite')]) {
            expect(opened.exportCopy(destination)).toEqual({ ok: false, reason: 'same-as-database' });
        }

        expect(profileNames(join(folder, 'finance.sqlite'))).toEqual(['Pessoal']);
        opened.close();
    });

    it('pasta que não aceita a gravação: falha sem apagar a cópia anterior nem deixar temporário', async () => {
        const folder = temporaryFolder();
        const opened = await openedWithProfile(folder);
        const target = join(temporaryFolder(), 'sem-pasta', 'copia.sqlite');

        expect(opened.exportCopy(target)).toEqual({ ok: false, reason: 'write-failed' });
        expect(existsSync(join(target, '..'))).toBe(false);

        // Destino que é uma pasta: o rename falha depois da cópia, e o temporário é apagado.
        const parent = temporaryFolder();
        mkdirSync(join(parent, 'copia.sqlite'));
        expect(opened.exportCopy(join(parent, 'copia.sqlite'))).toEqual({ ok: false, reason: 'write-failed' });
        expect(readdirSync(parent)).toEqual(['copia.sqlite']);
        opened.close();
    });

    it('com o banco bloqueado não há conexão para copiar', async () => {
        const folder = temporaryFolder();
        writeFileSync(join(folder, 'restore-pending.json'), JSON.stringify({ failedCopy: 'x' }));
        const opened = await openCore({
            databasePath: join(folder, 'finance.sqlite'),
            backupsPath: join(folder, 'backups'),
            restoreMarkerPath: join(folder, 'restore-pending.json'),
            migrationFailureMarkerPath: join(folder, 'migration-failed.json'),
            clock: new SystemClock(),
            ids: new CryptoIdGenerator(),
            log: silentLog,
        });
        expect(opened.status.kind).toBe('restoreIncomplete');
        expect(opened.exportCopy(join(folder, 'copia.sqlite'))).toEqual({ ok: false, reason: 'unavailable' });
    });

    it('exportDatabaseFile funciona sobre qualquer conexão da porta, como a do mobile terá', () => {
        const database = BetterSqliteDatabase.open(':memory:');
        database.exec('CREATE TABLE t (x INTEGER)');
        const destination = join(temporaryFolder(), 'copia.sqlite');
        expect(exportDatabaseFile(database, join(temporaryFolder(), 'finance.sqlite'), destination)).toEqual({ ok: true });
        database.close();
    });

    it('sugere no diálogo o nome com a data local', () => {
        expect(defaultExportFileName(new Date(2026, 0, 5, 23, 59))).toBe('financas-2026-01-05.sqlite');
    });
});

describe('textos de Ajustes', () => {
    it('mostra a última cópia na hora local, e "nenhuma" sem cópia ou com data ilegível', () => {
        const instant = new Date(2026, 9, 14, 15, 7).toISOString();
        expect(formatExportInstant(instant)).toBe('14/10/2026 às 15:07');
        expect(lastExportText(instant)).toBe('Não há backup em nuvem. Última cópia: 14/10/2026 às 15:07.');
        expect(lastExportText(null)).toBe('Não há backup em nuvem. Nenhuma cópia exportada ainda.');
        expect(lastExportText('ontem')).toBe('Não há backup em nuvem. Nenhuma cópia exportada ainda.');
    });

    it('cancelar o diálogo não avisa nada; cada falha diz o que fazer', () => {
        expect(exportFailureMessage('canceled')).toBeNull();
        expect(exportFailureMessage('same-as-database')).toContain('Escolha outro arquivo');
        expect(exportFailureMessage('write-failed')).toContain('espaço no disco');
        expect(exportFailureMessage('unavailable')).toContain('Feche e abra o app');
    });

    it('versão do banco', () => {
        expect(formatSchemaVersion(4)).toBe('v4');
        expect(formatSchemaVersion(null)).toBe('—');
    });
});

describe('lista de atalhos (desktop-mvp-plan Fase 13)', () => {
    /**
     * @param key Tecla impressa na lista.
     * @return A ação que o shell dispara para a tecla solta, numa tela com mês de referência.
     */
    const actionOf = (key: string): ShortcutAction | null => {
        const press: KeyPress = { key, ctrlKey: false, altKey: false, metaKey: false, repeat: false, defaultPrevented: false, inEditableField: false, inOverlay: false };
        return shortcutFor(press, { referenceMonthVisible: true });
    };

    it('os atalhos globais da lista são os que o teclado do shell dispara', () => {
        const global = SHORTCUT_GUIDE[0];
        expect(global?.title).toBe('Em qualquer tela');
        expect(global?.entries.flatMap((entry) => entry.keys.map(actionOf))).toEqual(['newTransaction', 'previousMonth', 'nextMonth']);
    });

    it('não lista o Ctrl K, que ainda não faz nada', () => {
        expect(SHORTCUT_GUIDE.flatMap((group) => group.entries.flatMap((entry) => entry.keys))).not.toContain('K');
    });
});

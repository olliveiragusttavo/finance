import { databaseFiles } from '../src/startup/databaseFiles.ts';
import { replaceWithCopy } from '../src/startup/databaseCopy.ts';
import { MemoryFileSystem } from './support/MemoryFileSystem.ts';

const PATHS = databaseFiles('file:///app/files/SQLite/', 'finance.sqlite', 'file:///app/files');
const COPY = 'file:///app/cache/DocumentPicker/financas.sqlite';
const PREVIOUS = 'file:///app/files/SQLite/backups/antes-da-importacao-20261111-120000.sqlite';

/**
 * @return Um disco com o banco do aparelho (e o `-wal` dele) e a cópia escolhida no cache.
 */
function disk(): MemoryFileSystem {
    const files = new MemoryFileSystem();
    files.files.set(PATHS.databaseUri, 'banco-do-celular');
    files.files.set(`${PATHS.databaseUri}-wal`, 'wal-do-celular');
    files.files.set(COPY, 'copia-do-desktop');
    return files;
}

describe('importar a cópia do banco no celular (mobile-mvp-plan, Fase 18)', () => {
    it('Regra de negócio (Cópia do banco): a cópia substitui o banco, e o anterior é guardado com o -wal', () => {
        const files = disk();

        const result = replaceWithCopy(files, PATHS, COPY, 'financas.sqlite', '20261111-120000');

        expect(result).toEqual({ ok: true, file: 'financas.sqlite', previousCopy: 'antes-da-importacao-20261111-120000.sqlite' });
        expect(files.files.get(PATHS.databaseUri)).toBe('copia-do-desktop');
        expect(files.files.has(`${PATHS.databaseUri}-wal`)).toBe(false);
        expect(files.files.get(PREVIOUS)).toBe('banco-do-celular');
        expect(files.files.get(`${PREVIOUS}-wal`)).toBe('wal-do-celular');
        expect(files.files.has(PATHS.restoreMarkerUri)).toBe(false);
        expect(files.files.has(COPY)).toBe(false);
    });

    it('o disco que recusa o provisório não toca no banco', () => {
        const files = disk();
        files.failOn('copy');

        const result = replaceWithCopy(files, PATHS, COPY, 'financas.sqlite', '20261111-120000');

        expect(result).toEqual({ ok: false, reason: 'write-failed' });
        expect(files.files.get(PATHS.databaseUri)).toBe('banco-do-celular');
        expect(files.files.has(PATHS.restoreMarkerUri)).toBe(false);
    });

    it('a troca que falha no meio é desfeita: o banco e o -wal voltam ao lugar', () => {
        const files = disk();
        // Os dois primeiros `move` tiram o banco e o -wal do lugar; o terceiro, a cópia entrando, falha.
        files.failOn('move', 2, 1);

        const result = replaceWithCopy(files, PATHS, COPY, 'financas.sqlite', '20261111-120000');

        expect(result).toEqual({ ok: false, reason: 'io-error' });
        expect(files.files.get(PATHS.databaseUri)).toBe('banco-do-celular');
        expect(files.files.get(`${PATHS.databaseUri}-wal`)).toBe('wal-do-celular');
        expect(files.files.has(PATHS.restoreMarkerUri)).toBe(false);
    });

    it('sem conseguir desfazer, a marca fica apontando onde o banco está', () => {
        const files = disk();
        files.failOn('move', 1);

        const result = replaceWithCopy(files, PATHS, COPY, 'financas.sqlite', '20261111-120000');

        expect(result).toEqual({ ok: false, reason: 'database-moved', failedCopy: 'antes-da-importacao-20261111-120000.sqlite' });
        expect(files.files.get(PATHS.restoreMarkerUri)).toBe(JSON.stringify({ failedCopy: 'antes-da-importacao-20261111-120000.sqlite' }));
    });
});

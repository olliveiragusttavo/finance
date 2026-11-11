import { databaseFiles, fileMarkers } from '../src/startup/databaseFiles.ts';
import { restoreBackup } from '../src/startup/restoreBackup.ts';
import { MemoryFileSystem } from './support/MemoryFileSystem.ts';

const PATHS = databaseFiles('file:///app/files/SQLite/', 'finance.sqlite', 'file:///app/files');
const BACKUP = 'file:///app/files/SQLite/backups/pre-v4.sqlite';
const FAILED = 'file:///app/files/SQLite/backups/falha-20260315-120000.sqlite';

/**
 * @return Um disco com o banco que falhou (e o `-wal` dele), o backup e a marca de migration.
 */
function disk(): MemoryFileSystem {
    const files = new MemoryFileSystem();
    files.files.set(PATHS.databaseUri, 'banco-que-falhou');
    files.files.set(`${PATHS.databaseUri}-wal`, 'wal-que-falhou');
    files.files.set(BACKUP, 'backup');
    files.files.set(PATHS.migrationFailureMarkerUri, '{"backupFile":"pre-v4.sqlite"}');
    return files;
}

describe('restauração do backup no celular (backend-design §4.5, passo 4)', () => {
    it('troca o banco pelo backup e guarda o que falhou, com o -wal, em falha-{instante}', () => {
        const files = disk();

        const result = restoreBackup(files, PATHS, 'pre-v4.sqlite', '20260315-120000');

        expect(result).toEqual({ ok: true, restoredFrom: 'pre-v4.sqlite', failedCopy: 'falha-20260315-120000.sqlite' });
        expect(files.files.get(PATHS.databaseUri)).toBe('backup');
        expect(files.files.get(FAILED)).toBe('banco-que-falhou');
        expect(files.files.get(`${FAILED}-wal`)).toBe('wal-que-falhou');
        expect(files.exists(PATHS.restoreMarkerUri)).toBe(false);
        // A marca de migration descrevia o banco que saiu do lugar.
        expect(files.exists(PATHS.migrationFailureMarkerUri)).toBe(false);
    });

    it('backup que sumiu: recusa sem tocar em nada', () => {
        const files = disk();
        files.files.delete(BACKUP);

        expect(restoreBackup(files, PATHS, 'pre-v4.sqlite', '20260315-120000')).toEqual({ ok: false, reason: 'no-backup' });
        expect(files.files.get(PATHS.databaseUri)).toBe('banco-que-falhou');
    });

    it('nome com pasta na marca: só o nome vale, para não restaurar de fora de backups/', () => {
        const files = disk();

        expect(restoreBackup(files, PATHS, '../../outro/pre-v4.sqlite', '20260315-120000').ok).toBe(true);
    });

    it('cópia do backup que falha (memória cheia): io-error e o banco continua no lugar', () => {
        const files = disk();
        files.failOn('copy');

        expect(restoreBackup(files, PATHS, 'pre-v4.sqlite', '20260315-120000')).toEqual({ ok: false, reason: 'io-error' });
        expect(files.files.get(PATHS.databaseUri)).toBe('banco-que-falhou');
        expect(files.exists(PATHS.restoreMarkerUri)).toBe(false);
        expect(files.exists(`${PATHS.databaseUri}.restaurando`)).toBe(false);
    });

    it('troca que falha no meio: desfaz, devolve o banco ao lugar e não deixa marca', () => {
        const files = disk();
        // Os dois primeiros `move` tiram o banco e o -wal; o terceiro, que traria o backup, falha.
        files.failOn('move', 2, 1);

        expect(restoreBackup(files, PATHS, 'pre-v4.sqlite', '20260315-120000')).toEqual({ ok: false, reason: 'io-error' });
        expect(files.files.get(PATHS.databaseUri)).toBe('banco-que-falhou');
        expect(files.files.get(`${PATHS.databaseUri}-wal`)).toBe('wal-que-falhou');
        expect(files.exists(PATHS.restoreMarkerUri)).toBe(false);
    });

    it('nem o desfazer funciona: database-moved, e a marca fica para a abertura bloquear apontando a cópia', () => {
        const files = disk();
        files.failOn('move', 1);

        const result = restoreBackup(files, PATHS, 'pre-v4.sqlite', '20260315-120000');

        expect(result).toEqual({ ok: false, reason: 'database-moved', failedCopy: FAILED });
        expect(fileMarkers(files, PATHS).readRestore()).toEqual({ failedCopy: FAILED });
    });
});

describe('marcas da abertura em arquivo', () => {
    it('marca de restauração ilegível ainda bloqueia, sem a cópia', () => {
        const files = new MemoryFileSystem();
        files.files.set(PATHS.restoreMarkerUri, 'isto não é JSON');

        expect(fileMarkers(files, PATHS).readRestore()).toEqual({ failedCopy: null });
    });

    it('grava, lê e apaga a marca de migration que falhou', () => {
        const files = new MemoryFileSystem();
        const markers = fileMarkers(files, PATHS);

        markers.writeMigrationFailure({ backupFile: 'pre-v4.sqlite' });
        expect(markers.readMigrationFailure()).toEqual({ backupFile: 'pre-v4.sqlite' });
        markers.clearMigrationFailure();
        expect(markers.readMigrationFailure()).toBeNull();
    });

    it('marca de migration em outro formato é ignorada, e a abertura volta a oferecer o backup da tentativa', () => {
        const files = new MemoryFileSystem();
        files.files.set(PATHS.migrationFailureMarkerUri, '{"backup":1}');

        expect(fileMarkers(files, PATHS).readMigrationFailure()).toBeNull();
    });

    it('junta pasta e nome sem barra dupla', () => {
        expect(PATHS.databaseUri).toBe('file:///app/files/SQLite/finance.sqlite');
        expect(PATHS.logUri).toBe('file:///app/files/logs/core.log');
    });
});

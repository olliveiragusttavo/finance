import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationFailedError } from '@finance/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAppUrl } from '../src/main/appUrl.ts';
import { CloseHandshake, DatabaseCloseTimeoutError } from '../src/main/CloseHandshake.ts';
import { DEFAULT_PREFERENCES, DevicePreferencesStore } from '../src/main/DevicePreferencesStore.ts';
import { buildReportUrl, problemReportSchema, readLogTail, REPORT_DESTINATION } from '../src/main/problemReport.ts';
import { restoreBackup } from '../src/main/restoreBackup.ts';
import type { ProblemReport } from '../src/shared/bridge.ts';
import { databaseFiles } from '../src/utility/databaseFiles.ts';
import { FileLog } from '../src/utility/FileLog.ts';
import { SystemClock } from '../src/utility/systemAdapters.ts';
import { parseUtilityArguments, utilityArguments } from '../src/utility/utilityMessages.ts';

const folders: string[] = [];

afterEach(() => {
    vi.useRealTimers();
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

/** @return Uma pasta temporária, apagada no fim do teste. */
function temporaryFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), 'finance-main-'));
    folders.push(folder);
    return folder;
}

describe('trava de navegação (desktop-shell-design §3.6)', () => {
    const packaged = 'file:///opt/financas/resources/app/out/renderer/index.html';

    it('aceita só o próprio app, inclusive a troca de rota pelo hash', () => {
        expect(isAppUrl(`${packaged}#/transacoes`, packaged)).toBe(true);
        expect(isAppUrl('http://localhost:5173/#/x', 'http://localhost:5173')).toBe(true);
    });

    it('recusa conteúdo remoto, outro arquivo local e endereço inválido', () => {
        expect(isAppUrl('https://example.com', packaged)).toBe(false);
        expect(isAppUrl('file:///etc/passwd', packaged)).toBe(false);
        expect(isAppUrl('http://localhost:5174/', 'http://localhost:5173')).toBe(false);
        expect(isAppUrl('não é url', packaged)).toBe(false);
    });
});

describe('preferências do aparelho', () => {
    it('sem arquivo, ou com JSON inválido, devolve as padrão em vez de derrubar a abertura', () => {
        const folder = temporaryFolder();
        const store = new DevicePreferencesStore(join(folder, 'preferences.json'));
        expect(store.read()).toEqual(DEFAULT_PREFERENCES);
        writeFileSync(join(folder, 'preferences.json'), '{ quebrado');
        expect(store.read()).toEqual(DEFAULT_PREFERENCES);
    });

    it('campo ruim no arquivo volta ao padrão sem perder os bons', () => {
        const folder = temporaryFolder();
        writeFileSync(join(folder, 'preferences.json'), JSON.stringify({ theme: 'roxo', lastPeriod: '2026-10', antigo: 1 }));
        expect(new DevicePreferencesStore(join(folder, 'preferences.json')).read()).toEqual({ theme: 'system', lastProfileId: null, lastPeriod: '2026-10' });
    });

    it('grava só pedidos válidos e mantém os campos que o pedido não traz', () => {
        const path = join(temporaryFolder(), 'sub', 'preferences.json');
        const store = new DevicePreferencesStore(path);
        expect(store.update({ theme: 'dark' })).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark' });
        expect(store.update({ lastPeriod: '2026-11' })).toEqual({ ...DEFAULT_PREFERENCES, theme: 'dark', lastPeriod: '2026-11' });
        expect(() => store.update({ theme: 'roxo' })).toThrow();
        expect(() => store.update({ caminho: '/etc' })).toThrow();
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ theme: 'dark', lastProfileId: null, lastPeriod: '2026-11' });
    });
});

describe('restaurar backup (backend-design §4.5, passo 4)', () => {
    it('põe a cópia no lugar do banco e guarda o banco que falhou com o seu -wal', () => {
        const folder = temporaryFolder();
        const files = databaseFiles(folder);
        mkdirSync(files.backupsPath);
        writeFileSync(files.databasePath, 'falhou');
        writeFileSync(`${files.databasePath}-wal`, 'wal da falha');
        writeFileSync(join(files.backupsPath, 'pre-v1-2026-10-03-120000.sqlite'), 'antes');

        const result = restoreBackup(files, 'pre-v1-2026-10-03-120000.sqlite', '20261003-130000');
        expect(result).toEqual({ ok: true, restoredFrom: 'pre-v1-2026-10-03-120000.sqlite', failedCopy: join(files.backupsPath, 'falha-20261003-130000.sqlite') });
        expect(readFileSync(files.databasePath, 'utf8')).toBe('antes');
        expect(readFileSync(join(files.backupsPath, 'falha-20261003-130000.sqlite'), 'utf8')).toBe('falhou');
        expect(existsSync(`${files.databasePath}-wal`)).toBe(false);
        expect(readFileSync(join(files.backupsPath, 'falha-20261003-130000.sqlite-wal'), 'utf8')).toBe('wal da falha');
        expect(existsSync(files.restoreMarkerPath)).toBe(false);
        expect(existsSync(`${files.databasePath}.restaurando`)).toBe(false);
    });

    it('restauração bem-sucedida apaga a marca de migration que falhou, que descrevia o banco que saiu', () => {
        const folder = temporaryFolder();
        const files = databaseFiles(folder);
        mkdirSync(files.backupsPath);
        writeFileSync(files.databasePath, 'falhou');
        writeFileSync(join(files.backupsPath, 'pre-v1-2026-10-03-120000.sqlite'), 'antes');
        writeFileSync(files.migrationFailureMarkerPath, JSON.stringify({ backupFile: 'pre-v1-2026-10-03-120000.sqlite' }));

        const result = restoreBackup(files, 'pre-v1-2026-10-03-120000.sqlite', '20261003-130000');
        expect(result.ok).toBe(true);
        expect(existsSync(files.migrationFailureMarkerPath)).toBe(false);
    });

    it('restauração que falha mantém a marca de migration, porque o banco que falhou continua no lugar', () => {
        const folder = temporaryFolder();
        const files = databaseFiles(folder);
        mkdirSync(join(files.backupsPath, 'pre-v1-2026-10-03-120000.sqlite'), { recursive: true });
        writeFileSync(files.databasePath, 'atual');
        writeFileSync(files.migrationFailureMarkerPath, JSON.stringify({ backupFile: 'pre-v1-2026-10-03-120000.sqlite' }));

        const result = restoreBackup(files, 'pre-v1-2026-10-03-120000.sqlite', '20261003-130000');
        expect(result).toEqual({ ok: false, reason: 'io-error' });
        expect(existsSync(files.migrationFailureMarkerPath)).toBe(true);
    });

    it('não sai da pasta de backups mesmo que o nome tente', () => {
        const folder = temporaryFolder();
        writeFileSync(join(folder, 'segredo.sqlite'), 'x');
        const result = restoreBackup(databaseFiles(folder), '../segredo.sqlite', 'x');
        expect(result).toEqual({ ok: false, reason: 'no-backup' });
    });

    it('cópia que falha não tira o banco do lugar', () => {
        const folder = temporaryFolder();
        const files = databaseFiles(folder);
        // Um diretório com o nome do backup faz a cópia falhar, como um disco cheio faria.
        mkdirSync(join(files.backupsPath, 'pre-v1-2026-10-03-120000.sqlite'), { recursive: true });
        writeFileSync(files.databasePath, 'atual');
        writeFileSync(`${files.databasePath}-wal`, 'wal atual');

        const result = restoreBackup(files, 'pre-v1-2026-10-03-120000.sqlite', '20261003-130000');
        expect(result).toEqual({ ok: false, reason: 'io-error' });
        expect(readFileSync(files.databasePath, 'utf8')).toBe('atual');
        expect(readFileSync(`${files.databasePath}-wal`, 'utf8')).toBe('wal atual');
        expect(existsSync(files.restoreMarkerPath)).toBe(false);
        expect(existsSync(`${files.databasePath}.restaurando`)).toBe(false);
    });

    it('troca que falha no meio é desfeita: o banco e o -wal voltam ao lugar', () => {
        const folder = temporaryFolder();
        const files = databaseFiles(folder);
        mkdirSync(files.backupsPath);
        writeFileSync(join(files.backupsPath, 'pre-v1-2026-10-03-120000.sqlite'), 'antes');
        writeFileSync(files.databasePath, 'atual');
        writeFileSync(`${files.databasePath}-wal`, 'wal atual');
        // O destino do -shm ocupado por uma pasta com conteúdo faz a terceira troca falhar.
        writeFileSync(`${files.databasePath}-shm`, 'shm atual');
        mkdirSync(join(files.backupsPath, 'falha-20261003-130000.sqlite-shm', 'ocupado'), { recursive: true });

        const result = restoreBackup(files, 'pre-v1-2026-10-03-120000.sqlite', '20261003-130000');
        expect(result).toEqual({ ok: false, reason: 'io-error' });
        expect(readFileSync(files.databasePath, 'utf8')).toBe('atual');
        expect(readFileSync(`${files.databasePath}-wal`, 'utf8')).toBe('wal atual');
        expect(existsSync(join(files.backupsPath, 'falha-20261003-130000.sqlite'))).toBe(false);
        expect(existsSync(files.restoreMarkerPath)).toBe(false);
        expect(existsSync(`${files.databasePath}.restaurando`)).toBe(false);
    });
});

describe('fechar o banco antes de restaurar', () => {
    it('dois pedidos ao mesmo tempo enviam um só e terminam juntos', async () => {
        const handshake = new CloseHandshake(1000);
        const send = vi.fn();
        const first = handshake.request(send);
        const second = handshake.request(send);
        handshake.confirm();
        await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
        expect(send).toHaveBeenCalledTimes(1);
    });

    it('processo do núcleo que já terminou conta como banco fechado', async () => {
        const handshake = new CloseHandshake(1000);
        handshake.processExited();
        const send = vi.fn();
        await expect(handshake.request(send)).resolves.toBeUndefined();
        expect(send).not.toHaveBeenCalled();
    });

    it('processo que cai durante a espera libera o pedido', async () => {
        const handshake = new CloseHandshake(1000);
        const waiting = handshake.request(() => undefined);
        handshake.processExited();
        await expect(waiting).resolves.toBeUndefined();
    });

    it('núcleo travado esgota o prazo em vez de prender a tela, e permite outro pedido', async () => {
        vi.useFakeTimers();
        const handshake = new CloseHandshake(1000);
        const send = vi.fn();
        const waiting = handshake.request(send);
        vi.advanceTimersByTime(1000);
        await expect(waiting).rejects.toBeInstanceOf(DatabaseCloseTimeoutError);
        const retry = handshake.request(send);
        handshake.confirm();
        await expect(retry).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledTimes(2);
    });
});

describe('relato de problema', () => {
    const report: ProblemReport = { title: 'O núcleo do app parou', details: 'Error: boom\n    at x', description: 'Salvei uma despesa', includeLog: true };
    const environment = ['App: 0.0.0'];

    /**
     * @param url Endereço montado.
     * @param key Parâmetro procurado.
     * @return O valor decodificado do parâmetro.
     */
    function param(url: string, key: string): string {
        return new URL(url).searchParams.get(key) ?? '';
    }

    it('abre a issue no repositório do projeto com título, descrição, erro, ambiente e log', () => {
        const { url, logTruncated } = buildReportUrl('github', report, { environment, logTail: '# core.log\nlinha 1' });
        expect(url.startsWith(`https://github.com/${REPORT_DESTINATION.repository}/issues/new?`)).toBe(true);
        expect(param(url, 'title')).toBe('[Erro] O núcleo do app parou');
        const body = param(url, 'body');
        expect(body).toContain('Salvei uma despesa');
        expect(body).toContain('Error: boom');
        expect(body).toContain('- App: 0.0.0');
        expect(body).toContain('linha 1');
        expect(logTruncated).toBe(false);
    });

    it('sem o log marcado, o log não vai', () => {
        const { url } = buildReportUrl('github', { ...report, includeLog: false }, { environment, logTail: 'segredo do log' });
        expect(param(url, 'body')).not.toContain('segredo do log');
    });

    it('log grande é cortado das linhas antigas para caber no limite de cada destino', () => {
        const logTail = Array.from({ length: 400 }, (_, index) => `{"event":"linha-${String(index)}","texto":"${'x'.repeat(40)}"}`).join('\n');
        const github = buildReportUrl('github', report, { environment, logTail });
        expect(github.url.length).toBeLessThanOrEqual(8000);
        expect(github.logTruncated).toBe(true);
        expect(param(github.url, 'body')).toContain('linha-399');
        expect(param(github.url, 'body')).not.toContain('linha-0"');

        const email = buildReportUrl('email', { ...report, description: 'd'.repeat(5000) }, { environment, logTail });
        expect(email.url.startsWith(`mailto:${REPORT_DESTINATION.email}?subject=`)).toBe(true);
        expect(email.url.length).toBeLessThanOrEqual(1800);
    });

    it('corte do texto longo não parte emoji ao meio nem derruba o relato', () => {
        for (let size = 4000; size < 4010; size += 1) {
            const description = `${'d'.repeat(size)}${'😀'.repeat(400)}`;
            const email = buildReportUrl('email', { ...report, title: `${'t'.repeat(110)}😀😀😀`, description }, { environment, logTail: '' });
            expect(email.url.length).toBeLessThanOrEqual(1800);
        }
    });

    it('recusa relato malformado vindo do renderer', () => {
        expect(problemReportSchema.safeParse({ ...report, title: '' }).success).toBe(false);
        // Campo a mais (um endereço, por exemplo) é descartado: o destino é fixo no processo principal.
        expect(problemReportSchema.parse({ ...report, url: 'https://outro.site' })).toEqual(report);
        expect(problemReportSchema.safeParse({ ...report, includeLog: 'sim' }).success).toBe(false);
    });

    it('lê só o fim dos logs e esconde a pasta pessoal', () => {
        const folder = temporaryFolder();
        const core = join(folder, 'core.log');
        writeFileSync(core, Array.from({ length: 100 }, (_, index) => `{"n":${String(index)},"path":"/home/maria/.config/x"}`).join('\n'));
        const tail = readLogTail([core, join(folder, 'main.log')], '/home/maria');
        const lines = tail.split('\n');
        expect(lines[0]).toBe('# core.log');
        expect(lines).toHaveLength(41);
        expect(lines.at(-1)).toBe('{"n":99,"path":"~/.config/x"}');
        expect(tail).not.toContain('/home/maria');
    });

    it('esconde a pasta pessoal do Windows também na forma escapada do JSON e nas URLs de pilha', () => {
        const folder = temporaryFolder();
        const core = join(folder, 'core.log');
        const home = 'C:\\Users\\maria';
        const line = JSON.stringify({ path: `${home}\\AppData\\Roaming\\Finanças`, stack: 'at file:///C:/Users/maria/app/index.js:1:1' });
        writeFileSync(core, `${line}\n`);
        const tail = readLogTail([core], home);
        expect(tail).toContain('"path":"~\\\\AppData');
        expect(tail).toContain('file:///~/app');
        expect(tail).not.toContain('maria');
    });
});

describe('log do núcleo', () => {
    it('grava a causa e os campos próprios do erro, que trazem a falha real da migration', () => {
        const folder = temporaryFolder();
        const path = join(folder, 'logs', 'core.log');
        const failure = new MigrationFailedError(2, new Error('no such table: accounts'));
        new FileLog(path, () => new Date(0)).write('error', 'core.open-failed', { error: failure });
        const entry: unknown = JSON.parse(readFileSync(path, 'utf8'));
        expect(entry).toMatchObject({
            event: 'core.open-failed',
            error: { name: 'MigrationFailedError', version: 2, cause: { name: 'Error', message: 'no such table: accounts' } },
        });
    });

    it('não entra em recursão quando a cadeia de causas é circular', () => {
        const folder = temporaryFolder();
        const path = join(folder, 'core.log');
        const first = new Error('primeiro');
        const second = new Error('segundo', { cause: first });
        first.cause = second;
        new FileLog(path).write('error', 'loop', { error: first });
        expect(readFileSync(path, 'utf8')).toContain('[Circular Error]');
    });
});

describe('adaptadores reais das portas', () => {
    it('o relógio separa o instante UTC da data local do usuário', () => {
        // 22h de 31/10 em São Paulo já é 1º/11 em UTC: o mês do usuário ainda não virou.
        const instant = new Date(2026, 9, 31, 22, 30, 0);
        const clock = new SystemClock(() => instant);
        expect(clock.today().toString()).toBe('2026-10-31');
        expect(clock.now()).toBe(instant.toISOString().slice(0, 19).replace('T', ' '));
    });

    it('a pasta de dados chega ao processo do núcleo por argumento', () => {
        expect(parseUtilityArguments(['electron', 'utility.js', ...utilityArguments('/home/u/.config/Finanças')])).toEqual({ userData: '/home/u/.config/Finanças' });
        expect(() => parseUtilityArguments(['electron'])).toThrow();
    });
});

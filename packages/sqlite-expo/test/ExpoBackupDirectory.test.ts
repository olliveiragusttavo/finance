import { describe, expect, it } from 'vitest';
import { ExpoBackupDirectory, fileUriToPath, type ExpoBackupEntry, type ExpoBackupFolder } from '../src/ExpoBackupDirectory.ts';

/**
 * Pasta em memória com a forma do `Directory` do `expo-file-system`: o adaptador só cria,
 * lista e apaga, e o teste confere o que ele pediu.
 */
class FakeFolder implements ExpoBackupFolder {
    public exists = false;
    public files: string[] = [];
    public readonly createCalls: { readonly intermediates: boolean; readonly idempotent: boolean }[] = [];

    /**
     * @param uri URI da pasta, como o Expo devolve.
     */
    public constructor(public readonly uri: string) {}

    /**
     * @param options Opções pedidas pelo adaptador.
     */
    public create(options: { readonly intermediates: boolean; readonly idempotent: boolean }): void {
        this.createCalls.push(options);
        this.exists = true;
    }

    /**
     * @return Os arquivos, cada um sabendo se apagar.
     */
    public list(): readonly ExpoBackupEntry[] {
        return this.files.map((name) => ({
            name,
            delete: (): void => {
                this.files = this.files.filter((file) => file !== name);
            },
        }));
    }
}

describe('ExpoBackupDirectory', () => {
    it('cria a pasta de forma idempotente e devolve caminho de arquivo, e não URI, para o VACUUM INTO', () => {
        const folder = new FakeFolder('file:///data/user/0/com.finance.app/files/SQLite/backups/');
        const backups = new ExpoBackupDirectory(folder);

        expect(backups.pathOf('finance-2026.sqlite')).toBe('/data/user/0/com.finance.app/files/SQLite/backups/finance-2026.sqlite');
        expect(folder.createCalls).toEqual([{ intermediates: true, idempotent: true }]);
    });

    it('lista vazio sem criar a pasta quando ela ainda não existe', () => {
        const folder = new FakeFolder('file:///x/backups');

        expect(new ExpoBackupDirectory(folder).list()).toEqual([]);
        expect(folder.createCalls).toEqual([]);
    });

    it('apaga só o arquivo pedido; ausente não é erro', () => {
        const folder = new FakeFolder('file:///x/backups');
        folder.exists = true;
        folder.files = ['a.sqlite', 'b.sqlite'];
        const backups = new ExpoBackupDirectory(folder);

        backups.remove('a.sqlite');
        backups.remove('nao-existe.sqlite');

        expect(backups.list()).toEqual(['b.sqlite']);
    });
});

describe('fileUriToPath', () => {
    it('decodifica o que a URI escapa', () => {
        expect(fileUriToPath('file:///storage/Meus%20Arquivos/backups')).toBe('/storage/Meus Arquivos/backups');
    });

    it('aceita caminho sem esquema e recusa esquema que o SQLite não abre', () => {
        expect(fileUriToPath('/data/backups')).toBe('/data/backups');
        expect(() => fileUriToPath('content://com.android.externalstorage/backups')).toThrow('precisa ser local');
    });
});

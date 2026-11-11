import type { BackupDirectory } from '@finance/core';

/** Item da pasta (`File` ou `Directory` do `expo-file-system`), só com o que o adaptador usa. */
export interface ExpoBackupEntry {
    readonly name: string;
    delete(): void;
}

/**
 * Pasta do `expo-file-system` (`Directory`), só com o que o adaptador usa. Interface própria
 * pelo mesmo motivo do `ExpoConnection`: o Vitest exercita o adaptador com um dublê, e a raiz
 * de composição do app confere na compilação que o `Directory` real cumpre esta forma.
 */
export interface ExpoBackupFolder {
    readonly uri: string;
    readonly exists: boolean;
    create(options: { readonly intermediates: boolean; readonly idempotent: boolean }): void;
    list(): readonly ExpoBackupEntry[];
}

/**
 * Adaptador da porta `BackupDirectory` do núcleo sobre o `expo-file-system`, com a pasta
 * `backups/` ao lado do banco. Fino e sem regra, como o `NodeBackupDirectory` do desktop:
 * quando copiar, como nomear e quantas cópias guardar é decisão do núcleo (backend-design §4.6).
 */
export class ExpoBackupDirectory implements BackupDirectory {
    /**
     * @param folder Pasta `backups/`; criada sob demanda, porque um banco que nunca migrou
     * não precisa dela.
     */
    public constructor(private readonly folder: ExpoBackupFolder) {}

    /**
     * Cria a pasta e devolve o caminho no formato que o `VACUUM INTO` aceita. O
     * `expo-file-system` trabalha com URI `file://`, e o SQLite abre caminho de arquivo; a URI
     * passada direto criaria um arquivo chamado "file:" no diretório corrente, ou falharia.
     *
     * @param fileName Nome do arquivo de backup.
     * @return O caminho completo do arquivo, com a pasta já existente.
     */
    public pathOf(fileName: string): string {
        this.folder.create({ intermediates: true, idempotent: true });
        return `${fileUriToPath(this.folder.uri).replace(/\/+$/, '')}/${fileName}`;
    }

    /**
     * @return Os nomes dos arquivos da pasta; vazio quando ela ainda não existe.
     */
    public list(): readonly string[] {
        return this.folder.exists ? this.folder.list().map((entry) => entry.name) : [];
    }

    /**
     * Apaga pelo item listado, e não montando um `File` pelo nome, para o adaptador não
     * depender do construtor do módulo nativo. A pasta guarda poucas cópias (a rotação do
     * núcleo apaga as antigas), então percorrer a lista não pesa.
     *
     * @param fileName Arquivo a apagar; ausente não é erro.
     */
    public remove(fileName: string): void {
        if (!this.folder.exists) {
            return;
        }
        this.folder.list().find((entry) => entry.name === fileName)?.delete();
    }
}

/**
 * Converte uma URI `file://` em caminho de arquivo, decodificando o que a URI escapa (espaço
 * vira `%20`). Caminho sem esquema passa como veio, porque já é o que o SQLite espera.
 *
 * @param uri URI devolvida pelo `expo-file-system`.
 * @return O caminho absoluto no sistema de arquivos do aparelho.
 * @throws {Error} Quando a URI tem outro esquema (`content://`), que o SQLite não abre.
 */
export function fileUriToPath(uri: string): string {
    if (uri.startsWith('file://')) {
        return decodeURIComponent(uri.slice('file://'.length));
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(uri)) {
        throw new Error(`a pasta de backups precisa ser local (file://), veio ${uri}`);
    }
    return uri;
}

import { Directory, File } from 'expo-file-system';

/**
 * As operações de arquivo de que a abertura, a restauração e o log precisam, por URI. Interface
 * própria, e não o `expo-file-system` direto, para que a restauração — o trecho em que um
 * passo errado perde o banco do usuário — seja testada no Jest com um disco em memória, passo
 * a passo e com falhas injetadas.
 */
export interface AppFileSystem {
    /**
     * @param uri Arquivo.
     * @return `true` quando o arquivo existe.
     */
    exists(uri: string): boolean;
    /**
     * @param uri Arquivo de texto.
     * @return O conteúdo.
     * @throws {Error} Quando o arquivo não existe ou não pode ser lido.
     */
    readText(uri: string): string;
    /**
     * @param uri Arquivo; criado ou substituído.
     * @param text Conteúdo inteiro.
     */
    writeText(uri: string, text: string): void;
    /**
     * @param uri Arquivo; criado se faltar.
     * @param text Texto a acrescentar no fim.
     */
    appendText(uri: string, text: string): void;
    /**
     * @param from Arquivo de origem, que continua no lugar.
     * @param to Destino; não pode existir.
     */
    copy(from: string, to: string): void;
    /**
     * @param from Arquivo de origem.
     * @param to Destino; não pode existir.
     */
    move(from: string, to: string): void;
    /** @param uri Arquivo a apagar; ausente não é erro. */
    remove(uri: string): void;
    /** @param uri Pasta a criar, com as pastas acima; existente não é erro. */
    ensureFolder(uri: string): void;
}

/**
 * Junta pasta e nome numa URI, sem barra dupla. As URIs do `expo-file-system` terminam ou não
 * em `/` conforme a origem, e uma barra dupla viraria um caminho diferente na comparação.
 *
 * @param folder URI da pasta.
 * @param name Nome do arquivo.
 * @return A URI do arquivo.
 */
export function joinUri(folder: string, name: string): string {
    return `${folder.replace(/\/+$/, '')}/${name}`;
}

/** O disco do aparelho, sobre a API síncrona do `expo-file-system`. */
export const expoFileSystem: AppFileSystem = {
    exists: (uri) => new File(uri).exists,
    readText: (uri) => new File(uri).textSync(),
    writeText: (uri, text) => {
        const file = new File(uri);
        if (!file.exists) {
            file.create({ intermediates: true });
        }
        file.writeSync(text);
    },
    appendText: (uri, text) => {
        const file = new File(uri);
        if (!file.exists) {
            file.create({ intermediates: true });
        }
        file.writeSync(text, { append: true });
    },
    copy: (from, to) => {
        new File(from).copySync(new File(to));
    },
    move: (from, to) => {
        new File(from).moveSync(new File(to));
    },
    remove: (uri) => {
        const file = new File(uri);
        if (file.exists) {
            file.delete();
        }
    },
    ensureFolder: (uri) => {
        new Directory(uri).create({ intermediates: true, idempotent: true });
    },
};

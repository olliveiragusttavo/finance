import { getDocumentAsync } from 'expo-document-picker';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

/*
 * Folha de compartilhamento e seletor de documentos do sistema (mobile-mvp-plan, Fase 18), num
 * lugar só: as telas pedem "compartilhe este arquivo" e "escolha um arquivo", sem conhecer os
 * módulos nativos, e os testes trocam este módulo inteiro.
 */

/** Resultado de compartilhar: a folha abriu, ou o aparelho não tem folha de compartilhamento. */
export type ShareOutcome = 'shared' | 'unavailable';

/**
 * Abre a folha de compartilhamento do sistema com um arquivo do app, para o usuário mandar a cópia
 * do banco ou o log para onde quiser (mobile-shell-design §6.2: o destino é escolha dele).
 *
 * @param uri Arquivo `file://` do app.
 * @param mimeType Tipo do arquivo, que decide os apps oferecidos.
 * @param dialogTitle Título da folha, no Android.
 * @return `shared` quando a folha abriu e fechou — o sistema não diz se o usuário de fato mandou —,
 * `unavailable` quando o aparelho não compartilha arquivos.
 */
export async function shareFile(uri: string, mimeType: string, dialogTitle: string): Promise<ShareOutcome> {
    if (!(await isAvailableAsync())) {
        return 'unavailable';
    }
    await shareAsync(uri, { mimeType, dialogTitle });
    return 'shared';
}

/** Arquivo escolhido no seletor, já copiado para o cache do app. */
export interface PickedFile {
    readonly uri: string;
    readonly name: string;
}

/**
 * Abre o seletor de documentos do sistema para escolher a cópia do banco. Pede a cópia para o
 * cache do app (`copyToCacheDirectory`): o SQLite só abre arquivo local, e o original, num
 * provedor de documentos, fica intocado. Aceita qualquer tipo: o Android não tem um tipo próprio
 * para SQLite, e a conferência do conteúdo é do núcleo.
 *
 * @return O arquivo escolhido, ou `null` quando o usuário fechou o seletor.
 */
export async function pickDatabaseCopy(): Promise<PickedFile | null> {
    const result = await getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: false });
    const [asset] = result.canceled ? [] : result.assets;
    return asset === undefined ? null : { uri: asset.uri, name: asset.name };
}

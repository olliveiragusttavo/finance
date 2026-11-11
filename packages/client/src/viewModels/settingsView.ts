/*
 * Ajustes no desktop e no celular (desktop-mvp-plan Fases 13 e 13.9; mobile-mvp-plan Fase 18): o
 * tema, a cópia do banco exportada e importada e a versão do banco, com as mesmas frases nos dois
 * apps. Cada app faz a cópia pelo próprio caminho (diálogo de salvar, folha de compartilhamento);
 * o que ela pode dar, e o que dizer em cada caso, é comum.
 */

/** Tema escolhido no aparelho; `system` acompanha o sistema operacional. */
export type ThemePreference = 'system' | 'light' | 'dark';

/** Por que uma exportação não gravou a cópia. */
export type DatabaseExportFailure = 'canceled' | 'same-as-database' | 'write-failed' | 'unavailable';

/** Resultado de importar uma cópia do banco no lugar do atual. */
export type DatabaseImportResult =
    /**
     * `file`: a cópia importada, como escolhida no diálogo; `previousCopy`: onde ficou o banco que
     * saiu do lugar, para o usuário voltar a ele se escolheu a cópia errada.
     */
    | { readonly ok: true; readonly file: string; readonly previousCopy: string }
    | { readonly ok: false; readonly reason: DatabaseImportFailure }
    /**
     * A troca falhou e não foi possível devolver o banco ao lugar: ele está em `failedCopy`. O
     * app fica bloqueado até alguém resolver, como na restauração de backup.
     */
    | { readonly ok: false; readonly reason: 'database-moved'; readonly failedCopy: string };

/**
 * Por que uma importação não trocou o banco. `canceled`: o usuário fechou o diálogo de abrir.
 * `same-as-database`: o arquivo escolhido é o próprio banco do app. `unreadable`: não é SQLite ou
 * está corrompido. `not-app-database`: é SQLite, mas não deste app. `newer-than-app`: é de uma
 * versão mais nova do app. `write-failed`: o disco recusou o arquivo provisório. `unavailable`:
 * o núcleo não está com o banco aberto. `core-busy`: o núcleo não liberou o banco a tempo.
 * `io-error`: o disco recusou a troca, e tudo foi desfeito. Em todos, o banco é o de antes.
 */
export type DatabaseImportFailure =
    | 'canceled'
    | 'same-as-database'
    | 'unreadable'
    | 'not-app-database'
    | 'newer-than-app'
    | 'write-failed'
    | 'unavailable'
    | 'core-busy'
    | 'io-error';

/** Opções de tema na ordem do mockup `DesktopAjustes`: o padrão primeiro. */
export const THEME_OPTIONS: readonly { readonly value: ThemePreference; readonly label: string }[] = [
    { value: 'system', label: 'Seguir o sistema' },
    { value: 'light', label: 'Claro' },
    { value: 'dark', label: 'Escuro' },
];

/**
 * Data e hora da última cópia na hora local do aparelho, sem `Intl`, como os formatadores do
 * `client`: o instante é gravado em UTC, mas o usuário reconhece a cópia pela hora do relógio.
 *
 * @param instant Instante ISO 8601 gravado pelo processo principal.
 * @return `dd/mm/aaaa às hh:mm`; `null` quando o texto não é um instante válido, para a tela
 * tratar como se não houvesse cópia em vez de mostrar "NaN".
 */
export function formatExportInstant(instant: string): string | null {
    const date = new Date(instant);
    if (Number.isNaN(date.getTime())) {
        return null;
    }
    /**
     * Completa com zero à esquerda porque `dd/mm/aaaa às hh:mm` tem largura fixa: sem isso, a
     * linha de apoio muda de tamanho entre um dia de um dígito e um de dois.
     *
     * @param value Dia, mês, hora ou minuto, todos com no máximo dois dígitos.
     * @return O número com dois dígitos.
     */
    const two =(value: number): string => String(value).padStart(2, '0');
    return `${two(date.getDate())}/${two(date.getMonth() + 1)}/${String(date.getFullYear())} às ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/**
 * Linha de apoio do "Exportar cópia do banco". Lembra que não há backup em nuvem, porque é
 * isso que dá sentido à exportação: sem ela, perder o aparelho é perder o histórico
 * (mobile-shell-design §6.1).
 *
 * @param lastExportAt Instante da última cópia exportada neste aparelho, ou `null`.
 * @return O aviso com a data da última cópia, ou dizendo que ainda não houve nenhuma.
 */
export function lastExportText(lastExportAt: string | null): string {
    const formatted = lastExportAt === null ? null : formatExportInstant(lastExportAt);
    return formatted === null ? 'Não há backup em nuvem. Nenhuma cópia exportada ainda.' : `Não há backup em nuvem. Última cópia: ${formatted}.`;
}

/**
 * O que dizer quando a cópia não foi gravada. Cada motivo diz o que fazer, e não só que falhou
 * (brief §4, regra 9: nada de aviso genérico).
 *
 * @param reason Motivo devolvido pelo processo principal.
 * @return A mensagem; `null` quando o usuário cancelou o diálogo, que não pede aviso.
 */
export function exportFailureMessage(reason: DatabaseExportFailure): string | null {
    switch (reason) {
        case 'canceled':
            return null;
        case 'same-as-database':
            return 'Escolha outro arquivo: o destino era o próprio banco do app, que a cópia substituiria.';
        case 'write-failed':
            return 'Não foi possível gravar a cópia. Confira se há espaço no disco e permissão de escrita na pasta escolhida.';
        case 'unavailable':
            return 'O banco não está aberto agora. Feche e abra o app para exportar a cópia.';
    }
}

/**
 * O que dizer depois de importar uma cópia do banco. O sucesso diz onde ficou o banco anterior,
 * porque é o caminho de volta se a cópia escolhida for a errada; cada falha diz se os dados
 * mudaram e o que fazer (brief §4, regra 9: nada de aviso genérico).
 *
 * @param result Resultado devolvido pelo processo principal, na hora ou depois de recarregar.
 * @return A mensagem; `null` quando o usuário cancelou o diálogo, que não pede aviso.
 */
export function importResultMessage(result: DatabaseImportResult): string | null {
    if (result.ok) {
        return `Cópia ${result.file} importada. O banco anterior foi guardado em ${result.previousCopy}.`;
    }
    switch (result.reason) {
        case 'canceled':
            return null;
        case 'same-as-database':
            return 'Escolha outro arquivo: esse é o próprio banco do app, que já está aberto.';
        case 'unreadable':
            return 'O arquivo escolhido não é um banco SQLite ou está corrompido. Nada foi alterado; escolha uma cópia exportada pelo app.';
        case 'not-app-database':
            return 'O arquivo é um banco SQLite, mas não foi gravado por este app. Nada foi alterado; escolha uma cópia exportada pelo app.';
        case 'newer-than-app':
            return 'A cópia é de uma versão mais nova do app. Nada foi alterado; atualize o app para importá-la.';
        case 'write-failed':
            return 'Não foi possível preparar a cópia na pasta do banco. Nada foi alterado; confira se há espaço no disco.';
        case 'unavailable':
            return 'O banco não está aberto agora. Feche e abra o app para importar a cópia.';
        case 'core-busy':
            return 'O app não conseguiu liberar o banco a tempo. Nada foi alterado; tente de novo.';
        case 'io-error':
            return 'O disco recusou a troca do banco, e ela foi desfeita: os dados continuam os de antes. Confira se há espaço no disco e tente de novo.';
        case 'database-moved':
            return `A troca do banco falhou e não pôde ser desfeita. O banco anterior está guardado em ${result.failedCopy}.`;
    }
}

/**
 * @param schemaVersion `user_version` do banco aberto, ou `null` quando ele não abriu.
 * @return O texto da versão do banco; "—" sem banco aberto, o que em Ajustes não deveria
 * acontecer, porque a tela só existe com o banco pronto.
 */
export function formatSchemaVersion(schemaVersion: number | null): string {
    return schemaVersion === null ? '—' : `v${String(schemaVersion)}`;
}

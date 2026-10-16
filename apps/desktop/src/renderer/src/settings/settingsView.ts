import type { DatabaseExportFailure, ThemePreference } from '../../../shared/bridge.ts';

/*
 * Textos da tela de Ajustes (desktop-mvp-plan Fase 13), separados do componente para que as
 * regras de "o que dizer em cada caso" tenham teste sem montar a janela.
 */

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

/** Um atalho na lista de Ajustes. */
export interface ShortcutGuideEntry {
    /** Teclas como aparecem impressas no teclado, na ordem em que se leem. */
    readonly keys: readonly string[];
    readonly label: string;
}

/** Atalhos de um lugar do app. */
export interface ShortcutGuideGroup {
    readonly title: string;
    readonly entries: readonly ShortcutGuideEntry[];
}

/**
 * Atalhos de teclado que o app tem hoje, agrupados por onde valem. A lista do mockup tem só os
 * globais, mas os das listas de lançamentos são os que mais poupam cliques, e sem a lista ninguém
 * os descobre. Desde a Fase 13.2 as listas de Transações, do extrato de Contas e da fatura de
 * Cartões são a mesma, com os mesmos atalhos, então são um grupo só. O `Ctrl K` do mockup fica de
 * fora enquanto a busca está pendente (Fase 4): listar um atalho que não faz nada seria pior que
 * não listar. O teste confere os globais contra o `shortcutFor`, para a lista não se descolar do
 * teclado.
 */
export const SHORTCUT_GUIDE: readonly ShortcutGuideGroup[] = [
    {
        title: 'Em qualquer tela',
        entries: [
            { keys: ['N'], label: 'Novo lançamento' },
            { keys: ['[', ']'], label: 'Mês anterior / seguinte, nas telas com mês de referência' },
        ],
    },
    {
        title: 'Listas de lançamentos (Transações, extrato e fatura)',
        entries: [
            { keys: ['↑', '↓'], label: 'Linha anterior / seguinte' },
            { keys: ['Enter'], label: 'Editar o lançamento ou abrir a fatura' },
            { keys: ['P'], label: 'Marcar ou desmarcar como pago (ou clicar na situação)' },
            { keys: ['Del'], label: 'Excluir o lançamento' },
        ],
    },
];

/**
 * @param schemaVersion `user_version` do banco aberto, ou `null` quando ele não abriu.
 * @return O texto da versão do banco; "—" sem banco aberto, o que em Ajustes não deveria
 * acontecer, porque a tela só existe com o banco pronto.
 */
export function formatSchemaVersion(schemaVersion: number | null): string {
    return schemaVersion === null ? '—' : `v${String(schemaVersion)}`;
}

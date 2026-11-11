
/*
 * Lista de atalhos da tela de Ajustes (desktop-mvp-plan Fase 13), separada do componente para que a
 * conferência contra o teclado do shell tenha teste sem montar a janela. Os textos da cópia do
 * banco moram no `client`, comuns ao celular.
 */

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


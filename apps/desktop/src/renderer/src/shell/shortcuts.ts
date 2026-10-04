/*
 * Atalhos globais do shell (desktop-mvp-plan Fase 4; lista do mockup `DesktopAjustes`). A
 * decisão "esta tecla é um atalho?" fica numa função pura sobre o evento já resumido, para que
 * as regras de quando *não* disparar — que são a parte delicada — tenham teste sem DOM.
 * O `Ctrl K` (busca) ficou pendente no plano: não há mockup do que ele abre.
 */

/** Ação disparada por um atalho global. */
export type ShortcutAction = 'newTransaction' | 'previousMonth' | 'nextMonth';

/** O que importa de um `keydown` para decidir o atalho. */
export interface KeyPress {
    /** `KeyboardEvent.key`: o caractere produzido, já com o layout do teclado aplicado. */
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly metaKey: boolean;
    /** Tecla segurada: repetir abriria o painel ou passaria vários meses sem querer. */
    readonly repeat: boolean;
    /** Outro componente (menu, diálogo) já tratou a tecla. */
    readonly defaultPrevented: boolean;
    /** O foco está num campo de texto, onde a tecla é digitação. */
    readonly inEditableField: boolean;
    /** O foco está num diálogo, painel ou menu aberto, que tem o próprio teclado. */
    readonly inOverlay: boolean;
}

/** Contexto do shell no momento da tecla. */
export interface ShortcutContext {
    /** Se a tela mostra o mês de referência; sem a barra, trocar o mês seria invisível. */
    readonly referenceMonthVisible: boolean;
}

/**
 * Pela tecla produzida (`key`), e não pela posição (`code`): no ABNT2 o `[` fica noutra tecla
 * que no layout americano, e o usuário procura o símbolo impresso.
 */
const KEY_ACTIONS: Readonly<Record<string, ShortcutAction>> = {
    n: 'newTransaction',
    N: 'newTransaction',
    '[': 'previousMonth',
    ']': 'nextMonth',
};

/**
 * @param press A tecla e onde estava o foco.
 * @param context O que a tela atual mostra.
 * @return A ação do atalho, ou `null` quando a tecla deve seguir seu caminho normal: digitação
 * num campo, combinação com modificador (que é do sistema ou do navegador), tecla segurada,
 * tecla já tratada por um menu ou diálogo, ou troca de mês numa tela sem mês de referência.
 */
export function shortcutFor(press: KeyPress, context: ShortcutContext): ShortcutAction | null {
    if (press.ctrlKey || press.altKey || press.metaKey || press.repeat || press.defaultPrevented || press.inEditableField || press.inOverlay) {
        return null;
    }
    const action = KEY_ACTIONS[press.key] ?? null;
    if ((action === 'previousMonth' || action === 'nextMonth') && !context.referenceMonthVisible) {
        return null;
    }
    return action;
}

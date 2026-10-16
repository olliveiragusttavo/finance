import { useEffect } from 'react';
import { shortcutFor, type ShortcutAction, type ShortcutContext } from './shortcuts.ts';

/** Elementos com teclado próprio, onde uma tecla solta não é atalho do shell. */
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/**
 * @param target Alvo do evento de teclado.
 * @return Se o foco está num lugar onde a tecla é digitação: campo, área de texto, lista de
 * opções ou conteúdo editável.
 */
function isEditable(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }
    return target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

/**
 * Liga os atalhos globais (`N`, `[`, `]`) à janela. A decisão de cada tecla é da função pura
 * `shortcutFor`; aqui só se resume o evento e se chama a ação.
 *
 * @param context O que a tela mostra agora (se há mês de referência).
 * @param run Executa a ação; recebida a cada render, então pode fechar sobre o estado atual.
 */
export function useGlobalShortcuts(context: ShortcutContext, run: (action: ShortcutAction) => void): void {
    useEffect(() => {
        /**
         * @param event Tecla pressionada em qualquer ponto da janela.
         */
        const onKeyDown = (event: KeyboardEvent): void => {
            const target = event.target instanceof Element ? event.target : null;
            const action = shortcutFor(
                {
                    key: event.key,
                    ctrlKey: event.ctrlKey,
                    altKey: event.altKey,
                    metaKey: event.metaKey,
                    repeat: event.repeat,
                    defaultPrevented: event.defaultPrevented,
                    inEditableField: isEditable(event.target),
                    inOverlay: (target?.closest(OVERLAY_SELECTOR) ?? null) !== null,
                },
                context,
            );
            if (action !== null) {
                event.preventDefault();
                run(action);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [context, run]);
}

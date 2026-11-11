import { forwardRef, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { ScrollView, TextInput, View } from 'react-native';

/*
 * Dublê do `@gorhom/bottom-sheet` para o Jest. O dublê do pacote mostra o conteúdo da folha
 * sempre, aberta ou não, e nunca chama `onDismiss`; com ele, um teste não distinguiria a folha
 * aberta da fechada. Este mostra o conteúdo só entre `present()` e `dismiss()`, e avisa o
 * `onDismiss` como a folha de verdade.
 */

/**
 * @param props.children O app.
 * @return Os filhos; no Jest não há portal.
 */
export function BottomSheetModalProvider({ children }: { readonly children: ReactNode }): ReactNode {
    return children;
}

/** Os métodos da folha que o app chama. */
interface ModalMethods {
    present(): void;
    dismiss(): void;
}

/**
 * Folha modal: conteúdo só enquanto aberta.
 *
 * @param props.children Conteúdo.
 * @param props.onDismiss Avisado ao fechar.
 * @return O conteúdo, quando aberta.
 */
export const BottomSheetModal = forwardRef<ModalMethods, { readonly children: ReactNode; readonly onDismiss?: () => void }>(function BottomSheetModal({ children, onDismiss }, ref) {
    const [presented, setPresented] = useState(false);
    const presentedRef = useRef(false);
    useImperativeHandle(ref, () => ({
        present: () => {
            presentedRef.current = true;
            setPresented(true);
        },
        dismiss: () => {
            if (presentedRef.current) {
                presentedRef.current = false;
                setPresented(false);
                onDismiss?.();
            }
        },
    }), [onDismiss]);
    return presented ? <View testID="bottom-sheet">{children}</View> : null;
});

/** @return Nada: o véu não tem papel no Jest. */
export function BottomSheetBackdrop(): null {
    return null;
}

export const BottomSheetScrollView = ScrollView;
export const BottomSheetView = View;
export const BottomSheetTextInput = TextInput;

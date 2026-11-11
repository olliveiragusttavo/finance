import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { useEffect, type ReactNode } from 'react';
import { reportFirstScreen } from '../startup/startupTiming.ts';
import { ActiveProfileProvider } from './ActiveProfile.tsx';

/**
 * Marca a primeira tela interativa para a medição da abertura (mobile-mvp-plan, Fase 5): monta
 * quando a lista de perfis — a primeira consulta do app — respondeu e a tela da vez (primeiro
 * uso ou Início) foi desenhada.
 *
 * @return Nada na tela.
 */
function FirstScreenMark(): null {
    useEffect(() => {
        reportFirstScreen();
    }, []);
    return null;
}

/**
 * O shell depois da abertura: o perfil ativo e o hospedeiro das folhas inferiores. O hospedeiro
 * fica aqui dentro, e não na raiz, porque a folha é desenhada no lugar dele, e não no da tela
 * que a abriu: só enxerga os contextos que estão acima dele — o núcleo, o cache, as
 * preferências e o perfil ativo. Sem perfil, o primeiro uso ocupa a tela, com o próprio
 * hospedeiro.
 *
 * @param props.whenEmpty Tela do banco sem perfil (o primeiro uso).
 * @param props.children A navegação do app.
 * @return O shell.
 */
export function AppShell({ whenEmpty, children }: { readonly whenEmpty: ReactNode; readonly children: ReactNode }): ReactNode {
    return (
        <ActiveProfileProvider
            whenEmpty={
                <BottomSheetModalProvider>
                    <FirstScreenMark />
                    {whenEmpty}
                </BottomSheetModalProvider>
            }
        >
            <BottomSheetModalProvider>
                <FirstScreenMark />
                {children}
            </BottomSheetModalProvider>
        </ActiveProfileProvider>
    );
}

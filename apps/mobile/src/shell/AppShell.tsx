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
 * O shell depois da abertura: o perfil ativo para tudo abaixo e a marca da primeira tela. Sem
 * perfil, o primeiro uso ocupa a tela.
 *
 * @param props.whenEmpty Tela do banco sem perfil (o primeiro uso).
 * @param props.children A navegação do app.
 * @return O shell.
 */
export function AppShell({ whenEmpty, children }: { readonly whenEmpty: ReactNode; readonly children: ReactNode }): ReactNode {
    return (
        <ActiveProfileProvider
            whenEmpty={
                <>
                    <FirstScreenMark />
                    {whenEmpty}
                </>
            }
        >
            <FirstScreenMark />
            {children}
        </ActiveProfileProvider>
    );
}

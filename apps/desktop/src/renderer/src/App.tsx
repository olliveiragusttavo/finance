import { CoreClientProvider, createQueryClient } from '@finance/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { use, useState, type ReactNode } from 'react';
import type { DevicePreferences, StartupStatus } from '../../shared/bridge.ts';
import { bridge } from './lib/bridge.ts';
import { DevicePreferencesProvider, useDevicePreferences } from './lib/devicePreferences.tsx';
import { FailFastCoreClient, failures } from './lib/failures.ts';
import { useTheme } from './lib/theme.ts';
import { FirstUseScreen } from './firstUse/FirstUseScreen.tsx';
import { createAppRouter } from './router.tsx';
import { BlockingScreen } from './screens/BlockingScreen.tsx';
import { ActiveProfileProvider } from './shell/activeProfile.tsx';

/** O que o app precisa saber antes do primeiro quadro. */
export interface Boot {
    readonly status: StartupStatus;
    readonly preferences: DevicePreferences;
}

/**
 * Raiz do app: entrega as preferências do aparelho à árvore e decide entre a tela de bloqueio
 * e o app. A decisão vem antes de montar roteador e cache, porque com o banco bloqueado
 * nenhuma rota do núcleo pode ser chamada (backend-design §4.5).
 *
 * @param props.boot Promessa do estado da abertura e das preferências; resolvida pelo
 * `Suspense` acima, para que nada pisque entre "carregando" e o bloqueio.
 * @return A tela de bloqueio ou o app.
 */
export function App({ boot }: { readonly boot: Promise<Boot> }): ReactNode {
    const { status, preferences } = use(boot);
    return (
        <DevicePreferencesProvider initial={preferences}>
            <ThemedRoot>{status.kind === 'ready' ? <ReadyApp /> : <BlockingScreen status={status} />}</ThemedRoot>
        </DevicePreferencesProvider>
    );
}

/**
 * Aplica o tema das preferências. É um componente à parte porque o tema muda com o app aberto
 * (menu da barra superior) e precisa ler o contexto, que só existe abaixo do provedor.
 *
 * @param props.children A tela de bloqueio ou o app, que valem os dois no tema escolhido.
 * @return Os filhos, sem invólucro.
 */
function ThemedRoot({ children }: { readonly children: ReactNode }): ReactNode {
    useTheme(useDevicePreferences().preferences.theme);
    return children;
}

/**
 * O app com o banco aberto. O `CoreClient` injetado é o do preload, decorado para que um erro
 * `INTERNAL` do núcleo leve à tela de erro: daqui para baixo nenhum componente sabe que existe
 * IPC (desktop-shell-design §5.1). O roteador só monta com um perfil ativo, porque toda tela
 * do shell lê dados de um perfil; sem perfil, o primeiro uso ocupa a janela.
 *
 * @return Os provedores de dados, o perfil ativo e o roteador.
 */
function ReadyApp(): ReactNode {
    const [queryClient] = useState(createQueryClient);
    const [client] = useState(() => new FailFastCoreClient(bridge.core, failures));
    return (
        <QueryClientProvider client={queryClient}>
            <CoreClientProvider client={client}>
                <ActiveProfileProvider whenEmpty={<FirstUseScreen />}>
                    <AppRouter />
                </ActiveProfileProvider>
            </CoreClientProvider>
        </QueryClientProvider>
    );
}

/**
 * Cria o roteador ao montar, e não junto com o `ReadyApp`: o histórico em hash lê a URL quando
 * o roteador nasce, e o primeiro uso acerta a URL para a Visão geral pouco antes de o shell
 * montar. Criado antes, o roteador abriria na rota que estava na URL.
 *
 * @return O roteador do shell.
 */
function AppRouter(): ReactNode {
    const [router] = useState(createAppRouter);
    return <RouterProvider router={router} />;
}

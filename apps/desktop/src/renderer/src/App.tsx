import { CoreClientProvider, createQueryClient } from '@finance/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { use, useState, type ReactNode } from 'react';
import type { DevicePreferences, StartupStatus } from '../../shared/bridge.ts';
import { bridge } from './lib/bridge.ts';
import { FailFastCoreClient, failures } from './lib/failures.ts';
import { useTheme } from './lib/theme.ts';
import { createAppRouter } from './router.tsx';
import { BlockingScreen } from './screens/BlockingScreen.tsx';

/** O que o app precisa saber antes do primeiro quadro. */
export interface Boot {
    readonly status: StartupStatus;
    readonly preferences: DevicePreferences;
}

/**
 * Raiz do app: aplica o tema do aparelho e decide entre a tela de bloqueio e o app. A
 * decisão vem antes de montar roteador e cache, porque com o banco bloqueado nenhuma rota
 * do núcleo pode ser chamada (backend-design §4.5).
 *
 * @param props.boot Promessa do estado da abertura e das preferências; resolvida pelo
 * `Suspense` acima, para que nada pisque entre "carregando" e o bloqueio.
 * @return A tela de bloqueio ou o app.
 */
export function App({ boot }: { readonly boot: Promise<Boot> }): ReactNode {
    const { status, preferences } = use(boot);
    useTheme(preferences.theme);
    if (status.kind !== 'ready') {
        return <BlockingScreen status={status} />;
    }
    return <ReadyApp />;
}

/**
 * O app com o banco aberto. O `CoreClient` injetado é o do preload, decorado para que um erro
 * `INTERNAL` do núcleo leve à tela de erro: daqui para baixo nenhum componente sabe que existe
 * IPC (desktop-shell-design §5.1).
 *
 * @return Os provedores de dados e o roteador.
 */
function ReadyApp(): ReactNode {
    const [queryClient] = useState(createQueryClient);
    const [router] = useState(createAppRouter);
    const [client] = useState(() => new FailFastCoreClient(bridge.core, failures));
    return (
        <QueryClientProvider client={queryClient}>
            <CoreClientProvider client={client}>
                <RouterProvider router={router} />
            </CoreClientProvider>
        </QueryClientProvider>
    );
}

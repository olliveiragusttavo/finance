import { CoreClientProvider, createQueryClient } from '@finance/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { BlockingScreen } from '../screens/BlockingScreen.tsx';
import { AppText } from '../ui/AppText.tsx';
import type { MobileStartup } from './openMobileCore.ts';

/**
 * Portão da abertura: enquanto o banco abre, mostra "Abrindo…"; num bloqueio, a tela de
 * bloqueio; pronto, o app, com o núcleo e o cache de consultas disponíveis para as telas. As
 * telas nunca veem o núcleo, só o `CoreClient` (lint de fronteira do `apps/mobile`).
 *
 * A abertura começa depois do primeiro frame, para que "Abrindo…" já esteja desenhado quando a
 * thread JavaScript parar nas migrations e na verificação de integridade.
 *
 * @param props.open A abertura do app; a real na raiz, uma em memória nos testes.
 * @param props.queryClient Cache das consultas; o padrão do `client` no app, um sem coleta
 * agendada nos testes, em que o timer de 5 minutos seguraria o Jest.
 * @param props.children O app, mostrado só com o banco aberto.
 * @return A tela da etapa atual.
 */
export function StartupGate(props: { readonly open: () => Promise<MobileStartup>; readonly queryClient?: QueryClient; readonly children: ReactNode }): ReactNode {
    const { open, children } = props;
    const [startup, setStartup] = useState<MobileStartup | null>(null);
    const [queryClient] = useState(() => props.queryClient ?? createQueryClient());

    useEffect(() => {
        let cancelled = false;
        let opened: MobileStartup | null = null;
        const frame = requestAnimationFrame(() => {
            void open().then((result) => {
                if (cancelled) {
                    result.close();
                    return;
                }
                opened = result;
                setStartup(result);
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(frame);
            opened?.close();
        };
    }, [open]);

    if (startup === null) {
        return (
            <View className="flex-1 items-center justify-center bg-bg">
                <AppText className="text-muted">Abrindo…</AppText>
            </View>
        );
    }
    if (startup.status.kind !== 'ready' || startup.client === null) {
        return startup.status.kind === 'ready' ? null : <BlockingScreen status={startup.status} restore={startup.restore} />;
    }
    return (
        <CoreClientProvider client={startup.client}>
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        </CoreClientProvider>
    );
}

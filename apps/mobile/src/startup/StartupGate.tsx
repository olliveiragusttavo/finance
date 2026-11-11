import { CoreClientProvider, createQueryClient } from '@finance/client';
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { BlockingScreen } from '../screens/BlockingScreen.tsx';
import { AppText } from '../ui/AppText.tsx';
import { Button } from '../ui/Button.tsx';
import { Sheet } from '../ui/Sheet.tsx';
import type { DatabaseCopies } from './databaseCopy.ts';
import type { MobileStartup } from './openMobileCore.ts';

/** O que a abertura entrega às telas além do núcleo: Ajustes usa a versão, as cópias e a reabertura. */
export interface StartupControls {
    /** `user_version` do banco aberto, mostrado em Ajustes. */
    readonly schemaVersion: number;
    /** Exportar e importar a cópia do banco e o log; `null` nos testes que não os usam. */
    readonly copies: DatabaseCopies | null;
    /**
     * Fecha e reabre o núcleo — depois de importar uma cópia, o banco em uso é outro. O cache de
     * consultas é esvaziado, porque guardava dados do banco que saiu.
     *
     * @param notice Frase a mostrar numa folha por cima do app reaberto (o resultado da
     * importação), ou `null`.
     */
    readonly restart: (notice: string | null) => void;
}

const StartupControlsContext = createContext<StartupControls | null>(null);

/**
 * @return A versão do banco, as cópias e a reabertura do núcleo.
 * @throws {Error} Fora do `StartupGate` pronto: só as telas do app aberto usam isto.
 */
export function useStartupControls(): StartupControls {
    const value = useContext(StartupControlsContext);
    if (value === null) {
        throw new Error('useStartupControls precisa do StartupGate pronto acima na árvore');
    }
    return value;
}

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
 *
 * Reabrir (`restart`, depois de importar a cópia do banco) volta a "Abrindo…" e roda a abertura
 * de novo, com migrations e verificação, como em toda abertura: a cópia pode ser de uma versão
 * anterior e precisar migrar.
 */
export function StartupGate(props: { readonly open: () => Promise<MobileStartup>; readonly queryClient?: QueryClient; readonly children: ReactNode }): ReactNode {
    const { open, children } = props;
    const [startup, setStartup] = useState<MobileStartup | null>(null);
    const [queryClient] = useState(() => props.queryClient ?? createQueryClient());
    // Cada reabertura é uma tentativa nova: o efeito da abertura depende dela.
    const [attempt, setAttempt] = useState(0);
    // O resultado da importação: o app reabre no Início, e não em Ajustes, então a frase vem
    // numa folha por cima do app, até o usuário dispensar.
    const [notice, setNotice] = useState<string | null>(null);

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
    }, [open, attempt]);

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
    const controls: StartupControls = {
        schemaVersion: startup.status.schemaVersion,
        copies: startup.copies,
        restart: (next) => {
            startup.close();
            queryClient.clear();
            setNotice(next);
            setStartup(null);
            setAttempt((value) => value + 1);
        },
    };
    return (
        <StartupControlsContext.Provider value={controls}>
            <CoreClientProvider client={startup.client}>
                <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
            </CoreClientProvider>
            <Sheet
                open={notice !== null}
                title="Cópia do banco"
                onClose={() => {
                    setNotice(null);
                }}
            >
                <AppText className="text-ink2">{notice}</AppText>
                <Button
                    label="Entendi"
                    onPress={() => {
                        setNotice(null);
                    }}
                />
            </Sheet>
        </StartupControlsContext.Provider>
    );
}

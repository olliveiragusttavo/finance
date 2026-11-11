import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

/** Quem reage ao app entrar e sair do primeiro plano. */
export interface LifecycleListener {
    readonly onForeground: () => void;
    readonly onBackground: () => void;
}

/**
 * O único ponto do app que escuta o `AppState` (mobile-shell-design §5.3). Hoje ninguém se
 * inscreve: é onde a sincronização vai ligar e desligar o listener, e um ponto só evita que
 * cada tela assine o `AppState` por conta própria e uma esqueça de desligar. A sincronização
 * só acontece com a tela de sincronização aberta, nunca em segundo plano.
 */
export class AppLifecycle {
    private readonly listeners = new Set<LifecycleListener>();
    private foreground = true;

    /**
     * @param listener Quem quer saber das trocas de estado.
     * @return Função que cancela a inscrição.
     */
    public subscribe(listener: LifecycleListener): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    /**
     * Repassa a troca de estado do sistema. `inactive` (a gaveta de notificações aberta, a troca
     * de apps em andamento) não conta como saída: o app ainda está visível.
     *
     * @param state Estado informado pelo `AppState`.
     */
    public update(state: AppStateStatus): void {
        const foreground = state === 'active' || state === 'inactive';
        if (foreground === this.foreground) {
            return;
        }
        this.foreground = foreground;
        for (const listener of this.listeners) {
            if (foreground) {
                listener.onForeground();
            } else {
                listener.onBackground();
            }
        }
    }
}

const LifecycleContext = createContext<AppLifecycle | null>(null);

/**
 * Liga o `AppState` ao `AppLifecycle` na raiz do app, uma vez.
 *
 * @param props.children O app.
 * @return A árvore com o ciclo de vida disponível.
 */
export function AppLifecycleRoot({ children }: { readonly children: ReactNode }): ReactNode {
    const [lifecycle] = useState(() => new AppLifecycle());
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (state) => {
            lifecycle.update(state);
        });
        return () => {
            subscription.remove();
        };
    }, [lifecycle]);
    return <LifecycleContext value={lifecycle}>{children}</LifecycleContext>;
}

/**
 * @return O ciclo de vida da raiz.
 * @throws {Error} Fora do `AppLifecycleRoot`.
 */
export function useAppLifecycle(): AppLifecycle {
    const lifecycle = useContext(LifecycleContext);
    if (lifecycle === null) {
        throw new Error('useAppLifecycle precisa do AppLifecycleRoot acima na árvore');
    }
    return lifecycle;
}

import { Component, useSyncExternalStore, type ErrorInfo, type ReactNode } from 'react';
import { type FailureStore, unexpectedRendererFailure } from '../lib/failures.ts';
import { ErrorScreen } from '../screens/ErrorScreen.tsx';

/** Propriedades da barreira de erro. */
interface ErrorBoundaryProps {
    readonly store: FailureStore;
    readonly children: ReactNode;
}

/**
 * Barreira de erro do React. Precisa ser classe: é a única forma que o React oferece de pegar
 * exceção lançada durante a renderização. Sem ela, um erro numa tela desmontaria a árvore
 * inteira e deixaria a janela em branco, sem explicação nem como relatar.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, { readonly failed: boolean }> {
    public override state = { failed: false };

    /**
     * @return O estado de falha, para não renderizar de novo a árvore que acabou de lançar.
     */
    public static getDerivedStateFromError(): { readonly failed: boolean } {
        return { failed: true };
    }

    /**
     * Registra a falha com a pilha de componentes, que mostra em que tela o erro nasceu.
     *
     * @param error O que a renderização lançou.
     * @param info Pilha de componentes do React.
     */
    public override componentDidCatch(error: unknown, info: ErrorInfo): void {
        const failure = unexpectedRendererFailure(error);
        this.props.store.report({ ...failure, details: `${failure.details}\n\nComponentes:${info.componentStack ?? ''}` });
    }

    /** @return Os filhos, ou nada depois da falha — a tela de erro vem do `FailureGate`. */
    public override render(): ReactNode {
        return this.state.failed ? null : this.props.children;
    }
}

/**
 * Raiz que troca o app pela tela de erro assim que qualquer falha fatal é registrada, venha
 * ela da renderização, de uma promessa solta, do núcleo ou do processo principal. Um ponto
 * só de decisão garante que nenhum caminho de erro deixe o app aberto num estado desconhecido.
 *
 * @param props.store Registro de falhas.
 * @param props.children O app.
 * @return O app, ou a tela de erro.
 */
export function FailureGate({ store, children }: ErrorBoundaryProps): ReactNode {
    const failure = useSyncExternalStore(store.subscribe, store.snapshot);
    if (failure !== null) {
        return <ErrorScreen failure={failure} />;
    }
    return <ErrorBoundary store={store}>{children}</ErrorBoundary>;
}

import { createContext, useContext, type ReactNode } from 'react';
import type { CoreClient } from '../core/CoreClient.ts';

const CoreClientContext = createContext<CoreClient | null>(null);

/**
 * Injeta o `CoreClient` da plataforma na árvore: a raiz do app escolhe a implementação
 * (IPC no desktop, direta no mobile) e nenhum hook sabe qual é (desktop-shell-design §5.1).
 *
 * @param props.client Implementação do núcleo para esta plataforma.
 * @param props.children Árvore que usa os hooks de dados.
 * @return O provedor do contexto.
 */
export function CoreClientProvider({ client, children }: { readonly client: CoreClient; readonly children: ReactNode }): ReactNode {
    return <CoreClientContext value={client}>{children}</CoreClientContext>;
}

/**
 * @return O `CoreClient` injetado pela raiz.
 * @throws {Error} Quando chamado fora de `CoreClientProvider` — um erro de montagem do app,
 * que precisa aparecer no primeiro render e não como consulta eternamente carregando.
 */
export function useCoreClient(): CoreClient {
    const client = useContext(CoreClientContext);
    if (client === null) {
        throw new Error('useCoreClient precisa de um CoreClientProvider acima na árvore');
    }
    return client;
}

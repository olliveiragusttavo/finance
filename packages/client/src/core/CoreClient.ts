import type { CoreApi, CoreInput, CoreOutput, CoreResult, CoreRoute } from '@finance/core';

/**
 * O núcleo como a UI o enxerga (desktop-shell-design §5.1). Hooks, view-models e telas só
 * conhecem esta interface; trocar de plataforma é trocar a implementação injetada na raiz do
 * app — `IpcCoreClient` no desktop, `DirectCoreClient` no mobile e nos testes.
 */
export interface CoreClient {
    /**
     * @param route Rota do mapa de rotas do núcleo.
     * @param input Entrada da rota; o núcleo valida de novo do outro lado da fronteira.
     * @return O resultado da rota. Falha esperada vem como `{ ok: false }`, nunca como
     * exceção, porque o IPC perderia a classe do erro (desktop-shell-design §5.3).
     */
    call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>>;
}

/**
 * Chamada direta ao núcleo no mesmo processo: a implementação do mobile, onde o núcleo roda
 * na thread JavaScript, e a dos testes do `client`, que exercitam hooks e view-models contra
 * SQLite em memória sem abrir o Electron (desktop-mvp-plan §4).
 */
export class DirectCoreClient implements CoreClient {
    /**
     * @param core Núcleo montado por `createCore`; só o `call` tipado é usado, para que o
     * cliente não tenha acesso aos Services por baixo da fronteira.
     */
    public constructor(private readonly core: Pick<CoreApi, 'call'>) {}

    /**
     * @param route Rota chamada.
     * @param input Entrada da rota.
     * @return O resultado da rota, como o núcleo devolveu.
     */
    public call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>> {
        return this.core.call(route, input);
    }
}

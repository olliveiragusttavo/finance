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
 * Decide quando uma chamada ao núcleo roda. Recebe o trabalho e o executa uma vez, agora ou
 * mais tarde; a ordem de chegada precisa ser mantida, porque uma escrita seguida de uma
 * leitura da mesma tela não pode inverter.
 */
export type CoreCallScheduler = (task: () => void) => void;

/** Executa na hora: o padrão dos testes e de quem não divide a thread com a tela. */
const runNow: CoreCallScheduler = (task) => {
    task();
};

/**
 * Chamada direta ao núcleo no mesmo processo: a implementação do mobile, onde o núcleo roda
 * na thread JavaScript, e a dos testes do `client`, que exercitam hooks e view-models contra
 * SQLite em memória sem abrir o Electron (desktop-mvp-plan §4).
 *
 * No celular, o núcleo e a tela dividem a thread JavaScript, e a chamada síncrona ao SQLite a
 * bloqueia (mobile-shell-design §4.3). O `schedule` deixa a raiz do app adiar a chamada para
 * depois do frame corrente: o toque desenha o retorno visual (botão pressionado, folha
 * fechando) antes de a thread parar no banco, em vez de o app parecer travado.
 */
export class DirectCoreClient implements CoreClient {
    /**
     * @param core Núcleo montado por `createCore`; só o `call` tipado é usado, para que o
     * cliente não tenha acesso aos Services por baixo da fronteira.
     * @param schedule Quando cada chamada roda; na hora, por padrão. O mobile passa um
     * agendador pós-frame.
     */
    public constructor(
        private readonly core: Pick<CoreApi, 'call'>,
        private readonly schedule: CoreCallScheduler = runNow,
    ) {}

    /**
     * @param route Rota chamada.
     * @param input Entrada da rota.
     * @return O resultado da rota, como o núcleo devolveu, quando o agendador a executar.
     */
    public call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>> {
        return new Promise((resolve, reject) => {
            this.schedule(() => {
                this.core.call(route, input).then(resolve, reject);
            });
        });
    }
}

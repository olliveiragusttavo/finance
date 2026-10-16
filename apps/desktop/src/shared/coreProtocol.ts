import type { CoreInput, CoreOutput, CoreResult, CoreRoute } from '@finance/core';
import type { CoreClient } from '@finance/client';

/**
 * Uma ponta de canal de mensagens, do jeito que este protocolo precisa dela. Existe porque
 * cada lado tem um `MessagePort` diferente — o do DOM no preload, o `MessagePortMain` do
 * Electron no `utilityProcess` e o do `worker_threads` nos testes —, e a correlação de
 * requisição e resposta é a mesma nos três.
 */
export interface MessageEndpoint {
    /**
     * @param message Mensagem serializável por structured clone.
     */
    postMessage(message: unknown): void;

    /**
     * @param listener Recebe cada mensagem que chega, ainda não validada.
     */
    onMessage(listener: (message: unknown) => void): void;
}

/** Pedido de uma rota, do renderer ao `utilityProcess`. */
export interface CoreRequestMessage {
    readonly kind: 'core.request';
    /** Número de correlação: as respostas podem chegar fora de ordem. */
    readonly id: number;
    readonly route: string;
    readonly input: unknown;
}

/** Resposta de uma rota, do `utilityProcess` ao renderer. */
export interface CoreResponseMessage {
    readonly kind: 'core.response';
    readonly id: number;
    readonly result: CoreResult<unknown>;
}

/** Erro devolvido às chamadas pendentes quando o processo do núcleo cai ou o canal fecha. */
const TRANSPORT_CLOSED: CoreResult<never> = {
    ok: false,
    error: { code: 'INTERNAL', message: 'Canal com o núcleo fechado', details: { reason: 'transport-closed' } },
};

/**
 * `CoreClient` do desktop sobre um `MessagePort` (desktop-shell-design §5.2): o renderer fala
 * direto com o `utilityProcess`, sem passar pelo processo principal. Cada chamada leva um
 * número de correlação, porque o canal é um só e as respostas não têm ordem garantida.
 *
 * As chamadas feitas antes de a ponta chegar (o preload roda antes de o processo principal
 * entregar o `MessagePort`) ficam numa fila e saem quando ela é conectada.
 */
export class IpcCoreClient implements CoreClient {
    private nextId = 1;
    private endpoint: MessageEndpoint | null = null;
    private closed = false;
    private readonly queued: CoreRequestMessage[] = [];
    private readonly pending = new Map<number, (result: CoreResult<never>) => void>();

    /**
     * Liga o cliente a uma ponta do canal e envia o que estava na fila.
     *
     * @param endpoint Ponta entregue pelo processo principal.
     */
    public connect(endpoint: MessageEndpoint): void {
        this.endpoint = endpoint;
        endpoint.onMessage((message) => {
            this.receive(message);
        });
        for (const request of this.queued.splice(0)) {
            endpoint.postMessage(request);
        }
    }

    /**
     * @param route Rota chamada.
     * @param input Entrada da rota; o núcleo a valida de novo do outro lado.
     * @return O resultado da rota; `INTERNAL` com `transport-closed` quando o processo do
     * núcleo caiu — a tela mostra erro em vez de ficar carregando para sempre.
     */
    public call<R extends CoreRoute>(route: R, input: CoreInput<R>): Promise<CoreResult<CoreOutput<R>>> {
        if (this.closed) {
            return Promise.resolve(TRANSPORT_CLOSED);
        }
        const request: CoreRequestMessage = { kind: 'core.request', id: this.nextId++, route, input };
        return new Promise((resolve) => {
            this.pending.set(request.id, resolve);
            if (this.endpoint === null) {
                this.queued.push(request);
            } else {
                this.endpoint.postMessage(request);
            }
        });
    }

    /**
     * Encerra o cliente quando o processo do núcleo cai: toda chamada pendente ou futura
     * recebe o erro de transporte.
     */
    public close(): void {
        this.closed = true;
        this.queued.length = 0;
        for (const resolve of this.pending.values()) {
            resolve(TRANSPORT_CLOSED);
        }
        this.pending.clear();
    }

    /**
     * @param message Mensagem recebida; ignorada quando não é uma resposta pendente, porque
     * uma resposta duplicada ou atrasada não pode resolver outra chamada.
     */
    private receive(message: unknown): void {
        if (!isCoreResponse(message)) {
            return;
        }
        const resolve = this.pending.get(message.id);
        if (resolve !== undefined) {
            this.pending.delete(message.id);
            resolve(message.result);
        }
    }
}

/**
 * Confere o envelope da resposta. O conteúdo de `data` não é validado aqui: quem responde é o
 * `core.dispatch` da mesma versão do app, que devolve para cada rota o tipo do mapa de rotas.
 * Por isso o envelope é declarado como `CoreResult<never>`, que o compilador aceita como o
 * resultado de qualquer rota.
 *
 * @param message Mensagem recebida do canal.
 * @return `true` quando é uma resposta com número de correlação e resultado bem formado.
 */
export function isCoreResponse(message: unknown): message is CoreResponseMessage & { readonly result: CoreResult<never> } {
    if (typeof message !== 'object' || message === null || !('kind' in message) || message.kind !== 'core.response') {
        return false;
    }
    if (!('id' in message) || typeof message.id !== 'number' || !('result' in message)) {
        return false;
    }
    const { result } = message;
    return typeof result === 'object' && result !== null && 'ok' in result && typeof result.ok === 'boolean';
}

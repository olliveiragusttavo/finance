import type { CoreApi } from '@finance/core';
import { z } from 'zod';
import type { CoreResponseMessage, MessageEndpoint } from '../shared/coreProtocol.ts';

/**
 * Formato do pedido. O renderer é entrada não confiável (desktop-shell-design §3.6): a
 * mensagem é validada antes de chegar ao núcleo, que valida a entrada da rota de novo.
 */
const requestSchema = z.strictObject({
    kind: z.literal('core.request'),
    id: z.number().int().positive(),
    route: z.string().max(100),
    input: z.unknown(),
});

/**
 * Atende os pedidos de uma ponta do canal com o `dispatch` do núcleo. O `dispatch` não
 * tipado é o certo aqui: a rota chega como texto, e uma rota desconhecida vira
 * `VALIDATION_FAILED` dentro do núcleo, não uma exceção neste processo.
 *
 * @param endpoint Ponta do canal ligada a uma janela.
 * @param core Despacho do núcleo.
 * @param onInvalid Recebe as mensagens fora do protocolo, para o log; elas são descartadas
 * porque sem um id válido não há a quem responder.
 */
export function serveCore(endpoint: MessageEndpoint, core: Pick<CoreApi, 'dispatch'>, onInvalid: (message: unknown) => void): void {
    endpoint.onMessage((message) => {
        const parsed = requestSchema.safeParse(message);
        if (!parsed.success) {
            onInvalid(message);
            return;
        }
        const { id, route, input } = parsed.data;
        void core.dispatch(route, input).then((result) => {
            const response: CoreResponseMessage = { kind: 'core.response', id, result };
            endpoint.postMessage(response);
        });
    });
}

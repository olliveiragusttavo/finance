import type { CoreError, CoreRoute, ErrorCode, ErrorDetails } from '@finance/core';

/**
 * Falha de uma rota do núcleo transformada em exceção do lado da UI. O núcleo devolve erro
 * como dado (desktop-shell-design §5.3), mas o TanStack Query só entra no estado de erro
 * quando a função da consulta rejeita — esta classe é a ponte, e carrega o `CoreError`
 * inteiro para que a tela trate o código de forma exaustiva em vez de ler a mensagem.
 */
export class CoreCallError extends Error {
    /**
     * @param route Rota que falhou; entra na mensagem técnica para o log apontar a origem.
     * @param error Erro como atravessou a fronteira: código fechado, mensagem técnica e detalhes.
     */
    public constructor(public readonly route: CoreRoute, public readonly error: CoreError) {
        super(`${route}: ${error.message}`);
        this.name = 'CoreCallError';
    }

    /** @return O código fechado do erro, para o `switch` exaustivo da tela. */
    public get code(): ErrorCode {
        return this.error.code;
    }

    /** @return Os detalhes estruturados do erro (campo, regra, entidade). */
    public get details(): ErrorDetails {
        return this.error.details;
    }
}

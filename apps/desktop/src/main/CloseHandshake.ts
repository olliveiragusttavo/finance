/** O processo do núcleo não confirmou o fechamento do banco dentro do prazo. */
export class DatabaseCloseTimeoutError extends Error {
    /**
     * @param timeoutMs Prazo esgotado, para o log.
     */
    public constructor(timeoutMs: number) {
        super(`O processo do núcleo não fechou o banco em ${String(timeoutMs)} ms`);
        this.name = 'DatabaseCloseTimeoutError';
    }
}

/**
 * Pedido de fechamento do banco ao processo do núcleo, à espera da confirmação. Existe
 * separado do `CoreProcess` porque a espera tinha três jeitos de nunca acabar — o processo já
 * morto, o processo travado e dois pedidos ao mesmo tempo, em que o segundo apagava o aviso
 * do primeiro —, e cada um deixava a tela de restauração parada em "restaurando" sem saída.
 *
 * Processo encerrado conta como banco fechado: o SQLite solta o arquivo junto com o processo.
 */
export class CloseHandshake {
    private exited = false;
    private closed = false;
    private waiting: Promise<void> | null = null;
    private confirmWaiting: (() => void) | null = null;

    /**
     * @param timeoutMs Prazo para a confirmação; sem ele, um núcleo travado prenderia a tela.
     */
    public constructor(private readonly timeoutMs: number) {}

    /**
     * Pede o fechamento, ou reaproveita o pedido em andamento.
     *
     * @param send Envia o pedido ao processo do núcleo; chamado no máximo uma vez por pedido.
     * @return Promessa resolvida quando o banco foi fechado ou o processo terminou.
     * @throws {DatabaseCloseTimeoutError} (na promessa) Quando o prazo esgota; um novo pedido
     * pode ser feito depois.
     */
    public request(send: () => void): Promise<void> {
        if (this.exited || this.closed) {
            return Promise.resolve();
        }
        this.waiting ??= new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.confirmWaiting = null;
                this.waiting = null;
                reject(new DatabaseCloseTimeoutError(this.timeoutMs));
            }, this.timeoutMs);
            this.confirmWaiting = (): void => {
                clearTimeout(timer);
                this.confirmWaiting = null;
                resolve();
            };
            send();
        });
        return this.waiting;
    }

    /** O processo do núcleo confirmou que fechou a conexão. */
    public confirm(): void {
        this.closed = true;
        this.confirmWaiting?.();
    }

    /** O processo do núcleo terminou; a conexão foi junto. */
    public processExited(): void {
        this.exited = true;
        this.confirmWaiting?.();
    }
}

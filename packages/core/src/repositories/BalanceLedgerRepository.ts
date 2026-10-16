import type { InvoiceTypeTotals, MovementSources } from '../domain/balance/MonthlyMovement.ts';
import type { Currency } from '../domain/shared/Currency.ts';
import type { AccountId, CreditCardId, InvoiceId } from '../domain/shared/ids.ts';
import type { YearMonth } from '../domain/shared/YearMonth.ts';

/**
 * Consultas agregadas da rotina de recálculo. Separadas dos Repositories de entidade
 * porque não devolvem entidades, e sim somas: a agregação roda no código C do SQLite
 * (`SUM` por contêiner mensal) e o núcleo só aplica as regras sobre os totais
 * (backend-design §3.2).
 */
export interface BalanceLedgerRepository {
    /**
     * @param accountId Conta recalculada.
     * @param from Primeira competência considerada.
     * @param currency Moeda do perfil, em que todas as somas estão denominadas.
     * @return As somas que formam o movimento mensal da conta a partir de `from`.
     */
    movementSources(accountId: AccountId, from: YearMonth, currency: Currency): MovementSources;

    /**
     * @param invoiceId Fatura recalculada.
     * @param currency Moeda do perfil.
     * @return As somas por tipo das transações vivas da fatura.
     */
    invoiceTypeTotals(invoiceId: InvoiceId, currency: Currency): readonly InvoiceTypeTotals[];

    /**
     * Somas por tipo das faturas de um cartão **depois** de uma competência, sem as ocorrências
     * de séries fixas — o que já está comprometido nelas (compras avulsas e parcelas). Base do
     * limite usado (`CreditCardService.list`).
     *
     * @param creditCardId Cartão consultado.
     * @param after Competência a partir da qual (exclusive) as faturas entram.
     * @param currency Moeda do perfil.
     * @return As somas de cada fatura viva posterior; a fatura sem lançamento comprometido fica
     * fora do mapa.
     */
    committedInvoiceTypeTotals(creditCardId: CreditCardId, after: YearMonth, currency: Currency): ReadonlyMap<InvoiceId, readonly InvoiceTypeTotals[]>;
}

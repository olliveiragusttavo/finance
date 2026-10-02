import type { CreditCard } from '../domain/creditCard/CreditCard.ts';
import type { CreditCardId } from '../domain/shared/ids.ts';

/** Acesso aos cartões de crédito. Só leitura nesta camada de lançamentos. */
export interface CreditCardRepository {
    /**
     * @param id Cartão procurado.
     * @return O cartão vivo, ou `null` quando não existe ou foi excluído.
     */
    findById(id: CreditCardId): CreditCard | null;
}

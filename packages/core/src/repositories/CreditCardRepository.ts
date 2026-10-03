import type { CreditCard } from '../domain/creditCard/CreditCard.ts';
import type { CreditCardId, ProfileId } from '../domain/shared/ids.ts';

/** Acesso aos cartões de crédito. */
export interface CreditCardRepository {
    /**
     * @param id Cartão procurado.
     * @return O cartão vivo, ativo ou desativado, ou `null` quando não existe ou foi excluído.
     */
    findById(id: CreditCardId): CreditCard | null;

    /**
     * @param profileId Perfil dono dos cartões.
     * @return Os cartões vivos do perfil, ativos e desativados, por nome.
     */
    listByProfile(profileId: ProfileId): readonly CreditCard[];

    /**
     * Insere o cartão novo ou regrava os dados do usuário de um existente.
     *
     * @param creditCard Cartão a gravar.
     * @return void
     */
    save(creditCard: CreditCard): void;
}

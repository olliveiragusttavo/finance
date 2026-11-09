import type { Profile } from '../domain/profile/Profile.ts';
import type { AccountId, CreditCardId, ProfileId } from '../domain/shared/ids.ts';

/** Acesso aos perfis. */
export interface ProfileRepository {
    /**
     * @param id Perfil procurado.
     * @return O perfil vivo, ou `null` quando não existe ou foi excluído.
     */
    findById(id: ProfileId): Profile | null;

    /**
     * @return Os perfis vivos, por nome — a lista do seletor de perfil.
     */
    list(): readonly Profile[];

    /**
     * Insere o perfil novo ou regrava os dados do usuário de um existente. Um único método
     * porque o perfil não tem cache derivado: tudo nele é dado do usuário.
     *
     * @param profile Perfil a gravar.
     * @return void
     */
    save(profile: Profile): void;

    /**
     * Grava a conta padrão à parte do `save`, porque a leitura só devolve o padrão que ainda vale
     * (conta viva e ativa): regravar o perfil inteiro apagaria a escolha de uma conta apenas
     * desativada, que reativar deve devolver.
     *
     * @param id Perfil dono.
     * @param accountId Nova conta padrão, já conferida pelo Service; `null` tira o padrão.
     * @return void
     */
    setDefaultAccount(id: ProfileId, accountId: AccountId | null): void;

    /**
     * Grava o cartão padrão, pelo mesmo motivo do `setDefaultAccount`.
     *
     * @param id Perfil dono.
     * @param creditCardId Novo cartão padrão, já conferido pelo Service; `null` tira o padrão.
     * @return void
     */
    setDefaultCreditCard(id: ProfileId, creditCardId: CreditCardId | null): void;

    /**
     * @param id Perfil consultado.
     * @return `true` quando o perfil tem ao menos uma transação viva, ou recebe uma
     * transferência de outro perfil; é o que torna a troca de moeda insegura, porque os
     * valores lançados ficariam com a unidade errada.
     */
    hasTransactions(id: ProfileId): boolean;
}

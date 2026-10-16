import type { TransferTargetResponse } from '@finance/core';

/** Conta de outro perfil, como as telas a recebem de `accounts.transferTargets`. */
export type OtherProfileAccount = Pick<TransferTargetResponse, 'id' | 'name' | 'profileName'>;

/**
 * Nome de uma conta de outro perfil com o perfil entre parênteses — "Nubank (Empresa)". O
 * nome sozinho é ambíguo, porque os dois perfis costumam ter contas no mesmo banco, e numa
 * transferência entre perfis o usuário precisa ver de que lado o dinheiro está.
 *
 * @param account Conta de outro perfil.
 * @return O rótulo da conta com o perfil.
 */
export function otherProfileAccountLabel(account: OtherProfileAccount): string {
    return `${account.name} (${account.profileName})`;
}

/**
 * Índice dos rótulos das contas de outros perfis, para os view-models que nomeiam o outro
 * lado de uma transferência entre perfis sem uma busca linear por linha.
 *
 * @param accounts Contas de outros perfis; ausente quando a tela não as carregou.
 * @return Os rótulos por id da conta; vazio sem contas.
 */
export function otherProfileAccountNames(accounts: readonly OtherProfileAccount[] | undefined): ReadonlyMap<string, string> {
    return new Map((accounts ?? []).map((account) => [account.id, otherProfileAccountLabel(account)]));
}

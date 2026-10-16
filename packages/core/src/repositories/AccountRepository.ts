import type { Account } from '../domain/account/Account.ts';
import type { AccountId, ProfileId } from '../domain/shared/ids.ts';

/** Acesso às contas. */
export interface AccountRepository {
    /**
     * @param id Conta procurada.
     * @return A conta viva, ou `null` quando não existe ou foi excluída.
     */
    findById(id: AccountId): Account | null;

    /**
     * @param profileId Perfil dono das contas.
     * @return As contas vivas do perfil, ativas e desativadas, por nome — desativada
     * continua nos saldos e nos relatórios (desktop-mvp-plan §5.1).
     */
    listByProfile(profileId: ProfileId): readonly Account[];

    /**
     * Existe para a verificação de integridade na abertura, que confere o banco inteiro e
     * não um perfil: um desvio no perfil que o usuário não abriu hoje é o mesmo bug.
     *
     * @return As contas vivas de todos os perfis vivos, em ordem estável de id.
     */
    listAll(): readonly Account[];

    /**
     * Insere a conta nova ou regrava os dados do usuário de uma existente — nome, tipo,
     * rótulo de moeda, "considerar no saldo", saldo inicial e desativação. Nunca toca o cache
     * de saldo de uma conta existente, que é só da rotina de recálculo.
     *
     * @param account Conta a gravar; numa inserção, o cache dela é gravado como o inicial.
     * @return void
     */
    save(account: Account): void;

    /**
     * Grava só o cache de saldo. Separado de uma gravação completa porque a rotina de
     * recálculo nunca pode tocar dados do usuário, como o `opening_balance`.
     *
     * @param account Conta com o cache recalculado.
     * @return void
     */
    saveBalances(account: Account): void;
}

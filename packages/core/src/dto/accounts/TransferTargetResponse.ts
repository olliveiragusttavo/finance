import type { TransferTarget } from '../../services/account/AccountViews.ts';

/**
 * Conta de outro perfil oferecida como destino de transferência. Só o necessário para a
 * escolha e para o nome nas listas: o saldo e o cadastro de uma conta de outro perfil não
 * são da conta deste perfil, e expô-los aqui convidaria a tela a mostrá-los.
 */
export interface TransferTargetResponse {
    readonly id: string;
    readonly name: string;
    readonly disabled: boolean;
    readonly profileId: string;
    readonly profileName: string;
}

/**
 * @param target Conta e perfil dono, montados pelo Service.
 * @return A conta serializável, com o nome do perfil para a UI agrupar e rotular.
 */
export function toTransferTargetResponse(target: TransferTarget): TransferTargetResponse {
    return {
        id: target.account.id,
        name: target.account.name,
        disabled: target.account.disabled,
        profileId: target.profile.id,
        profileName: target.profile.name,
    };
}

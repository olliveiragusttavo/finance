import { toAccountListResponse, type AccountListResponse } from '../dto/accounts/AccountListResponse.ts';
import { toAccountResponse, type AccountResponse } from '../dto/accounts/AccountResponse.ts';
import { toAccountDeletionImpactResponse, type AccountDeletionImpactResponse } from '../dto/deletion/DeletionImpactResponse.ts';
import { accountIdRequest, createAccountRequest, listAccountsRequest, updateAccountRequest } from '../requests/accountRequests.ts';
import type { AccountService } from '../services/account/AccountService.ts';
import type { CascadeDeletionService } from '../services/deletion/CascadeDeletionService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas do cadastro de contas, incluindo o alerta e a exclusão em cadeia. */
export class AccountController {
    /**
     * @param accounts Cadastro de contas.
     * @param deletions Alerta e exclusão em cadeia.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly accounts: AccountService,
        private readonly deletions: CascadeDeletionService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil e o mês de referência.
     * @return As contas com o fechamento do mês e o total.
     */
    public list(raw: unknown): Promise<CoreResult<AccountListResponse>> {
        return handle(listAccountsRequest, raw, ({ profileId, period }) => toAccountListResponse(this.accounts.list(profileId, period)), this.onUnexpected);
    }

    /**
     * @param raw Entrada do formulário de conta nova.
     * @return A conta criada.
     */
    public create(raw: unknown): Promise<CoreResult<AccountResponse>> {
        return handle(createAccountRequest, raw, (command) => toAccountResponse(this.accounts.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada do formulário de edição, completa.
     * @return A conta editada.
     */
    public update(raw: unknown): Promise<CoreResult<AccountResponse>> {
        return handle(updateAccountRequest, raw, (command) => toAccountResponse(this.accounts.update(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da conta.
     * @return A conta desativada.
     */
    public disable(raw: unknown): Promise<CoreResult<AccountResponse>> {
        return handle(accountIdRequest, raw, ({ id }) => toAccountResponse(this.accounts.disable(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da conta.
     * @return A conta reativada.
     */
    public enable(raw: unknown): Promise<CoreResult<AccountResponse>> {
        return handle(accountIdRequest, raw, ({ id }) => toAccountResponse(this.accounts.enable(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da conta.
     * @return O que a exclusão apagaria e as outras contas cujo saldo mudaria.
     */
    public deletionImpact(raw: unknown): Promise<CoreResult<AccountDeletionImpactResponse>> {
        return handle(accountIdRequest, raw, ({ id }) => toAccountDeletionImpactResponse(this.deletions.accountImpact(id)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o id da conta.
     * @return `null` em caso de sucesso — não há o que devolver de uma conta excluída.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(accountIdRequest, raw, ({ id }) => {
            this.deletions.deleteAccount(id);
            return null;
        }, this.onUnexpected);
    }
}

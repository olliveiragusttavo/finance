import { toAccountBalanceResponse, type AccountBalanceResponse } from '../dto/accounts/AccountBalanceResponse.ts';
import { toProfileBalancesResponse, type ProfileBalancesResponse } from '../dto/profiles/ProfileBalancesResponse.ts';
import { toStatementResponse, type StatementResponse } from '../dto/statements/StatementResponse.ts';
import { profileBalancesRequest, rebuildAccountRequest } from '../requests/balanceRequests.ts';
import { getStatementRequest } from '../requests/statementRequests.ts';
import type { AccountBalanceService } from '../services/balance/AccountBalanceService.ts';
import type { StatementConsolidationService } from '../services/statement/StatementConsolidationService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas de leitura de saldo: extrato consolidado do mês e saldos do perfil. */
export class StatementController {
    /**
     * @param consolidation Monta o extrato consolidado.
     * @param balances Saldos do perfil e reparo.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly consolidation: StatementConsolidationService,
        private readonly balances: AccountBalanceService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com a conta e o mês.
     * @return O extrato consolidado do mês.
     */
    public getStatement(raw: unknown): Promise<CoreResult<StatementResponse>> {
        return handle(
            getStatementRequest,
            raw,
            ({ accountId, period }) => toStatementResponse(this.consolidation.getStatement(accountId, period)),
            this.onUnexpected,
        );
    }

    /**
     * @param raw Entrada com o perfil.
     * @return Os saldos de cada conta e o total do perfil.
     */
    public profileBalances(raw: unknown): Promise<CoreResult<ProfileBalancesResponse>> {
        return handle(profileBalancesRequest, raw, ({ profileId }) => toProfileBalancesResponse(this.balances.profileBalances(profileId)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a conta.
     * @return A conta com os saldos reconstruídos do zero.
     */
    public rebuildAccount(raw: unknown): Promise<CoreResult<AccountBalanceResponse>> {
        return handle(rebuildAccountRequest, raw, ({ accountId }) => toAccountBalanceResponse(this.balances.rebuildAccount(accountId)), this.onUnexpected);
    }
}

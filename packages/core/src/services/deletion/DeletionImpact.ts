import type { Account } from '../../domain/account/Account.ts';
import type { DeletionScope } from '../../repositories/DeletionRepository.ts';

/**
 * O que uma exclusão em cadeia vai apagar e quais **outras** contas mudam de saldo — o
 * conteúdo do alerta antes da confirmação (desktop-mvp-plan §5.1). Fica fora do arquivo do
 * `CascadeDeletionService` para que a camada DTO dependa só do contrato de saída.
 */
export interface DeletionImpact {
    readonly scope: DeletionScope;
    /** Contas que sobrevivem à exclusão e cujo saldo vai mudar, por nome. */
    readonly affectedAccounts: readonly Account[];
}

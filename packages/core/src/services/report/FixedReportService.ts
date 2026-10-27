import {
    BALANCE_PROJECTION_MONTHS,
    buildBalanceProjection,
    projectionBasisMonths,
    type BalanceProjection,
    type BalanceProjectionBasis,
} from '../../domain/report/BalanceProjection.ts';
import { buildPartnerReport, type PartnerReport } from '../../domain/report/PartnerReport.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { BusinessRuleViolation } from '../../domain/shared/errors.ts';
import type { ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { FixedReportRepository } from '../../repositories/FixedReportRepository.ts';
import type { PartnerRepository } from '../../repositories/PartnerRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { AccountBalanceService } from '../balance/AccountBalanceService.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { EntriesWithoutPartnerView } from './FixedReportViews.ts';

/**
 * Relatórios fixos (reports-design §8 e §9): os que ficam no topo da lista de Relatórios e não se
 * montam no editor, porque cada um responde uma pergunta própria — a divisão dos aportes pela
 * participação dos sócios e a projeção do saldo —, que o filtro e o agrupamento não expressam.
 */
export class FixedReportService {
    /**
     * @param unitOfWork Leitura numa transação só, para que as somas e o saldo de partida vejam o
     * mesmo estado do banco.
     * @param clock Dá o dia de hoje, de onde a projeção parte.
     * @param profiles Confere o perfil e a moeda dele.
     * @param partners Sócios do perfil, que o relatório lista mesmo sem aporte.
     * @param transactions Entradas sem sócio, para a lista do relatório por sócio.
     * @param reports Somas dos relatórios fixos.
     * @param balances Saldo consolidado de hoje, o mesmo da tela de Contas.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly clock: Clock,
        private readonly profiles: ProfileService,
        private readonly partners: PartnerRepository,
        private readonly transactions: TransactionRepository,
        private readonly reports: FixedReportRepository,
        private readonly balances: AccountBalanceService,
    ) {}

    /**
     * Relatório por sócio: quanto cada sócio aportou, em todos os períodos, contra quanto deveria
     * pela participação no total de aportes, os números do mês e o acerto (reports-design §8, P1–P5).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência, que recorta os aportes e as entradas sem sócio do mês.
     * @return O relatório.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    public byPartner(profileId: ProfileId, reference: YearMonth): PartnerReport {
        return this.unitOfWork.run(() => {
            const profile = this.requireBusiness(profileId);
            return buildPartnerReport({
                reference,
                partners: this.partners.listByProfile(profileId),
                totals: this.reports.contributionTotalsByPartner(profileId, reference, profile.currency),
                zero: Money.zero(profile.currency),
            });
        });
    }

    /**
     * Entradas do mês sem sócio, para a lista em que a tela pede para atribuir as que são aporte —
     * com o mesmo critério das somas, para que a lista some o valor do indicador (P5). Cada entrada
     * vale o que pôs no saldo do perfil: a receita sem os encargos (`originEffect`), a
     * transferência pelo valor que chega (`destinationEffect`).
     *
     * @param profileId Perfil consultado.
     * @param reference Mês de referência.
     * @return As entradas e o total delas.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    public entriesWithoutPartner(profileId: ProfileId, reference: YearMonth): EntriesWithoutPartnerView {
        return this.unitOfWork.run(() => {
            const profile = this.requireBusiness(profileId);
            const transactions = this.transactions.listEntriesWithoutPartner(profileId, reference);
            const zero = Money.zero(profile.currency);
            return {
                period: reference,
                transactions,
                total: transactions.reduce((total, transaction) => total.add(transaction.type === 'income' ? transaction.originEffect() : transaction.destinationEffect() ?? zero), zero),
            };
        });
    }

    /**
     * Projeção de saldo (reports-design §9): o saldo consolidado de hoje, mais o que já está lançado
     * para cada mês (a variação do saldo previsto), mais a estimativa dos avulsos pela média dos
     * últimos meses fechados, com a faixa de incerteza. Vale para todo tipo de perfil. Não depende
     * do mês de referência da barra: projeta a partir de hoje, porque o saldo de partida é o de hoje.
     *
     * @param profileId Perfil consultado.
     * @param basis Quantos meses fechados formam a estimativa dos avulsos.
     * @return A projeção do fim do mês corrente e dos 12 meses seguintes.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public balanceProjection(profileId: ProfileId, basis: BalanceProjectionBasis): BalanceProjection {
        return this.unitOfWork.run(() => {
            const { profile, total } = this.balances.profileBalances(profileId);
            const today = this.clock.today();
            const firstPeriod = this.reports.firstStatementPeriod(profileId);
            const months = projectionBasisMonths(basis, today.period, firstPeriod);
            const from = months[0] ?? today.period;
            return buildBalanceProjection({
                basis,
                today,
                firstPeriod,
                histories: this.reports.closingHistories(profileId, from, today.period.plusMonths(BALANCE_PROJECTION_MONTHS), profile.currency),
                nonRecurring: this.reports.nonRecurringResults(profileId, from, today.period.previous(), profile.currency),
                start: total.consolidated,
                currency: profile.currency,
            });
        });
    }

    /**
     * Regra de negócio (Perfil): sócio só existe em perfil empresarial, e o relatório por sócio
     * não está disponível no pessoal (database-design §4.1). Recusar, em vez de devolver um
     * relatório vazio, impede que a tela mostre "nenhum sócio" num perfil em que sócio nem existe.
     *
     * @param profileId Perfil consultado.
     * @return O perfil empresarial.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    private requireBusiness(profileId: ProfileId): Profile {
        const profile = this.profiles.require(profileId);
        if (!profile.acceptsPartners()) {
            throw new BusinessRuleViolation('partner-requires-business-profile', 'o relatório por sócio só existe em perfil empresarial');
        }
        return profile;
    }
}

import { buildPendingSummary, nextInvoices, pendingInvoices, pendingUntil, type NextInvoicesSummary, type PendingInvoice, type PendingSummary } from '../../domain/overview/PendingItems.ts';
import { buildSpendingSummary, spendingWindow, type SpendingSummary } from '../../domain/overview/SpendingSummary.ts';
import type { ProfileId } from '../../domain/shared/ids.ts';
import { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { OverviewRepository } from '../../repositories/OverviewRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';

/**
 * Primeira competência possível, para buscar as faturas em aberto de qualquer época: um atraso
 * antigo continua atrasado e não pode sumir do selo por estar longe.
 */
const FIRST_PERIOD = YearMonth.of(1900, 1);

/**
 * Visão geral (mockup `DesktopVisaoGeral2`): as perguntas da tela que nenhuma outra rota responde —
 * quanto saiu e entrou no mês e para onde foi, o que está atrasado ou ainda vence no mês e a
 * próxima fatura de cada cartão. Os saldos, os cartões do mês e as metas vêm das rotas das
 * próprias telas, para que a Visão geral e cada tela nunca discordem.
 */
export class OverviewService {
    /**
     * @param unitOfWork Leitura numa transação só, para que as somas vejam o mesmo estado do banco.
     * @param clock Dá o dia de hoje, que decide o que está atrasado.
     * @param profiles Confere o perfil e dá a moeda dele.
     * @param overview Somas e lançamentos em aberto.
     * @param invoices Faturas em aberto do perfil.
     * @param accounts Nomes das contas que pagam os cartões.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly clock: Clock,
        private readonly profiles: ProfileService,
        private readonly overview: OverviewRepository,
        private readonly invoices: InvoiceRepository,
        private readonly accounts: AccountRepository,
    ) {}

    /**
     * Gastos dos seis meses até o de referência, entradas do mês e as maiores categorias. Depende do
     * mês de referência, e não de hoje, como o resto da tela que segue a barra do mês.
     *
     * @param profileId Perfil consultado.
     * @param period Mês de referência.
     * @return O resumo de gastos.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public spending(profileId: ProfileId, period: YearMonth): SpendingSummary {
        return this.unitOfWork.run(() => {
            const { currency } = this.profiles.require(profileId);
            const window = spendingWindow(period);
            return buildSpendingSummary({
                period,
                expensesByMonth: this.overview.expensesByMonth(profileId, window[0] ?? period, period, currency),
                income: this.overview.incomeOfMonth(profileId, period, currency),
                categories: this.overview.expensesByCategory(profileId, period, currency),
                currency,
            });
        });
    }

    /**
     * O selo de atrasados e o painel do que está em aberto. Parte de hoje, e não do mês de
     * referência: atraso é sempre em relação a hoje, em qualquer mês que a barra mostre.
     *
     * @param profileId Perfil consultado.
     * @return Os atrasados e o que ainda vence até o fim do mês de hoje.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public pending(profileId: ProfileId): PendingSummary {
        return this.unitOfWork.run(() => {
            const { currency } = this.profiles.require(profileId);
            const today = this.clock.today();
            const transactions = this.overview.pendingTransactions(profileId, pendingUntil(today), currency);
            return buildPendingSummary(today, [...transactions, ...this.openInvoices(profileId)], currency);
        });
    }

    /**
     * A próxima fatura em aberto de cada cartão, para o indicador "Próximas faturas" e o bloco de
     * cartões. Parte de hoje, como o selo de atrasados.
     *
     * @param profileId Perfil consultado.
     * @return A próxima fatura de cada cartão que tem valor a pagar.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public nextInvoices(profileId: ProfileId): NextInvoicesSummary {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            const today = this.clock.today();
            return { today, invoices: nextInvoices(today, this.openInvoices(profileId)) };
        });
    }

    /**
     * Faturas em aberto, de qualquer competência, dos cartões pagos por contas do perfil.
     * Regra de negócio (Cartões): o cartão desativado continua com as faturas, porque a dívida
     * não some ao desativar (desktop-mvp-plan §5.1).
     *
     * @param profileId Perfil consultado.
     * @return As faturas com valor a pagar e a conta pagadora de cada uma.
     */
    private openInvoices(profileId: ProfileId): readonly PendingInvoice[] {
        const names = new Map(this.accounts.listByProfile(profileId).map((account) => [account.id, account.name]));
        return pendingInvoices(
            this.invoices.listOpenByPayingProfile(profileId, FIRST_PERIOD).map((entry) => ({ ...entry, accountName: names.get(entry.creditCard.accountId) ?? '' })),
        );
    }
}

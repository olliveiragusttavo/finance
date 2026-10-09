import { NotFoundError } from '../../domain/shared/errors.ts';
import { TransactionId, type ProfileId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { Transaction } from '../../domain/transaction/Transaction.ts';
import type { TransactionContainer } from '../../domain/transaction/TransactionContainer.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { ImpactCalculator } from '../balance/ImpactCalculator.ts';
import type { RecurrenceService } from '../recurrence/RecurrenceService.ts';
import type { StatementConsolidationService } from '../statement/StatementConsolidationService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateTransactionCommand, EditScope, UpdateTransactionCommand } from './TransactionCommands.ts';
import type { TransactionComposer } from './TransactionComposer.ts';

/**
 * CRUD de transações. As regras de montar e conferir um lançamento ficam no
 * `TransactionComposer` (database-design §3.10), compartilhado com as recorrências. Toda
 * escrita grava, garante o contêiner e recalcula os saldos afetados numa única unidade de
 * trabalho: um saldo nunca fica visível pela metade.
 *
 * O que é de uma série — criar com repetição, editar e excluir em "esta e as futuras" ou
 * "todas" — é do `RecurrenceService` (database-design §4.12); aqui fica o lançamento avulso e
 * o escopo "somente esta".
 */
export class TransactionService {
    /**
     * @param unitOfWork Escrita e recálculo na mesma transação de banco.
     * @param ids Gera o UUID v4 da transação nova (database-design §3.5).
     * @param composer Regras de montar e conferir um lançamento.
     * @param accounts Conta do extrato ao marcar pago.
     * @param transactions Transações.
     * @param consolidation Garante o extrato do mês do pagamento.
     * @param recurrences Séries: repetição, escopos de série.
     * @param impacts Traduz o estado da transação nos saldos afetados.
     * @param recalculation A rotina única de recálculo.
     * @param clock "Hoje" do usuário, a data de pagamento do atalho de marcar pago.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly composer: TransactionComposer,
        private readonly accounts: AccountRepository,
        private readonly transactions: TransactionRepository,
        private readonly consolidation: StatementConsolidationService,
        private readonly recurrences: RecurrenceService,
        private readonly impacts: ImpactCalculator,
        private readonly recalculation: BalanceRecalculationService,
        private readonly clock: Clock,
    ) {}

    /**
     * Lança uma transação nova e recalcula os saldos que ela afeta. Com repetição, cria a série
     * (`RecurrenceService.createSeries`) e devolve a 1ª ocorrência.
     *
     * @param command Conteúdo validado pela camada Request, com o perfil dono.
     * @return A transação gravada, relida do banco (valores já arredondados).
     * @throws {NotFoundError} Quando o perfil ou alguma referência não existe.
     * @throws {BusinessRuleViolation} Quando uma regra de negócio é violada.
     */
    public create(command: CreateTransactionCommand): Transaction {
        if (command.repeat !== null) {
            return this.recurrences.createSeries(command, command.repeat);
        }
        return this.unitOfWork.run(() => {
            const profile = this.composer.requireProfile(command.profileId);
            this.composer.assertReferences(profile, command, null);
            const resolved = this.composer.resolveContainer(profile, command, null);
            const transaction = Transaction.create({
                ...this.composer.toContent(profile, command, resolved.container),
                id: TransactionId(this.ids.random()),
                profileId: profile.id,
                recurrenceId: null,
                occurrence: null,
            });
            this.transactions.insert(transaction);
            this.recalculation.apply(resolved.impact.merge(this.impacts.ofTransaction(transaction)));
            return this.composer.requireTransaction(transaction.id);
        });
    }

    /**
     * Edita uma transação e recalcula os saldos do estado antigo **e** do novo: mudar de mês,
     * de conta ou de fatura precisa recalcular os dois contêineres (backend-design §5.1). Os
     * escopos de série vão para o `RecurrenceService`; "somente esta" deixa a regra intocada.
     *
     * @param command Novo conteúdo completo, com o id da transação e o escopo.
     * @return A transação editada, relida do banco.
     * @throws {NotFoundError} Quando a transação ou alguma referência não existe.
     * @throws {BusinessRuleViolation} Quando uma regra de negócio é violada.
     */
    public update(command: UpdateTransactionCommand): Transaction {
        if (command.scope !== 'single') {
            return this.recurrences.update(command);
        }
        return this.unitOfWork.run(() => {
            const current = this.composer.requireTransaction(command.id);
            if (command.repeat !== null) {
                this.recurrences.assertSeriesUnchanged(current, command.repeat);
            }
            const profile = this.composer.requireProfile(current.profileId);
            // O impacto do estado antigo é calculado antes de qualquer escrita, enquanto a
            // fatura antiga ainda está no estado (pago ou em aberto) que pesava nos saldos.
            const before = this.impacts.ofTransaction(current);
            this.composer.assertReferences(profile, command, current);
            const resolved = this.composer.resolveContainer(profile, command, current);
            const revised = current.revise(this.composer.toContent(profile, command, resolved.container));
            this.transactions.update(revised);
            this.recalculation.apply(before.merge(resolved.impact).merge(this.impacts.ofTransaction(revised)));
            return this.composer.requireTransaction(revised.id);
        });
    }

    /**
     * Soft delete da transação e recálculo. Excluir um pagamento parcial de fatura devolve o
     * valor à conta e à fatura (database-design §4.7) — sai naturalmente do recálculo. Os
     * escopos de série vão para o `RecurrenceService`; "somente esta" exclui só a ocorrência, e
     * a marca d'água impede que o complemento a recrie (database-design §4.12).
     *
     * @param id Transação a excluir.
     * @param scope A quais ocorrências da série a exclusão se aplica.
     * @return void
     * @throws {NotFoundError} Quando a transação não existe ou já foi excluída.
     * @throws {BusinessRuleViolation} Quando pede um escopo de série num lançamento avulso.
     */
    public delete(id: TransactionId, scope: EditScope = 'single'): void {
        if (scope !== 'single') {
            this.recurrences.delete(id, scope);
            return;
        }
        this.unitOfWork.run(() => {
            const current = this.composer.requireTransaction(id);
            const impact = this.impacts.ofTransaction(current);
            this.transactions.softDelete(id);
            this.recalculation.apply(impact);
        });
    }

    /**
     * Marca ou desmarca o pagamento — o atalho `P` da tela de Transações.
     * Regra de negócio (Transações): marcar como paga usa a data de **hoje** como data de
     * pagamento, porque pago e data de pagamento andam juntos (brief §3, Transação); desmarcar
     * limpa a data. Regra de negócio (Extrato): numa transação de conta, a nova data decide o
     * extrato (`Transaction.cashDate`), então pagar em outro mês move a transação para o
     * extrato do pagamento, e desmarcar a devolve ao do vencimento. Recalcula o estado antigo
     * e o novo, como qualquer edição. Pedir o estado em que a transação já está não muda
     * nada — nem a data de um pagamento já registrado.
     *
     * @param id Transação a marcar.
     * @param paid `true` para paga, `false` para em aberto.
     * @return A transação com a situação pedida, relida do banco.
     * @throws {NotFoundError} Quando a transação não existe ou foi excluída.
     */
    public setPaid(id: TransactionId, paid: boolean): Transaction {
        return this.unitOfWork.run(() => {
            const current = this.composer.requireTransaction(id);
            if (current.isPaid() === paid) {
                return current;
            }
            const before = this.impacts.ofTransaction(current);
            const paymentDate = paid ? this.clock.today() : null;
            const revised = current.withPaymentDate(paymentDate, this.containerOnPayment(current, paymentDate ?? current.dueDate));
            this.transactions.update(revised);
            this.recalculation.apply(before.merge(this.impacts.ofTransaction(revised)));
            return this.composer.requireTransaction(id);
        });
    }

    /**
     * Contêiner de uma transação existente depois de mudar a data de pagamento.
     *
     * @param current Transação marcada ou desmarcada.
     * @param cashDate Nova data de caixa: a de pagamento, ou o vencimento ao desmarcar.
     * @return O extrato do mês da data, garantido; numa transação de cartão, a fatura atual,
     * porque a fatura escolhida é a verdade (database-design §4.7).
     * @throws {NotFoundError} Quando a conta do extrato não existe mais.
     */
    private containerOnPayment(current: Transaction, cashDate: LocalDate): TransactionContainer {
        if (current.container.kind === 'invoice') {
            return current.container;
        }
        const account = this.accounts.findById(current.container.accountId);
        if (account === null) {
            throw new NotFoundError('Account', current.container.accountId);
        }
        const statement = this.consolidation.ensureStatement(account, cashDate.period);
        return { kind: 'statement', statementId: statement.id, accountId: statement.accountId, period: statement.period };
    }

    /**
     * @param id Transação procurada.
     * @return A transação viva.
     * @throws {NotFoundError} Quando não existe ou foi excluída.
     */
    public get(id: TransactionId): Transaction {
        return this.unitOfWork.run(() => this.composer.requireTransaction(id));
    }

    /**
     * Transações do perfil num mês, pelo `due_date` — a lista "Transações do mês" (brief M5) —,
     * com as transferências recebidas de outros perfis, que o perfil vê mas não edita.
     *
     * @param profileId Perfil consultado.
     * @param period Mês consultado.
     * @return As transações vivas do mês, por data.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public listByPeriod(profileId: ProfileId, period: YearMonth): readonly Transaction[] {
        return this.unitOfWork.run(() => {
            this.composer.requireProfile(profileId);
            return this.transactions.listByProfileBetween(
                profileId,
                LocalDate.of(period.year, period.month, 1),
                LocalDate.of(period.year, period.month, period.lengthInDays()),
            );
        });
    }
}

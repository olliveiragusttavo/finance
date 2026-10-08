import type { Recurrence } from '../../domain/recurrence/Recurrence.ts';
import type { RecurrenceId, TransactionId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { Transaction } from '../../domain/transaction/Transaction.ts';
import type { Timestamp } from '../../ports/Clock.ts';
import type { RecurrenceRepository } from '../../repositories/RecurrenceRepository.ts';
import type { RowStamps, TransactionRepository } from '../../repositories/TransactionRepository.ts';
import type { CreateTransactionCommand, EditScope, UpdateTransactionCommand } from '../transaction/TransactionCommands.ts';
import type { TransactionComposer } from '../transaction/TransactionComposer.ts';
import type { TransactionService } from '../transaction/TransactionService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';

/** Uma ocorrência que a operação exclui, cria ou altera. */
export interface PlannedOccurrence {
    /** A ocorrência como estava (excluída) ou como fica (criada, alterada). */
    readonly transaction: Transaction;
    /** Se a ocorrência foi editada à mão depois de criada (`editedByHand`); sempre `false` na criada. */
    readonly editedByHand: boolean;
}

/**
 * O que uma criação, edição ou exclusão faz com uma série, sem gravar nada — o conteúdo do
 * diálogo de revisão (database-design §4.12).
 */
export interface SeriesPlan {
    /** A regra antes da operação; `null` numa criação. */
    readonly seriesBefore: Recurrence | null;
    /** A mesma regra depois da operação; `null` quando ela é excluída (ou numa criação). */
    readonly seriesAfter: Recurrence | null;
    /** A regra que a operação cria — a da criação, ou a da série recomeçada; `null` quando não cria. */
    readonly newSeries: Recurrence | null;
    readonly deleted: readonly PlannedOccurrence[];
    readonly created: readonly PlannedOccurrence[];
    readonly updated: readonly PlannedOccurrence[];
}

/** Uma série num instante: a regra viva, as ocorrências vivas e os carimbos delas. */
interface SeriesSnapshot {
    readonly recurrence: Recurrence | null;
    readonly occurrences: readonly Transaction[];
    readonly stamps: ReadonlyMap<TransactionId, RowStamps>;
}

const EMPTY: SeriesSnapshot = { recurrence: null, occurrences: [], stamps: new Map() };

/**
 * Monta o plano de uma operação sobre uma série para o diálogo de revisão
 * (database-design §4.12): a criação, edição ou exclusão de uma
 * transação recorrente só é gravada depois que o usuário vê o que será excluído, criado e
 * alterado. Em vez de prever o resultado com uma segunda implementação das regras, executa a
 * própria operação numa transação desfeita (`UnitOfWork.rehearse`) e compara a série antes e
 * depois: o plano nunca discorda do que a confirmação grava, e uma recusa de regra aparece já
 * no plano, antes de o usuário confirmar.
 */
export class SeriesPlanner {
    /**
     * @param unitOfWork Ensaio da operação, sempre desfeito.
     * @param operations As operações de verdade, ensaiadas.
     * @param composer Busca da ocorrência editada ou excluída, com a mesma recusa das operações.
     * @param transactions Ocorrências e carimbos, lidos antes e depois do ensaio.
     * @param recurrences Regras, lidas antes e depois do ensaio.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly operations: TransactionService,
        private readonly composer: TransactionComposer,
        private readonly transactions: TransactionRepository,
        private readonly recurrences: RecurrenceRepository,
    ) {}

    /**
     * @param command Lançamento novo, normalmente com repetição.
     * @return O plano da criação: as ocorrências que a série grava agora.
     * @throws {NotFoundError} Quando o perfil ou uma referência não existe.
     * @throws {BusinessRuleViolation} Quando a criação seria recusada.
     */
    public planCreate(command: CreateTransactionCommand): SeriesPlan {
        return this.unitOfWork.rehearse(() => {
            const created = this.operations.create(command);
            return diffSeries(EMPTY, EMPTY, this.snapshot(created.recurrenceId, created.id), null);
        });
    }

    /**
     * @param command Edição, com o escopo e a série pedida.
     * @return O plano da edição.
     * @throws {NotFoundError} Quando a transação ou uma referência não existe.
     * @throws {BusinessRuleViolation} Quando a edição seria recusada.
     */
    public planUpdate(command: UpdateTransactionCommand): SeriesPlan {
        return this.unitOfWork.rehearse(() => {
            const current = this.composer.requireTransaction(command.id);
            const before = this.snapshot(current.recurrenceId, current.id);
            const saved = this.operations.update(command);
            const after = this.snapshot(current.recurrenceId, current.id);
            const fresh = saved.recurrenceId === current.recurrenceId ? null : this.snapshot(saved.recurrenceId, saved.id);
            return diffSeries(before, after, fresh, current.id);
        });
    }

    /**
     * @param id Ocorrência a partir da qual excluir.
     * @param scope A quais ocorrências da série a exclusão se aplica.
     * @return O plano da exclusão.
     * @throws {NotFoundError} Quando a transação não existe.
     * @throws {BusinessRuleViolation} Quando pede um escopo de série num lançamento avulso.
     */
    public planDelete(id: TransactionId, scope: EditScope): SeriesPlan {
        return this.unitOfWork.rehearse(() => {
            const current = this.composer.requireTransaction(id);
            const before = this.snapshot(current.recurrenceId, current.id);
            this.operations.delete(id, scope);
            return diffSeries(before, this.snapshot(current.recurrenceId, current.id), null, null);
        });
    }

    /**
     * @param recurrenceId Série; `null` num lançamento avulso, que é a sua própria "série".
     * @param alone Lançamento avulso, lido quando não há série.
     * @return A série como está agora.
     */
    private snapshot(recurrenceId: RecurrenceId | null, alone: TransactionId): SeriesSnapshot {
        if (recurrenceId === null) {
            const transaction = this.transactions.findById(alone);
            return { recurrence: null, occurrences: transaction === null ? [] : [transaction], stamps: new Map() };
        }
        return {
            recurrence: this.recurrences.findById(recurrenceId),
            occurrences: this.transactions.listOccurrences(recurrenceId),
            stamps: this.transactions.listOccurrenceStamps(recurrenceId),
        };
    }
}

/**
 * Compara a série antes e depois da operação. Pelo id, e não pelo número: a série recomeçada
 * tem os mesmos números com outros ids, e a ocorrência revivida volta com o id antigo.
 *
 * @param before A série antes.
 * @param after A mesma série depois.
 * @param fresh A série que a operação criou; `null` quando não criou.
 * @param target Ocorrência editada, que entra como alterada mesmo sem mudança — é a que o
 * usuário está salvando; `null` na criação e na exclusão.
 * @return O plano.
 */
function diffSeries(before: SeriesSnapshot, after: SeriesSnapshot, fresh: SeriesSnapshot | null, target: TransactionId | null): SeriesPlan {
    const beforeById = new Map(before.occurrences.map((transaction) => [transaction.id, transaction]));
    const afterIds = new Set(after.occurrences.map((transaction) => transaction.id));
    const deleted = before.occurrences
        .filter((transaction) => !afterIds.has(transaction.id))
        .map((transaction) => ({ transaction, editedByHand: editedByHand(before.stamps.get(transaction.id)) }));
    const created = [...after.occurrences.filter((transaction) => !beforeById.has(transaction.id)), ...(fresh?.occurrences ?? [])]
        .map((transaction) => ({ transaction, editedByHand: false }));
    const updated = after.occurrences.flatMap((transaction) => {
        const previous = beforeById.get(transaction.id);
        if (previous === undefined || (transaction.id !== target && sameContent(previous, transaction))) {
            return [];
        }
        return [{ transaction, editedByHand: editedByHand(before.stamps.get(transaction.id)) }];
    });
    return {
        seriesBefore: before.recurrence,
        seriesAfter: after.recurrence,
        newSeries: fresh?.recurrence ?? null,
        deleted: [...deleted].sort(bySeriesOrder),
        created: [...created].sort(bySeriesOrder),
        updated: [...updated].sort(bySeriesOrder),
    };
}

/**
 * Tolerância entre a criação e a última escrita de uma linha que ainda conta como "não
 * editada". Os dois carimbos têm precisão de segundo e vêm de relógios diferentes — o do motor
 * no `created_at`, o da aplicação no `updated_at` —, então milissegundos na criação podem virar
 * um segundo de diferença.
 */
const EDIT_TOLERANCE_SECONDS = 1;

/**
 * Regra do diálogo de revisão (desktop-mvp-plan Fase 9.2): uma ocorrência conta como
 * editada à mão quando foi escrita depois de criada. É uma aproximação aceita: marcar como paga
 * também escreve na linha, e uma edição de série escreve nas outras ocorrências do escopo.
 *
 * @param stamps Carimbos da linha; ausentes num lançamento avulso.
 * @return `true` quando a última escrita passou da criação mais que a tolerância.
 */
export function editedByHand(stamps: RowStamps | undefined): boolean {
    return stamps !== undefined && secondsOf(stamps.updatedAt) - secondsOf(stamps.createdAt) > EDIT_TOLERANCE_SECONDS;
}

/**
 * @param timestamp Instante `YYYY-MM-DD HH:MM:SS`.
 * @return Segundos desde a época, para medir a distância entre dois carimbos sem `Date`, que o
 * núcleo não lê (backend-design §3.4).
 */
function secondsOf(timestamp: Timestamp): number {
    const [date = '', time = ''] = timestamp.split(' ');
    const [hours = 0, minutes = 0, seconds = 0] = time.split(':').map(Number);
    return LocalDate.parse(date).toEpochDay() * 86_400 + hours * 3_600 + minutes * 60 + seconds;
}

/**
 * @param a Ocorrência antes.
 * @param b A mesma ocorrência depois.
 * @return `true` quando nada que o usuário vê mudou — a ocorrência não entra como alterada.
 */
function sameContent(a: Transaction, b: Transaction): boolean {
    return a.type === b.type
        && containerKey(a) === containerKey(b)
        && a.subCategoryId === b.subCategoryId
        && a.destinationAccountId === b.destinationAccountId
        && a.partnerId === b.partnerId
        && a.goalId === b.goalId
        && a.name === b.name
        && a.description === b.description
        && a.value.equals(b.value)
        && a.charges.equals(b.charges)
        && a.origin.currency.equals(b.origin.currency)
        && a.origin.conversionRate === b.origin.conversionRate
        && a.dueDate.equals(b.dueDate)
        && (a.paymentDate === null ? b.paymentDate === null : b.paymentDate !== null && a.paymentDate.equals(b.paymentDate))
        && a.tagIds.length === b.tagIds.length
        && a.tagIds.every((tagId) => b.tagIds.includes(tagId));
}

/**
 * @param transaction Ocorrência.
 * @return O extrato ou a fatura em que ela está, para comparar.
 */
function containerKey(transaction: Transaction): string {
    const { container } = transaction;
    return container.kind === 'statement' ? `statement:${container.statementId}` : `invoice:${container.invoiceId}`;
}

/**
 * @param a Uma ocorrência planejada.
 * @param b Outra.
 * @return A ordem do diálogo, que mostra a data de cada ocorrência: pela data, e pelo número
 * quando duas vencem no mesmo dia.
 */
function bySeriesOrder(a: PlannedOccurrence, b: PlannedOccurrence): number {
    return a.transaction.dueDate.compare(b.transaction.dueDate) || (a.transaction.occurrence ?? 0) - (b.transaction.occurrence ?? 0);
}

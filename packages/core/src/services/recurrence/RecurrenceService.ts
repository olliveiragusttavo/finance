import type { Profile } from '../../domain/profile/Profile.ts';
import { Recurrence, seriesHasOccurrence, seriesValueOf, type RecurrenceSource, type RecurrenceTemplate, type RecurrenceTerms } from '../../domain/recurrence/Recurrence.ts';
import { moveToAnchor, RecurrenceSchedule } from '../../domain/recurrence/RecurrenceSchedule.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { occurrenceIdFor } from '../../domain/shared/DeterministicIds.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { RecurrenceId, type CreditCardId, type ProfileId, type TagId, type TransactionId } from '../../domain/shared/ids.ts';
import { LocalDate } from '../../domain/shared/LocalDate.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import { Transaction } from '../../domain/transaction/Transaction.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { RecurrenceRepository } from '../../repositories/RecurrenceRepository.ts';
import type { TransactionRepository } from '../../repositories/TransactionRepository.ts';
import { BalanceImpact } from '../balance/BalanceImpact.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import type { ImpactCalculator } from '../balance/ImpactCalculator.ts';
import type { CreateTransactionCommand, EditScope, RepeatInput, TransactionInput, TransactionSource, UpdateTransactionCommand } from '../transaction/TransactionCommands.ts';
import type { SelectionPolicy, TransactionComposer } from '../transaction/TransactionComposer.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';

/** Meses à frente que uma série fixa mantém gravados (database-design §4.12). */
const HORIZON_MONTHS = 12;

/** Uma ocorrência prevista, sem gravar nada — a prévia das parcelas do formulário. */
export interface OccurrencePreview {
    readonly occurrence: number;
    readonly dueDate: LocalDate;
    readonly value: Money;
    /** Fatura em que a compra cai; `null` numa conta. */
    readonly invoicePeriod: YearMonth | null;
}

/** O que a prévia precisa do formulário. */
export interface PreviewCommand {
    readonly profileId: ProfileId;
    readonly source: TransactionSource;
    readonly dueDate: LocalDate;
    readonly value: number;
    readonly repeat: RepeatInput;
}

/** Ocorrência emitida e os saldos que ela mexe. */
interface Emitted {
    readonly transaction: Transaction;
    readonly impact: BalanceImpact;
}

/** Uma série que o complemento não conseguiu estender; as outras seguiram. */
export interface TopUpFailure {
    readonly recurrenceId: RecurrenceId;
    /** O que a série lançou: erro de domínio ou bug, para o log da abertura. */
    readonly error: unknown;
}

/** O resultado do complemento de todas as séries. */
export interface TopUpOutcome {
    readonly emitted: number;
    readonly failures: readonly TopUpFailure[];
}

/** O que uma emissão em sequência gravou. */
interface EmittedRange {
    /** Último número que a série passa a ter gravado — emitido agora ou já vivo; `null` se nenhum. */
    readonly last: number | null;
    /** Quantas ocorrências foram gravadas agora. */
    readonly emitted: number;
    readonly impact: BalanceImpact;
}

/**
 * Recorrências: parcelamentos e lançamentos fixos (database-design §4.12; desktop-mvp-plan
 * Fase 9.1). Cada ocorrência é uma transação real, gravada pelas mesmas regras de qualquer
 * lançamento (`TransactionComposer`), com id derivado do número dela. Toda operação grava as
 * ocorrências, a regra e o recálculo de todos os meses afetados numa única unidade de trabalho:
 * uma série nunca fica visível pela metade.
 */
export class RecurrenceService {
    /**
     * @param unitOfWork Escrita e recálculo na mesma transação de banco.
     * @param ids Gera o UUID v4 da regra nova.
     * @param clock "Hoje", de onde conta o horizonte das séries fixas.
     * @param composer Regras de montar e conferir um lançamento.
     * @param transactions Ocorrências.
     * @param recurrences Regras.
     * @param impacts Traduz o estado de uma ocorrência nos saldos afetados.
     * @param recalculation A rotina única de recálculo.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly clock: Clock,
        private readonly composer: TransactionComposer,
        private readonly transactions: TransactionRepository,
        private readonly recurrences: RecurrenceRepository,
        private readonly impacts: ImpactCalculator,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * Cria a série a partir do lançamento do formulário: a 1ª ocorrência leva as escolhas dele
     * (pago, fatura), e as seguintes saem do modelo. Parceladas são gravadas inteiras; fixas,
     * até o horizonte.
     *
     * @param command Lançamento com a repetição.
     * @param repeat Repetição pedida.
     * @return A 1ª ocorrência, relida do banco.
     * @throws {NotFoundError} Quando o perfil ou alguma referência não existe.
     * @throws {BusinessRuleViolation} Quando uma regra de negócio é violada.
     */
    public createSeries(command: CreateTransactionCommand, repeat: RepeatInput): Transaction {
        return this.unitOfWork.run(() => {
            const profile = this.composer.requireProfile(command.profileId);
            this.composer.assertReferences(profile, command, null);
            const recurrence = Recurrence.create({
                id: RecurrenceId(this.ids.random()),
                profileId: profile.id,
                terms: termsOf(repeat),
                schedule: RecurrenceSchedule.startingOn(repeat.frequency, command.dueDate),
                materializedCount: 0,
                template: this.templateOf(profile, command),
            });
            this.recurrences.insert(recurrence);
            const first = this.emit(profile, recurrence, 1, { paymentDate: command.paymentDate, policy: 'newChoice', current: null });
            const rest = this.emitFrom(profile, recurrence, 2);
            this.recurrences.update(recurrence.revise({ materializedCount: rest.last ?? 1 }));
            this.recalculation.apply(first.impact.merge(rest.impact));
            return this.composer.requireTransaction(first.transaction.id);
        });
    }

    /**
     * Complemento (top-up): estende cada série fixa até o horizonte de 12 meses a partir de
     * hoje. Roda na abertura do app, depois da verificação de integridade (backend-design
     * §4.5). Idempotente pela marca d'água: na segunda vez não grava nada, e uma ocorrência
     * excluída nunca volta, porque o número dela já passou.
     * Cada série é complementada na sua própria transação (backend-design §4.5): a falha de uma
     * desfaz só ela e entra no resultado, e as outras seguem. Numa transação só, uma série
     * inconsistente desfazia o complemento de todas e, como a abertura roda o mesmo complemento
     * sobre os mesmos dados, falhava em toda abertura — sem que o usuário chegasse à tela para
     * corrigi-la.
     *
     * @return Quantas ocorrências foram emitidas e as séries que falharam, com o erro de cada uma.
     * @throws {Error} Quando chamado dentro de outra unidade de trabalho, que não deixaria isolar
     * as séries.
     */
    public topUp(): TopUpOutcome {
        const ids = this.unitOfWork.runAlone(() => this.recurrences.listAllIds());
        let emitted = 0;
        const failures: TopUpFailure[] = [];
        for (const id of ids) {
            try {
                emitted += this.unitOfWork.runAlone(() => this.topUpSeries(id));
            } catch (error) {
                failures.push({ recurrenceId: id, error });
            }
        }
        return { emitted, failures };
    }

    /**
     * Complementa uma série: emite da marca d'água em diante e avança a marca. Lê a regra aqui,
     * dentro da transação dela, para que uma linha corrompida falhe só nesta série.
     *
     * @param id Regra a complementar.
     * @return Quantas ocorrências foram emitidas.
     * @throws {NotFoundError} Quando a regra, o perfil ou uma referência do modelo não existe.
     * @throws {CorruptRowError} Quando a linha da regra não pode ser lida.
     * @throws {BusinessRuleViolation} Quando uma ocorrência viola uma regra do lançamento.
     */
    private topUpSeries(id: RecurrenceId): number {
        const recurrence = this.requireRecurrence(id);
        const profile = this.composer.requireProfile(recurrence.profileId);
        const result = this.emitFrom(profile, recurrence, recurrence.materializedCount + 1);
        if (result.last === null) {
            return 0;
        }
        this.recurrences.update(recurrence.revise({ materializedCount: result.last }));
        this.recalculation.apply(result.impact);
        return result.emitted;
    }

    /**
     * Edita uma ocorrência em "esta e as futuras" ou "todas", ou muda a série
     * (database-design §4.12, "Editar uma transação recorrente pergunta o escopo").
     * Regra de negócio (Recorrências): aplica às outras ocorrências do escopo e ao modelo só o
     * que **mudou** na editada; trocar a data muda o dia âncora, e cada ocorrência vai para o
     * dia novo dentro do próprio mês (ou da própria semana). Pago e data de pagamento continuam
     * individuais. Mudar a série vale sempre para a editada e as futuras: a quantidade de
     * parcelas e o término de uma fixa só criam ou apagam o que a mudança exige
     * (`reshapeSeries`); a periodicidade e a forma (parcelada ou fixa) encerram a regra e
     * começam outra na editada (`restartSeries`). O tipo do lançamento não muda em nenhum
     * escopo (database-design §4.13).
     *
     * @param command Conteúdo completo da editada, com o escopo e a série pedida.
     * @return A ocorrência editada, relida do banco — numa série recomeçada, a 1ª da regra nova.
     * @throws {NotFoundError} Quando a transação, a regra ou uma referência não existe.
     * @throws {BusinessRuleViolation} Quando o lançamento não é de uma série, o tipo mudou, a
     * série mudou fora de "esta e as futuras", a data de uma diária mudou fora de "somente
     * esta", as parcelas ficaram abaixo da editada ou o término ficou antes dela.
     */
    public update(command: UpdateTransactionCommand): Transaction {
        return this.unitOfWork.run(() => {
            const current = this.composer.requireTransaction(command.id);
            const recurrence = this.requireSeries(current);
            const profile = this.composer.requireProfile(current.profileId);
            if (command.scope === 'single') {
                throw new BusinessRuleViolation('recurrence-change-requires-scope', 'o escopo "somente esta" é do TransactionService', { field: 'scope' });
            }
            const change = seriesChangeOf(recurrence, command.repeat);
            // Regra de negócio (Recorrências, database-design §4.12): mudar a série não tem escolha
            // de escopo — vale para a editada e as futuras.
            if (change.kind !== 'none' && command.scope !== 'future') {
                throw new BusinessRuleViolation('recurrence-change-requires-scope', 'mudar a série vale para esta e as futuras', { field: 'scope' });
            }
            // Antes de qualquer caminho: recomeçar a série grava a editada pelo modelo novo sem
            // passar por `Transaction.revise`, que é quem recusa a troca de tipo nos demais.
            current.assertTypeKept(command.type);
            this.composer.assertReferences(profile, command, current);
            if (change.kind === 'restart') {
                return this.restartSeries(profile, recurrence, current, command, change.repeat);
            }
            return this.reviseSeries(profile, recurrence, current, command, change.kind === 'reshape' ? change.repeat : null);
        });
    }

    /**
     * Regra de negócio (Recorrências, database-design §4.12): mudar a série (frequência,
     * tipo, parcelas, fim) vale para a editada e as futuras, então não cabe em "somente esta".
     *
     * @param current Ocorrência editada em "somente esta".
     * @param repeat Série que veio no formulário.
     * @return void
     * @throws {BusinessRuleViolation} Quando a série pedida difere da atual, ou veio num
     * lançamento avulso.
     */
    public assertSeriesUnchanged(current: Transaction, repeat: RepeatInput): void {
        this.unitOfWork.run(() => {
            const recurrence = this.requireSeries(current);
            if (seriesChangeOf(recurrence, repeat).kind !== 'none') {
                throw new BusinessRuleViolation('recurrence-change-requires-scope', 'mudar a série vale para esta e as futuras', { field: 'repeat' });
            }
        });
    }

    /**
     * Exclui ocorrências de uma série em "esta e as futuras" ou "todas".
     * Regra de negócio (Recorrências, database-design §4.12): "esta e as futuras" exclui a
     * editada e as de número maior e encerra a série antes dela, para que o complemento não
     * emita mais nada; "todas" exclui a série inteira e a regra. Ocorrências pagas também
     * saem — o diálogo de revisão mostra antes —, e os saldos de todos os meses afetados são
     * recalculados.
     *
     * @param id Ocorrência a partir da qual excluir.
     * @param scope `future` ou `all`.
     * @return void
     * @throws {NotFoundError} Quando a transação ou a regra não existe.
     * @throws {BusinessRuleViolation} Quando o lançamento não é de uma série.
     */
    public delete(id: TransactionId, scope: Exclude<EditScope, 'single'>): void {
        this.unitOfWork.run(() => {
            const current = this.composer.requireTransaction(id);
            const recurrence = this.requireSeries(current);
            const doomed = this.transactions.listOccurrences(recurrence.id).filter((member) => inScope(member, current, scope));
            let impact = BalanceImpact.none();
            for (const member of doomed) {
                impact = impact.merge(this.impacts.ofTransaction(member));
                this.transactions.softDelete(member.id);
            }
            const ended = scope === 'all' ? null : recurrence.endingBefore(numberOf(current));
            if (ended === null) {
                this.recurrences.softDelete(recurrence.id);
            } else {
                this.recurrences.update(ended);
            }
            this.recalculation.apply(impact);
        });
    }

    /**
     * Edição em "esta e as futuras" ou "todas" que mantém a regra: aplica o que mudou e, quando
     * a quantidade de parcelas ou o término mudou, só cria ou apaga o que a mudança exige.
     * Regra de negócio (Recorrências, database-design §4.12): o calendário não muda, então as
     * ocorrências que continuam na série ficam como estão, com as edições feitas nelas; as que
     * saem da série saem mesmo pagas. Recriar todas as futuras, como antes, apagava pagamentos
     * e edições sem necessidade.
     *
     * @param profile Perfil dono.
     * @param recurrence Regra como está.
     * @param current Ocorrência editada, como está.
     * @param command Conteúdo da editada, com o escopo.
     * @param reshape Série pedida quando a quantidade de parcelas ou o término mudou; `null`
     * quando a série é a mesma.
     * @return A ocorrência editada, relida do banco.
     * @throws {BusinessRuleViolation} Quando a data de uma diária mudou, as parcelas ficaram
     * abaixo da editada ou o término ficou antes dela.
     */
    private reviseSeries(profile: Profile, recurrence: Recurrence, current: Transaction, command: UpdateTransactionCommand, reshape: RepeatInput | null): Transaction {
        const dateChanged = !command.dueDate.equals(current.dueDate);
        // O dia novo não muda quais ocorrências a série tem: numa fixa com fim, o fim acompanha (`reanchoredOn`).
        const reanchored = dateChanged ? recurrence.reanchoredOn(command.dueDate) : recurrence;
        const { schedule } = reanchored;
        const others = this.transactions.listOccurrences(recurrence.id).filter((member) => member.id !== current.id && inScope(member, current, command.scope));
        let impact = BalanceImpact.none();
        for (const member of [current, ...others]) {
            impact = impact.merge(this.impacts.ofTransaction(member));
        }

        const edited = this.composer.resolveContainer(profile, command, current);
        const revisedEdited = current.revise(this.composer.toContent(profile, command, edited.container));
        this.transactions.update(revisedEdited);
        impact = impact.merge(edited.impact).merge(this.impacts.ofTransaction(revisedEdited));

        const changes = changesBetween(current, revisedEdited);
        const offset = this.offsetOf(revisedEdited);
        for (const member of others) {
            impact = impact.merge(this.reviseMember(profile, member, changes, { schedule, dateChanged, offset }));
        }

        let revised = reanchored.revise({ template: applyChanges(recurrence.template, changes, offset) });
        if (revised.terms.kind === 'installments' && (changes.value !== undefined || reshape !== null)) {
            // Regra de negócio (Parcelamento, database-design §4.12): daqui em diante a série vale
            // por parcela. O valor alterado na tela vale para as parcelas novas; sem alteração,
            // elas recebem o valor regular da série — o da editada podia ser o da 1ª, com o resto
            // do arredondamento, ou um valor próprio dela, dado em "somente esta".
            revised = revised.revise({ terms: { ...revised.terms, valueType: 'perInstallment' }, template: { ...revised.template, value: changes.value ?? recurrence.regularValue() } });
        }
        if (reshape !== null) {
            const reshaped = this.reshapeSeries(profile, reanchored, revised, reshape, numberOf(current));
            revised = reshaped.recurrence;
            impact = impact.merge(reshaped.impact);
        }
        this.recurrences.update(revised);
        this.recalculation.apply(impact);
        return this.composer.requireTransaction(revisedEdited.id);
    }

    /**
     * Muda a quantidade de parcelas ou o término de uma fixa sem trocar o calendário.
     * Regra de negócio (Recorrências, database-design §4.12): apaga as ocorrências que deixam de
     * existir na série — mesmo pagas — e cria as que passam a existir, até o horizonte numa
     * fixa; as demais ficam intactas. A nova quantidade não pode ficar abaixo da editada, nem o
     * término antes dela. A marca d'água não recua: um número apagado só volta se a série
     * voltar a tê-lo, por uma nova mudança da quantidade ou do término.
     *
     * @param profile Perfil dono.
     * @param before Regra como estava — já no dia âncora novo, quando a data mudou, que não muda
     * quais números existem —, que diz quais números já existiam.
     * @param revised Regra com o modelo e o calendário já revisados.
     * @param repeat Série pedida, da mesma forma e frequência.
     * @param occurrence Número da editada.
     * @return A regra com os termos novos e a marca d'água, e os saldos mexidos.
     * @throws {BusinessRuleViolation} Quando as parcelas ficam abaixo da editada ou o término
     * fica antes dela.
     */
    private reshapeSeries(profile: Profile, before: Recurrence, revised: Recurrence, repeat: RepeatInput, occurrence: number): { readonly recurrence: Recurrence; readonly impact: BalanceImpact } {
        if (repeat.kind === 'installments' && repeat.installments < occurrence) {
            throw new BusinessRuleViolation(
                'recurrence-installments-below-occurrence',
                `a série não pode ter menos parcelas que a editada (${String(occurrence)})`,
                { field: 'installments', occurrence },
            );
        }
        // A forma e a frequência são as mesmas (`seriesChangeOf`); numa parcelada, o valor já vale por parcela.
        const terms: RecurrenceTerms = repeat.kind === 'installments'
            ? { kind: 'installments', installments: repeat.installments, valueType: 'perInstallment' }
            : { kind: 'fixed', endAt: repeat.endAt };
        if (terms.kind === 'fixed' && terms.endAt !== null && terms.endAt.isBefore(revised.schedule.dateOf(occurrence))) {
            throw new BusinessRuleViolation('recurrence-end-before-occurrence', 'a série não pode terminar antes da editada', { field: 'endAt' });
        }
        const reshaped = revised.revise({ terms });

        let impact = BalanceImpact.none();
        for (const member of this.transactions.listOccurrences(before.id)) {
            if (!reshaped.hasOccurrence(numberOf(member))) {
                impact = impact.merge(this.impacts.ofTransaction(member));
                this.transactions.softDelete(member.id);
            }
        }
        // Uma fixa sem fim já tinha todos os números.
        const last = before.lastOccurrence();
        const added = last === null ? { last: null, impact: BalanceImpact.none() } : this.emitFrom(profile, reshaped, last + 1);
        return {
            recurrence: reshaped.revise({ materializedCount: Math.max(before.materializedCount, added.last ?? 0) }),
            impact: impact.merge(added.impact),
        };
    }

    /**
     * Muda a periodicidade ou o tipo da série: encerra a regra e começa outra na editada.
     * Regra de negócio (Recorrências, database-design §4.12): a editada e as de número maior
     * são excluídas, mesmo pagas; a regra antiga termina na anterior à editada (ou é excluída,
     * quando a editada é a 1ª) e as passadas ficam nela, sem vínculo com a regra nova. A regra
     * nova nasce do formulário, com a editada como 1ª ocorrência e o pagamento dela. Uma
     * parcelada que continua parcelada tem como total as parcelas restantes, por parcela; a
     * fixa que vira parcelada tem a quantidade e a leitura do valor que o usuário informou.
     * Uma regra nova, e não a mesma regenerada, porque a numeração antiga não diz nada no
     * calendário novo — recriar até a contagem antiga gravava décadas de uma diária que virou
     * mensal.
     *
     * @param profile Perfil dono.
     * @param recurrence Regra como está.
     * @param current Ocorrência editada, como está.
     * @param command Conteúdo da editada, que vira o modelo da regra nova.
     * @param repeat Série pedida, com outra frequência ou outro tipo.
     * @return A 1ª ocorrência da regra nova, relida do banco.
     * @throws {BusinessRuleViolation} Quando as parcelas ficam abaixo da editada, ou a fixa nova
     * termina antes de começar.
     */
    private restartSeries(profile: Profile, recurrence: Recurrence, current: Transaction, command: UpdateTransactionCommand, repeat: RepeatInput): Transaction {
        const occurrence = numberOf(current);
        if (repeat.kind === 'installments' && recurrence.terms.kind === 'installments' && repeat.installments < occurrence) {
            throw new BusinessRuleViolation(
                'recurrence-installments-below-occurrence',
                `a série não pode ter menos parcelas que a editada (${String(occurrence)})`,
                { field: 'installments', occurrence },
            );
        }
        const terms: RecurrenceTerms = repeat.kind === 'fixed'
            ? { kind: 'fixed', endAt: repeat.endAt }
            : recurrence.terms.kind === 'installments'
              ? { kind: 'installments', installments: repeat.installments - occurrence + 1, valueType: 'perInstallment' }
              : { kind: 'installments', installments: repeat.installments, valueType: repeat.valueType };
        const fresh = Recurrence.create({
            id: RecurrenceId(this.ids.random()),
            profileId: profile.id,
            terms,
            schedule: RecurrenceSchedule.startingOn(repeat.frequency, command.dueDate),
            materializedCount: 0,
            template: this.templateOf(profile, command),
        });

        let impact = BalanceImpact.none();
        for (const member of this.transactions.listOccurrences(recurrence.id)) {
            if (numberOf(member) >= occurrence) {
                impact = impact.merge(this.impacts.ofTransaction(member));
                this.transactions.softDelete(member.id);
            }
        }
        const ended = recurrence.endingBefore(occurrence);
        if (ended === null) {
            this.recurrences.softDelete(recurrence.id);
        } else {
            this.recurrences.update(ended);
        }

        this.recurrences.insert(fresh);
        // A 1ª é a editada: vale o que o formulário escolheu, inclusive a origem desativada que ela já tinha.
        const first = this.emit(profile, fresh, 1, { paymentDate: command.paymentDate, policy: 'newChoice', current });
        const rest = this.emitFrom(profile, fresh, 2);
        this.recurrences.update(fresh.revise({ materializedCount: rest.last ?? 1 }));
        this.recalculation.apply(impact.merge(first.impact).merge(rest.impact));
        return this.composer.requireTransaction(first.transaction.id);
    }

    /**
     * @param profileId Perfil consultado.
     * @return As regras vivas do perfil.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId): readonly Recurrence[] {
        return this.unitOfWork.run(() => {
            this.composer.requireProfile(profileId);
            return this.recurrences.listByProfile(profileId);
        });
    }

    /**
     * @param id Regra consultada.
     * @return As ocorrências vivas da série, por data — o diálogo de escopo conta as pagas e os
     * meses afetados a partir delas.
     * @throws {NotFoundError} Quando a regra não existe.
     */
    public occurrences(id: RecurrenceId): readonly Transaction[] {
        return this.unitOfWork.run(() => {
            this.requireRecurrence(id);
            return this.transactions.listOccurrences(id);
        });
    }

    /**
     * Prévia das ocorrências que a criação vai gravar, sem gravar nada — a lista de parcelas
     * com a fatura de cada uma do mockup `MobileParcelar`. Usa o mesmo calendário, a mesma
     * divisão e a mesma sugestão de fatura da criação, para que a prévia nunca discorde do que
     * é gravado.
     *
     * @param command Origem, data, valor e repetição do formulário.
     * @return As ocorrências que a criação emitiria agora.
     * @throws {NotFoundError} Quando o perfil ou o cartão não existe.
     * @throws {BusinessRuleViolation} Quando a série termina antes de começar.
     */
    public preview(command: PreviewCommand): readonly OccurrencePreview[] {
        return this.unitOfWork.run(() => {
            const profile = this.composer.requireProfile(command.profileId);
            const value = Money.of(command.value, profile.currency);
            const terms = termsOf(command.repeat);
            const schedule = RecurrenceSchedule.startingOn(command.repeat.frequency, command.dueDate);
            const { source } = command;
            const offset = source.kind === 'creditCard' ? this.chosenOffset(source.creditCardId, command.dueDate, source.invoicePeriod) : 0;
            const horizon = this.horizon();
            const previews: OccurrencePreview[] = [];
            for (let occurrence = 1; seriesHasOccurrence(terms, schedule, occurrence) && (occurrence === 1 || withinReach(terms, schedule, occurrence, horizon)); occurrence++) {
                const dueDate = schedule.dateOf(occurrence);
                previews.push({
                    occurrence,
                    dueDate,
                    value: seriesValueOf(terms, value, occurrence),
                    invoicePeriod: source.kind === 'account' ? null : this.composer.suggestedInvoicePeriod(source.creditCardId, dueDate).plusMonths(offset),
                });
            }
            return previews;
        });
    }

    /**
     * Emite as ocorrências a partir de um número enquanto a série as tiver e elas estiverem ao
     * alcance (`withinReach`). Um número que já está vivo é pulado, e não regravado: o mesmo
     * número pode chegar de outro aparelho pela sincronização antes da marca d'água dele
     * (sync-design §5.6), e regravá-lo esbarraria na linha viva — no complemento, a cada abertura.
     * As ocorrências vivas só são lidas quando há algo a emitir, porque o complemento passa por
     * toda série a cada abertura e quase nunca emite.
     *
     * @param profile Perfil dono.
     * @param recurrence Regra que emite.
     * @param from Primeiro número a emitir.
     * @return O último número que a série passa a ter gravado (`null` se nenhum), quantas
     * ocorrências foram gravadas agora e os saldos mexidos.
     */
    private emitFrom(profile: Profile, recurrence: Recurrence, from: number): EmittedRange {
        const horizon = this.horizon();
        let alive: ReadonlySet<number> | null = null;
        let impact = BalanceImpact.none();
        let last: number | null = null;
        let emitted = 0;
        for (let occurrence = from; recurrence.hasOccurrence(occurrence) && withinReach(recurrence.terms, recurrence.schedule, occurrence, horizon); occurrence++) {
            alive ??= new Set(this.transactions.listOccurrences(recurrence.id).map(numberOf));
            if (!alive.has(occurrence)) {
                impact = impact.merge(this.emit(profile, recurrence, occurrence, { paymentDate: null, policy: 'generated', current: null }).impact);
                emitted++;
            }
            last = occurrence;
        }
        return { last, emitted, impact };
    }

    /**
     * Calculado uma vez por emissão, e não por ocorrência: uma diária emite centenas delas, e o
     * horizonte não muda no meio da operação.
     *
     * @return O último dia que uma série fixa grava agora — 12 meses depois de hoje.
     */
    private horizon(): LocalDate {
        const today = this.clock.today();
        return LocalDate.clampedTo(today.period.plusMonths(HORIZON_MONTHS), today.day);
    }

    /**
     * Grava uma ocorrência pelo modelo. O id vem do número, então um número que já existiu e
     * foi excluído é revivido (sync-design §5.6).
     *
     * @param profile Perfil dono.
     * @param recurrence Regra que emite.
     * @param occurrence Número da ocorrência.
     * @param options Data de pagamento (só a 1ª da criação, ou da série recomeçada, vem paga do
     * formulário), se a conta desativada é aceita e a ocorrência editada que esta substitui — a
     * origem desativada que ela já tinha continua aceita, como em qualquer edição.
     * @return A ocorrência e os saldos que ela mexe.
     */
    private emit(
        profile: Profile,
        recurrence: Recurrence,
        occurrence: number,
        options: { readonly paymentDate: LocalDate | null; readonly policy: SelectionPolicy; readonly current: Transaction | null },
    ): Emitted {
        const dueDate = recurrence.schedule.dateOf(occurrence);
        const { template } = recurrence;
        const input: TransactionInput = {
            type: template.type,
            source: this.sourceFor(template.source, dueDate),
            subCategoryId: template.subCategoryId,
            destinationAccountId: template.destinationAccountId,
            partnerId: template.partnerId,
            goalId: template.goalId,
            name: template.name,
            description: template.description,
            value: recurrence.valueOf(occurrence).amount,
            charges: template.charges.amount,
            originCurrency: template.origin.currency.code,
            conversionRate: template.origin.conversionRate,
            dueDate,
            paymentDate: options.paymentDate,
            tagIds: template.tagIds,
        };
        const resolved = this.composer.resolveContainer(profile, input, options.current, options.policy);
        const transaction = Transaction.create({
            ...this.composer.toContent(profile, input, resolved.container),
            id: occurrenceIdFor(recurrence.id, occurrence),
            profileId: profile.id,
            recurrenceId: recurrence.id,
            occurrence,
        });
        this.transactions.insert(transaction);
        return { transaction, impact: resolved.impact.merge(this.impacts.ofTransaction(transaction)) };
    }

    /**
     * Aplica a uma ocorrência do escopo o que mudou na editada.
     *
     * @param profile Perfil dono.
     * @param member Ocorrência do escopo, como está.
     * @param changes O que mudou na editada.
     * @param context Calendário (com o dia âncora novo), se a data mudou e o deslocamento de
     * fatura da editada.
     * @return Os saldos que a revisão mexe.
     */
    private reviseMember(
        profile: Profile,
        member: Transaction,
        changes: TemplateChanges,
        context: { readonly schedule: RecurrenceSchedule; readonly dateChanged: boolean; readonly offset: number | null },
    ): BalanceImpact {
        const dueDate = context.dateChanged ? moveToAnchor(context.schedule.frequency, member.dueDate, context.schedule.anchorDay) : member.dueDate;
        const source = changes.source !== undefined
            ? this.sourceFor(changes.source.kind === 'creditCard' ? { ...changes.source, invoiceOffset: context.offset ?? 0 } : changes.source, dueDate)
            : sourceOf(member);
        const input: TransactionInput = {
            type: member.type,
            source,
            subCategoryId: changes.subCategoryId ?? member.subCategoryId,
            destinationAccountId: changes.destinationAccountId === undefined ? member.destinationAccountId : changes.destinationAccountId,
            partnerId: changes.partnerId === undefined ? member.partnerId : changes.partnerId,
            goalId: changes.goalId === undefined ? member.goalId : changes.goalId,
            name: changes.name ?? member.name,
            description: changes.description === undefined ? member.description : changes.description,
            value: (changes.value ?? member.value).amount,
            charges: (changes.charges ?? member.charges).amount,
            originCurrency: (changes.origin ?? member.origin).currency.code,
            conversionRate: (changes.origin ?? member.origin).conversionRate,
            dueDate,
            paymentDate: member.paymentDate,
            tagIds: changes.tagIds ?? member.tagIds,
        };
        const resolved = this.composer.resolveContainer(profile, input, member, 'generated');
        const revised = member.revise(this.composer.toContent(profile, input, resolved.container));
        this.transactions.update(revised);
        return resolved.impact.merge(this.impacts.ofTransaction(revised));
    }

    /**
     * @param source Origem do modelo.
     * @param dueDate Data da ocorrência.
     * @return A origem da ocorrência; num cartão, a fatura sugerida pela data dela mais o
     * deslocamento escolhido.
     */
    private sourceFor(source: RecurrenceSource, dueDate: LocalDate): TransactionSource {
        if (source.kind === 'account') {
            return source;
        }
        return {
            kind: 'creditCard',
            creditCardId: source.creditCardId,
            invoicePeriod: this.composer.suggestedInvoicePeriod(source.creditCardId, dueDate).plusMonths(source.invoiceOffset),
        };
    }

    /**
     * @param transaction Ocorrência gravada.
     * @return Quantos meses a fatura dela está depois da sugerida pela data; `null` numa conta.
     */
    private offsetOf(transaction: Transaction): number | null {
        const { container } = transaction;
        return container.kind === 'invoice' ? this.composer.suggestedInvoicePeriod(container.creditCardId, transaction.dueDate).monthsUntil(container.period) : null;
    }

    /**
     * @param creditCardId Cartão da compra.
     * @param dueDate Data da compra.
     * @param chosen Fatura escolhida no formulário; `null` aceita a sugerida.
     * @return O deslocamento da fatura escolhida em relação à sugerida.
     */
    private chosenOffset(creditCardId: CreditCardId, dueDate: LocalDate, chosen: YearMonth | null): number {
        const suggested = this.composer.suggestedInvoicePeriod(creditCardId, dueDate);
        return chosen === null ? 0 : suggested.monthsUntil(chosen);
    }

    /**
     * @param profile Perfil dono.
     * @param input Lançamento do formulário.
     * @return O modelo da série, com o deslocamento da fatura escolhida para a 1ª.
     */
    private templateOf(profile: Profile, input: TransactionInput): RecurrenceTemplate {
        const source: RecurrenceSource = input.source.kind === 'account'
            ? input.source
            : { kind: 'creditCard', creditCardId: input.source.creditCardId, invoiceOffset: this.chosenOffset(input.source.creditCardId, input.dueDate, input.source.invoicePeriod) };
        return {
            type: input.type,
            source,
            destinationAccountId: input.destinationAccountId,
            subCategoryId: input.subCategoryId,
            partnerId: input.partnerId,
            goalId: input.goalId,
            name: input.name,
            description: input.description,
            value: Money.of(input.value, profile.currency),
            charges: Money.of(input.charges, profile.currency),
            origin: { currency: input.originCurrency === null ? profile.currency : Currency.of(input.originCurrency), conversionRate: input.conversionRate },
            tagIds: input.tagIds,
        };
    }

    /**
     * @param transaction Lançamento editado ou excluído com escopo.
     * @return A regra viva da série.
     * @throws {BusinessRuleViolation} Quando o lançamento não é de uma série.
     * @throws {NotFoundError} Quando a regra não existe mais.
     */
    private requireSeries(transaction: Transaction): Recurrence {
        if (transaction.recurrenceId === null) {
            throw new BusinessRuleViolation('recurrence-scope-requires-series', 'só lançamentos de uma série têm "esta e as futuras" e "todas"', { field: 'scope' });
        }
        return this.requireRecurrence(transaction.recurrenceId);
    }

    /**
     * @param id Regra procurada.
     * @return A regra viva.
     * @throws {NotFoundError} Quando não existe.
     */
    private requireRecurrence(id: RecurrenceId): Recurrence {
        const recurrence = this.recurrences.findById(id);
        if (recurrence === null) {
            throw new NotFoundError('Recurrence', id);
        }
        return recurrence;
    }
}

/**
 * O que mudou na ocorrência editada; ausente = não mudou. Não tem o tipo porque ele é fixo
 * desde a criação (`Transaction.assertTypeKept`): nenhuma edição o propaga para a série.
 */
type TemplateChanges = Partial<{
    readonly source: RecurrenceSource;
    readonly destinationAccountId: Transaction['destinationAccountId'];
    readonly subCategoryId: Transaction['subCategoryId'];
    readonly partnerId: Transaction['partnerId'];
    readonly goalId: Transaction['goalId'];
    readonly name: string;
    readonly description: string | null;
    readonly value: Money;
    readonly charges: Money;
    readonly origin: Transaction['origin'];
    readonly tagIds: readonly TagId[];
}>;

/**
 * Regra de negócio (Recorrências, database-design §4.12): nos escopos de série, só o que mudou
 * na editada vai para as outras — o resto de cada ocorrência é dela.
 *
 * @param before Ocorrência como estava.
 * @param after Ocorrência como ficou.
 * @return Os campos que mudaram.
 */
function changesBetween(before: Transaction, after: Transaction): TemplateChanges {
    const changes: { -readonly [K in keyof TemplateChanges]: TemplateChanges[K] } = {};
    const beforeSource = sourceKey(before);
    const afterSource = sourceKey(after);
    // Trocar de conta ou de cartão, ou de fatura no mesmo cartão: o deslocamento da editada passa
    // a valer para as outras. Só a data mudar não conta — a fatura gravada é a verdade (§4.7).
    if (beforeSource !== afterSource || (before.container.kind === 'invoice' && after.container.kind === 'invoice' && !before.container.period.equals(after.container.period))) {
        changes.source = after.container.kind === 'statement'
            ? { kind: 'account', accountId: after.container.accountId }
            : { kind: 'creditCard', creditCardId: after.container.creditCardId, invoiceOffset: 0 };
    }
    if (before.destinationAccountId !== after.destinationAccountId) {
        changes.destinationAccountId = after.destinationAccountId;
    }
    if (before.subCategoryId !== after.subCategoryId) {
        changes.subCategoryId = after.subCategoryId;
    }
    if (before.partnerId !== after.partnerId) {
        changes.partnerId = after.partnerId;
    }
    if (before.goalId !== after.goalId) {
        changes.goalId = after.goalId;
    }
    if (before.name !== after.name) {
        changes.name = after.name;
    }
    if (before.description !== after.description) {
        changes.description = after.description;
    }
    if (!before.value.equals(after.value)) {
        changes.value = after.value;
    }
    if (!before.charges.equals(after.charges)) {
        changes.charges = after.charges;
    }
    if (!before.origin.currency.equals(after.origin.currency) || before.origin.conversionRate !== after.origin.conversionRate) {
        changes.origin = after.origin;
    }
    if (before.tagIds.length !== after.tagIds.length || before.tagIds.some((tagId) => !after.tagIds.includes(tagId))) {
        changes.tagIds = after.tagIds;
    }
    return changes;
}

/**
 * @param template Modelo atual.
 * @param changes O que mudou na editada.
 * @param offset Deslocamento de fatura da editada; `null` numa conta.
 * @return O modelo com as mudanças.
 */
function applyChanges(template: RecurrenceTemplate, changes: TemplateChanges, offset: number | null): RecurrenceTemplate {
    const source: RecurrenceSource = changes.source === undefined
        ? template.source
        : changes.source.kind === 'creditCard'
          ? { ...changes.source, invoiceOffset: offset ?? 0 }
          : changes.source;
    return {
        type: template.type,
        source,
        destinationAccountId: changes.destinationAccountId === undefined ? template.destinationAccountId : changes.destinationAccountId,
        subCategoryId: changes.subCategoryId ?? template.subCategoryId,
        partnerId: changes.partnerId === undefined ? template.partnerId : changes.partnerId,
        goalId: changes.goalId === undefined ? template.goalId : changes.goalId,
        name: changes.name ?? template.name,
        description: changes.description === undefined ? template.description : changes.description,
        value: changes.value ?? template.value,
        charges: changes.charges ?? template.charges,
        origin: changes.origin ?? template.origin,
        tagIds: changes.tagIds ?? template.tagIds,
    };
}

/**
 * @param member Ocorrência.
 * @param current Ocorrência editada.
 * @param scope Escopo pedido.
 * @return Se a ocorrência está no escopo. Regra de negócio (Recorrências, database-design
 * §4.12): "futuras" é a editada e as de número maior, nunca pela data — uma ocorrência movida
 * para depois da editada continua anterior a ela na série.
 */
function inScope(member: Transaction, current: Transaction, scope: EditScope): boolean {
    switch (scope) {
        case 'single':
            return member.id === current.id;
        case 'future':
            return member.id === current.id || numberOf(member) >= numberOf(current);
        case 'all':
            return true;
    }
}

/**
 * @param transaction Ocorrência de uma série.
 * @return O número dela na série. Toda ocorrência tem número (database-design §4.12); o 1 só
 * cobre o tipo anulável de `occurrence`, que também serve aos lançamentos avulsos.
 */
function numberOf(transaction: Transaction): number {
    return transaction.occurrence ?? 1;
}

/**
 * O que a edição faz com a série (database-design §4.12, "Mudar a série").
 * Regra de negócio (Recorrências): outra periodicidade ou outro tipo recomeça a série numa regra
 * nova (`restart`); outra quantidade de parcelas ou outro término mantém a regra e só cria ou
 * apaga o que a mudança exige (`reshape`).
 */
type SeriesChange =
    | { readonly kind: 'none' }
    | { readonly kind: 'reshape'; readonly repeat: RepeatInput }
    | { readonly kind: 'restart'; readonly repeat: RepeatInput };

/**
 * @param recurrence Regra como está.
 * @param repeat Série pedida no formulário; `null` não muda a série.
 * @return O que a edição faz com a série.
 */
function seriesChangeOf(recurrence: Recurrence, repeat: RepeatInput | null): SeriesChange {
    const { terms } = recurrence;
    if (repeat === null) {
        return { kind: 'none' };
    }
    if (repeat.frequency !== recurrence.schedule.frequency || repeat.kind !== terms.kind) {
        return { kind: 'restart', repeat };
    }
    const same = repeat.kind === 'installments'
        ? terms.kind === 'installments' && repeat.installments === terms.installments
        : terms.kind === 'fixed' && (repeat.endAt === null ? terms.endAt === null : terms.endAt !== null && repeat.endAt.equals(terms.endAt));
    return same ? { kind: 'none' } : { kind: 'reshape', repeat };
}

/**
 * Regra de negócio (Recorrências, database-design §4.12): parceladas são gravadas inteiras;
 * fixas, até 12 meses depois de hoje — também quando a série muda, para que trocar a
 * periodicidade nunca grave além do horizonte.
 *
 * @param terms Forma da série.
 * @param schedule Calendário.
 * @param occurrence Número candidato.
 * @param horizon Último dia que uma fixa grava agora.
 * @return `true` quando a ocorrência deve ser gravada agora.
 */
function withinReach(terms: RecurrenceTerms, schedule: RecurrenceSchedule, occurrence: number, horizon: LocalDate): boolean {
    return terms.kind === 'installments' || !horizon.isBefore(schedule.dateOf(occurrence));
}

/**
 * @param repeat Repetição pedida na criação.
 * @return A forma da série.
 */
function termsOf(repeat: RepeatInput): RecurrenceTerms {
    return repeat.kind === 'installments'
        ? { kind: 'installments', installments: repeat.installments, valueType: repeat.valueType }
        : { kind: 'fixed', endAt: repeat.endAt };
}

/**
 * @param transaction Ocorrência.
 * @return A origem como a rota recebe, mantendo a fatura em que ela está.
 */
function sourceOf(transaction: Transaction): TransactionSource {
    const { container } = transaction;
    return container.kind === 'statement'
        ? { kind: 'account', accountId: container.accountId }
        : { kind: 'creditCard', creditCardId: container.creditCardId, invoicePeriod: container.period };
}

/**
 * @param transaction Ocorrência.
 * @return A conta ou o cartão de origem, para comparar.
 */
function sourceKey(transaction: Transaction): string {
    const { container } = transaction;
    return container.kind === 'statement' ? `account:${container.accountId}` : `creditCard:${container.creditCardId}`;
}

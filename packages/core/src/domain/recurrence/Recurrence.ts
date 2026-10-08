import { BusinessRuleViolation, InvalidValueError } from '../shared/errors.ts';
import type { AccountId, CreditCardId, GoalId, PartnerId, ProfileId, RecurrenceId, SubCategoryId, TagId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import { Money } from '../shared/Money.ts';
import { normalizedDescription, type OriginCurrency } from '../transaction/Transaction.ts';
import type { TransactionType } from '../transaction/TransactionType.ts';
import type { RecurrenceSchedule } from './RecurrenceSchedule.ts';

/** Como o valor digitado de um parcelamento se lê: o total da compra ou o valor de cada parcela. */
export type InstallmentValueType = 'total' | 'perInstallment';

/**
 * Forma da série (database-design §4.12): parcelada termina por quantidade, fixa termina por
 * data ou nunca. União discriminada porque cada forma só tem os seus campos — `installments` e
 * `end_at` são exclusivos por tipo.
 */
export type RecurrenceTerms =
    | { readonly kind: 'installments'; readonly installments: number; readonly valueType: InstallmentValueType }
    | { readonly kind: 'fixed'; readonly endAt: LocalDate | null };

/**
 * Origem do modelo. Num cartão, guarda o deslocamento da fatura: quantos meses a fatura
 * escolhida está depois da sugerida pela data de cada ocorrência.
 */
export type RecurrenceSource =
    | { readonly kind: 'account'; readonly accountId: AccountId }
    | { readonly kind: 'creditCard'; readonly creditCardId: CreditCardId; readonly invoiceOffset: number };

/** O que a regra emite em cada ocorrência — os campos de `transactions` que o usuário edita. */
export interface RecurrenceTemplate {
    readonly type: TransactionType;
    readonly source: RecurrenceSource;
    readonly destinationAccountId: AccountId | null;
    readonly subCategoryId: SubCategoryId;
    readonly partnerId: PartnerId | null;
    readonly goalId: GoalId | null;
    readonly name: string;
    readonly description: string | null;
    /** O total da compra quando `valueType = total`; senão o valor de cada ocorrência. */
    readonly value: Money;
    readonly charges: Money;
    readonly origin: OriginCurrency;
    /** Copiadas para todas as ocorrências (regra de negócio: tags valem para a série inteira). */
    readonly tagIds: readonly TagId[];
}

/** Dados completos de uma regra. */
export interface RecurrenceProps {
    readonly id: RecurrenceId;
    readonly profileId: ProfileId;
    readonly terms: RecurrenceTerms;
    readonly schedule: RecurrenceSchedule;
    /** Marca d'água: quantas ocorrências a regra já emitiu; só avança. */
    readonly materializedCount: number;
    readonly template: RecurrenceTemplate;
}

/**
 * A regra que produz transações repetidas (database-design §4.12). Guarda o modelo e o
 * calendário; cada ocorrência emitida é uma transação real, e a regra só decide quais números
 * existem, quando vencem e quanto vale cada um.
 */
export class Recurrence implements RecurrenceProps {
    public readonly id: RecurrenceId;
    public readonly profileId: ProfileId;
    public readonly terms: RecurrenceTerms;
    public readonly schedule: RecurrenceSchedule;
    public readonly materializedCount: number;
    public readonly template: RecurrenceTemplate;

    /**
     * O modelo é normalizado aqui, pelas mesmas regras da `Transaction` (nome e descrição
     * aparados, tags sem repetição), para que ele sempre bata com as ocorrências que emite.
     *
     * @param props Dados já validados por `create` ou lidos do banco por `restore`.
     */
    private constructor(props: RecurrenceProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.terms = props.terms;
        this.schedule = props.schedule;
        this.materializedCount = props.materializedCount;
        const { template } = props;
        this.template = { ...template, name: template.name.trim(), description: normalizedDescription(template.description), tagIds: Object.freeze([...new Set(template.tagIds)]) };
        Object.freeze(this);
    }

    /**
     * @param props Regra nova ou revisada.
     * @return A regra.
     * @throws {InvalidValueError} Quando a quantidade de parcelas ou a marca d'água é inválida.
     * @throws {BusinessRuleViolation} Quando a fixa termina antes de começar.
     */
    public static create(props: RecurrenceProps): Recurrence {
        const { terms } = props;
        if (terms.kind === 'installments' && (!Number.isInteger(terms.installments) || terms.installments < 1)) {
            throw new InvalidValueError('installments', `quantidade de parcelas inválida: ${terms.installments}`);
        }
        if (!Number.isInteger(props.materializedCount) || props.materializedCount < 0) {
            throw new InvalidValueError('materializedCount', `marca d'água inválida: ${props.materializedCount}`);
        }
        // Regra de negócio (Recorrências): a fixa com fim emite pelo menos a 1ª ocorrência; um
        // fim antes dela é um erro de digitação, não uma série vazia.
        if (terms.kind === 'fixed' && terms.endAt !== null && terms.endAt.isBefore(props.schedule.dateOf(1))) {
            throw new BusinessRuleViolation('recurrence-end-before-start', 'a série termina antes da primeira ocorrência', { field: 'endAt' });
        }
        return new Recurrence(props);
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A regra, sem revalidar — o que se grava já passou por `create`.
     */
    public static restore(props: RecurrenceProps): Recurrence {
        return new Recurrence(props);
    }

    /**
     * @param occurrence Número da ocorrência.
     * @return `true` quando a série tem a ocorrência (`seriesHasOccurrence`).
     */
    public hasOccurrence(occurrence: number): boolean {
        return seriesHasOccurrence(this.terms, this.schedule, occurrence);
    }

    /**
     * @param occurrence Número da ocorrência.
     * @return O valor dela (`seriesValueOf`).
     */
    public valueOf(occurrence: number): Money {
        return seriesValueOf(this.terms, this.template.value, occurrence);
    }

    /**
     * @param changes Partes a trocar.
     * @return Uma nova regra com as partes trocadas e revalidada.
     */
    public revise(changes: Partial<Pick<RecurrenceProps, 'terms' | 'schedule' | 'template' | 'materializedCount'>>): Recurrence {
        return Recurrence.create({ ...this.props(), ...changes });
    }

    /**
     * Encerra a série antes de uma ocorrência — "excluir esta e as futuras" —, para que o
     * complemento não emita mais nada a partir dela.
     * Regra de negócio (Recorrências, database-design §4.12): a fixa termina na véspera da data
     * que o **calendário** dá à ocorrência, e não da data gravada nela. A gravada pode ter sido
     * movida em "somente esta": movida para depois, o fim deixava a série com a ocorrência que o
     * usuário excluiu, e o complemento a emitia de novo; movida para antes da 1ª, o fim ficava
     * antes do início e toda edição seguinte da série era recusada.
     * Regra de negócio (Parcelamento): no "valor total", o total passa a ser a soma das parcelas
     * que ficam — senão o painel mostraria o total da compra inteira sobre menos parcelas.
     *
     * @param occurrence Número da primeira ocorrência excluída.
     * @return A regra encerrada, ou `null` quando não sobra nenhuma ocorrência (a regra inteira
     * é excluída).
     */
    public endingBefore(occurrence: number): Recurrence | null {
        if (occurrence <= 1) {
            return null;
        }
        if (this.terms.kind === 'installments') {
            const installments = occurrence - 1;
            const template = this.terms.valueType === 'total' ? { ...this.template, value: this.sumOf(installments) } : this.template;
            return this.revise({ terms: { ...this.terms, installments }, template });
        }
        return this.revise({ terms: { kind: 'fixed', endAt: this.schedule.dateOf(occurrence).plusDays(-1) } });
    }

    /**
     * Troca o dia âncora a partir da data nova de uma ocorrência ("esta e as futuras" com a data
     * trocada) sem mudar quais ocorrências a série tem.
     * Regra de negócio (Recorrências, database-design §4.12): trocar a data muda o dia, nunca o
     * mês de cada ocorrência — então a última ocorrência de uma fixa com fim continua sendo a
     * última, e o fim acompanha o dia novo. Mantido o fim digitado, o dia novo podia levar a
     * última para depois dele (ela continuava gravada, mas fora da série) ou trazer a seguinte
     * para antes dele, e a 1ª podia passar do fim numa edição que nem mexeu no término.
     *
     * @param date Data nova da ocorrência editada.
     * @return A regra com o calendário novo e, numa fixa com fim, o fim entre a data nova da
     * última ocorrência e a véspera da seguinte — o mesmo fim quando ele já estava nesse intervalo.
     * @throws {BusinessRuleViolation} Na série diária, que não tem dia âncora.
     */
    public reanchoredOn(date: LocalDate): Recurrence {
        const schedule = this.schedule.withAnchorFrom(date);
        const last = this.lastOccurrence();
        if (this.terms.kind === 'installments' || this.terms.endAt === null || last === null || last < 1) {
            return this.revise({ schedule });
        }
        const earliest = schedule.dateOf(last);
        const latest = schedule.dateOf(last + 1).plusDays(-1);
        const { endAt } = this.terms;
        const kept = endAt.isBefore(earliest) ? earliest : latest.isBefore(endAt) ? latest : endAt;
        return this.revise({ schedule, terms: { kind: 'fixed', endAt: kept } });
    }

    /**
     * Última ocorrência da série — de onde uma quantidade maior de parcelas ou um término mais
     * adiante começa a criar, e a que um dia âncora novo precisa manter dentro da série.
     *
     * @return O número da última ocorrência; `0` se a série não tiver nenhuma (só numa regra
     * lida do banco em estado inválido) e `null` numa fixa sem fim, que tem todos os números.
     */
    public lastOccurrence(): number | null {
        if (this.terms.kind === 'installments') {
            return this.terms.installments;
        }
        if (this.terms.endAt === null) {
            return null;
        }
        let occurrence = 0;
        while (this.hasOccurrence(occurrence + 1)) {
            occurrence++;
        }
        return occurrence;
    }

    /**
     * Valor de uma ocorrência que não carrega o resto do arredondamento — o que as parcelas que
     * uma nova quantidade cria recebem quando o usuário não mexeu no valor.
     * Regra de negócio (Parcelamento, database-design §4.12): no "valor total" o resto vai só
     * para a 1ª parcela; copiá-lo para as novas faria a série somar mais que a compra.
     *
     * @return No "valor total", o valor da última parcela (o total, numa parcela única); nas
     * demais formas, o valor do modelo.
     */
    public regularValue(): Money {
        return this.terms.kind === 'installments' && this.terms.valueType === 'total' ? this.valueOf(this.terms.installments) : this.template.value;
    }

    /**
     * @param installments Quantas parcelas, a partir da 1ª, somar.
     * @return A soma dos valores delas, pela mesma divisão que as gerou.
     */
    private sumOf(installments: number): Money {
        let total = Money.zero(this.template.value.currency);
        for (let occurrence = 1; occurrence <= installments; occurrence++) {
            total = total.add(this.valueOf(occurrence));
        }
        return total;
    }

    /**
     * @return Os dados da regra como objeto simples — o ponto de partida das revisões, que o
     * espalhamento da instância não daria (ele perde o protótipo e copiaria só por acaso).
     */
    private props(): RecurrenceProps {
        return {
            id: this.id,
            profileId: this.profileId,
            terms: this.terms,
            schedule: this.schedule,
            materializedCount: this.materializedCount,
            template: this.template,
        };
    }
}

/**
 * Diz se a série tem a ocorrência de um número. Fica fora da classe para que a prévia das
 * parcelas use a mesma regra sem precisar de uma regra gravada inteira.
 *
 * @param terms Forma da série.
 * @param schedule Calendário.
 * @param occurrence Número da ocorrência.
 * @return `true` até a última parcela, ou enquanto a fixa não passou do fim.
 */
export function seriesHasOccurrence(terms: RecurrenceTerms, schedule: RecurrenceSchedule, occurrence: number): boolean {
    if (occurrence < 1) {
        return false;
    }
    if (terms.kind === 'installments') {
        return occurrence <= terms.installments;
    }
    return terms.endAt === null || !terms.endAt.isBefore(schedule.dateOf(occurrence));
}

/**
 * Valor da ocorrência de um número.
 * Regra de negócio (Parcelamento, database-design §4.12): no "valor total", cada parcela é o
 * total dividido pelo número de parcelas, e a diferença do arredondamento vai para a 1ª.
 *
 * @param terms Forma da série.
 * @param value Valor do modelo: o total, ou o de cada ocorrência.
 * @param occurrence Número da ocorrência.
 * @return O valor dela.
 */
export function seriesValueOf(terms: RecurrenceTerms, value: Money, occurrence: number): Money {
    if (terms.kind === 'installments' && terms.valueType === 'total') {
        return value.split(terms.installments)[occurrence - 1] ?? value;
    }
    return value;
}

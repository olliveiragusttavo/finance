import type { Currency } from '../shared/Currency.ts';
import { BusinessRuleViolation, InvalidValueError } from '../shared/errors.ts';
import type { AccountId, GoalId, PartnerId, ProfileId, RecurrenceId, SubCategoryId, TagId, TransactionId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import type { TransactionContainer } from './TransactionContainer.ts';
import { destinationEffect, feedsGoal, movesToDestination, originEffect, type TransactionType } from './TransactionType.ts';

const NAME_MAX_LENGTH = 100;

/**
 * Proveniência de um valor em moeda estrangeira. Só registro: `value` já chega convertido
 * para a moeda do perfil e **nenhum cálculo multiplica pela taxa** (database-design §4.13).
 */
export interface OriginCurrency {
    readonly currency: Currency;
    readonly conversionRate: number;
}

/** Campos que o usuário edita numa transação. */
export interface TransactionContent {
    readonly type: TransactionType;
    readonly container: TransactionContainer;
    readonly subCategoryId: SubCategoryId;
    readonly destinationAccountId: AccountId | null;
    readonly partnerId: PartnerId | null;
    readonly goalId: GoalId | null;
    readonly name: string;
    readonly description: string | null;
    /** Sempre na moeda do perfil; o sinal inverte o efeito do tipo (estorno). */
    readonly value: Money;
    /** Juros e tarifas; sempre custo da origem. */
    readonly charges: Money;
    readonly origin: OriginCurrency;
    readonly dueDate: LocalDate;
    /** `null` enquanto a transação está em aberto; preenchida exatamente quando paga. */
    readonly paymentDate: LocalDate | null;
    /** Tags do lançamento, sem repetição; vazio quando não tem nenhuma (database-design §4.14). */
    readonly tagIds: readonly TagId[];
}

/** Dados completos de uma transação. */
export interface TransactionProps extends TransactionContent {
    readonly id: TransactionId;
    /** Perfil dono, derivado do contêiner; usado para checar posse de toda referência. */
    readonly profileId: ProfileId;
    /** Preenchido só em ocorrências emitidas por uma recorrência; o usuário não edita. */
    readonly recurrenceId: RecurrenceId | null;
    /**
     * Número da ocorrência na série (a 1ª é 1), preenchido exatamente com `recurrenceId`; é a
     * chave do id determinístico da ocorrência (database-design §4.12).
     */
    readonly occurrence: number | null;
}

/**
 * Toda movimentação de dinheiro — receita, despesa, transferência ou investimento
 * (database-design §4.13). A entidade guarda os invariantes que relacionam campos da
 * própria linha; o que depende de outras linhas (posse das referências, perfil
 * empresarial) é verificado no ponto de controle da camada Service (§3.10).
 */
export class Transaction implements TransactionProps {
    public readonly id: TransactionId;
    public readonly profileId: ProfileId;
    public readonly recurrenceId: RecurrenceId | null;
    public readonly occurrence: number | null;
    public readonly type: TransactionType;
    public readonly container: TransactionContainer;
    public readonly subCategoryId: SubCategoryId;
    public readonly destinationAccountId: AccountId | null;
    public readonly partnerId: PartnerId | null;
    public readonly goalId: GoalId | null;
    public readonly name: string;
    public readonly description: string | null;
    public readonly value: Money;
    public readonly charges: Money;
    public readonly origin: OriginCurrency;
    public readonly dueDate: LocalDate;
    public readonly paymentDate: LocalDate | null;
    public readonly tagIds: readonly TagId[];

    /**
     * @param props Dados da transação; privado e congelado para que toda criação e edição
     * passe pelos invariantes de `create` e `revise`.
     */
    private constructor(props: TransactionProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.recurrenceId = props.recurrenceId;
        this.occurrence = props.occurrence;
        this.type = props.type;
        this.container = props.container;
        this.subCategoryId = props.subCategoryId;
        this.destinationAccountId = props.destinationAccountId;
        this.partnerId = props.partnerId;
        this.goalId = props.goalId;
        this.name = props.name;
        this.description = props.description;
        this.value = props.value;
        this.charges = props.charges;
        this.origin = props.origin;
        this.dueDate = props.dueDate;
        this.paymentDate = props.paymentDate;
        // Cópia congelada: o array veio de fora e, compartilhado, poderia ser mutado depois.
        this.tagIds = Object.freeze([...props.tagIds]);
        Object.freeze(this);
    }

    /**
     * Cria uma transação nova, validando os invariantes da linha.
     *
     * @param props Dados da transação, com id já gerado pela aplicação (database-design §3.5).
     * @return A transação.
     * @throws {InvalidValueError} Quando um campo isolado é inválido (nome, taxa).
     * @throws {BusinessRuleViolation} Quando campos se contradizem (destino em receita, meta em despesa).
     */
    public static create(props: TransactionProps): Transaction {
        return new Transaction(Transaction.validated(props));
    }

    /**
     * Reconstitui uma transação persistida, sem revalidar: a linha pode ter perdido o
     * destino por `ON DELETE SET NULL` (database-design §4.13), estado que não se cria mas
     * que se lê.
     *
     * @param props Dados lidos do banco pelo Repository.
     * @return A transação.
     */
    public static restore(props: TransactionProps): Transaction {
        return new Transaction(props);
    }

    /**
     * Edita os campos do usuário. Identidade, perfil, tipo e vínculo com a recorrência não
     * mudam: o id de uma ocorrência é derivado da data em que foi gerada e nunca é recalculado
     * (sync-design §5.6), e o tipo é fixo desde a criação (`assertTypeKept`).
     *
     * @param content Novo conteúdo completo da transação.
     * @return A transação editada.
     * @throws {InvalidValueError} Quando um campo isolado é inválido.
     * @throws {BusinessRuleViolation} Quando campos se contradizem ou o tipo mudou.
     */
    public revise(content: TransactionContent): Transaction {
        this.assertTypeKept(content.type);
        return new Transaction(Transaction.validated({ ...content, id: this.id, profileId: this.profileId, recurrenceId: this.recurrenceId, occurrence: this.occurrence }));
    }

    /**
     * Recusa a troca de tipo numa edição. Fica exposto, e não só dentro de `revise`, porque
     * recomeçar uma série grava a editada de novo pelo modelo da regra nova sem passar por
     * `revise`, e a regra precisa valer também ali.
     * Regra de negócio (Transação, database-design §4.13): o tipo é fixo desde a criação — uma
     * despesa continua despesa, uma receita continua receita. Trocar o tipo inverte a direção
     * do efeito no saldo, cria ou some com a conta de destino e muda quem pode alimentar uma
     * meta; aceitar isso numa edição deixava vínculos inválidos para trás (meta numa despesa,
     * revisão de 2026-10-08, item 1). Lançar com outro tipo é excluir e lançar de novo.
     *
     * @param type Tipo que a edição pede.
     * @return void
     * @throws {BusinessRuleViolation} Quando o tipo pedido difere do gravado.
     */
    public assertTypeKept(type: TransactionType): void {
        if (type !== this.type) {
            throw new BusinessRuleViolation('transaction-type-locked', `o tipo do lançamento não muda depois de criado (${this.type} → ${type})`, { field: 'type' });
        }
    }

    /**
     * Marca ou desmarca o pagamento sem passar pela edição completa. Recebe o contêiner junto
     * porque, numa transação de conta, a data de pagamento decide o extrato (`cashDate`):
     * pagar em outro mês muda a transação de extrato. Não revalida o conteúdo porque nem a
     * data de pagamento nem o contêiner participam de um invariante da linha; revalidar
     * recusaria marcar como paga uma transferência antiga que perdeu o destino por
     * `ON DELETE SET NULL` (database-design §4.13).
     *
     * @param paymentDate Data do pagamento, ou `null` para voltar a ficar em aberto.
     * @param container Contêiner resolvido para a nova data pelo Service; numa transação de
     * cartão, a mesma fatura.
     * @return Uma nova transação com a situação trocada.
     */
    public withPaymentDate(paymentDate: LocalDate | null, container: TransactionContainer): Transaction {
        return new Transaction({
            id: this.id,
            profileId: this.profileId,
            recurrenceId: this.recurrenceId,
            occurrence: this.occurrence,
            type: this.type,
            container,
            subCategoryId: this.subCategoryId,
            destinationAccountId: this.destinationAccountId,
            partnerId: this.partnerId,
            goalId: this.goalId,
            name: this.name,
            description: this.description,
            value: this.value,
            charges: this.charges,
            origin: this.origin,
            dueDate: this.dueDate,
            paymentDate,
            tagIds: this.tagIds,
        });
    }

    /**
     * @return `true` quando a transação já foi paga. Derivado de `paymentDate` para que
     * `paid` e `payment_date` nunca discordem — regra que o banco não garante (§3.10).
     */
    public isPaid(): boolean {
        return this.paymentDate !== null;
    }

    /**
     * Data em que o dinheiro de fato se move: a do pagamento, ou o vencimento enquanto a
     * transação está em aberto.
     * Regra de negócio (Extrato): a transação de conta cai no extrato do mês desta data — paga,
     * no mês do pagamento; em aberto, no do vencimento. Vale também para a conta de destino de
     * transferências e investimentos, porque a transferência é uma linha só, com uma data só
     * dos dois lados (database-design §4.6 e §4.13). Transação de cartão não usa esta data
     * para o contêiner: quem decide é a fatura escolhida (§4.7).
     *
     * @return A data de pagamento, ou o vencimento quando em aberto.
     */
    public cashDate(): LocalDate {
        return this.paymentDate ?? this.dueDate;
    }

    /**
     * @return O efeito desta transação no saldo do contêiner de origem.
     */
    public originEffect(): Money {
        return originEffect(this.type, this.value, this.charges);
    }

    /**
     * @return O efeito no saldo da conta de destino, ou `null` quando não há destino.
     */
    public destinationEffect(): Money | null {
        return this.destinationAccountId === null ? null : destinationEffect(this.value);
    }

    /**
     * Ponto único dos invariantes da linha, usado por `create` e `revise`.
     *
     * @param props Dados a validar.
     * @return Os mesmos dados, com o nome e a descrição normalizados e as tags sem repetição.
     * @throws {InvalidValueError} Quando um campo isolado é inválido.
     * @throws {BusinessRuleViolation} Quando campos se contradizem.
     */
    private static validated(props: TransactionProps): TransactionProps {
        // O número e a série andam juntos: um sem o outro não identifica a ocorrência.
        if ((props.recurrenceId === null) !== (props.occurrence === null) || (props.occurrence !== null && (!Number.isInteger(props.occurrence) || props.occurrence < 1))) {
            throw new InvalidValueError('occurrence', `número de ocorrência inválido: ${String(props.occurrence)}`);
        }
        const name = props.name.trim();
        if (name.length === 0 || name.length > NAME_MAX_LENGTH) {
            throw new InvalidValueError('name', `o nome precisa ter de 1 a ${NAME_MAX_LENGTH} caracteres`);
        }
        if (!Number.isFinite(props.origin.conversionRate) || props.origin.conversionRate <= 0) {
            throw new InvalidValueError('conversionRate', `a taxa de conversão precisa ser positiva: ${props.origin.conversionRate}`);
        }
        if (!props.value.currency.equals(props.charges.currency)) {
            throw new InvalidValueError('charges', 'valor e encargos precisam estar na moeda do perfil');
        }
        // Regra de negócio (Transferência): transferência e investimento levam dinheiro a
        // uma conta de destino, e só eles têm uma (database-design §4.13).
        if (movesToDestination(props.type) && props.destinationAccountId === null) {
            throw new BusinessRuleViolation('destination-required', 'transferências e investimentos precisam de uma conta de destino');
        }
        if (!movesToDestination(props.type) && props.destinationAccountId !== null) {
            throw new BusinessRuleViolation('destination-not-allowed', 'só transferências e investimentos têm conta de destino');
        }
        // Regra de negócio (Metas): a meta é um valor que se quer guardar, e só receita e
        // transferência levam dinheiro a ela (desktop-mvp-plan Fase 9.3). Despesa é gasto e
        // investimento já tem destino próprio; nenhum dos dois junta dinheiro para a meta.
        if (props.goalId !== null && !feedsGoal(props.type)) {
            throw new BusinessRuleViolation('goal-requires-saving-type', 'só receitas e transferências podem ser vinculadas a uma meta', { field: 'goalId' });
        }
        // Uma transferência para a própria conta somaria zero e apareceria duas vezes no
        // extrato; não representa movimento nenhum.
        if (props.container.kind === 'statement' && props.destinationAccountId === props.container.accountId) {
            throw new BusinessRuleViolation('destination-equals-origin', 'a conta de destino precisa ser diferente da conta de origem');
        }
        // A mesma tag duas vezes seria o mesmo vínculo duas vezes, que o índice único do par
        // recusaria com erro de SQL (database-design §4.14); a repetição é descartada.
        return { ...props, name, description: normalizedDescription(props.description), tagIds: [...new Set(props.tagIds)] };
    }
}

/**
 * Normalização única da descrição de um lançamento, exportada para que o modelo de uma
 * recorrência guarde a descrição do mesmo jeito que as ocorrências que ele emite — uma cópia
 * da regra em outro lugar podia divergir, e o modelo deixaria de bater com as ocorrências.
 *
 * @param description Descrição como veio.
 * @return A descrição aparada, ou `null` quando vazia.
 */
export function normalizedDescription(description: string | null): string | null {
    const trimmed = description?.trim() ?? null;
    return trimmed === '' ? null : trimmed;
}

import type { Currency } from '../shared/Currency.ts';
import { BusinessRuleViolation, InvalidValueError } from '../shared/errors.ts';
import type { AccountId, GoalId, PartnerId, ProfileId, RecurrenceId, SubCategoryId, TransactionId } from '../shared/ids.ts';
import type { LocalDate } from '../shared/LocalDate.ts';
import type { Money } from '../shared/Money.ts';
import type { TransactionContainer } from './TransactionContainer.ts';
import { destinationEffect, movesToDestination, originEffect, type TransactionType } from './TransactionType.ts';

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
}

/** Dados completos de uma transação. */
export interface TransactionProps extends TransactionContent {
    readonly id: TransactionId;
    /** Perfil dono, derivado do contêiner; usado para checar posse de toda referência. */
    readonly profileId: ProfileId;
    /** Preenchido só em ocorrências emitidas por uma recorrência; o usuário não edita. */
    readonly recurrenceId: RecurrenceId | null;
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

    /**
     * @param props Dados da transação; privado e congelado para que toda criação e edição
     * passe pelos invariantes de `create` e `revise`.
     */
    private constructor(props: TransactionProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.recurrenceId = props.recurrenceId;
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
        Object.freeze(this);
    }

    /**
     * Cria uma transação nova, validando os invariantes da linha.
     *
     * @param props Dados da transação, com id já gerado pela aplicação (database-design §3.5).
     * @return A transação.
     * @throws {InvalidValueError} Quando um campo isolado é inválido (nome, taxa).
     * @throws {BusinessRuleViolation} Quando campos se contradizem (destino em receita).
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
     * Edita os campos do usuário. Identidade, perfil e vínculo com a recorrência não mudam:
     * o id de uma ocorrência é derivado da data em que foi gerada e nunca é recalculado
     * (sync-design §5.6).
     *
     * @param content Novo conteúdo completo da transação.
     * @return A transação editada.
     * @throws {InvalidValueError} Quando um campo isolado é inválido.
     * @throws {BusinessRuleViolation} Quando campos se contradizem.
     */
    public revise(content: TransactionContent): Transaction {
        return new Transaction(Transaction.validated({ ...content, id: this.id, profileId: this.profileId, recurrenceId: this.recurrenceId }));
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
     * @return Os mesmos dados, com o nome normalizado.
     * @throws {InvalidValueError} Quando um campo isolado é inválido.
     * @throws {BusinessRuleViolation} Quando campos se contradizem.
     */
    private static validated(props: TransactionProps): TransactionProps {
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
        // Uma transferência para a própria conta somaria zero e apareceria duas vezes no
        // extrato; não representa movimento nenhum.
        if (props.container.kind === 'statement' && props.destinationAccountId === props.container.accountId) {
            throw new BusinessRuleViolation('destination-equals-origin', 'a conta de destino precisa ser diferente da conta de origem');
        }
        const description = props.description?.trim() ?? null;
        return { ...props, name, description: description === '' ? null : description };
    }
}

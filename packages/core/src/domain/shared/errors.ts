/**
 * Conjunto fechado de códigos de erro que atravessam a fronteira UI ↔ núcleo. É fechado
 * porque a UI trata cada código de forma exaustiva, verificada pelo compilador
 * (desktop-shell-design §5.3); um código novo precisa quebrar o build da UI, não cair num
 * `default` silencioso.
 */
export type ErrorCode =
    | 'VALIDATION_FAILED'
    | 'NOT_FOUND'
    | 'BUSINESS_RULE_VIOLATION'
    | 'CONFLICT'
    | 'SCHEMA_NEWER_THAN_APP'
    | 'INTERNAL';

/**
 * Detalhes serializáveis de um erro. Só tipos primitivos, porque o resultado atravessa o
 * IPC do Electron por structured clone e chegaria sem nada que não fosse dado simples.
 */
export type ErrorDetails = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Raiz dos erros esperados do domínio. Existe para separar o que é falha prevista — e vira
 * um `CoreResult` com código — do que é bug, que vira erro genérico com log
 * (desktop-shell-design §5.3).
 */
export abstract class DomainError extends Error {
    public abstract readonly code: ErrorCode;

    /**
     * @param message Mensagem técnica, em PT-BR, para log e depuração; a UI decide o texto
     * mostrado a partir do código e dos detalhes, não desta mensagem.
     * @param details Dados estruturados do erro; servem para a UI montar uma mensagem
     * específica sem precisar interpretar texto livre.
     */
    protected constructor(message: string, public readonly details: ErrorDetails = {}) {
        super(message);
        this.name = new.target.name;
    }
}

/**
 * Um valor recebido não respeita o domínio (data inexistente, moeda inválida, id
 * malformado). É erro de entrada, não bug, por isso compartilha o código da validação da
 * camada Request.
 */
export class InvalidValueError extends DomainError {
    public readonly code = 'VALIDATION_FAILED';

    /**
     * @param field Nome do campo ou conceito inválido; permite à UI apontar o campo do
     * formulário que precisa ser corrigido.
     * @param reason Explicação técnica do motivo da rejeição, para log.
     */
    public constructor(field: string, reason: string) {
        super(`Valor inválido em "${field}": ${reason}`, { field, reason });
    }
}

/**
 * A linha procurada não existe ou foi excluída (soft delete). Os dois casos são o mesmo
 * erro de propósito: para o usuário uma linha excluída simplesmente não existe mais.
 */
export class NotFoundError extends DomainError {
    public readonly code = 'NOT_FOUND';

    /**
     * @param entity Nome da entidade procurada; diz à UI o que não foi encontrado.
     * @param id Identificador procurado; necessário para depurar referências quebradas.
     */
    public constructor(entity: string, id: string) {
        super(`${entity} não encontrado(a): ${id}`, { entity, id });
    }
}

/**
 * Conjunto fechado das regras que o núcleo recusa com `BUSINESS_RULE_VIOLATION`. É fechado
 * pelo mesmo motivo do `ErrorCode`: a UI escolhe a mensagem de cada regra num mapa
 * exaustivo, e uma regra nova precisa quebrar a compilação do `client` em vez de cair na
 * mensagem genérica sem ninguém perceber.
 */
export type BusinessRule =
    | 'account-disabled'
    | 'credit-card-disabled'
    | 'destination-equals-origin'
    | 'destination-not-allowed'
    | 'destination-required'
    | 'invoice-already-paid'
    | 'invoice-not-paid'
    | 'move-target-deleted'
    | 'partner-requires-business-profile'
    | 'profile-currency-locked'
    | 'recurrence-occurrence-date-taken'
    | 'reference-outside-profile'
    | 'sub-category-in-use';

/**
 * Uma regra de negócio que relaciona colunas ou linhas foi violada — o tipo de regra que
 * o banco deliberadamente não garante (database-design §3.10) e que, por isso, precisa de
 * um único ponto de controle na camada Service.
 */
export class BusinessRuleViolation extends DomainError {
    public readonly code = 'BUSINESS_RULE_VIOLATION';

    /**
     * @param rule Identificador estável da regra violada (ex.: `destination-required`); é o
     * que a UI usa para escolher a mensagem, por isso não muda com o texto.
     * @param message Descrição técnica da violação, para log.
     * @param details Dados extras da violação para a UI detalhar a mensagem.
     */
    public constructor(rule: BusinessRule, message: string, details: ErrorDetails = {}) {
        super(message, { rule, ...details });
    }
}

/**
 * O nome escolhido já está em uso por outro cadastro vivo do mesmo escopo (categoria no
 * perfil, subcategoria na categoria). Tem código próprio, e não `BUSINESS_RULE_VIOLATION`,
 * porque a UI trata de um jeito específico — aponta o campo do nome e sugere outro —, e
 * porque sem esta checagem o usuário receberia o `SQLITE_CONSTRAINT` do índice único como
 * erro genérico (database-design §3.11).
 */
export class NameConflictError extends DomainError {
    public readonly code = 'CONFLICT';

    /**
     * @param entity Cadastro em que o nome colidiu; diz à UI qual mensagem mostrar.
     * @param name Nome recusado, como o usuário digitou, para a mensagem citar.
     */
    public constructor(entity: string, name: string) {
        super(`Já existe ${entity} com o nome "${name}"`, { entity, field: 'name', name });
    }
}

/**
 * Uma linha lida do banco viola um invariante que a aplicação sempre grava corretamente
 * (ex.: `paid = 1` sem `payment_date`). Não é erro do usuário: indica escrita externa ou
 * bug, e por isso vira `INTERNAL` em vez de ser corrigida em silêncio.
 */
export class CorruptRowError extends DomainError {
    public readonly code = 'INTERNAL';

    /**
     * @param table Tabela da linha corrompida; necessária para localizar o problema no arquivo.
     * @param reason O invariante violado.
     */
    public constructor(table: string, reason: string) {
        super(`Linha inválida em ${table}: ${reason}`, { table, reason });
    }
}

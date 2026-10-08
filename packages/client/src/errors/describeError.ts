import type { BusinessRule, CoreError, ErrorDetails } from '@finance/core';

/** O que a tela mostra de um erro do núcleo. */
export interface ErrorDescription {
    /** Frase em pt-BR para o usuário, sem jargão técnico. */
    readonly message: string;
    /**
     * Campo do formulário que causou o erro (`name`, `source.accountId`), para a tela
     * destacá-lo; `null` quando o erro não pertence a um campo.
     */
    readonly field: string | null;
}

/**
 * Mensagem de cada regra de negócio. `Record` sobre a união fechada `BusinessRule`: uma
 * regra nova no núcleo quebra a compilação aqui, e não cai na mensagem genérica.
 */
const RULE_MESSAGES: Readonly<Record<BusinessRule, string>> = {
    'account-disabled': 'Esta conta está desativada e não aceita lançamentos novos. Reative-a em Cadastros para usá-la.',
    'credit-card-disabled': 'Este cartão está desativado e não aceita lançamentos novos. Reative-o em Cadastros para usá-lo.',
    'destination-equals-origin': 'A conta de destino precisa ser diferente da conta de origem.',
    'destination-not-allowed': 'Só transferências e investimentos têm conta de destino.',
    'destination-required': 'Escolha a conta de destino da transferência ou do investimento.',
    'goal-requires-saving-type': 'Só receitas e transferências podem ser vinculadas a uma meta.',
    'invoice-already-paid': 'Esta fatura já está paga. Reabra a fatura antes de pagá-la de novo.',
    'invoice-not-paid': 'Esta fatura já está em aberto.',
    'move-target-deleted': 'Escolha para onde mover os lançamentos entre as subcategorias que continuam existindo.',
    'partner-requires-business-profile': 'Só perfis empresariais registram o sócio que pagou.',
    'profile-currency-locked': 'A moeda do perfil não pode mudar depois que há lançamentos.',
    'recurrence-change-requires-scope': 'Mudar a repetição vale para esta e as futuras.',
    'recurrence-daily-date-single-only': 'Numa série diária, trocar a data só vale para "somente esta".',
    'recurrence-end-before-occurrence': 'A repetição não pode terminar antes do lançamento que você está editando.',
    'recurrence-end-before-start': 'A repetição termina antes do primeiro lançamento. Escolha um fim depois dele.',
    'recurrence-installments-below-occurrence': 'O parcelamento não pode ter menos parcelas que a parcela que você está editando.',
    'recurrence-scope-requires-series': 'Este lançamento não faz parte de uma série.',
    'reference-outside-profile': 'O item escolhido pertence a outro perfil.',
    'sub-category-in-use': 'Esta subcategoria tem lançamentos. Escolha para onde movê-los antes de excluir.',
    'transaction-type-locked': 'O tipo do lançamento não muda depois de criado. Exclua-o e lance de novo com o outro tipo.',
};

/**
 * Nome, com artigo, das entidades que o núcleo informa em `NOT_FOUND` e `CONFLICT`. Aberto
 * (`string`) porque o núcleo não fecha esse conjunto; nome desconhecido vira "O item".
 */
const ENTITY_NAMES: Readonly<Record<string, string>> = {
    Account: 'A conta',
    Category: 'A categoria',
    CreditCard: 'O cartão',
    Goal: 'A meta',
    Invoice: 'A fatura',
    Note: 'A anotação',
    Profile: 'O perfil',
    SubCategory: 'A subcategoria',
    Tag: 'A tag',
    Transaction: 'O lançamento',
    category: 'uma categoria',
    goalId: 'A meta',
    subCategory: 'uma subcategoria nesta categoria',
    tag: 'uma tag',
    tagIds: 'A tag',
};

/**
 * Traduz o erro do núcleo para o que a tela mostra. O `switch` é exaustivo sobre o
 * `ErrorCode` fechado (desktop-shell-design §5.3): um código novo quebra a compilação aqui,
 * em vez de cair num `default` silencioso. A mensagem vem do código e dos detalhes, nunca do
 * texto técnico do núcleo, que é para log.
 *
 * @param error Erro como atravessou a fronteira.
 * @return A mensagem em pt-BR e o campo a destacar, quando houver.
 */
export function describeError(error: CoreError): ErrorDescription {
    const field = textDetail(error.details, 'field');
    switch (error.code) {
        case 'VALIDATION_FAILED':
            return { message: 'Algum dado informado é inválido. Confira o campo destacado.', field };
        case 'NOT_FOUND':
            return { message: `${entityName(error.details, 'O item')} não existe mais; pode ter sido excluído(a).`, field: null };
        case 'BUSINESS_RULE_VIOLATION':
            return { message: ruleMessage(error.details), field };
        case 'CONFLICT':
            return { message: `Já existe ${entityName(error.details, 'um cadastro')} com o nome "${textDetail(error.details, 'name') ?? ''}". Escolha outro nome.`, field };
        case 'SCHEMA_NEWER_THAN_APP':
            return { message: 'Este banco foi gravado por uma versão mais nova do app. Atualize o app para abri-lo.', field: null };
        case 'INTERNAL':
            return { message: 'Algo deu errado do nosso lado. O erro foi registrado no log.', field: null };
    }
}

/**
 * @param details Detalhes do erro.
 * @return A mensagem da regra violada; a genérica quando o detalhe não traz uma regra
 * conhecida, o que só acontece com um núcleo de outra versão.
 */
function ruleMessage(details: ErrorDetails): string {
    const rule = textDetail(details, 'rule');
    return rule !== null && isBusinessRule(rule) ? RULE_MESSAGES[rule] : 'Esta operação não é permitida pelas regras do app.';
}

/**
 * @param rule Identificador vindo do núcleo.
 * @return `true` quando a regra tem mensagem; estreita o tipo para indexar o mapa sem cast.
 */
function isBusinessRule(rule: string): rule is BusinessRule {
    return Object.hasOwn(RULE_MESSAGES, rule);
}

/**
 * @param details Detalhes do erro.
 * @param fallback Nome usado quando a entidade não é conhecida.
 * @return O nome da entidade, com artigo, para compor a frase.
 */
function entityName(details: ErrorDetails, fallback: string): string {
    const entity = textDetail(details, 'entity');
    return entity === null ? fallback : (ENTITY_NAMES[entity] ?? fallback);
}

/**
 * @param details Detalhes do erro, que só trazem tipos primitivos.
 * @param key Chave procurada.
 * @return O valor quando é texto não vazio; `null` caso contrário.
 */
function textDetail(details: ErrorDetails, key: string): string | null {
    const value = details[key];
    return typeof value === 'string' && value !== '' ? value : null;
}

import type { AccountResponse, CategoryBranchResponse, CoreError } from '@finance/core';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_FIELDS, accountFormFrom, emptyAccountForm, readAccountForm, type AccountFormResult } from '../src/renderer/src/registry/accountForm.ts';
import { moveTargets, transactionsToMove } from '../src/renderer/src/registry/categoryMoves.ts';
import { placeCoreError } from '../src/renderer/src/registry/coreErrorField.ts';
import {
    closingDayWarning,
    CREDIT_CARD_FIELDS,
    creditCardFormFrom,
    emptyCreditCardForm,
    payingAccountOptions,
    readCreditCardForm,
    type CreditCardFormResult,
    type CreditCardFormValues,
} from '../src/renderer/src/registry/creditCardForm.ts';
import { readNameForm } from '../src/renderer/src/registry/nameForm.ts';
import { filterNotes, noteTitle, readNoteForm } from '../src/renderer/src/registry/noteForm.ts';
import { emptyProfileForm, PROFILE_FIELDS, readProfileForm } from '../src/renderer/src/registry/profileForm.ts';
import { categoryCounter, openKind, parseRegistrySearch, REGISTRY_KINDS } from '../src/renderer/src/registry/registryKinds.ts';

/** Id de conta válido no formato do núcleo. */
const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';

/**
 * @param result Resultado da leitura.
 * @return Os erros por campo; vazio quando o formulário é válido, para o teste comparar direto.
 */
function errorsOf(result: AccountFormResult | CreditCardFormResult): Readonly<Record<string, string>> {
    return result.ok ? {} : result.errors;
}

/**
 * @param changes Campos que o teste muda.
 * @return Uma conta como `accounts.list` a devolve.
 */
function account(changes: Partial<AccountResponse> = {}): AccountResponse {
    return {
        id: ACCOUNT_ID,
        profileId: 'p',
        name: 'Nubank',
        type: 'checking',
        currency: 'BRL',
        considerBalance: true,
        disabled: false,
        openingBalance: { amount: 1234.5, currency: 'BRL' },
        ...changes,
    };
}

/**
 * @param changes Campos que o teste preenche.
 * @return Um cartão válido no formulário, mais as mudanças.
 */
function card(changes: Partial<CreditCardFormValues> = {}): CreditCardFormValues {
    return { ...emptyCreditCardForm(ACCOUNT_ID), name: 'Roxinho', limit: '5.000,00', closingDay: '3', dueDay: '10', ...changes };
}

/**
 * @param code Código do erro.
 * @param details Detalhes do erro.
 * @return Um erro como atravessa a fronteira do núcleo.
 */
function coreError(code: CoreError['code'], details: CoreError['details']): CoreError {
    return { code, message: 'técnico', details };
}

describe('formulário de conta (desktop-mvp-plan Fase 6)', () => {
    it('monta o conteúdo de accounts.create/update, com a moeda como rótulo e o nome aparado', () => {
        const result = readAccountForm({ ...emptyAccountForm('BRL'), name: '  Tesouro ', type: 'investment', currency: 'USD', considerBalance: false, openingBalance: '1.234,56' }, 'BRL');
        expect(result).toEqual({ ok: true, content: { name: 'Tesouro', type: 'investment', currencyLabel: 'USD', considerBalance: false, openingBalance: 1234.56 } });
    });

    it('saldo inicial em branco é zero, o padrão do cadastro (database-design §4.4)', () => {
        const result = readAccountForm({ ...emptyAccountForm('BRL'), name: 'Nubank' }, 'BRL');
        expect(result.ok && result.content.openingBalance).toBe(0);
    });

    it('a conta nova nasce na moeda do perfil, somando no total', () => {
        expect(emptyAccountForm('USD')).toMatchObject({ currency: 'USD', considerBalance: true, type: 'checking' });
    });

    it('editar sem mexer em nada devolve o mesmo cadastro, saldo inicial incluído', () => {
        const result = readAccountForm(accountFormFrom(account({ considerBalance: false })), 'BRL');
        expect(result).toEqual({ ok: true, content: { name: 'Nubank', type: 'checking', currencyLabel: 'BRL', considerBalance: false, openingBalance: 1234.5 } });
    });

    it('saldo inválido não esconde o erro do nome', () => {
        expect(errorsOf(readAccountForm({ ...emptyAccountForm('BRL'), name: ' ', openingBalance: '12.5' }, 'BRL'))).toEqual({
            name: 'Informe o nome da conta.',
            openingBalance: 'Digite um valor como 1.234,56.',
        });
    });

    it('o limite do nome é o do núcleo e o teto do saldo vem na mensagem', () => {
        expect(errorsOf(readAccountForm({ ...emptyAccountForm('BRL'), name: 'a'.repeat(46) }, 'BRL'))).toEqual({ name: 'Use no máximo 45 caracteres.' });
        expect(errorsOf(readAccountForm({ ...emptyAccountForm('BRL'), name: 'Nubank', openingBalance: '1.000.000.000.000,01' }, 'BRL'))).toEqual({
            openingBalance: 'Use um valor de até 1.000.000.000.000,00, positivo ou negativo.',
        });
    });

    it('a lista de campos cobre todo o formulário', () => {
        expect([...ACCOUNT_FIELDS].sort()).toEqual(Object.keys(emptyAccountForm('BRL')).sort());
    });
});

describe('formulário de cartão (desktop-mvp-plan Fase 6)', () => {
    it('monta o conteúdo de creditCards.create/update', () => {
        expect(readCreditCardForm(card(), 'BRL')).toEqual({ ok: true, content: { accountId: ACCOUNT_ID, name: 'Roxinho', limit: 5000, closingDay: 3, dueDay: 10 } });
    });

    it('editar sem mexer em nada devolve o mesmo cadastro', () => {
        const form = creditCardFormFrom({ id: 'c', profileId: 'p', accountId: ACCOUNT_ID, name: 'Roxinho', limit: { amount: 5000, currency: 'BRL' }, closingDay: 31, dueDay: 8, disabled: false });
        expect(readCreditCardForm(form, 'BRL')).toEqual({ ok: true, content: { accountId: ACCOUNT_ID, name: 'Roxinho', limit: 5000, closingDay: 31, dueDay: 8 } });
    });

    it('sem conta, limite e dias, aponta cada campo de uma vez', () => {
        expect(errorsOf(readCreditCardForm({ name: '', accountId: '', limit: '', closingDay: '', dueDay: '' }, 'BRL'))).toEqual({
            name: 'Informe o nome do cartão.',
            accountId: 'Escolha a conta que paga as faturas.',
            limit: 'Informe o limite do cartão.',
            closingDay: 'Informe o dia de fechamento.',
            dueDay: 'Informe o dia de vencimento.',
        });
    });

    it('Regra de negócio (Cartão): limite negativo é recusado; zero é aceito', () => {
        expect(errorsOf(readCreditCardForm(card({ limit: '-1,00' }), 'BRL'))).toEqual({ limit: 'Use zero ou um valor positivo para o limite.' });
        expect(readCreditCardForm(card({ limit: '0' }), 'BRL').ok).toBe(true);
    });

    it('o teto do limite não sugere valor negativo, que o campo recusaria', () => {
        expect(errorsOf(readCreditCardForm(card({ limit: '1.000.000.000.000,01' }), 'BRL'))).toEqual({ limit: 'Use um valor de até 1.000.000.000.000,00.' });
    });

    it('Regra de negócio (Cartão): dias fora de 1–31 ou que não são número inteiro são recusados', () => {
        expect(errorsOf(readCreditCardForm(card({ closingDay: '0', dueDay: '32' }), 'BRL'))).toEqual({ closingDay: 'Use um dia de 1 a 31.', dueDay: 'Use um dia de 1 a 31.' });
        expect(errorsOf(readCreditCardForm(card({ closingDay: '1.5', dueDay: '10a' }), 'BRL'))).toEqual({ closingDay: 'Use um dia de 1 a 31.', dueDay: 'Use um dia de 1 a 31.' });
        expect(readCreditCardForm(card({ closingDay: ' 31 ', dueDay: '1' }), 'BRL').ok).toBe(true);
    });

    it('Regra de negócio (Cartão, database-design §4.5): fechamento em 29–31 avisa que vira o último dia nos meses curtos', () => {
        expect(closingDayWarning('28')).toBeNull();
        expect(closingDayWarning('29')).toBe('Nos meses sem o dia 29, a fatura fecha no último dia do mês.');
        expect(closingDayWarning('31')).toBe('Nos meses sem o dia 31, a fatura fecha no último dia do mês.');
        expect(closingDayWarning('32')).toBeNull();
        expect(closingDayWarning('')).toBeNull();
        expect(closingDayWarning('abc')).toBeNull();
    });

    it('Regra de negócio (Contas, §5.1): conta desativada não paga cartão novo, mas continua na edição do cartão que já paga', () => {
        const active = account({ id: 'a', name: 'Ativa' });
        const disabled = account({ id: 'd', name: 'Desativada', disabled: true });
        expect(payingAccountOptions([active, disabled], null).map((option) => option.name)).toEqual(['Ativa']);
        expect(payingAccountOptions([active, disabled], 'd').map((option) => option.name)).toEqual(['Ativa', 'Desativada']);
    });

    it('a lista de campos cobre todo o formulário', () => {
        expect([...CREDIT_CARD_FIELDS].sort()).toEqual(Object.keys(emptyCreditCardForm('')).sort());
    });
});

describe('nome de categoria e perfil', () => {
    it('nome de categoria: aparado, obrigatório e com o limite do núcleo', () => {
        expect(readNameForm('  Moradia ', 'o nome da categoria')).toEqual({ ok: true, name: 'Moradia' });
        expect(readNameForm('   ', 'o nome da categoria')).toEqual({ ok: false, error: 'Informe o nome da categoria.' });
        expect(readNameForm('a'.repeat(46), 'o nome da subcategoria')).toEqual({ ok: false, error: 'Use no máximo 45 caracteres.' });
    });

    it('perfil: monta o profiles.create, com o nome aparado, e aponta o nome em branco', () => {
        expect(readProfileForm({ name: ' Estúdio ', type: 'business', currency: 'USD' })).toEqual({ ok: true, content: { name: 'Estúdio', type: 'business', currency: 'USD' } });
        expect(readProfileForm(emptyProfileForm())).toEqual({ ok: false, errors: { name: 'Informe o nome do perfil.' } });
        expect([...PROFILE_FIELDS].sort()).toEqual(Object.keys(emptyProfileForm()).sort());
    });
});

describe('recusa do núcleo no formulário', () => {
    it('conflito de nome vai para baixo do campo do nome', () => {
        const placed = placeCoreError(coreError('CONFLICT', { entity: 'category', field: 'name', name: 'Moradia' }), { name: 'name' });
        expect(placed).toEqual({ field: 'name', message: 'Já existe uma categoria com o nome "Moradia". Escolha outro nome.' });
    });

    it('Regra de negócio (Perfis, §5): moeda travada vai para baixo do campo da moeda', () => {
        const placed = placeCoreError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'profile-currency-locked', field: 'currency' }), { currency: 'currency' });
        expect(placed).toEqual({ field: 'currency', message: 'A moeda do perfil não pode mudar depois que há lançamentos.' });
    });

    it('campo que o formulário não tem, ou erro sem campo, vai para o aviso geral', () => {
        expect(placeCoreError(coreError('NOT_FOUND', { entity: 'Account' }), { name: 'name' }).field).toBeNull();
        expect(placeCoreError(coreError('BUSINESS_RULE_VIOLATION', { rule: 'account-disabled', field: 'accountId' }), { name: 'name' }).field).toBeNull();
    });
});

describe('mover lançamentos ao excluir categoria', () => {
    const tree: readonly CategoryBranchResponse[] = [
        {
            id: 'food',
            profileId: 'p',
            name: 'Alimentação',
            subCategories: [
                { id: 'market', categoryId: 'food', name: 'Mercado', transactionCount: 3 },
                { id: 'delivery', categoryId: 'food', name: 'Delivery', transactionCount: 2 },
            ],
        },
        { id: 'home', profileId: 'p', name: 'Moradia', subCategories: [{ id: 'rent', categoryId: 'home', name: 'Aluguel', transactionCount: 0 }] },
        { id: 'empty', profileId: 'p', name: 'Vazia', subCategories: [] },
    ];
    const [food] = tree;
    if (food === undefined) {
        throw new Error('cenário sem categoria');
    }
    const [market] = food.subCategories;
    if (market === undefined) {
        throw new Error('cenário sem subcategoria');
    }

    it('subcategoria: move só os lançamentos dela, para qualquer outra subcategoria', () => {
        const target = { kind: 'subCategory', category: food, subCategory: market } as const;
        expect(transactionsToMove(target)).toBe(3);
        expect(moveTargets(tree, target).map((group) => [group.categoryName, group.subCategories.map((sub) => sub.name)])).toEqual([
            ['Alimentação', ['Delivery']],
            ['Moradia', ['Aluguel']],
        ]);
    });

    it('Regra de negócio (Categorias): categoria soma as subcategorias e não oferece nenhuma delas como destino', () => {
        const target = { kind: 'category', category: food } as const;
        expect(transactionsToMove(target)).toBe(5);
        expect(moveTargets(tree, target).map((group) => group.categoryName)).toEqual(['Moradia']);
    });
});

describe('lista lateral de Cadastros', () => {
    it('o tipo vem da URL; tipo desconhecido abre Contas', () => {
        expect(openKind(parseRegistrySearch({ kind: 'categories' }))).toBe('categories');
        expect(openKind(parseRegistrySearch({ kind: 'nada' }))).toBe('accounts');
        expect(openKind(parseRegistrySearch({}))).toBe('accounts');
    });

    it('tem os tipos do mockup, na ordem dele', () => {
        expect(REGISTRY_KINDS.map((item) => item.label)).toEqual(['Contas', 'Cartões', 'Categorias', 'Tags', 'Perfis', 'Anotações']);
        expect(openKind(parseRegistrySearch({ kind: 'notes' }))).toBe('notes');
    });

    it('o contador de categorias segue o mockup (8 · 17 sub)', () => {
        expect(categoryCounter([])).toBe('0 · 0 sub');
        expect(
            categoryCounter([
                { id: 'a', profileId: 'p', name: 'A', subCategories: [{ id: 's', categoryId: 'a', name: 'S', transactionCount: 0 }] },
                { id: 'b', profileId: 'p', name: 'B', subCategories: [] },
            ]),
        ).toBe('2 · 1 sub');
    });
});

describe('anotações (mockup DesktopAnotacoes)', () => {
    /**
     * @param id Id da anotação.
     * @param text Texto.
     * @return Uma anotação como `notes.list` a devolve.
     */
    const note = (id: string, text: string): { readonly id: string; readonly profileId: string; readonly text: string } => ({ id, profileId: 'p', text });
    const notes = [note('a', 'IPTU 2027\nCota única vence em fevereiro.'), note('b', 'Reembolsos pendentes\nConferir a tag reembolsável.')];

    it('o editor exige texto, aparado como o núcleo grava; não há limite de tamanho', () => {
        expect(readNoteForm('  \n Lembrete \n')).toEqual({ ok: true, text: 'Lembrete' });
        expect(readNoteForm(' \n ')).toEqual({ ok: false, error: 'Escreva a anotação antes de salvar.' });
        expect(readNoteForm('a'.repeat(20_000)).ok).toBe(true);
    });

    it('a busca procura no texto inteiro, sem diferenciar maiúsculas nem acentos', () => {
        expect(filterNotes(notes, 'fevereiro').map((found) => found.id)).toEqual(['a']);
        expect(filterNotes(notes, 'REEMBOLSAVEL').map((found) => found.id)).toEqual(['b']);
        expect(filterNotes(notes, '  ')).toEqual(notes);
        expect(filterNotes(notes, 'aluguel')).toEqual([]);
    });

    it('o título é a primeira linha', () => {
        expect(notes.map(noteTitle)).toEqual(['IPTU 2027', 'Reembolsos pendentes']);
    });
});

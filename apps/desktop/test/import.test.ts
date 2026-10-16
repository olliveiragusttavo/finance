import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMPORT_FIELDS, IMPORT_FILE_KINDS, type MappingTemplate } from '@finance/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DevicePreferencesStore } from '../src/main/DevicePreferencesStore.ts';
import { TEMPLATE_NAME_MAX_LENGTH } from '../src/shared/bridge.ts';
import { IMPORT_FILE_MAX_BYTES, IMPORT_TEMPLATES_MAX, mappingTemplateSchema, readImportFile, TEMPLATE_FIELD_IDS, TEMPLATE_FILE_KINDS } from '../src/main/importFiles.ts';
import { decodeImportFile, defaultTemplateName, detectedKindText, formatCount, formatFileSize, importButtonLabel, issueText, openFailureMessage, outcomeText, previewRows, readProblemText } from '../src/renderer/src/import/importView.ts';

const folders: string[] = [];

afterEach(() => {
    for (const folder of folders.splice(0)) {
        rmSync(folder, { recursive: true, force: true });
    }
});

/**
 * @return Uma pasta temporária, apagada no fim do teste.
 */
function folder(): string {
    const path = mkdtempSync(join(tmpdir(), 'finance-import-'));
    folders.push(path);
    return path;
}

/**
 * @param name Nome do modelo.
 * @return Um modelo válido.
 */
function template(name: string): MappingTemplate {
    return { name, kind: 'expenses', headers: ['descricao', 'valor'], fields: { name: 'descricao', value: 'valor' } };
}

describe('arquivo escolhido no processo principal (desktop-mvp-plan Fase 13.1)', () => {
    it('devolve o nome-base e os bytes, nunca o caminho', async () => {
        const path = join(folder(), 'Despesas.csv');
        writeFileSync(path, 'a,b\n1,2\n');
        const result = await readImportFile(path);
        expect(result).toMatchObject({ ok: true, name: 'Despesas.csv', size: 8 });
        expect(JSON.stringify(result)).not.toContain(tmpdir());
    });

    it('recusa arquivo grande demais, pasta e arquivo que não existe, sem lançar', async () => {
        const base = folder();
        const big = join(base, 'grande.csv');
        writeFileSync(big, Buffer.alloc(IMPORT_FILE_MAX_BYTES + 1));
        expect(await readImportFile(big)).toEqual({ ok: false, reason: 'too-large' });
        expect(await readImportFile(base)).toEqual({ ok: false, reason: 'read-failed' });
        expect(await readImportFile(join(base, 'sumiu.csv'))).toEqual({ ok: false, reason: 'read-failed' });
    });
});

describe('modelos de mapeamento no aparelho', () => {
    it('guarda todo campo e todo tipo do catálogo do client', () => {
        expect([...TEMPLATE_FIELD_IDS].sort()).toEqual(IMPORT_FIELDS.map((field) => field.id).sort());
        expect([...TEMPLATE_FILE_KINDS].sort()).toEqual([...IMPORT_FILE_KINDS].sort());
    });

    it('salva substituindo o de mesmo nome, com o mais novo por último, e limita a lista', () => {
        const store = new DevicePreferencesStore(join(folder(), 'preferences.json'));
        expect(store.importTemplates()).toEqual([]);
        store.saveImportTemplate(template('A'));
        store.saveImportTemplate(template('B'));
        const saved = store.saveImportTemplate({ ...template('A'), kind: 'incomes' });
        expect(saved.map((item) => [item.name, item.kind])).toEqual([['B', 'expenses'], ['A', 'incomes']]);
        for (let index = 0; index < IMPORT_TEMPLATES_MAX + 5; index++) {
            store.saveImportTemplate(template(`M${String(index)}`));
        }
        expect(store.importTemplates()).toHaveLength(IMPORT_TEMPLATES_MAX);
        // O tema não muda ao salvar modelos.
        expect(store.read().theme).toBe('system');
    });

    it('recusa modelo inválido vindo do renderer, e um arquivo com lista inválida perde só a lista', () => {
        const path = join(folder(), 'preferences.json');
        const store = new DevicePreferencesStore(path);
        expect(() => store.saveImportTemplate({ ...template('A'), fields: { inventado: 'x' } })).toThrow();
        expect(() => store.saveImportTemplate({ ...template('A'), name: ' ' })).toThrow();
        writeFileSync(path, JSON.stringify({ theme: 'dark', importTemplates: [{ name: 1 }] }));
        expect(store.importTemplates()).toEqual([]);
        expect(store.read().theme).toBe('dark');
    });

    it('corta o nome sugerido no limite que o processo principal aceita', () => {
        expect(defaultTemplateName('expenses', 'despesas.csv')).toBe('Despesas — despesas.csv');
        const name = defaultTemplateName('transfers', `${'x'.repeat(80)}.csv`);
        expect(name).toHaveLength(TEMPLATE_NAME_MAX_LENGTH);
        expect(mappingTemplateSchema.safeParse({ ...template('A'), name }).success).toBe(true);
    });
});

describe('textos da importação', () => {
    it('decodifica UTF-8 e cai para Latin-1 quando os bytes não são UTF-8', () => {
        const utf8 = new TextEncoder().encode('Descrição');
        expect(decodeImportFile(utf8, null)).toEqual({ text: 'Descrição', encoding: 'utf-8' });
        const latin = new Uint8Array([0x44, 0x65, 0x73, 0x63, 0x72, 0x69, 0xe7, 0xe3, 0x6f]);
        expect(decodeImportFile(latin, null)).toEqual({ text: 'Descrição', encoding: 'latin-1' });
        expect(decodeImportFile(utf8, 'latin-1').encoding).toBe('latin-1');
    });

    it('formata contagens e tamanhos sem Intl', () => {
        expect([0, 999, 1890, 1234567].map(formatCount)).toEqual(['0', '999', '1.890', '1.234.567']);
        expect(formatFileSize(270_406)).toBe('264 KB');
        expect(formatFileSize(300)).toBe('1 KB');
        expect(formatFileSize(1_300_000)).toBe('1,2 MB');
        expect(importButtonLabel(1)).toBe('Importar 1 linha');
        expect(importButtonLabel(1890)).toBe('Importar 1.890 linhas');
    });

    it('diz por que o tipo foi detectado', () => {
        expect(detectedKindText({ kind: 'expenses', reasons: ['nome do arquivo', 'coluna “Cartão”'] })).toBe('Detectado: Despesas (nome do arquivo e coluna “Cartão”)');
        expect(detectedKindText({ kind: 'incomes', reasons: ['nome do arquivo'] })).toBe('Detectado: Receitas (nome do arquivo)');
        expect(detectedKindText({ kind: 'expenses', reasons: [] })).toBe('Sem pista no arquivo: Despesas por padrão');
    });

    it('explica cada falha e cada linha de fora', () => {
        expect(openFailureMessage('canceled')).toBeNull();
        expect(openFailureMessage('too-large')).toContain('20 MB');
        expect(readProblemText({ line: 12, field: 'value', reason: 'invalid-number' })).toBe('Linha 12: Valor não é um número');
        expect(readProblemText({ line: 3, field: 'type', reason: 'unknown-type' })).toContain('tipo não reconhecido');
        expect(issueText({ line: 5, reason: 'destination-equals-origin' })).toBe('Linha 5: transferência com origem e destino iguais');
    });

    it('mostra na prévia o sinal pelo tipo, e não só pela cor (decisão de interface 7)', () => {
        const rows = previewRows([
            { line: 1, type: 'expense', name: 'Mercado', value: 46.88, dueDate: '2026-11-15', account: 'Banco', creditCard: 'Inter', category: 'Moradia', subCategory: 'Mercado', paymentDate: null },
            { line: 2, type: 'expense', name: 'Estorno', value: -10, dueDate: '2026-11-15', account: 'Banco', category: 'Outros', subCategory: 'Estorno', paymentDate: '2026-11-10' },
            { line: 3, type: 'income', name: 'CDB', value: 85.85, dueDate: '2026-10-01', account: 'Banco', category: 'Rendimentos', subCategory: 'CDB', repetition: { kind: 'fixed', frequency: 'monthly' } },
            { line: 4, type: 'transference', name: 'Lucros', value: 8073.69, dueDate: '2026-10-11', account: 'Empresa', destination: 'Banco', repetition: { kind: 'installments', frequency: 'monthly', installment: 2, installments: 3 } },
        ], 'BRL');
        expect(rows.map((row) => [row.value, row.direction, row.where, row.repetition, row.status])).toEqual([
            ['−R$ 46,88', 'out', 'Cartão Inter', '—', 'Pendente'],
            ['+R$ 10,00', 'in', 'Banco', '—', 'Pago 10/11/2026'],
            ['+R$ 85,85', 'in', 'Banco', 'Fixa mensal', 'Pendente'],
            ['⇄ R$ 8.073,69', 'transfer', 'Empresa → Banco', 'Parcela 2/3', 'Pendente'],
        ]);
    });

    it('resume a importação só com o que aconteceu', () => {
        const base = { transactions: 1890, fixedSeries: 24, installmentSeries: 32, invoicesPaid: 44, accountsCreated: 4, creditCardsCreated: 2, categoriesCreated: 13, subCategoriesCreated: 53, tagsCreated: 0, skipped: 0 };
        expect(outcomeText(base)).toBe('Importado: 1.890 lançamentos, 56 recorrências, 44 faturas pagas, 4 contas novas, 2 cartões novos, 66 categorias e subcategorias novas.');
        expect(outcomeText({ ...base, fixedSeries: 0, installmentSeries: 0, invoicesPaid: 0, accountsCreated: 0, creditCardsCreated: 0, categoriesCreated: 0, subCategoriesCreated: 0, skipped: 3 })).toBe('Importado: 1.890 lançamentos. 3 linhas com problema ficaram de fora.');
    });
});

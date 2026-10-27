import { describe, expect, it } from 'vitest';
import type { CoreInput, ReportFilterResponse } from '../../src/index.ts';
import { TestWorld } from '../support/TestWorld.ts';

type CreateInput = CoreInput<'reports.create'>;

/**
 * A rota devolve as listas do filtro como `readonly`, e a entrada do zod as pede mutáveis; o
 * editor faz a mesma cópia ao reabrir uma definição.
 *
 * @param filter Filtro como a rota o devolveu.
 * @return O mesmo filtro na forma da entrada de `reports.update`.
 */
function asInput(filter: ReportFilterResponse): CreateInput['filter'] {
    return {
        ...filter,
        types: [...filter.types],
        categoryIds: [...filter.categoryIds],
        subCategoryIds: [...filter.subCategoryIds],
        accountIds: [...filter.accountIds],
        creditCardIds: [...filter.creditCardIds],
        tagIds: [...filter.tagIds],
        partnerIds: [...filter.partnerIds],
        goalIds: [...filter.goalIds],
    };
}

/**
 * @param world Mundo do teste.
 * @return Um perfil com uma subcategoria e a tag "viagem", criada pela rota real.
 */
async function setup(world: TestWorld = new TestWorld('2026-10-15')): Promise<{
    world: TestWorld;
    profileId: string;
    subCategoryId: string;
    tagId: string;
}> {
    const profileId = world.profile();
    const subCategoryId = world.subCategory(profileId);
    const tag = await world.ok('tags.create', { profileId, name: 'viagem' });
    return { world, profileId, subCategoryId, tagId: tag.id };
}

/**
 * @param profileId Perfil dono.
 * @param overrides Campos que o teste quer fixar.
 * @return A entrada de um relatório do mês de referência, em tabela por categoria.
 */
function report(profileId: string, overrides: Partial<CreateInput> = {}): CreateInput {
    return {
        profileId,
        name: 'Gastos do mês',
        filter: { period: { anchor: { kind: 'reference' } } },
        layout: { format: 'table', primary: 'category' },
        ...overrides,
    };
}

describe('cadastro de relatórios (reports-design §4)', () => {
    it('cria com os padrões do filtro preenchidos, lista por nome e abre a definição salva', async () => {
        const { world, profileId, tagId } = await setup();
        const created = await world.ok('reports.create', report(profileId, { name: 'Viagens', filter: { period: { anchor: { kind: 'fixed', month: '2026-07' }, previousMonths: 2, basis: 'due' }, types: ['expense'], tagIds: [tagId] } }));
        await world.ok('reports.create', report(profileId, { name: 'aluguel' }));

        expect(created.filter).toEqual({
            period: { anchor: { kind: 'fixed', month: '2026-07' }, previousMonths: 2, basis: 'due' },
            types: ['expense'],
            categoryIds: [],
            subCategoryIds: [],
            accountIds: [],
            creditCardIds: [],
            tagIds: [tagId],
            tagMatch: 'any',
            partnerIds: [],
            goalIds: [],
            status: 'all',
            minValue: null,
            maxValue: null,
        });
        expect(created.layout).toEqual({ format: 'table', primary: 'category', secondary: null, measure: 'sum', analysis: false });
        expect((await world.ok('reports.list', { profileId })).map((definition) => definition.name)).toEqual(['aluguel', 'Viagens']);
        expect(await world.ok('reports.get', { id: created.id })).toEqual(created);
    });

    it('grava o filtro e o formato num JSON versionado', async () => {
        const { world, profileId } = await setup();
        const created = await world.ok('reports.create', report(profileId));
        const row = world.database.get('SELECT definition FROM report_definitions WHERE id = :id', { id: created.id });
        expect(JSON.parse(String(row?.['definition']))).toMatchObject({ version: 1, layout: { primary: 'category' } });
    });

    it('Regra de negócio (Relatórios): nome único no perfil sem diferenciar maiúsculas nem acento composto; regravar com o próprio nome não conflita', async () => {
        const { world, profileId } = await setup();
        const first = await world.ok('reports.create', report(profileId, { name: 'Saúde' }));
        expect(await world.failure('reports.create', report(profileId, { name: ' SAÚDE ' }))).toMatchObject({ code: 'CONFLICT', details: { entity: 'report' } });
        expect((await world.ok('reports.update', { id: first.id, name: 'saúde', filter: asInput(first.filter), layout: first.layout })).name).toBe('saúde');
        // Outro perfil pode ter o mesmo nome.
        const other = world.profile();
        expect((await world.ok('reports.create', report(other, { name: 'Saúde' }))).name).toBe('Saúde');
    });

    it('recusa o nome vazio ou com mais de 100 caracteres', async () => {
        const { world, profileId } = await setup();
        expect((await world.failure('reports.create', report(profileId, { name: '   ' }))).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('reports.create', report(profileId, { name: 'x'.repeat(101) }))).code).toBe('VALIDATION_FAILED');
        expect((await world.ok('reports.create', report(profileId, { name: 'x'.repeat(100) }))).name).toHaveLength(100);
    });

    it('Regra de negócio (Relatórios, §2.2): cadastro de outro perfil ou excluído no filtro é NOT_FOUND', async () => {
        const { world, profileId } = await setup();
        const other = await setup(world);
        expect(await world.failure('reports.create', report(profileId, { filter: { period: { anchor: { kind: 'reference' } }, tagIds: [other.tagId] } }))).toMatchObject({
            code: 'NOT_FOUND',
            details: { entity: 'Tag', id: other.tagId },
        });
        expect((await world.failure('reports.create', report(profileId, { filter: { period: { anchor: { kind: 'reference' } }, subCategoryIds: [other.subCategoryId] } }))).details['entity']).toBe('SubCategory');

        const deleted = await world.ok('tags.create', { profileId, name: 'antiga' });
        await world.ok('tags.delete', { id: deleted.id });
        expect((await world.failure('reports.create', report(profileId, { filter: { period: { anchor: { kind: 'reference' } }, tagIds: [deleted.id] } }))).code).toBe('NOT_FOUND');
    });

    it('Regra de negócio (Relatórios, §2.2): o cadastro excluído depois de salvo continua na definição, e regravar o aceita; um id novo morto, não', async () => {
        const { world, profileId, tagId } = await setup();
        const created = await world.ok('reports.create', report(profileId, { filter: { period: { anchor: { kind: 'reference' } }, tagIds: [tagId] } }));
        await world.ok('tags.delete', { id: tagId });

        expect((await world.ok('reports.get', { id: created.id })).filter.tagIds).toEqual([tagId]);
        const renamed = await world.ok('reports.update', { id: created.id, name: 'Outro nome', filter: asInput(created.filter), layout: created.layout });
        expect(renamed.filter.tagIds).toEqual([tagId]);

        const gone = await world.ok('tags.create', { profileId, name: 'também excluída' });
        await world.ok('tags.delete', { id: gone.id });
        expect((await world.failure('reports.update', { id: created.id, name: 'Outro nome', filter: { ...asInput(created.filter), tagIds: [tagId, gone.id] }, layout: created.layout })).code).toBe('NOT_FOUND');
    });

    it('Regra de negócio (Relatórios, L5): dimensões repetidas são recusadas', async () => {
        const { world, profileId } = await setup();
        const failure = await world.failure('reports.create', report(profileId, { layout: { format: 'bar', primary: 'month', secondary: 'month' } }));
        expect(failure).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', details: { rule: 'report-dimensions-repeated' } });
    });

    it('Regra de negócio (Relatórios, L9): a análise é gravada, e a definição de antes dela lê sem análise', async () => {
        const { world, profileId } = await setup();
        const created = await world.ok('reports.create', report(profileId, { layout: { format: 'table', primary: 'flow', analysis: true } }));
        expect((await world.ok('reports.get', { id: created.id })).layout.analysis).toBe(true);
        world.database.run("UPDATE report_definitions SET definition = json_remove(definition, '$.layout.analysis') WHERE id = :id", { id: created.id });
        expect((await world.ok('reports.get', { id: created.id })).layout.analysis).toBe(false);
    });

    it('Regra de negócio (Relatórios, L7): a pizza só tem a dimensão principal', async () => {
        const { world, profileId } = await setup();
        const failure = await world.failure('reports.create', report(profileId, { layout: { format: 'pie', primary: 'category', secondary: 'month' } }));
        expect(failure).toMatchObject({ code: 'BUSINESS_RULE_VIOLATION', details: { rule: 'report-pie-secondary' } });
        const created = await world.ok('reports.create', report(profileId, { layout: { format: 'pie', primary: 'category' } }));
        expect(created.layout).toMatchObject({ format: 'pie', secondary: null });
    });

    it('recusa janela acima de 36 meses, mínimo acima do máximo e campo desconhecido', async () => {
        const { world, profileId } = await setup();
        expect((await world.failure('reports.create', report(profileId, { filter: { period: { anchor: { kind: 'reference' }, previousMonths: 36 } } }))).code).toBe('VALIDATION_FAILED');
        expect((await world.failure('reports.create', report(profileId, { filter: { period: { anchor: { kind: 'reference' } }, minValue: 10, maxValue: 5 } }))).code).toBe('VALIDATION_FAILED');
        const unknownField = { ...report(profileId), filter: { period: { anchor: { kind: 'reference' } }, search: 'mercado' } };
        expect((await world.core.dispatch('reports.create', unknownField)).ok).toBe(false);
    });

    it('excluir tira o relatório da lista e da abertura, sem tocar nas transações', async () => {
        const { world, profileId } = await setup();
        const created = await world.ok('reports.create', report(profileId));
        await world.ok('reports.delete', { id: created.id });
        expect(await world.ok('reports.list', { profileId })).toEqual([]);
        expect((await world.failure('reports.get', { id: created.id })).code).toBe('NOT_FOUND');
        expect((await world.failure('reports.run', { id: created.id, period: '2026-10' })).code).toBe('NOT_FOUND');
        // O nome volta a ficar livre.
        expect((await world.ok('reports.create', report(profileId))).name).toBe('Gastos do mês');
    });
});

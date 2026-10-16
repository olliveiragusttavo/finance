import { describe, expect, it } from 'vitest';
import { formatGoalListView, formatRegistryListView, goalChoices, goalInView, goalViewOf, registryInView, registryViewOf, type GoalListView } from '../src/index.ts';

/**
 * @param id Id e nome da meta.
 * @param reached Se foi atingida.
 * @param archived Se foi arquivada.
 * @return A meta como `goals.options` a devolve.
 */
function option(id: string, reached: boolean, archived: boolean): { readonly id: string; readonly name: string; readonly reached: boolean; readonly archived: boolean } {
    return { id, name: id, reached, archived };
}

describe('visualizações das listas laterais (desktop-mvp-plan Fase 13.4)', () => {
    it('Metas: ativa é a que não foi atingida nem arquivada; a atingida e arquivada aparece nas duas', () => {
        const goals = [option('Viagem', false, false), option('Carro', true, false), option('Curso', false, true), option('Moto', true, true)];
        /**
         * Lista os ids (que são os nomes, em `option`) para a comparação mostrar de cara qual meta
         * entrou ou faltou em cada visualização.
         *
         * @param view Visualização conferida.
         * @return Os ids das metas que aparecem nela, na ordem original.
         */
        const names = (view: GoalListView): readonly string[] => goals.filter((goal) => goalInView(goal, view)).map((goal) => goal.id);
        expect(names('active')).toEqual(['Viagem']);
        expect(names('reached')).toEqual(['Carro', 'Moto']);
        expect(names('archived')).toEqual(['Curso', 'Moto']);
        expect(goals.map(goalViewOf)).toEqual(['active', 'reached', 'archived', 'archived']);
        expect(formatGoalListView('reached')).toBe('Atingidas');
    });

    it('Contas e Cartões: ativos ou desativados, com o rótulo no gênero do cadastro', () => {
        expect([registryInView({ disabled: true }, 'disabled'), registryInView({ disabled: true }, 'active'), registryInView({ disabled: false }, 'active')]).toEqual([true, false, true]);
        expect(registryViewOf({ disabled: true })).toBe('disabled');
        expect([formatRegistryListView('active', 'feminine'), formatRegistryListView('disabled', 'masculine')]).toEqual(['Ativas', 'Desativados']);
    });

    it('campo "Meta": as atingidas num grupo à parte, e a arquivada só na edição do lançamento vinculado a ela', () => {
        const options = [option('Carro', true, false), option('Curso', false, true), option('Viagem', false, false)];
        expect(goalChoices(options, null)).toEqual([
            { id: 'Viagem', label: 'Viagem', group: 'Ativas' },
            { id: 'Carro', label: 'Carro', group: 'Atingidas' },
        ]);
        expect(goalChoices(options, 'Curso').map((choice) => choice.label)).toEqual(['Curso (arquivada)', 'Viagem', 'Carro']);
    });
});

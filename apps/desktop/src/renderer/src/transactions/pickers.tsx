import { subCategoryOptions } from '@finance/client';
import type { CategoryBranchResponse, TagResponse } from '@finance/core';
import type { ReactNode } from 'react';
import { Combobox, type ComboboxAria, type ComboboxOption } from '@/components/Combobox';

/*
 * Escolhas de cadastro que mais de um formulário oferece — a subcategoria, que todo lançamento
 * tem, e as tags, que são várias de uma vez —, sobre o seletor com busca (`Combobox`). A
 * subcategoria precisa da busca desde a Fase 9: a árvore inteira passa de cem itens num perfil real.
 */

/**
 * Subcategoria com busca: o botão mostra "Categoria › Sub" como a tabela, e a busca olha a
 * categoria e a subcategoria juntas — "mercado alim" acha "Alimentação › Mercado".
 *
 * @param props.id Id do botão, ligado ao rótulo do campo.
 * @param props.tree Árvore de categorias do perfil.
 * @param props.value Subcategoria escolhida; vazio enquanto nada foi escolhido.
 * @param props.onChange Recebe a subcategoria escolhida.
 * @param props.aria Atributos do erro do campo.
 * @param props.exclude Subcategorias que não são escolha (a que está sendo excluída, no diálogo de mover).
 * @param props.disabled Trava o campo enquanto as categorias do perfil escolhido carregam.
 * @return O campo.
 */
export function SubCategoryPicker({
    id,
    tree,
    value,
    onChange,
    aria,
    exclude = [],
    disabled = false,
}: {
    readonly id: string;
    readonly tree: readonly CategoryBranchResponse[];
    readonly value: string;
    readonly onChange: (subCategoryId: string) => void;
    readonly aria?: ComboboxAria | undefined;
    readonly exclude?: readonly string[] | undefined;
    readonly disabled?: boolean | undefined;
}): ReactNode {
    const options = subCategoryOptions(tree, '')
        .filter((option) => !exclude.includes(option.id))
        .map((option): ComboboxOption => ({ value: option.id, label: option.name, prefix: `${option.categoryName} › ` }));
    return (
        <Combobox
            id={id}
            options={options}
            value={value}
            onChange={onChange}
            placeholder="Escolha a categoria"
            searchLabel="Buscar categoria"
            emptyText="Nenhuma categoria encontrada."
            disabled={disabled}
            aria={aria}
        />
    );
}

/**
 * Tags do lançamento: o botão mostra as escolhidas como etiquetas, e a lista com busca fica aberta
 * entre uma marcação e outra, para escolher várias de uma vez.
 *
 * @param props.id Id do botão, ligado ao rótulo do campo.
 * @param props.tags Tags do perfil.
 * @param props.value Tags marcadas.
 * @param props.onChange Recebe as tags marcadas.
 * @return O campo.
 */
export function TagPicker({
    id,
    tags,
    value,
    onChange,
}: {
    readonly id: string;
    readonly tags: readonly TagResponse[];
    readonly value: readonly string[];
    readonly onChange: (tagIds: readonly string[]) => void;
}): ReactNode {
    return (
        <Combobox
            id={id}
            multiple
            options={tags.map((tag) => ({ value: tag.id, label: tag.name }))}
            value={value}
            onChange={onChange}
            disabled={tags.length === 0}
            placeholder={tags.length === 0 ? 'Nenhuma tag cadastrada' : 'adicionar tag'}
            searchLabel="Buscar tag"
            emptyText="Nenhuma tag encontrada."
        />
    );
}

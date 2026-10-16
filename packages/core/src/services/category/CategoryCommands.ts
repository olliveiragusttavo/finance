import type { CategoryId, ProfileId, SubCategoryId } from '../../domain/shared/ids.ts';

/** Categoria nova num perfil. */
export interface CreateCategoryCommand {
    readonly profileId: ProfileId;
    readonly name: string;
}

/** Renomear uma categoria. */
export interface RenameCategoryCommand {
    readonly id: CategoryId;
    readonly name: string;
}

/** Subcategoria nova numa categoria. */
export interface CreateSubCategoryCommand {
    readonly categoryId: CategoryId;
    readonly name: string;
}

/** Renomear uma subcategoria. */
export interface RenameSubCategoryCommand {
    readonly id: SubCategoryId;
    readonly name: string;
}

/**
 * Excluir categoria ou subcategoria. `moveTo` é a subcategoria que passa a classificar os
 * lançamentos da excluída; obrigatória quando há lançamentos, ignorada quando não há.
 */
export interface DeleteCategoryCommand<T extends CategoryId | SubCategoryId> {
    readonly id: T;
    readonly moveTo: SubCategoryId | null;
}

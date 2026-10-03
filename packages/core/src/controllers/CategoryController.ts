import {
    toCategoryResponse,
    toCategoryTreeResponse,
    toSubCategoryResponse,
    type CategoryBranchResponse,
    type CategoryResponse,
    type SubCategoryResponse,
} from '../dto/categories/CategoryResponse.ts';
import {
    categoryTreeRequest,
    createCategoryRequest,
    createSubCategoryRequest,
    deleteCategoryRequest,
    deleteSubCategoryRequest,
    renameCategoryRequest,
    renameSubCategoryRequest,
} from '../requests/categoryRequests.ts';
import type { CategoryService } from '../services/category/CategoryService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas do cadastro de categorias e subcategorias. */
export class CategoryController {
    /**
     * @param categories Cadastro de categorias.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly categories: CategoryService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil.
     * @return A árvore categoria → subcategoria com a contagem de lançamentos.
     */
    public tree(raw: unknown): Promise<CoreResult<readonly CategoryBranchResponse[]>> {
        return handle(categoryTreeRequest, raw, ({ profileId }) => toCategoryTreeResponse(this.categories.tree(profileId)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil e o nome.
     * @return A categoria criada.
     */
    public createCategory(raw: unknown): Promise<CoreResult<CategoryResponse>> {
        return handle(createCategoryRequest, raw, (command) => toCategoryResponse(this.categories.createCategory(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a categoria e o novo nome.
     * @return A categoria renomeada.
     */
    public renameCategory(raw: unknown): Promise<CoreResult<CategoryResponse>> {
        return handle(renameCategoryRequest, raw, (command) => toCategoryResponse(this.categories.renameCategory(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a categoria e, se houver lançamentos, para onde movê-los.
     * @return `null` em caso de sucesso.
     */
    public deleteCategory(raw: unknown): Promise<CoreResult<null>> {
        return handle(deleteCategoryRequest, raw, (command) => {
            this.categories.deleteCategory(command);
            return null;
        }, this.onUnexpected);
    }

    /**
     * @param raw Entrada com a categoria e o nome.
     * @return A subcategoria criada.
     */
    public createSubCategory(raw: unknown): Promise<CoreResult<SubCategoryResponse>> {
        return handle(createSubCategoryRequest, raw, (command) => toSubCategoryResponse(this.categories.createSubCategory(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a subcategoria e o novo nome.
     * @return A subcategoria renomeada.
     */
    public renameSubCategory(raw: unknown): Promise<CoreResult<SubCategoryResponse>> {
        return handle(renameSubCategoryRequest, raw, (command) => toSubCategoryResponse(this.categories.renameSubCategory(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a subcategoria e, se houver lançamentos, para onde movê-los.
     * @return `null` em caso de sucesso.
     */
    public deleteSubCategory(raw: unknown): Promise<CoreResult<null>> {
        return handle(deleteSubCategoryRequest, raw, (command) => {
            this.categories.deleteSubCategory(command);
            return null;
        }, this.onUnexpected);
    }
}

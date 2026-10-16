import { Category } from '../../domain/category/Category.ts';
import { SUGGESTED_CATEGORIES } from '../../domain/category/suggestedCategories.ts';
import { SubCategory } from '../../domain/category/SubCategory.ts';
import { BusinessRuleViolation, NameConflictError, NotFoundError } from '../../domain/shared/errors.ts';
import { CategoryId, SubCategoryId, type ProfileId } from '../../domain/shared/ids.ts';
import { sameName } from '../../domain/shared/names.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type {
    CreateCategoryCommand,
    CreateSubCategoryCommand,
    DeleteCategoryCommand,
    RenameCategoryCommand,
    RenameSubCategoryCommand,
} from './CategoryCommands.ts';
import type { CategoryTree } from './CategoryTree.ts';

/**
 * Cadastro de categorias e subcategorias. Concentra as duas regras que o banco não
 * consegue expressar de forma legível: o nome único sem diferenciar maiúsculas (o índice
 * `NOCASE` só cobre ASCII e falharia com erro de SQL) e a exclusão de subcategoria em uso,
 * que precisa mover os lançamentos antes (mockup `DesktopCadastros`).
 *
 * Categoria não afeta saldo, então nada aqui chama a rotina de recálculo — mas mover e
 * excluir acontecem numa unidade de trabalho só, para que nenhum lançamento fique apontando
 * para uma subcategoria excluída.
 */
export class CategoryService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 das linhas novas.
     * @param profiles Confere que o perfil existe.
     * @param categories Categorias e subcategorias.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly categories: CategoryRepository,
    ) {}

    /**
     * @param profileId Perfil consultado.
     * @return As categorias do perfil, com as subcategorias e a contagem de lançamentos de
     * cada uma, tudo por nome.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public tree(profileId: ProfileId): CategoryTree {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            const counts = this.categories.transactionCounts(profileId);
            const subCategories = this.categories.listSubCategories(profileId);
            return this.categories.listCategories(profileId).map((category) => ({
                category,
                subCategories: subCategories
                    .filter((subCategory) => subCategory.categoryId === category.id)
                    .map((subCategory) => ({ subCategory, transactionCount: counts.get(subCategory.id) ?? 0 })),
            }));
        });
    }

    /**
     * Regra de negócio (Categorias): nomes únicos no perfil, sem diferenciar maiúsculas
     * (database-design §4.8).
     *
     * @param command Perfil e nome.
     * @return A categoria gravada.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {NameConflictError} Quando o perfil já tem uma categoria com o nome.
     */
    public createCategory(command: CreateCategoryCommand): Category {
        return this.unitOfWork.run(() => {
            this.profiles.require(command.profileId);
            const category = Category.create({ id: CategoryId(this.ids.random()), profileId: command.profileId, name: command.name });
            this.assertCategoryNameFree(category);
            this.categories.saveCategory(category);
            return this.requireCategory(category.id);
        });
    }

    /**
     * @param command Categoria e novo nome.
     * @return A categoria renomeada.
     * @throws {NotFoundError} Quando a categoria não existe.
     * @throws {NameConflictError} Quando outra categoria do perfil já tem o nome.
     */
    public renameCategory(command: RenameCategoryCommand): Category {
        return this.unitOfWork.run(() => {
            const renamed = this.requireCategory(command.id).rename(command.name);
            this.assertCategoryNameFree(renamed);
            this.categories.saveCategory(renamed);
            return this.requireCategory(renamed.id);
        });
    }

    /**
     * Regra de negócio (Categorias): nomes de subcategoria são únicos dentro da categoria,
     * sem diferenciar maiúsculas (database-design §4.9).
     *
     * @param command Categoria e nome.
     * @return A subcategoria gravada.
     * @throws {NotFoundError} Quando a categoria não existe.
     * @throws {NameConflictError} Quando a categoria já tem uma subcategoria com o nome.
     */
    public createSubCategory(command: CreateSubCategoryCommand): SubCategory {
        return this.unitOfWork.run(() => {
            const category = this.requireCategory(command.categoryId);
            const subCategory = SubCategory.create({
                id: SubCategoryId(this.ids.random()),
                categoryId: category.id,
                profileId: category.profileId,
                name: command.name,
            });
            this.assertSubCategoryNameFree(subCategory);
            this.categories.saveSubCategory(subCategory);
            return this.requireSubCategory(subCategory.id);
        });
    }

    /**
     * @param command Subcategoria e novo nome.
     * @return A subcategoria renomeada.
     * @throws {NotFoundError} Quando a subcategoria não existe.
     * @throws {NameConflictError} Quando outra subcategoria da categoria já tem o nome.
     */
    public renameSubCategory(command: RenameSubCategoryCommand): SubCategory {
        return this.unitOfWork.run(() => {
            const renamed = this.requireSubCategory(command.id).rename(command.name);
            this.assertSubCategoryNameFree(renamed);
            this.categories.saveSubCategory(renamed);
            return this.requireSubCategory(renamed.id);
        });
    }

    /**
     * Exclui uma subcategoria.
     * Regra de negócio (Categorias): excluir uma subcategoria em uso pede para mover os
     * lançamentos antes (mockup `DesktopCadastros`) — toda transação precisa de uma
     * subcategoria viva (database-design §4.13), e apagar os lançamentos junto mudaria
     * saldos por uma ação de cadastro.
     *
     * @param command Subcategoria e, se ela estiver em uso, a que recebe os lançamentos.
     * @return void
     * @throws {NotFoundError} Quando a subcategoria ou o destino não existe.
     * @throws {BusinessRuleViolation} Quando está em uso sem destino, ou o destino é inválido.
     */
    public deleteSubCategory(command: DeleteCategoryCommand<SubCategoryId>): void {
        this.unitOfWork.run(() => {
            const subCategory = this.requireSubCategory(command.id);
            this.moveUsage([subCategory], command.moveTo);
            this.categories.softDeleteSubCategory(subCategory.id);
        });
    }

    /**
     * Exclui uma categoria e as subcategorias dela, pela mesma regra da subcategoria: os
     * lançamentos de todas elas vão para `moveTo`, que precisa estar fora da categoria.
     *
     * @param command Categoria e, se alguma subcategoria estiver em uso, a que recebe os
     * lançamentos.
     * @return void
     * @throws {NotFoundError} Quando a categoria ou o destino não existe.
     * @throws {BusinessRuleViolation} Quando há lançamentos sem destino, ou o destino é inválido.
     */
    public deleteCategory(command: DeleteCategoryCommand<CategoryId>): void {
        this.unitOfWork.run(() => {
            const category = this.requireCategory(command.id);
            const subCategories = this.categories.listSubCategories(category.profileId).filter((subCategory) => subCategory.categoryId === category.id);
            this.moveUsage(subCategories, command.moveTo);
            this.categories.softDeleteCategory(category.id);
        });
    }

    /**
     * Cria as categorias sugeridas no primeiro uso. Pula as que já existem pelo nome, para
     * que a chamada repetida não esbarre no índice único.
     *
     * @param profileId Perfil recém-criado.
     * @return void
     */
    public seedSuggested(profileId: ProfileId): void {
        this.unitOfWork.run(() => {
            const existing = this.categories.listCategories(profileId);
            for (const suggestion of SUGGESTED_CATEGORIES) {
                if (existing.some((category) => sameName(category.name, suggestion.name))) {
                    continue;
                }
                const category = Category.create({ id: CategoryId(this.ids.random()), profileId, name: suggestion.name });
                this.categories.saveCategory(category);
                for (const name of suggestion.subCategories) {
                    this.categories.saveSubCategory(SubCategory.create({ id: SubCategoryId(this.ids.random()), categoryId: category.id, profileId, name }));
                }
            }
        });
    }

    /**
     * Move os lançamentos das subcategorias que vão ser excluídas.
     *
     * @param doomed Subcategorias que vão ser excluídas.
     * @param moveTo Subcategoria de destino, ou `null` quando o usuário não escolheu.
     * @return void
     * @throws {NotFoundError} Quando o destino não existe.
     * @throws {BusinessRuleViolation} Quando há lançamentos sem destino, o destino é de
     * outro perfil ou é uma das subcategorias excluídas.
     */
    private moveUsage(doomed: readonly SubCategory[], moveTo: SubCategoryId | null): void {
        const first = doomed[0];
        if (first === undefined) {
            return;
        }
        const counts = this.categories.transactionCounts(first.profileId);
        const inUse = doomed.reduce((total, subCategory) => total + (counts.get(subCategory.id) ?? 0), 0);
        if (inUse === 0) {
            return;
        }
        if (moveTo === null) {
            throw new BusinessRuleViolation(
                'sub-category-in-use',
                'a subcategoria tem lançamentos; escolha para onde movê-los antes de excluir',
                { field: 'moveTo', transactions: inUse },
            );
        }
        const target = this.requireSubCategory(moveTo);
        if (target.profileId !== first.profileId) {
            throw new BusinessRuleViolation('reference-outside-profile', 'moveTo pertence a outro perfil', { field: 'moveTo' });
        }
        if (doomed.some((subCategory) => subCategory.id === target.id)) {
            throw new BusinessRuleViolation('move-target-deleted', 'o destino dos lançamentos é uma das subcategorias excluídas', { field: 'moveTo' });
        }
        for (const subCategory of doomed) {
            this.categories.moveTransactions(subCategory.id, target.id);
        }
    }

    /**
     * @param category Categoria a gravar, nova ou renomeada.
     * @return void
     * @throws {NameConflictError} Quando outra categoria viva do perfil tem o mesmo nome.
     */
    private assertCategoryNameFree(category: Category): void {
        const taken = this.categories
            .listCategories(category.profileId)
            .some((other) => other.id !== category.id && sameName(other.name, category.name));
        if (taken) {
            throw new NameConflictError('category', category.name);
        }
    }

    /**
     * @param subCategory Subcategoria a gravar, nova ou renomeada.
     * @return void
     * @throws {NameConflictError} Quando outra subcategoria viva da categoria tem o mesmo nome.
     */
    private assertSubCategoryNameFree(subCategory: SubCategory): void {
        const taken = this.categories
            .listSubCategories(subCategory.profileId)
            .some((other) => other.id !== subCategory.id && other.categoryId === subCategory.categoryId && sameName(other.name, subCategory.name));
        if (taken) {
            throw new NameConflictError('subCategory', subCategory.name);
        }
    }

    /**
     * @param id Categoria procurada.
     * @return A categoria viva.
     * @throws {NotFoundError} Quando não existe.
     */
    private requireCategory(id: CategoryId): Category {
        const category = this.categories.findCategory(id);
        if (category === null) {
            throw new NotFoundError('Category', id);
        }
        return category;
    }

    /**
     * @param id Subcategoria procurada.
     * @return A subcategoria viva.
     * @throws {NotFoundError} Quando não existe.
     */
    private requireSubCategory(id: SubCategoryId): SubCategory {
        const subCategory = this.categories.findSubCategory(id);
        if (subCategory === null) {
            throw new NotFoundError('SubCategory', id);
        }
        return subCategory;
    }
}

import { Category } from '../../domain/category/Category.ts';
import { SubCategory } from '../../domain/category/SubCategory.ts';
import { CategoryId, ProfileId, SubCategoryId } from '../../domain/shared/ids.ts';
import type { Clock } from '../../ports/Clock.ts';
import type { Database, SqlRow } from '../../ports/Database.ts';
import type { CategoryRepository } from '../../repositories/CategoryRepository.ts';
import { RowReader } from './RowReader.ts';

const SELECT_CATEGORY = 'SELECT c.id, c.profile_id, c.name FROM transaction_categories c';

// A subcategoria só está viva com a categoria viva, e o perfil vem da categoria: a
// subcategoria não tem `profile_id` próprio (database-design §4.9).
const SELECT_SUB_CATEGORY = `
    SELECT s.id, s.category_id, s.name, c.profile_id
    FROM transaction_sub_categories s
    JOIN transaction_categories c ON c.id = s.category_id AND c.deleted_at IS NULL
`;

/** Implementação SQLite de `CategoryRepository`. */
export class SqliteCategoryRepository implements CategoryRepository {
    /**
     * @param database Conexão compartilhada da unidade de trabalho.
     * @param clock Relógio que carimba `updated_at` e `deleted_at`.
     */
    public constructor(private readonly database: Database, private readonly clock: Clock) {}

    /**
     * @param id Categoria procurada.
     * @return A categoria viva, ou `null`.
     */
    public findCategory(id: CategoryId): Category | null {
        const row = this.database.get(`${SELECT_CATEGORY} WHERE c.id = :id AND c.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toCategory(row);
    }

    /**
     * @param id Subcategoria procurada.
     * @return A subcategoria viva de categoria viva, ou `null`.
     */
    public findSubCategory(id: SubCategoryId): SubCategory | null {
        const row = this.database.get(`${SELECT_SUB_CATEGORY} WHERE s.id = :id AND s.deleted_at IS NULL`, { id });
        return row === undefined ? null : this.toSubCategory(row);
    }

    /**
     * @param profileId Perfil dono.
     * @return As categorias vivas do perfil, por nome.
     */
    public listCategories(profileId: ProfileId): readonly Category[] {
        return this.database
            .all(`${SELECT_CATEGORY} WHERE c.profile_id = :profileId AND c.deleted_at IS NULL ORDER BY c.name COLLATE NOCASE, c.id`, { profileId })
            .map((row) => this.toCategory(row));
    }

    /**
     * @param profileId Perfil dono.
     * @return As subcategorias vivas das categorias vivas do perfil, por nome.
     */
    public listSubCategories(profileId: ProfileId): readonly SubCategory[] {
        return this.database
            .all(`${SELECT_SUB_CATEGORY} WHERE c.profile_id = :profileId AND s.deleted_at IS NULL ORDER BY s.name COLLATE NOCASE, s.id`, { profileId })
            .map((row) => this.toSubCategory(row));
    }

    /**
     * Conta só transações vivas, que são as que o usuário enxerga nas listas; uma transação
     * excluída que ainda aponta para a subcategoria não a deixa "em uso".
     *
     * @param profileId Perfil dono.
     * @return Transações vivas por subcategoria do perfil.
     */
    public transactionCounts(profileId: ProfileId): ReadonlyMap<SubCategoryId, number> {
        const rows = this.database.all(
            `SELECT s.id, COUNT(t.id) AS total
            FROM transaction_sub_categories s
            JOIN transaction_categories c ON c.id = s.category_id
            JOIN transactions t ON t.sub_category_id = s.id AND t.deleted_at IS NULL
            WHERE c.profile_id = :profileId
            GROUP BY s.id`,
            { profileId },
        );
        return new Map(rows.map((row) => {
            const reader = new RowReader('transaction_sub_categories', row);
            return [SubCategoryId(reader.text('id')), reader.number('total')];
        }));
    }

    /**
     * @param category Categoria a gravar.
     * @return void
     */
    public saveCategory(category: Category): void {
        this.database.run(
            `INSERT INTO transaction_categories (id, profile_id, name, updated_at)
            VALUES (:id, :profileId, :name, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
            WHERE transaction_categories.deleted_at IS NULL`,
            { id: category.id, profileId: category.profileId, name: category.name, now: this.clock.now() },
        );
    }

    /**
     * @param subCategory Subcategoria a gravar.
     * @return void
     */
    public saveSubCategory(subCategory: SubCategory): void {
        this.database.run(
            `INSERT INTO transaction_sub_categories (id, category_id, name, updated_at)
            VALUES (:id, :categoryId, :name, :now)
            ON CONFLICT (id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at
            WHERE transaction_sub_categories.deleted_at IS NULL`,
            { id: subCategory.id, categoryId: subCategory.categoryId, name: subCategory.name, now: this.clock.now() },
        );
    }

    /**
     * @param id Categoria a excluir, com as subcategorias.
     * @return void
     */
    public softDeleteCategory(id: CategoryId): void {
        const params = { id, now: this.clock.now() };
        this.database.run(
            'UPDATE transaction_sub_categories SET deleted_at = :now, updated_at = :now WHERE category_id = :id AND deleted_at IS NULL',
            params,
        );
        this.database.run('UPDATE transaction_categories SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL', params);
    }

    /**
     * @param id Subcategoria a excluir.
     * @return void
     */
    public softDeleteSubCategory(id: SubCategoryId): void {
        this.database.run(
            'UPDATE transaction_sub_categories SET deleted_at = :now, updated_at = :now WHERE id = :id AND deleted_at IS NULL',
            { id, now: this.clock.now() },
        );
    }

    /**
     * Carimba `updated_at` em cada transação movida, porque a reclassificação é uma revisão
     * da linha e precisa se propagar pela sincronização como qualquer edição.
     *
     * @param from Subcategoria de origem.
     * @param to Subcategoria de destino.
     * @return Quantas transações vivas foram movidas.
     */
    public moveTransactions(from: SubCategoryId, to: SubCategoryId): number {
        return this.database.run(
            'UPDATE transactions SET sub_category_id = :to, updated_at = :now WHERE sub_category_id = :from AND deleted_at IS NULL',
            { from, to, now: this.clock.now() },
        ).changes;
    }

    /**
     * @param row Linha do `SELECT_CATEGORY`.
     * @return A categoria de domínio.
     */
    private toCategory(row: SqlRow): Category {
        const reader = new RowReader('transaction_categories', row);
        return Category.restore({ id: CategoryId(reader.text('id')), profileId: ProfileId(reader.text('profile_id')), name: reader.text('name') });
    }

    /**
     * @param row Linha do `SELECT_SUB_CATEGORY`.
     * @return A subcategoria de domínio, com o perfil dono.
     */
    private toSubCategory(row: SqlRow): SubCategory {
        const reader = new RowReader('transaction_sub_categories', row);
        return SubCategory.restore({
            id: SubCategoryId(reader.text('id')),
            categoryId: CategoryId(reader.text('category_id')),
            profileId: ProfileId(reader.text('profile_id')),
            name: reader.text('name'),
        });
    }
}

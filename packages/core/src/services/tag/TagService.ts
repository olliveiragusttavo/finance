import { NameConflictError, NotFoundError } from '../../domain/shared/errors.ts';
import { TagId, type ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import { sameName } from '../../domain/shared/names.ts';
import { Tag } from '../../domain/tag/Tag.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { TagRepository } from '../../repositories/TagRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateTagCommand, RenameTagCommand } from './TagCommands.ts';
import type { TagWithUsage } from './TagViews.ts';

/**
 * Cadastro de tags (database-design §4.10; mockup `DesktopTags`). Concentra a regra que o
 * banco não expressa de forma legível — o nome único sem diferenciar maiúsculas, que o
 * índice `NOCASE` só cobre em ASCII — e a exclusão, que tira a tag dos lançamentos sem
 * mexer neles. Tag não afeta saldo, então nada aqui recalcula.
 */
export class TagService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 das tags novas.
     * @param profiles Confere o perfil e dá a moeda do total.
     * @param tags Tags e o uso delas.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly tags: TagRepository,
    ) {}

    /**
     * @param profileId Perfil consultado.
     * @return As tags do perfil por nome, cada uma com o uso em todo o período; tag sem
     * lançamento vem com contagem e total zerados.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId): readonly TagWithUsage[] {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const usage = this.tags.usage(profileId);
            return this.tags.listByProfile(profileId).map((tag) => {
                const used = usage.get(tag.id);
                return {
                    tag,
                    transactionCount: used?.transactionCount ?? 0,
                    total: Money.of(used?.valueTotal ?? 0, profile.currency),
                    lastUsedOn: used?.lastUsedOn ?? null,
                };
            });
        });
    }

    /**
     * Regra de negócio (Tags): nomes únicos no perfil, sem diferenciar maiúsculas
     * (database-design §4.10).
     *
     * @param command Perfil e nome.
     * @return A tag gravada.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {NameConflictError} Quando o perfil já tem uma tag com o nome.
     */
    public create(command: CreateTagCommand): Tag {
        return this.unitOfWork.run(() => {
            this.profiles.require(command.profileId);
            const tag = Tag.create({ id: TagId(this.ids.random()), profileId: command.profileId, name: command.name });
            this.assertNameFree(tag);
            this.tags.save(tag);
            return this.require(tag.id);
        });
    }

    /**
     * @param command Tag e novo nome.
     * @return A tag renomeada.
     * @throws {NotFoundError} Quando a tag não existe.
     * @throws {NameConflictError} Quando outra tag do perfil já tem o nome.
     */
    public rename(command: RenameTagCommand): Tag {
        return this.unitOfWork.run(() => {
            const renamed = this.require(command.id).rename(command.name);
            this.assertNameFree(renamed);
            this.tags.save(renamed);
            return this.require(renamed.id);
        });
    }

    /**
     * Regra de negócio (Tags): excluir remove a tag dos lançamentos, que continuam existindo
     * (mockup `DesktopTags`) — diferente da subcategoria, a tag é opcional no lançamento, e
     * nada precisa ser movido.
     *
     * @param id Tag a excluir.
     * @return void
     * @throws {NotFoundError} Quando a tag não existe.
     */
    public delete(id: TagId): void {
        this.unitOfWork.run(() => {
            this.tags.softDelete(this.require(id).id);
        });
    }

    /**
     * @param id Tag procurada.
     * @return A tag viva.
     * @throws {NotFoundError} Quando não existe.
     */
    public require(id: TagId): Tag {
        const tag = this.tags.findById(id);
        if (tag === null) {
            throw new NotFoundError('Tag', id);
        }
        return tag;
    }

    /**
     * @param tag Tag a gravar, nova ou renomeada.
     * @return void
     * @throws {NameConflictError} Quando outra tag viva do perfil tem o mesmo nome.
     */
    private assertNameFree(tag: Tag): void {
        const taken = this.tags.listByProfile(tag.profileId).some((other) => other.id !== tag.id && sameName(other.name, tag.name));
        if (taken) {
            throw new NameConflictError('tag', tag.name);
        }
    }
}

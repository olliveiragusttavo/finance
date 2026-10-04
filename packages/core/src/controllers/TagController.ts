import { toTagResponse, toTagUsageResponses, type TagResponse, type TagUsageResponse } from '../dto/tags/TagResponse.ts';
import { createTagRequest, listTagsRequest, renameTagRequest, tagIdRequest } from '../requests/tagRequests.ts';
import type { TagService } from '../services/tag/TagService.ts';
import { handle, type CoreResult, type UnexpectedErrorListener } from './CoreResult.ts';

/** Rotas do cadastro de tags. */
export class TagController {
    /**
     * @param tags Cadastro de tags.
     * @param onUnexpected Destino do log de falhas inesperadas.
     */
    public constructor(
        private readonly tags: TagService,
        private readonly onUnexpected: UnexpectedErrorListener,
    ) {}

    /**
     * @param raw Entrada com o perfil.
     * @return As tags do perfil, com o uso de cada uma.
     */
    public list(raw: unknown): Promise<CoreResult<readonly TagUsageResponse[]>> {
        return handle(listTagsRequest, raw, ({ profileId }) => toTagUsageResponses(this.tags.list(profileId)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com o perfil e o nome.
     * @return A tag criada.
     */
    public create(raw: unknown): Promise<CoreResult<TagResponse>> {
        return handle(createTagRequest, raw, (command) => toTagResponse(this.tags.create(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a tag e o novo nome.
     * @return A tag renomeada.
     */
    public rename(raw: unknown): Promise<CoreResult<TagResponse>> {
        return handle(renameTagRequest, raw, (command) => toTagResponse(this.tags.rename(command)), this.onUnexpected);
    }

    /**
     * @param raw Entrada com a tag.
     * @return `null` em caso de sucesso.
     */
    public delete(raw: unknown): Promise<CoreResult<null>> {
        return handle(tagIdRequest, raw, ({ id }) => {
            this.tags.delete(id);
            return null;
        }, this.onUnexpected);
    }
}

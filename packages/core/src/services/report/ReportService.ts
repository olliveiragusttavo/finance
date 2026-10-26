import { ReportDefinition } from '../../domain/report/ReportDefinition.ts';
import { ReportFilter } from '../../domain/report/ReportFilter.ts';
import { ReportLayout } from '../../domain/report/ReportLayout.ts';
import { buildReportResult, type ReportResult } from '../../domain/report/ReportResult.ts';
import { NameConflictError, NotFoundError } from '../../domain/shared/errors.ts';
import { ReportDefinitionId, type ProfileId } from '../../domain/shared/ids.ts';
import { sameName } from '../../domain/shared/names.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { ReportDefinitionRepository } from '../../repositories/ReportDefinitionRepository.ts';
import type { ReportQueryRepository, ReportReferenceKind } from '../../repositories/ReportQueryRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateReportCommand, PreviewReportCommand, RunReportCommand, UpdateReportCommand } from './ReportCommands.ts';

/** Cada lista de ids do filtro, com o cadastro que ela referencia e o nome do erro. */
const REFERENCES: readonly { readonly kind: ReportReferenceKind; readonly entity: string; readonly ids: (filter: ReportFilter) => readonly string[] }[] = [
    { kind: 'category', entity: 'Category', ids: (filter) => filter.categoryIds },
    { kind: 'subCategory', entity: 'SubCategory', ids: (filter) => filter.subCategoryIds },
    { kind: 'account', entity: 'Account', ids: (filter) => filter.accountIds },
    { kind: 'creditCard', entity: 'CreditCard', ids: (filter) => filter.creditCardIds },
    { kind: 'tag', entity: 'Tag', ids: (filter) => filter.tagIds },
    { kind: 'partner', entity: 'Partner', ids: (filter) => filter.partnerIds },
    { kind: 'goal', entity: 'Goal', ids: (filter) => filter.goalIds },
];

/**
 * Relatórios personalizados (reports-design): o cadastro das definições e a execução delas.
 * Concentra as regras que relacionam linhas — o nome único no perfil e a posse de cada cadastro
 * do filtro — e a montagem do resultado, que lê as somas do banco numa unidade de trabalho só,
 * para que células e totais venham do mesmo estado.
 */
export class ReportService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 das definições novas.
     * @param profiles Confere o perfil e dá a moeda do resultado.
     * @param definitions Definições gravadas.
     * @param queries Somas e conferência de referências.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly definitions: ReportDefinitionRepository,
        private readonly queries: ReportQueryRepository,
    ) {}

    /**
     * @param profileId Perfil consultado.
     * @return As definições do perfil, por nome — a lista da página de Relatórios.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId): readonly ReportDefinition[] {
        return this.unitOfWork.run(() => {
            this.profiles.require(profileId);
            return this.definitions.listByProfile(profileId);
        });
    }

    /**
     * Regra de negócio (Relatórios, §2.2 e §4): nome único no perfil, sem diferenciar maiúsculas,
     * e todo cadastro do filtro vivo e do perfil.
     *
     * @param command Perfil, nome, filtro e formato.
     * @return A definição gravada.
     * @throws {NotFoundError} Quando o perfil ou um cadastro do filtro não existe, ou é de outro perfil.
     * @throws {NameConflictError} Quando o perfil já tem um relatório com o nome.
     * @throws {InvalidValueError} Quando o nome ou o filtro é inválido.
     * @throws {BusinessRuleViolation} `report-dimensions-repeated` quando as dimensões se repetem.
     */
    public create(command: CreateReportCommand): ReportDefinition {
        return this.unitOfWork.run(() => {
            this.profiles.require(command.profileId);
            const definition = ReportDefinition.create({
                id: ReportDefinitionId(this.ids.random()),
                profileId: command.profileId,
                name: command.name,
                filter: ReportFilter.create(command.filter),
                layout: ReportLayout.create(command.layout),
            });
            this.assertReferences(definition.profileId, definition.filter, null);
            this.assertNameFree(definition);
            this.definitions.save(definition);
            return this.require(definition.id);
        });
    }

    /**
     * Regra de negócio (Relatórios, §2.2): um cadastro excluído depois de salvo continua na
     * definição e não casa com nada; por isso regravar aceita os ids que a definição já tinha,
     * mesmo mortos, e só confere os novos — mudar o nome não pode exigir limpar o filtro antes.
     *
     * @param command Definição, nome, filtro e formato.
     * @return A definição regravada.
     * @throws {NotFoundError} Quando a definição ou um cadastro novo do filtro não existe.
     * @throws {NameConflictError} Quando outro relatório do perfil já tem o nome.
     * @throws {InvalidValueError} Quando o nome ou o filtro é inválido.
     * @throws {BusinessRuleViolation} `report-dimensions-repeated` quando as dimensões se repetem.
     */
    public update(command: UpdateReportCommand): ReportDefinition {
        return this.unitOfWork.run(() => {
            const current = this.require(command.id);
            const revised = current.revise(command.name, ReportFilter.create(command.filter), ReportLayout.create(command.layout));
            this.assertReferences(revised.profileId, revised.filter, current.filter);
            this.assertNameFree(revised);
            this.definitions.save(revised);
            return this.require(revised.id);
        });
    }

    /**
     * @param id Definição a excluir; as transações não são tocadas.
     * @return void
     * @throws {NotFoundError} Quando a definição não existe.
     */
    public delete(id: ReportDefinitionId): void {
        this.unitOfWork.run(() => {
            this.definitions.softDelete(this.require(id).id);
        });
    }

    /**
     * @param command Definição e mês de referência da tela.
     * @return O resultado da definição salva.
     * @throws {NotFoundError} Quando a definição não existe.
     */
    public run(command: RunReportCommand): ReportResult {
        return this.unitOfWork.run(() => {
            const definition = this.require(command.id);
            return this.execute(definition.profileId, definition.filter, definition.layout, command.period);
        });
    }

    /**
     * Roda o que o editor está montando, sem gravar, com as mesmas regras da definição salva —
     * inclusive a conferência das referências, para que o resultado ao vivo nunca mostre algo que
     * o salvar depois recusaria.
     *
     * @param command Perfil, mês de referência, filtro e formato.
     * @return O resultado, como `run` o daria depois de salvar.
     * @throws {NotFoundError} Quando o perfil ou um cadastro do filtro não existe.
     * @throws {InvalidValueError} Quando o filtro é inválido.
     * @throws {BusinessRuleViolation} `report-dimensions-repeated` quando as dimensões se repetem.
     */
    public preview(command: PreviewReportCommand): ReportResult {
        return this.unitOfWork.run(() => {
            this.profiles.require(command.profileId);
            const filter = ReportFilter.create(command.filter);
            this.assertReferences(command.profileId, filter, null);
            return this.execute(command.profileId, filter, ReportLayout.create(command.layout), command.period);
        });
    }

    /**
     * @param id Definição procurada.
     * @return A definição viva.
     * @throws {NotFoundError} Quando não existe.
     */
    public require(id: ReportDefinitionId): ReportDefinition {
        const definition = this.definitions.findById(id);
        if (definition === null) {
            throw new NotFoundError('ReportDefinition', id);
        }
        return definition;
    }

    /**
     * Lê as somas em cada nível de agrupamento — células, total da linha, total da coluna e
     * geral — porque com a tag como dimensão os totais não são a soma das células
     * (reports-design §3).
     *
     * @param profileId Perfil dono das transações.
     * @param filter Filtro validado.
     * @param layout Formato validado.
     * @param reference Mês de referência da tela.
     * @return O resultado montado.
     */
    private execute(profileId: ProfileId, filter: ReportFilter, layout: ReportLayout, reference: YearMonth): ReportResult {
        const profile = this.profiles.require(profileId);
        const window = filter.windowFor(reference);
        const scope = { profileId, filter, window };
        const cells = this.queries.aggregate(scope, layout.dimensions());
        const grand = this.queries.aggregate(scope, [])[0];
        return buildReportResult(layout, window, {
            cells,
            primaryTotals: layout.secondary === null ? cells : this.queries.aggregate(scope, [layout.primary]),
            secondaryTotals: layout.secondary === null ? [] : this.queries.aggregate(scope, [layout.secondary]),
            grandTotal: { total: grand?.total ?? 0, count: grand?.count ?? 0 },
        }, profile.currency);
    }

    /**
     * @param profileId Perfil dono da definição.
     * @param filter Filtro a conferir.
     * @param kept Filtro já gravado, cujos ids são aceitos mesmo excluídos; `null` na criação e
     * no editor, que conferem tudo.
     * @return void
     * @throws {NotFoundError} Com o primeiro cadastro novo que não existe, está excluído ou é de
     * outro perfil.
     */
    private assertReferences(profileId: ProfileId, filter: ReportFilter, kept: ReportFilter | null): void {
        for (const reference of REFERENCES) {
            const previous = new Set(kept === null ? [] : reference.ids(kept));
            const requested = reference.ids(filter).filter((id) => !previous.has(id));
            const live = this.queries.liveReferences(profileId, reference.kind, requested);
            const missing = requested.find((id) => !live.has(id));
            if (missing !== undefined) {
                throw new NotFoundError(reference.entity, missing);
            }
        }
    }

    /**
     * @param definition Definição a gravar, nova ou regravada.
     * @return void
     * @throws {NameConflictError} Quando outra definição viva do perfil tem o mesmo nome.
     */
    private assertNameFree(definition: ReportDefinition): void {
        const taken = this.definitions.listByProfile(definition.profileId).some((other) => other.id !== definition.id && sameName(other.name, definition.name));
        if (taken) {
            throw new NameConflictError('report', definition.name);
        }
    }
}

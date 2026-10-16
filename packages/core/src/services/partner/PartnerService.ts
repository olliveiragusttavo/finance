import { byLargestShare, Partner } from '../../domain/partner/Partner.ts';
import { assertSharesComplete } from '../../domain/partner/PartnerShares.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { PartnerId, type ProfileId } from '../../domain/shared/ids.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { PartnerRepository } from '../../repositories/PartnerRepository.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { PartnerEntry, ReplacePartnersCommand } from './PartnerCommands.ts';
import type { PartnerWithUsage } from './PartnerViews.ts';

/**
 * Cadastro de sócios (database-design §4.2; mockup `DesktopSocios`). Concentra as regras que
 * relacionam linhas e que o banco não garante (§3.10): sócio só em perfil empresarial e
 * participações somando 100%. Sócio não afeta saldo, então nada aqui recalcula.
 */
export class PartnerService {
    /**
     * @param unitOfWork Leitura, conferência e escrita numa transação só.
     * @param ids Gera o UUID v4 dos sócios novos.
     * @param profiles Confere o perfil e o tipo dele.
     * @param partners Sócios e quantos lançamentos estão vinculados a cada um.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly partners: PartnerRepository,
    ) {}

    /**
     * @param profileId Perfil empresarial consultado.
     * @return Os sócios vivos, maior participação primeiro, cada um com os lançamentos vinculados.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} `partner-requires-business-profile` num perfil pessoal.
     */
    public list(profileId: ProfileId): readonly PartnerWithUsage[] {
        return this.unitOfWork.run(() => {
            this.requireBusiness(profileId);
            return this.withUsage(profileId);
        });
    }

    /**
     * Grava a lista de sócios como o cadastro a deixou: cria os novos, regrava os editados e
     * remove os que saíram, tudo na mesma transação — a soma de 100% vale para o resultado, e
     * gravar sócio a sócio passaria por estados intermediários que ela recusa.
     * Regra de negócio (Sócios, database-design §4.2): só perfis empresariais têm sócios, e as
     * participações somam 100% (`assertSharesComplete`). Remover um sócio deixa os lançamentos
     * vinculados a ele sem sócio atribuído (decisão de interface 10 dos mockups).
     *
     * @param command Perfil e a lista completa de sócios.
     * @return A lista gravada, como a `list` a devolve.
     * @throws {NotFoundError} Quando o perfil não existe, ou um id enviado não é de um sócio
     * vivo do perfil (excluído antes, ou de outro perfil).
     * @throws {BusinessRuleViolation} `partner-requires-business-profile` num perfil pessoal;
     * `partner-shares-not-100` quando a soma das participações difere de 100%.
     * @throws {InvalidValueError} Quando um nome ou uma participação é inválido.
     */
    public replace(command: ReplacePartnersCommand): readonly PartnerWithUsage[] {
        return this.unitOfWork.run(() => {
            const profile = this.requireBusiness(command.profileId);
            const current = new Map(this.partners.listByProfile(profile.id).map((partner) => [partner.id, partner]));
            const next = command.partners.map((entry) => this.resolve(profile, current, entry));
            assertSharesComplete(next);
            const kept = new Set(next.map((partner) => partner.id));
            for (const removed of current.values()) {
                if (!kept.has(removed.id)) {
                    this.partners.softDelete(removed.id);
                }
            }
            for (const partner of next) {
                // Só o que mudou é regravado, para que o `updated_at` do sócio intocado continue
                // dizendo quando ele mudou de fato.
                if (!unchanged(current.get(partner.id), partner)) {
                    this.partners.save(partner);
                }
            }
            return this.withUsage(profile.id);
        });
    }

    /**
     * @param profile Perfil dono.
     * @param current Sócios vivos do perfil, pelo id.
     * @param entry Sócio como o cadastro o enviou.
     * @return O sócio novo, ou o existente com os dados trocados.
     * @throws {NotFoundError} Quando o id não está entre os sócios vivos do perfil.
     * @throws {InvalidValueError} Quando o nome ou a participação é inválido.
     */
    private resolve(profile: Profile, current: ReadonlyMap<PartnerId, Partner>, entry: PartnerEntry): Partner {
        if (entry.id === null) {
            return Partner.create({ id: PartnerId(this.ids.random()), profileId: profile.id, name: entry.name, percentage: entry.percentage });
        }
        const existing = current.get(entry.id);
        if (existing === undefined) {
            throw new NotFoundError('Partner', entry.id);
        }
        return existing.revise({ name: entry.name, percentage: entry.percentage });
    }

    /**
     * @param profileId Perfil consultado.
     * @return Os sócios vivos na ordem do cadastro, com a contagem de lançamentos.
     */
    private withUsage(profileId: ProfileId): readonly PartnerWithUsage[] {
        const counts = this.partners.transactionCounts(profileId);
        return [...this.partners.listByProfile(profileId)].sort(byLargestShare).map((partner) => ({ partner, transactionCount: counts.get(partner.id) ?? 0 }));
    }

    /**
     * Regra de negócio (Perfil): sócios só existem em perfis empresariais (database-design §4.1);
     * o banco não expressa a restrição porque ela relaciona duas tabelas.
     *
     * @param profileId Perfil pedido.
     * @return O perfil, já conferido.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando o perfil é pessoal.
     */
    private requireBusiness(profileId: ProfileId): Profile {
        const profile = this.profiles.require(profileId);
        if (!profile.acceptsPartners()) {
            throw new BusinessRuleViolation('partner-requires-business-profile', 'só perfis empresariais têm sócios');
        }
        return profile;
    }
}

/**
 * @param before Sócio como está gravado; `undefined` quando é novo.
 * @param after Sócio como vai ficar.
 * @return `true` quando nada que o banco guarda mudou.
 */
function unchanged(before: Partner | undefined, after: Partner): boolean {
    return before !== undefined && before.name === after.name && before.percentage === after.percentage;
}

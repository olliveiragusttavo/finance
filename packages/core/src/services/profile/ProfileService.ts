import { Profile } from '../../domain/profile/Profile.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { ProfileId } from '../../domain/shared/ids.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateProfileCommand, UpdateProfileCommand } from './ProfileCommands.ts';

/** Cadastro de perfis: listar, criar, renomear e trocar a moeda. */
export class ProfileService {
    /**
     * @param unitOfWork Leitura e escrita numa transação só.
     * @param ids Gera o UUID v4 do perfil novo (database-design §3.5).
     * @param profiles Perfis.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileRepository,
    ) {}

    /**
     * @return Os perfis vivos, por nome.
     */
    public list(): readonly Profile[] {
        return this.unitOfWork.run(() => this.profiles.list());
    }

    /**
     * @param command Dados do perfil novo.
     * @return O perfil gravado, relido do banco.
     * @throws {InvalidValueError} Quando o nome ou a moeda é inválido.
     */
    public create(command: CreateProfileCommand): Profile {
        return this.unitOfWork.run(() => {
            const profile = Profile.create({
                id: ProfileId(this.ids.random()),
                name: command.name,
                type: command.type,
                currency: Currency.of(command.currency),
            });
            this.profiles.save(profile);
            return this.require(profile.id);
        });
    }

    /**
     * Renomeia e, se pedido, troca a moeda.
     * Regra de negócio (Perfil): a moeda do perfil é a unidade de todo valor gravado
     * (database-design §4.1). Trocar a moeda não converte nada, então só é permitido
     * enquanto o perfil não tem lançamentos — é o caso de quem escolheu a moeda errada no
     * primeiro uso. Com lançamentos, cada valor passaria a significar outra quantia de
     * dinheiro, e uma moeda de outra precisão (iene, dinar) arredondaria o histórico.
     *
     * @param command Novo nome e moeda.
     * @return O perfil editado, relido do banco.
     * @throws {NotFoundError} Quando o perfil não existe.
     * @throws {BusinessRuleViolation} Quando a moeda muda num perfil com lançamentos.
     * @throws {InvalidValueError} Quando o nome ou a moeda é inválido.
     */
    public update(command: UpdateProfileCommand): Profile {
        return this.unitOfWork.run(() => {
            const current = this.require(command.id);
            const currency = Currency.of(command.currency);
            if (!currency.equals(current.currency) && this.profiles.hasTransactions(current.id)) {
                throw new BusinessRuleViolation(
                    'profile-currency-locked',
                    'a moeda do perfil não pode mudar depois que há lançamentos',
                    { field: 'currency' },
                );
            }
            this.profiles.save(current.rename(command.name).withCurrency(currency));
            return this.require(current.id);
        });
    }

    /**
     * @param id Perfil procurado.
     * @return O perfil vivo.
     * @throws {NotFoundError} Quando não existe.
     */
    public require(id: ProfileId): Profile {
        const profile = this.profiles.findById(id);
        if (profile === null) {
            throw new NotFoundError('Profile', id);
        }
        return profile;
    }
}

import { Profile } from '../../domain/profile/Profile.ts';
import { Currency } from '../../domain/shared/Currency.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { ProfileId } from '../../domain/shared/ids.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { AccountRepository } from '../../repositories/AccountRepository.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { ProfileRepository } from '../../repositories/ProfileRepository.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateProfileCommand, SetDefaultAccountCommand, SetDefaultCreditCardCommand, UpdateProfileCommand } from './ProfileCommands.ts';

/** Cadastro de perfis: listar, criar, renomear, trocar a moeda e escolher a conta e o cartão padrão. */
export class ProfileService {
    /**
     * @param unitOfWork Leitura e escrita numa transação só.
     * @param ids Gera o UUID v4 do perfil novo (database-design §3.5).
     * @param profiles Perfis.
     * @param accounts Contas, para conferir a conta padrão escolhida.
     * @param creditCards Cartões, para conferir o cartão padrão escolhido.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileRepository,
        private readonly accounts: AccountRepository,
        private readonly creditCards: CreditCardRepository,
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
     * Escolhe a conta que o atalho "Débito" do lançamento novo seleciona.
     * Regra de negócio (Lançamentos, database-design §4.1): no máximo uma conta padrão por perfil
     * — escolher outra substitui a anterior —, do próprio perfil e ativa, porque a conta
     * desativada não aceita lançamentos novos e o atalho só trocaria a escolha por um erro ao salvar.
     *
     * @param command Perfil e conta escolhida, ou `null` para tirar o padrão.
     * @return O perfil com a conta padrão nova.
     * @throws {NotFoundError} Quando o perfil ou a conta não existe.
     * @throws {BusinessRuleViolation} Quando a conta é de outro perfil ou está desativada.
     */
    public setDefaultAccount(command: SetDefaultAccountCommand): Profile {
        return this.unitOfWork.run(() => {
            const profile = this.require(command.profileId);
            if (command.accountId !== null) {
                const account = this.accounts.findById(command.accountId);
                if (account === null) {
                    throw new NotFoundError('Account', command.accountId);
                }
                if (account.profileId !== profile.id) {
                    throw new BusinessRuleViolation('reference-outside-profile', 'accountId pertence a outro perfil', { field: 'accountId' });
                }
                if (account.disabled) {
                    throw new BusinessRuleViolation('account-disabled', 'a conta padrão escolhida está desativada', { field: 'accountId' });
                }
            }
            this.profiles.setDefaultAccount(profile.id, command.accountId);
            return this.require(profile.id);
        });
    }

    /**
     * Escolhe o cartão que o atalho "Crédito" do lançamento novo seleciona, com a mesma regra da
     * conta padrão (`setDefaultAccount`).
     *
     * @param command Perfil e cartão escolhido, ou `null` para tirar o padrão.
     * @return O perfil com o cartão padrão novo.
     * @throws {NotFoundError} Quando o perfil ou o cartão não existe.
     * @throws {BusinessRuleViolation} Quando o cartão é de outro perfil ou está desativado.
     */
    public setDefaultCreditCard(command: SetDefaultCreditCardCommand): Profile {
        return this.unitOfWork.run(() => {
            const profile = this.require(command.profileId);
            if (command.creditCardId !== null) {
                const creditCard = this.creditCards.findById(command.creditCardId);
                if (creditCard === null) {
                    throw new NotFoundError('CreditCard', command.creditCardId);
                }
                if (creditCard.profileId !== profile.id) {
                    throw new BusinessRuleViolation('reference-outside-profile', 'creditCardId pertence a outro perfil', { field: 'creditCardId' });
                }
                if (creditCard.disabled) {
                    throw new BusinessRuleViolation('credit-card-disabled', 'o cartão padrão escolhido está desativado', { field: 'creditCardId' });
                }
            }
            this.profiles.setDefaultCreditCard(profile.id, command.creditCardId);
            return this.require(profile.id);
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

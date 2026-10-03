import type { Account } from '../../domain/account/Account.ts';
import { BillingCycle } from '../../domain/creditCard/BillingCycle.ts';
import { CreditCard, type CreditCardContent } from '../../domain/creditCard/CreditCard.ts';
import type { Invoice } from '../../domain/invoice/Invoice.ts';
import type { Profile } from '../../domain/profile/Profile.ts';
import type { Currency } from '../../domain/shared/Currency.ts';
import { BusinessRuleViolation, NotFoundError } from '../../domain/shared/errors.ts';
import { CreditCardId, type ProfileId } from '../../domain/shared/ids.ts';
import { Money } from '../../domain/shared/Money.ts';
import type { YearMonth } from '../../domain/shared/YearMonth.ts';
import type { IdGenerator } from '../../ports/IdGenerator.ts';
import type { CreditCardRepository } from '../../repositories/CreditCardRepository.ts';
import type { InvoiceRepository } from '../../repositories/InvoiceRepository.ts';
import type { AccountService } from '../account/AccountService.ts';
import type { BalanceRecalculationService } from '../balance/BalanceRecalculationService.ts';
import { invoiceCycle } from '../invoice/InvoiceCycle.ts';
import type { ProfileService } from '../profile/ProfileService.ts';
import type { UnitOfWork } from '../UnitOfWork.ts';
import type { CreateCreditCardCommand, CreditCardInput, UpdateCreditCardCommand } from './CreditCardCommands.ts';
import type { CreditCardListView } from './CreditCardViews.ts';

/**
 * Cadastro de cartões: listar com a fatura do mês, criar, editar, desativar e reativar. É o
 * ponto de controle das regras que ligam o cartão à conta pagadora, que o banco não garante
 * (database-design §3.10): mesma conta do perfil e conta ativa.
 */
export class CreditCardService {
    /**
     * @param unitOfWork Escrita e recálculo na mesma transação de banco.
     * @param ids Gera o UUID v4 do cartão novo.
     * @param profiles Perfil dono: existência e moeda do limite.
     * @param accounts Conta pagadora.
     * @param creditCards Cartões.
     * @param invoices Fatura do mês e faturas em aberto, para o limite usado.
     * @param recalculation A rotina única de recálculo, para conta pagadora ou ciclo editados.
     */
    public constructor(
        private readonly unitOfWork: UnitOfWork,
        private readonly ids: IdGenerator,
        private readonly profiles: ProfileService,
        private readonly accounts: AccountService,
        private readonly creditCards: CreditCardRepository,
        private readonly invoices: InvoiceRepository,
        private readonly recalculation: BalanceRecalculationService,
    ) {}

    /**
     * Lista os cartões com a fatura do mês e os totais do mês (mockup `DesktopCartoes`:
     * "Em aberto no mês" e "Total das faturas").
     * Regra de negócio (Cartões): a "fatura do mês" é a fatura da competência pedida — a que
     * fecha naquele mês (mockup `DesktopCartoes`). O limite usado é o valor a pagar somado
     * de **todas** as faturas em aberto do cartão, inclusive as futuras de parcelas, porque é
     * o que o banco já reservou do limite; faturas pagas não usam limite.
     *
     * @param profileId Perfil consultado.
     * @param period Mês de referência da tela.
     * @return Os cartões, ativos e desativados, com a fatura do mês e o limite usado.
     * @throws {NotFoundError} Quando o perfil não existe.
     */
    public list(profileId: ProfileId, period: YearMonth): CreditCardListView {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(profileId);
            const creditCards = this.creditCards.listByProfile(profileId).map((creditCard) => {
                const invoices = this.invoices.listByCard(creditCard.id);
                return {
                    creditCard,
                    invoiceOfMonth: invoiceCycle(creditCard, period, invoices.find((invoice) => invoice.period.equals(period)) ?? null),
                    limitUsed: amountDue(invoices.filter((invoice) => !invoice.isPaid()), profile.currency),
                };
            });
            const monthInvoices = creditCards.flatMap(({ invoiceOfMonth }) => (invoiceOfMonth.invoice === null ? [] : [invoiceOfMonth.invoice]));
            return {
                profile,
                period,
                creditCards,
                openTotal: amountDue(monthInvoices.filter((invoice) => !invoice.isPaid()), profile.currency),
                total: amountDue(monthInvoices, profile.currency),
            };
        });
    }

    /**
     * @param command Perfil dono e dados do cadastro.
     * @return O cartão gravado, relido do banco.
     * @throws {NotFoundError} Quando o perfil ou a conta pagadora não existe.
     * @throws {BusinessRuleViolation} Quando a conta pagadora é de outro perfil ou está desativada.
     * @throws {InvalidValueError} Quando o nome, o limite ou os dias são inválidos.
     */
    public create(command: CreateCreditCardCommand): CreditCard {
        return this.unitOfWork.run(() => {
            const profile = this.profiles.require(command.profileId);
            this.payingAccount(profile.id, command.accountId, null);
            const creditCard = CreditCard.create(CreditCardId(this.ids.random()), profile.id, this.toContent(profile, command));
            this.creditCards.save(creditCard);
            return this.require(creditCard.id);
        });
    }

    /**
     * Edita o cadastro.
     * Regra de negócio (Cartão de crédito): mudar o fechamento **não** move lançamentos
     * (database-design §4.7). Mas o ciclo decide o mês do vencimento — em que a fatura em
     * aberto pesa no previsto — e a conta pagadora decide em que conta ela pesa; mudar
     * qualquer um dos dois recalcula a conta antiga e a nova.
     *
     * @param command Novo cadastro completo, com o id do cartão.
     * @return O cartão editado, relido do banco.
     * @throws {NotFoundError} Quando o cartão ou a conta pagadora não existe.
     * @throws {BusinessRuleViolation} Quando a nova conta pagadora é de outro perfil ou está
     * desativada.
     * @throws {InvalidValueError} Quando o nome, o limite ou os dias são inválidos.
     */
    public update(command: UpdateCreditCardCommand): CreditCard {
        return this.unitOfWork.run(() => {
            const current = this.require(command.id);
            const profile = this.profiles.require(current.profileId);
            this.payingAccount(profile.id, command.accountId, current.accountId);
            const content = this.toContent(profile, command);
            this.creditCards.save(current.revise(content));
            if (current.affectsBalancesWhenRevisedTo(content)) {
                for (const accountId of new Set([current.accountId, content.accountId])) {
                    this.recalculation.recalculateAccountFully(accountId);
                }
            }
            return this.require(current.id);
        });
    }

    /**
     * Regra de negócio (Cartões): desativar não apaga faturas nem muda saldo
     * (desktop-mvp-plan §5.1).
     *
     * @param id Cartão a desativar.
     * @return O cartão desativado.
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public disable(id: CreditCardId): CreditCard {
        return this.unitOfWork.run(() => {
            this.creditCards.save(this.require(id).disable());
            return this.require(id);
        });
    }

    /**
     * @param id Cartão a reativar.
     * @return O cartão ativo.
     * @throws {NotFoundError} Quando o cartão não existe.
     */
    public enable(id: CreditCardId): CreditCard {
        return this.unitOfWork.run(() => {
            this.creditCards.save(this.require(id).enable());
            return this.require(id);
        });
    }

    /**
     * @param id Cartão procurado.
     * @return O cartão vivo.
     * @throws {NotFoundError} Quando não existe.
     */
    public require(id: CreditCardId): CreditCard {
        const creditCard = this.creditCards.findById(id);
        if (creditCard === null) {
            throw new NotFoundError('CreditCard', id);
        }
        return creditCard;
    }

    /**
     * Confere a conta pagadora.
     * Regra de negócio (Cartões): a conta que quita o cartão é do **mesmo** perfil
     * (database-design §4.5) e, quando escolhida agora, está ativa — conta desativada some
     * das escolhas novas, mas o cartão que já a usa continua editável (desktop-mvp-plan §5.1).
     *
     * @param profileId Perfil dono do cartão.
     * @param accountId Conta escolhida.
     * @param currentAccountId Conta atual numa edição; `null` num cadastro novo.
     * @return A conta pagadora.
     * @throws {NotFoundError} Quando a conta não existe.
     * @throws {BusinessRuleViolation} Quando é de outro perfil ou foi escolhida desativada.
     */
    private payingAccount(profileId: ProfileId, accountId: Account['id'], currentAccountId: Account['id'] | null): Account {
        const account = this.accounts.require(accountId);
        if (account.profileId !== profileId) {
            throw new BusinessRuleViolation('reference-outside-profile', 'accountId pertence a outro perfil', { field: 'accountId' });
        }
        if (account.disabled && account.id !== currentAccountId) {
            throw new BusinessRuleViolation('account-disabled', 'a conta pagadora está desativada', { field: 'accountId' });
        }
        return account;
    }

    /**
     * @param profile Perfil dono; dá a moeda do limite.
     * @param input Dados validados pela camada Request.
     * @return O conteúdo de domínio do cadastro.
     * @throws {InvalidValueError} Quando algum dia está fora de 1–31.
     */
    private toContent(profile: Profile, input: CreditCardInput): CreditCardContent {
        return {
            accountId: input.accountId,
            name: input.name,
            limit: Money.of(input.limit, profile.currency),
            billingCycle: BillingCycle.of(input.closingDay, input.dueDay),
        };
    }
}

/**
 * Soma o valor a pagar das faturas, em módulo, como a tela mostra (database-design §4.7).
 * Fatura credora (estornos maiores que as compras) entra como zero: crédito não paga outra
 * fatura nem libera limite de outro mês.
 *
 * @param invoices Faturas a somar.
 * @param currency Moeda do perfil, para o zero da soma vazia.
 * @return O total a pagar.
 */
function amountDue(invoices: readonly Invoice[], currency: Currency): Money {
    return invoices
        .filter((invoice) => invoice.balance.isNegative())
        .reduce((sum, invoice) => sum.subtract(invoice.balance), Money.zero(currency));
}

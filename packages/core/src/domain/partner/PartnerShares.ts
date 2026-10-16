import { BusinessRuleViolation } from '../shared/errors.ts';
import type { Partner } from './Partner.ts';

/** 100% em centésimos de ponto percentual, a unidade do `Partner.hundredths`. */
const FULL_SHARE_HUNDREDTHS = 100 * 100;

/**
 * Confere que as participações de um perfil fecham 100%.
 * Regra de negócio (Sócios, database-design §4.2; decisão de interface 10 dos mockups): a soma
 * das participações precisa dar 100% para salvar — com menos, parte das despesas não teria dono
 * na divisão do relatório; com mais, alguém pagaria a parte de outro. Sem nenhum sócio não há o
 * que dividir, e a lista vazia é aceita: é o estado de todo perfil empresarial recém-criado, e
 * remover todos os sócios precisa ter volta.
 *
 * @param partners Lista completa de sócios vivos do perfil, já com as mudanças.
 * @return void
 * @throws {BusinessRuleViolation} `partner-shares-not-100` quando há sócios e a soma difere de
 * 100%; o detalhe `total` traz a soma em pontos percentuais, para a tela dizer quanto falta.
 */
export function assertSharesComplete(partners: readonly Partner[]): void {
    if (partners.length === 0) {
        return;
    }
    const total = partners.reduce((sum, partner) => sum + partner.hundredths(), 0);
    if (total !== FULL_SHARE_HUNDREDTHS) {
        throw new BusinessRuleViolation('partner-shares-not-100', `as participações somam ${String(total / 100)}%`, { field: 'percentage', total: total / 100 });
    }
}

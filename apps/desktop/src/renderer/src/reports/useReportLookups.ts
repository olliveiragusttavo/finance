import { useAccounts, useCategoryTree, useCreditCards, useGoalOptions, usePartners, useTags, type ReportLookups } from '@finance/client';
import { useActiveProfile } from '@/shell/activeProfile';
import { useReferenceMonth } from '@/shell/useReferenceMonth';

/**
 * Os cadastros que o filtro de um relatório cita por id, para dar nome a eles no cabeçalho e
 * oferecê-los no editor. Os sócios só são pedidos no perfil empresarial, porque o núcleo recusa a
 * rota no pessoal (database-design §4.2).
 *
 * @return Os cadastros do perfil ativo, ou `null` enquanto algum ainda carrega.
 */
export function useReportLookups(): ReportLookups | null {
    const { profile } = useActiveProfile();
    const { period } = useReferenceMonth();
    const categories = useCategoryTree({ profileId: profile.id });
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const tags = useTags({ profileId: profile.id });
    const partners = usePartners(profile.type === 'business' ? { profileId: profile.id } : null);
    const goals = useGoalOptions({ profileId: profile.id });
    if (categories.data === undefined || accounts.data === undefined || creditCards.data === undefined || tags.data === undefined || goals.data === undefined) {
        return null;
    }
    if (profile.type === 'business' && partners.data === undefined) {
        return null;
    }
    return {
        categories: categories.data,
        accounts: accounts.data.accounts,
        creditCards: creditCards.data.creditCards,
        tags: tags.data,
        partners: partners.data ?? [],
        goals: goals.data,
    };
}

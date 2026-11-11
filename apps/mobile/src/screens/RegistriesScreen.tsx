import { formatCategoryCount, useAccounts, useCategoryTree, useCreditCards, useNotes, useTags } from '@finance/client';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { useActiveProfile } from '../shell/ActiveProfile.tsx';
import { ROUTES, type AppRoute } from '../shell/routes.ts';
import { Screen } from '../shell/Screen.tsx';
import { ScreenHeader } from '../shell/ScreenHeader.tsx';
import { useReferenceMonth } from '../shell/useReferenceMonth.ts';
import { AppText } from '../ui/AppText.tsx';
import { MenuGroup, MenuRow } from '../ui/menu.tsx';

/**
 * @param count Quantidade, ou `undefined` enquanto a consulta carrega.
 * @return A contagem à direita da linha, só quando já se sabe; uma linha sem número enquanto
 * carrega é melhor que um "0" que logo muda.
 */
function counted(count: number | undefined): { readonly trailing?: string } {
    return count === undefined ? {} : { trailing: String(count) };
}

/**
 * Cadastros (mockup `MobileCadastros`; mobile-mvp-plan, Fase 15): o índice dos cadastros com a
 * contagem de cada um. Contas e Cartões levam às próprias abas, onde o cadastro deles já mora
 * (Fases 12 e 13), como o desktop desde a Fase 13.11; Categorias, Tags, Perfis e Anotações
 * empilham na aba Mais. Fora do mês de referência (decisão de interface 2): nenhum número daqui
 * depende do mês — as contagens de contas e cartões usam a consulta do mês só porque é a que já
 * está em cache.
 * Regra de negócio (Perfis): sócios só existem no perfil empresarial, e a frase do mockup diz
 * isso no perfil pessoal.
 *
 * @return A tela.
 */
export function RegistriesScreen(): ReactNode {
    const { profile, profiles } = useActiveProfile();
    const { period } = useReferenceMonth();
    const router = useRouter();
    const accounts = useAccounts({ profileId: profile.id, period });
    const creditCards = useCreditCards({ profileId: profile.id, period });
    const categories = useCategoryTree({ profileId: profile.id });
    const tags = useTags({ profileId: profile.id });
    const notes = useNotes({ profileId: profile.id });

    /**
     * @param route Tela a abrir.
     * @return A ação do toque.
     */
    const open = (route: AppRoute) => (): void => {
        router.push(route);
    };

    return (
        <Screen header={<ScreenHeader title="Cadastros" back />}>
            <MenuGroup>
                <MenuRow first label="Contas" {...counted(accounts.data?.accounts.length)} onPress={open(ROUTES.accounts)} />
                <MenuRow label="Cartões" {...counted(creditCards.data?.creditCards.length)} onPress={open(ROUTES.cards)} />
                <MenuRow label="Categorias" {...(categories.data === undefined ? {} : { trailing: formatCategoryCount(categories.data) })} onPress={open(ROUTES.categories)} />
                <MenuRow label="Tags" {...counted(tags.data?.length)} onPress={open(ROUTES.tags)} />
            </MenuGroup>
            <MenuGroup>
                <MenuRow first label="Perfis" trailing={String(profiles.length)} onPress={open(ROUTES.profiles)} />
                <MenuRow label="Anotações" {...counted(notes.data?.length)} onPress={open(ROUTES.notes)} />
            </MenuGroup>
            {profile.type === 'personal' && <AppText className="text-12 text-muted">Sócios aparecem aqui só no perfil empresarial.</AppText>}
        </Screen>
    );
}

import type { ProfileResponse } from '@finance/core';

/*
 * Mapa da navegação do shell (desktop-mvp-plan Fase 4), separado dos componentes: o menu, a
 * barra do mês e o roteador leem a mesma lista, e as regras de "o que aparece onde" podem ser
 * testadas sem montar a janela.
 */

/** Caminho de cada tela do shell; o roteador registra exatamente estes. */
export type AppPath =
    | '/'
    | '/transactions'
    | '/accounts'
    | '/cards'
    | '/reports/category'
    | '/reports/account-flow'
    | '/reports/card-impact'
    | '/reports/partner'
    | '/reports/tag'
    | '/goals'
    | '/registry'
    | '/devices'
    | '/settings';

/** Subitem de "Relatórios". */
export interface ReportMenuItem {
    readonly label: string;
    readonly to: AppPath;
    /** Só aparece em perfil empresarial (decisão de interface 5 dos mockups). */
    readonly businessOnly: boolean;
}

/** Item de primeiro nível da barra lateral. */
export interface MenuItem {
    readonly label: string;
    readonly to: AppPath;
    /**
     * Prefixo dos caminhos que pertencem ao item. Difere de `to` em "Relatórios", cujo destino
     * é o primeiro relatório mas que fica marcado em qualquer um deles.
     */
    readonly section: string;
    readonly children: readonly ReportMenuItem[];
}

/** Prefixo dos caminhos de relatório. */
const REPORTS_SECTION = '/reports';

/**
 * Relatórios na ordem dos mockups (`DesktopRelSocio` mostra a lista completa). Fluxo por conta,
 * Por sócio e Por tag ficam no menu sem tela no MVP (desktop-mvp-plan §5).
 */
const REPORT_ITEMS: readonly ReportMenuItem[] = [
    { label: 'Por categoria', to: '/reports/category', businessOnly: false },
    { label: 'Fluxo por conta', to: '/reports/account-flow', businessOnly: false },
    { label: 'Impacto do cartão', to: '/reports/card-impact', businessOnly: false },
    { label: 'Por sócio', to: '/reports/partner', businessOnly: true },
    { label: 'Por tag', to: '/reports/tag', businessOnly: false },
];

/** Menu completo do mockup (brief D1), na ordem da barra lateral. */
export const MENU: readonly MenuItem[] = [
    { label: 'Visão geral', to: '/', section: '/', children: [] },
    { label: 'Transações', to: '/transactions', section: '/transactions', children: [] },
    { label: 'Contas', to: '/accounts', section: '/accounts', children: [] },
    { label: 'Cartões', to: '/cards', section: '/cards', children: [] },
    { label: 'Relatórios', to: '/reports/category', section: REPORTS_SECTION, children: REPORT_ITEMS },
    { label: 'Metas', to: '/goals', section: '/goals', children: [] },
    { label: 'Cadastros', to: '/registry', section: '/registry', children: [] },
    { label: 'Dispositivos', to: '/devices', section: '/devices', children: [] },
    { label: 'Ajustes', to: '/settings', section: '/settings', children: [] },
];

/**
 * Telas de configuração, que não dependem de período. Regra de interface (mockups, decisão 2):
 * o mês de referência não aparece em fluxos de configuração. Os mockups dessas telas ainda
 * desenham a barra do mês; a regra do README prevaleceu, por decisão registrada na Fase 4 do
 * plano. Metas continua com a barra, como no mockup.
 */
const PATHS_WITHOUT_REFERENCE_MONTH: ReadonlySet<string> = new Set<AppPath>(['/registry', '/devices', '/settings']);

/**
 * @param pathname Caminho atual do roteador.
 * @return Se a barra superior mostra o mês de referência e se os atalhos `[` `]` valem.
 */
export function showsReferenceMonth(pathname: string): boolean {
    return !PATHS_WITHOUT_REFERENCE_MONTH.has(pathname);
}

/**
 * @param item Item do menu.
 * @param pathname Caminho atual do roteador.
 * @return Se o item fica marcado. "Visão geral" só na raiz, e não em todo caminho que começa
 * com `/`; os demais em todo caminho da seção, para que um detalhe futuro (`/accounts/<id>`)
 * mantenha o item marcado.
 */
export function isItemActive(item: Pick<MenuItem, 'section'>, pathname: string): boolean {
    if (item.section === '/') {
        return pathname === '/';
    }
    return pathname === item.section || pathname.startsWith(`${item.section}/`);
}

/**
 * Subitens visíveis de um item. Os relatórios só se abrem quando a seção está ativa, como nos
 * mockups: abertos sempre, empurrariam Metas, Cadastros e Ajustes para baixo em toda tela.
 * Regra de negócio (Perfis): "Por sócio" só existe em perfil empresarial (brief §12).
 *
 * @param item Item do menu.
 * @param pathname Caminho atual, que decide se a seção está aberta.
 * @param profileType Tipo do perfil ativo, que decide se "Por sócio" aparece.
 * @return Os subitens a desenhar; vazio quando a seção está fechada ou não tem subitens.
 */
export function visibleChildren(item: MenuItem, pathname: string, profileType: ProfileResponse['type']): readonly ReportMenuItem[] {
    if (!isItemActive(item, pathname)) {
        return [];
    }
    return item.children.filter((child) => !child.businessOnly || profileType === 'business');
}

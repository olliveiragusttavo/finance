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
    | '/categories'
    | '/partners'
    | '/tags'
    | '/notes'
    | '/profiles'
    | '/devices'
    | '/settings'
    | '/settings/import';

/** Item da lista de relatórios, à esquerda da página de Relatórios. */
export interface ReportItem {
    readonly label: string;
    readonly to: AppPath;
    /** Só aparece em perfil empresarial (decisão de interface 5 dos mockups). */
    readonly businessOnly: boolean;
}

/** Item da barra lateral. */
export interface MenuItem {
    readonly label: string;
    readonly to: AppPath;
    /**
     * Prefixo dos caminhos que pertencem ao item. Difere de `to` em "Relatórios", cujo destino
     * é o primeiro relatório mas que fica marcado em qualquer um deles.
     */
    readonly section: string;
    /** Só aparece em perfil empresarial (Sócios), como "Por sócio" entre os relatórios. */
    readonly businessOnly: boolean;
}

/** Prefixo dos caminhos de relatório. */
const REPORTS_SECTION = '/reports';

/**
 * Relatórios na ordem dos mockups (`DesktopRelSocio` mostra a lista completa). Ficam na lista à
 * esquerda da página de Relatórios, como as contas em Contas, e não como subitens do menu: a
 * pedido do usuário, porque a lista vai crescer com os relatórios personalizados e, no menu,
 * empurraria Metas, os cadastros e Ajustes para baixo. Por sócio só aparece no perfil empresarial.
 */
const REPORTS: readonly ReportItem[] = [
    { label: 'Por categoria', to: '/reports/category', businessOnly: false },
    { label: 'Fluxo por conta', to: '/reports/account-flow', businessOnly: false },
    { label: 'Impacto do cartão', to: '/reports/card-impact', businessOnly: false },
    { label: 'Por sócio', to: '/reports/partner', businessOnly: true },
    { label: 'Por tag', to: '/reports/tag', businessOnly: false },
];

/**
 * Menu completo, na ordem da barra lateral. Os cadastros que o mockup (brief D1) reunia em
 * "Cadastros" têm cada um o seu item, a pedido do usuário (desktop-mvp-plan Fase 13.11): contas e
 * cartões já se cadastram nas próprias telas, e os demais ficam a um clique, sem a lista de tipos
 * no meio.
 */
export const MENU: readonly MenuItem[] = [
    { label: 'Visão geral', to: '/', section: '/', businessOnly: false },
    { label: 'Transações', to: '/transactions', section: '/transactions', businessOnly: false },
    { label: 'Contas', to: '/accounts', section: '/accounts', businessOnly: false },
    { label: 'Cartões', to: '/cards', section: '/cards', businessOnly: false },
    { label: 'Relatórios', to: '/reports/category', section: REPORTS_SECTION, businessOnly: false },
    { label: 'Metas', to: '/goals', section: '/goals', businessOnly: false },
    { label: 'Categorias', to: '/categories', section: '/categories', businessOnly: false },
    { label: 'Sócios', to: '/partners', section: '/partners', businessOnly: true },
    { label: 'Tags', to: '/tags', section: '/tags', businessOnly: false },
    { label: 'Anotações', to: '/notes', section: '/notes', businessOnly: false },
    { label: 'Perfis', to: '/profiles', section: '/profiles', businessOnly: false },
    { label: 'Dispositivos', to: '/devices', section: '/devices', businessOnly: false },
    { label: 'Ajustes', to: '/settings', section: '/settings', businessOnly: false },
];

/**
 * Regra de negócio (Perfis): sócio só existe em perfil empresarial (database-design §4.2), então
 * o item Sócios some do menu no perfil pessoal, como "Por sócio" some dos relatórios.
 *
 * @param profileType Tipo do perfil ativo.
 * @return Os itens que a barra lateral mostra para o perfil, na ordem do menu.
 */
export function menuFor(profileType: ProfileResponse['type']): readonly MenuItem[] {
    return MENU.filter((item) => !item.businessOnly || profileType === 'business');
}

/**
 * Telas de configuração, que não dependem de período. Regra de interface (mockups, decisão 2):
 * o mês de referência não aparece em fluxos de configuração. Os mockups dessas telas ainda
 * desenham a barra do mês; a regra do README prevaleceu, por decisão registrada na Fase 4 do
 * plano. Metas continua com a barra, como no mockup. Os cadastros (Categorias, Sócios, Tags,
 * Anotações e Perfis) seguem sem a barra, como na antiga tela Cadastros: nenhum número deles
 * depende do mês.
 */
const PATHS_WITHOUT_REFERENCE_MONTH: ReadonlySet<string> = new Set<AppPath>(['/categories', '/partners', '/tags', '/notes', '/profiles', '/devices', '/settings', '/settings/import']);

/** Um passo do caminho "Ajustes › Importar dados"; o último não tem link. */
export interface TrailStep {
    readonly label: string;
    readonly to: AppPath | null;
}

/**
 * Caminho mostrado na barra superior das telas que ficam dentro de outra (mockup
 * `DesktopImportArquivo`: "Ajustes › Importar dados"), no lugar do mês de referência.
 */
const TRAILS: ReadonlyMap<string, readonly TrailStep[]> = new Map<AppPath, readonly TrailStep[]>([
    ['/settings/import', [{ label: 'Ajustes', to: '/settings' }, { label: 'Importar dados', to: null }]],
]);

/**
 * @param pathname Caminho atual do roteador.
 * @return O caminho da tela, ou vazio nas telas de primeiro nível.
 */
export function trailFor(pathname: string): readonly TrailStep[] {
    return TRAILS.get(pathname) ?? [];
}

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
 * Relatórios da lista à esquerda da página de Relatórios para o perfil ativo, para que a lista
 * não ofereça um relatório que o núcleo recusa no perfil pessoal.
 * Regra de negócio (Perfis): "Por sócio" só existe em perfil empresarial (brief §12).
 *
 * @param profileType Tipo do perfil ativo, que decide se "Por sócio" aparece.
 * @return Os relatórios a listar, na ordem dos mockups.
 */
export function visibleReports(profileType: ProfileResponse['type']): readonly ReportItem[] {
    return REPORTS.filter((report) => !report.businessOnly || profileType === 'business');
}

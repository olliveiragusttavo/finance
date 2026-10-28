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
    | '/statement'
    | '/calendar'
    | '/accounts'
    | '/cards'
    | '/reports'
    | '/reports/edit'
    | '/goals'
    | '/categories'
    | '/partners'
    | '/tags'
    | '/notes'
    | '/profiles'
    | '/devices'
    | '/settings'
    | '/settings/import';

/** Item da barra lateral. */
export interface MenuItem {
    readonly label: string;
    readonly to: AppPath;
    /**
     * Prefixo dos caminhos que pertencem ao item: "Relatórios" fica marcado também no editor
     * (`/reports/edit`).
     */
    readonly section: string;
    /** Só aparece em perfil empresarial (Sócios). */
    readonly businessOnly: boolean;
}

/**
 * Menu completo, na ordem da barra lateral. Os cadastros que o mockup (brief D1) reunia em
 * "Cadastros" têm cada um o seu item, a pedido do usuário (desktop-mvp-plan Fase 13.11): contas e
 * cartões já se cadastram nas próprias telas, e os demais ficam a um clique, sem a lista de tipos
 * no meio.
 */
export const MENU: readonly MenuItem[] = [
    { label: 'Visão geral', to: '/', section: '/', businessOnly: false },
    { label: 'Transações', to: '/transactions', section: '/transactions', businessOnly: false },
    // Entre Transações e Calendário, como no mockup `DesktopExtrato`: os mesmos lançamentos em vários meses.
    { label: 'Extrato', to: '/statement', section: '/statement', businessOnly: false },
    // Logo abaixo de Transações, como no mockup `DesktopCalendario`: são os mesmos lançamentos por dia.
    { label: 'Calendário', to: '/calendar', section: '/calendar', businessOnly: false },
    { label: 'Contas', to: '/accounts', section: '/accounts', businessOnly: false },
    { label: 'Cartões', to: '/cards', section: '/cards', businessOnly: false },
    { label: 'Relatórios', to: '/reports', section: '/reports', businessOnly: false },
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
 * o item Sócios some do menu no perfil pessoal.
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

/**
 * Telas que mostram um período de vários meses no lugar do mês de referência. Regra de interface
 * (mockup `DesktopExtrato`): no Extrato o mês de referência vira o período, escolhido nos filtros
 * da própria tela, e a barra superior só o mostra — um ‹ › de um mês só não diria nada ali.
 */
const PATHS_WITH_PERIOD_RANGE: ReadonlySet<string> = new Set<AppPath>(['/statement']);

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
 * @return Se a barra superior mostra o mês de referência e se os atalhos `[` `]` valem; nas telas
 * com período de vários meses, não.
 */
export function showsReferenceMonth(pathname: string): boolean {
    return !PATHS_WITHOUT_REFERENCE_MONTH.has(pathname) && !PATHS_WITH_PERIOD_RANGE.has(pathname);
}

/**
 * @param pathname Caminho atual do roteador.
 * @return Se a barra superior mostra o período de vários meses da tela no lugar do mês.
 */
export function showsPeriodRange(pathname: string): boolean {
    return PATHS_WITH_PERIOD_RANGE.has(pathname);
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

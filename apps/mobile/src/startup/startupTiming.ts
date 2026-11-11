/**
 * Instante em que o JavaScript do app começou, pelo relógio monotônico do runtime. Lido na
 * carga do módulo, que a raiz (`app/_layout.tsx`) importa primeiro.
 */
const jsStartedAt = performance.now();

/** Instante em que a sequência de abertura terminou; `null` enquanto o núcleo não abriu. */
let coreOpenedAt: number | null = null;

/** A primeira tela já foi registrada: só a primeira conta como abertura. */
let firstScreenReported = false;

/**
 * Marca o fim da sequência de abertura (banco, migrations, integridade, recorrências), para o
 * registro da primeira tela separar o custo do núcleo do custo do React.
 */
export function markCoreOpened(): void {
    coreOpenedAt = performance.now();
}

/**
 * Registra no log do aparelho o instante em que a primeira tela interativa apareceu
 * (mobile-mvp-plan, Fase 5: "tempo da abertura até a primeira tela interativa"). Vai o instante
 * de parede (`Date.now`), que o script de medição compara com o instante do `am start` pelo
 * relógio do próprio aparelho — o JavaScript não sabe quando o processo nasceu —, e as parcelas
 * dentro do JavaScript, para mostrar onde o tempo foi. É uma linha por abertura, sempre
 * ligada: o custo é nenhum, e o número serve também fora da medição.
 */
export function reportFirstScreen(): void {
    if (firstScreenReported) {
        return;
    }
    firstScreenReported = true;
    const now = performance.now();
    const core = coreOpenedAt === null ? '?' : (coreOpenedAt - jsStartedAt).toFixed(0);
    console.log(`[abertura] primeira-tela epoch=${Date.now()} js→núcleo=${core} ms js→tela=${(now - jsStartedAt).toFixed(0)} ms`);
}

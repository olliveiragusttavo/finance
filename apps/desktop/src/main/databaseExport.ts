/**
 * Nome sugerido no diálogo de salvar da cópia exportada (desktop-mvp-plan Fase 13). Leva a data
 * para que cópias de dias diferentes não se sobrescrevam na mesma pasta e para que o usuário
 * reconheça a mais recente pela lista de arquivos. A data é a local, e não a UTC dos nomes de
 * backup: é a que o usuário lê no relógio quando exporta à noite.
 *
 * @param now Instante da exportação.
 * @return `financas-AAAA-MM-DD.sqlite`.
 */
export function defaultExportFileName(now: Date): string {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `financas-${String(now.getFullYear())}-${month}-${day}.sqlite`;
}

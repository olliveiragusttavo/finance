import { LocalDate, YearMonth, type ProfileResponse } from '@finance/core';

/*
 * Regras do shell que o desktop e o celular aplicam igual (mobile-mvp-plan §5.1, "Nenhuma regra
 * nova no mobile"): o mês corrente pelo relógio de parede, o mês vizinho na faixa do mês de
 * referência e o perfil que o app reabre. Onde cada app guarda o mês (URL no desktop,
 * preferências no celular) é do shell; o cálculo é este.
 */

/**
 * @param now Instante atual, no fuso do aparelho.
 * @return O mês corrente `YYYY-MM`. Usa o calendário local, e não UTC, porque "o mês atual"
 * é o do relógio de parede do usuário: em UTC, a noite do último dia já seria o mês seguinte
 * no Brasil.
 */
export function currentPeriod(now: Date): string {
    return YearMonth.of(now.getFullYear(), now.getMonth() + 1).toString();
}

/**
 * @param now Instante atual, no fuso do aparelho.
 * @return A data de hoje `YYYY-MM-DD`, pelo calendário local e pelo mesmo motivo do
 * `currentPeriod`: a data sugerida para um pagamento é a do relógio de parede do usuário.
 */
export function currentDate(now: Date): string {
    return LocalDate.of(now.getFullYear(), now.getMonth() + 1, now.getDate()).toString();
}

/**
 * @param period Mês `YYYY-MM`.
 * @param direction `-1` para o anterior, `1` para o seguinte.
 * @return O mês vizinho, com a virada de ano resolvida pelo `YearMonth`.
 * @throws {InvalidValueError} Ao sair da faixa de anos do núcleo (antes de 1900 ou depois de 9999).
 */
export function shiftPeriod(period: string, direction: -1 | 1): string {
    const month = YearMonth.parse(period);
    return (direction === 1 ? month.next() : month.previous()).toString();
}

/**
 * @param period Texto que deveria ser um mês `YYYY-MM`, vindo de fora do app (URL, arquivo de
 * preferências editado à mão ou de outra versão).
 * @return Se é um mês que o núcleo aceita; fora do formato ou da faixa de anos do `YearMonth`,
 * toda rota por período recusaria o mês com erro de validação.
 */
export function isValidPeriod(period: string): boolean {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        return false;
    }
    try {
        YearMonth.parse(period);
        return true;
    } catch {
        return false;
    }
}

/**
 * Escolhe o perfil aberto. Fica no aparelho (`lastProfileId`), e não no banco, porque dois
 * aparelhos sincronizados podem estar em perfis diferentes (desktop-mvp-plan §2).
 *
 * @param profiles Perfis do banco, na ordem do núcleo.
 * @param lastProfileId Último perfil aberto neste aparelho.
 * @return O último perfil aberto; o primeiro da lista quando ele não existe mais (excluído, ou
 * preferência de outro banco); `null` só quando não há perfil algum.
 */
export function pickActiveProfile(profiles: readonly ProfileResponse[], lastProfileId: string | null): ProfileResponse | null {
    return profiles.find((profile) => profile.id === lastProfileId) ?? profiles[0] ?? null;
}

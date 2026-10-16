import { allocateByShares, Currency, Money, PARTNER_NAME_MAX_LENGTH, type CoreInput, type MoneyResponse, type PartnerReportResponse, type PartnerResponse } from '@finance/core';
import { formatMoney } from '../format/money.ts';

/** 100% em centésimos de ponto percentual, a unidade em que a soma é conferida (como no núcleo). */
const FULL_SHARE = 100 * 100;

/** Quantas cores a divisão alterna (as quatro do mockup `DesktopSocios`). */
export const PARTNER_COLOR_COUNT = 4;

/** Um sócio como está no formulário do cadastro, ainda sem validar. */
export interface PartnerDraftRow {
    /** Chave estável da linha na tela; o id do sócio, ou uma chave local para o novo. */
    readonly key: string;
    /** Sócio gravado que a linha edita; `null` para o sócio novo. */
    readonly id: string | null;
    readonly name: string;
    /** Participação como o usuário digitou (`33,33`). */
    readonly percentage: string;
}

/** Uma linha da tabela de sócios pronta para a tela. */
export interface PartnerRosterRow {
    readonly key: string;
    /** Posição na paleta da divisão, de 0 a `PARTNER_COLOR_COUNT − 1`; não muda quando outro sócio sai. */
    readonly color: number;
    /** O nome, ou "Sem nome" enquanto o campo está vazio, para a barra e os rótulos. */
    readonly label: string;
    /** `60%`, `33,33%`; `0%` enquanto o campo é inválido. */
    readonly share: string;
    /** Quanto aportou em todos os períodos; `—` enquanto o relatório carrega. */
    readonly contributed: string;
    /** Parte do total de aportes pela participação digitada; `—` enquanto o relatório carrega. */
    readonly expected: string;
    readonly nameError: string | null;
    readonly percentageError: string | null;
}

/** Um pedaço da barra de divisão. */
export interface PartnerSegment {
    readonly key: string;
    readonly color: number;
    /** Largura em % da barra. */
    readonly width: number;
}

/** Situação da soma das participações. */
export type PartnerSumStatus =
    | { readonly kind: 'ok'; readonly text: string }
    | { readonly kind: 'off'; readonly text: string }
    | { readonly kind: 'empty'; readonly text: string };

/** O cadastro de sócios pronto para a tela. */
export interface PartnerRosterView {
    readonly rows: readonly PartnerRosterRow[];
    /** Cor que o próximo sócio adicionado vai receber, para a linha de adicionar. */
    readonly nextColor: number;
    readonly segments: readonly PartnerSegment[];
    /** `Soma: 100%`. */
    readonly sumLabel: string;
    /** Descrição da barra para leitor de tela: `Gustavo 60%, Ana 40%`. */
    readonly barLabel: string;
    readonly status: PartnerSumStatus;
    /** Aviso dos lançamentos que ficam sem sócio ao salvar; `null` quando ninguém com lançamento sai. */
    readonly removedWarning: string | null;
    /** O total de aportes dos sócios do formulário, a base da divisão; `—` enquanto o relatório carrega. */
    readonly base: string;
    /** Se o formulário difere do que está gravado. */
    readonly dirty: boolean;
    /** Se "Salvar" está liberado: há mudança, todo campo é válido e a soma fecha 100%. */
    readonly canSave: boolean;
}

/** Entrada do montador da tela. */
export interface PartnerRosterInput {
    readonly draft: readonly PartnerDraftRow[];
    /** Sócios gravados, como a rota `partners.list` os devolve. */
    readonly saved: readonly PartnerResponse[];
    /** Relatório por sócio, para "Aportou" e "Deveria ter aportado"; `undefined` enquanto carrega. */
    readonly report: PartnerReportResponse | undefined;
}

/**
 * @param saved Sócios gravados.
 * @return O formulário com os sócios como estão, na ordem do núcleo (maior participação primeiro).
 */
export function draftFromPartners(saved: readonly PartnerResponse[]): readonly PartnerDraftRow[] {
    return saved.map((partner) => ({ key: partner.id, id: partner.id, name: partner.name, percentage: formatPercentage(partner.percentage * 100) }));
}

/**
 * Lê a participação digitada em centésimos inteiros. Aceita vírgula ou ponto e até duas casas,
 * as mesmas que o núcleo grava, para que o que a soma mostra seja exatamente o que vai ser salvo.
 *
 * @param text Campo como o usuário digitou.
 * @return A participação em centésimos (60,5% → 6050), ou `null` quando o texto não é uma
 * participação de 0 a 100 com até duas casas decimais.
 */
export function parsePercentageInput(text: string): number | null {
    const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
    if (match === null) {
        return null;
    }
    const hundredths = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
    return hundredths <= FULL_SHARE ? hundredths : null;
}

/**
 * Monta o cadastro de sócios (mockup `DesktopSocios`) a partir do formulário.
 * Regra de negócio (Sócios, decisão de interface 10 dos mockups): a soma das participações
 * precisa dar 100% para salvar, e a tela mostra a soma ao vivo com a barra de divisão. Remover
 * um sócio com lançamentos deixa esses lançamentos sem sócio atribuído, e o aviso diz quantos
 * antes de salvar.
 * Regra de negócio (Sócios — aportes, reports-design §8): "Deveria ter aportado" divide o total de
 * aportes de todos os períodos pela participação digitada, pela mesma `allocateByShares` do
 * relatório, para que a prévia e o relatório gravado nunca discordem. O sócio removido no
 * formulário sai da base, como sairá ao salvar: os aportes dele ficam sem sócio.
 *
 * @param input Formulário, sócios gravados e o relatório por sócio.
 * @return A tela pronta.
 */
export function buildPartnerRosterView(input: PartnerRosterInput): PartnerRosterView {
    const { draft, saved, report } = input;
    const shares = draft.map((row) => parsePercentageInput(row.percentage) ?? 0);
    const total = shares.reduce((sum, share) => sum + share, 0);
    const expected = report === undefined ? null : previewExpected(draft, shares, total === FULL_SHARE, report);
    const colors = colorSlots(draft, saved);
    const rows = draft.map((row, index): PartnerRosterRow => {
        const share = shares[index] ?? 0;
        const contributed = report === undefined ? null : contributedOf(row, report);
        const expectedCents = expected?.cents[index];
        return {
            key: row.key,
            color: (colors.slots[index] ?? index) % PARTNER_COLOR_COUNT,
            label: labelOf(row),
            share: `${formatPercentage(share)}%`,
            contributed: contributed === null ? '—' : formatMoney(contributed),
            expected: expected === null || expectedCents === undefined ? '—' : formatMoney(fromMinor(expectedCents, expected.currency)),
            nameError: nameError(row.name),
            percentageError: parsePercentageInput(row.percentage) === null ? 'Use um número de 0 a 100, com até duas casas decimais.' : null,
        };
    });
    const valid = rows.every((row) => row.nameError === null && row.percentageError === null);
    const dirty = isDirty(draft, saved);
    return {
        rows,
        nextColor: colors.next % PARTNER_COLOR_COUNT,
        segments: rows.map((row, index) => ({ key: row.key, color: row.color, width: segmentWidth(shares[index] ?? 0, total) })),
        sumLabel: `Soma: ${formatPercentage(total)}%`,
        barLabel: rows.map((row) => `${row.label} ${row.share}`).join(', '),
        status: sumStatus(draft.length, total),
        removedWarning: removedWarning(draft, saved),
        base: expected === null ? '—' : formatMoney(fromMinor(expected.baseCents, expected.currency)),
        dirty,
        canSave: dirty && valid && (draft.length === 0 || total === FULL_SHARE),
    };
}

/**
 * @param draft Formulário já conferido (`canSave`).
 * @param profileId Perfil empresarial dono dos sócios.
 * @return A entrada da rota `partners.save`, com os nomes aparados e a participação de 0 a 100.
 */
export function toSavePartnersInput(draft: readonly PartnerDraftRow[], profileId: string): CoreInput<'partners.save'> {
    return {
        profileId,
        partners: draft.map((row) => ({ id: row.id, name: row.name.trim(), percentage: (parsePercentageInput(row.percentage) ?? 0) / 100 })),
    };
}

/**
 * Posição de cada linha na paleta. O sócio gravado fica com a posição dele na lista gravada e o
 * novo continua a sequência; pela posição no formulário, remover um sócio trocaria a cor de todos
 * os de baixo, e a barra pareceria mudar de dono.
 *
 * @param draft Formulário.
 * @param saved Sócios gravados, na ordem do núcleo.
 * @return A posição de cada linha, na ordem do formulário, e a do próximo sócio adicionado.
 */
function colorSlots(draft: readonly PartnerDraftRow[], saved: readonly PartnerResponse[]): { readonly slots: readonly number[]; readonly next: number } {
    const savedSlots = new Map(saved.map((partner, index) => [partner.id, index]));
    let next = saved.length;
    const slots = draft.map((row) => {
        const slot = row.id === null ? undefined : savedSlots.get(row.id);
        if (slot !== undefined) {
            return slot;
        }
        next += 1;
        return next - 1;
    });
    return { slots, next };
}

/**
 * Participação em texto pt-BR, sem zeros à direita: `60`, `33,33`, `12,5`.
 *
 * @param hundredths Participação em centésimos de ponto percentual.
 * @return O número sem o símbolo `%`, que o campo mostra à parte.
 */
function formatPercentage(hundredths: number): string {
    const rounded = Math.round(hundredths);
    const integer = Math.trunc(rounded / 100);
    const fraction = String(Math.abs(rounded % 100)).padStart(2, '0').replace(/0+$/, '');
    return fraction === '' ? String(integer) : `${String(integer)},${fraction}`;
}

/**
 * @param row Linha do formulário.
 * @return O nome aparado, ou "Sem nome" quando o campo está vazio.
 */
function labelOf(row: PartnerDraftRow): string {
    const name = row.name.trim();
    return name === '' ? 'Sem nome' : name;
}

/**
 * Confere o nome pelo limite do domínio (`PARTNER_NAME_MAX_LENGTH`), aparado como o núcleo o grava.
 *
 * @param name Nome como o usuário digitou.
 * @return A mensagem do campo, ou `null` quando o nome serve.
 */
function nameError(name: string): string | null {
    const trimmed = name.trim();
    if (trimmed === '') {
        return 'Informe o nome do sócio.';
    }
    return trimmed.length > PARTNER_NAME_MAX_LENGTH ? `O nome tem até ${String(PARTNER_NAME_MAX_LENGTH)} caracteres.` : null;
}

/**
 * @param row Linha do formulário.
 * @param report Relatório por sócio.
 * @return Quanto o sócio aportou; zero para o sócio novo, que ainda não aportou nada.
 */
function contributedOf(row: PartnerDraftRow, report: PartnerReportResponse): MoneyResponse {
    const line = row.id === null ? undefined : report.partners.find((partner) => partner.partnerId === row.id);
    return line?.contributed ?? { amount: 0, currency: report.contributions.currency };
}

/**
 * Divide a base do formulário pela participação digitada. A ordem da divisão é a do relatório —
 * maior participação primeiro, desempate pelo nome —, porque o centavo da sobra vai para quem
 * vem antes nos empates; dividir na ordem das linhas daria outro centavo que o relatório.
 *
 * @param draft Formulário.
 * @param shares Participação de cada linha em centésimos.
 * @param complete Se as participações somam 100%.
 * @param report Relatório por sócio.
 * @return A parte de cada linha em unidades menores, na ordem do formulário, a base e a moeda.
 */
function previewExpected(
    draft: readonly PartnerDraftRow[],
    shares: readonly number[],
    complete: boolean,
    report: PartnerReportResponse,
): { readonly cents: readonly number[]; readonly baseCents: number; readonly currency: Currency } {
    const currency = Currency.of(report.contributions.currency);
    const baseCents = draft.reduce((sum, row) => sum + toMinor(row.id === null ? 0 : contributedOf(row, report).amount, currency), 0);
    const order = draft.map((row, index) => ({ index, share: shares[index] ?? 0, name: row.name.trim().toLowerCase() })).sort((a, b) => b.share - a.share || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const parts = allocateByShares(baseCents, order.map((entry) => entry.share / FULL_SHARE), complete);
    const cents = new Array<number>(draft.length).fill(0);
    order.forEach((entry, position) => {
        cents[entry.index] = parts[position] ?? 0;
    });
    return { cents, baseCents, currency };
}

/**
 * @param amount Valor já arredondado pelo núcleo.
 * @param currency Moeda do perfil.
 * @return O valor em unidades menores inteiras.
 */
function toMinor(amount: number, currency: Currency): number {
    return Math.round(amount * 10 ** currency.minorUnits);
}

/**
 * @param cents Unidades menores.
 * @param currency Moeda do perfil.
 * @return O valor serializável para formatar.
 */
function fromMinor(cents: number, currency: Currency): MoneyResponse {
    return { amount: Money.of(cents / 10 ** currency.minorUnits, currency).rounded().amount, currency: currency.code };
}

/**
 * Largura de um sócio na barra. Com a soma acima de 100% as partes são reduzidas na proporção,
 * para que a barra continue mostrando a divisão inteira em vez de cortar o último sócio.
 *
 * @param share Participação em centésimos.
 * @param total Soma das participações em centésimos.
 * @return A largura em % da barra.
 */
function segmentWidth(share: number, total: number): number {
    return total > FULL_SHARE ? (share / total) * 100 : share / 100;
}

/**
 * @param count Quantos sócios o formulário tem.
 * @param total Soma das participações em centésimos.
 * @return A situação da soma, com a frase do quadro abaixo da tabela.
 */
function sumStatus(count: number, total: number): PartnerSumStatus {
    if (count === 0) {
        return { kind: 'empty', text: 'Sem sócios, as despesas do perfil ficam todas sem sócio atribuído no relatório.' };
    }
    if (total === FULL_SHARE) {
        return { kind: 'ok', text: 'A soma dá 100%. Pode salvar.' };
    }
    if (total < FULL_SHARE) {
        return { kind: 'off', text: `Faltam ${formatPercentage(FULL_SHARE - total)}% para fechar 100%.` };
    }
    return { kind: 'off', text: `A soma passou ${formatPercentage(total - FULL_SHARE)}% de 100%. Reduza a participação de alguém.` };
}

/**
 * @param draft Formulário.
 * @param saved Sócios gravados.
 * @return O aviso dos lançamentos que ficam sem sócio ao salvar, com a quantidade e os nomes;
 * `null` quando nenhum sócio removido tem lançamento.
 */
function removedWarning(draft: readonly PartnerDraftRow[], saved: readonly PartnerResponse[]): string | null {
    const kept = new Set(draft.map((row) => row.id));
    const removed = saved.filter((partner) => !kept.has(partner.id) && partner.transactionCount > 0);
    if (removed.length === 0) {
        return null;
    }
    const count = removed.reduce((sum, partner) => sum + partner.transactionCount, 0);
    const names = joinNames(removed.map((partner) => partner.name));
    return count === 1
        ? `Ao salvar, o lançamento vinculado a ${names} fica “sem sócio atribuído” e sai da divisão.`
        : `Ao salvar, os ${String(count)} lançamentos vinculados a ${names} ficam “sem sócio atribuído” e saem da divisão.`;
}

/**
 * @param names Nomes, na ordem.
 * @return `Ana`, `Ana e Bruno`, `Ana, Bruno e Carla`.
 */
function joinNames(names: readonly string[]): string {
    if (names.length <= 1) {
        return names.join('');
    }
    return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1] ?? ''}`;
}

/**
 * @param draft Formulário.
 * @param saved Sócios gravados.
 * @return `true` quando salvar mudaria algo: sócio novo, removido, ou nome e participação
 * diferentes do gravado. Espaços nas pontas não contam, porque o núcleo os apara.
 */
function isDirty(draft: readonly PartnerDraftRow[], saved: readonly PartnerResponse[]): boolean {
    if (draft.length !== saved.length) {
        return true;
    }
    const byId = new Map(saved.map((partner) => [partner.id, partner]));
    return draft.some((row) => {
        const current = row.id === null ? undefined : byId.get(row.id);
        return current === undefined || current.name !== row.name.trim() || parsePercentageInput(row.percentage) !== Math.round(current.percentage * 100);
    });
}

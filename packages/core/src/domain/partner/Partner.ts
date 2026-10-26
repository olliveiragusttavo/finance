import { InvalidValueError } from '../shared/errors.ts';
import type { PartnerId, ProfileId } from '../shared/ids.ts';
import { requireName } from '../shared/names.ts';

/**
 * Tamanho máximo do nome do sócio, o `CHECK (length(name) <= 100)` do schema (database-design
 * §4.2). Maior que o dos outros cadastros porque é o nome de uma pessoa, não um rótulo curto.
 */
export const PARTNER_NAME_MAX_LENGTH = 100;

/**
 * Casas decimais aceitas na participação. Duas bastam para dividir em três (33,33 + 33,33 +
 * 33,34) e permitem conferir a soma de 100% em centésimos inteiros, sem depender da precisão
 * do `REAL`.
 */
export const PARTNER_PERCENTAGE_DECIMALS = 2;

/** Dados de um sócio, já validados e tipados. */
export interface PartnerProps {
    readonly id: PartnerId;
    readonly profileId: ProfileId;
    readonly name: string;
    /** Participação societária, de 0 a 100 (database-design §4.2). */
    readonly percentage: number;
}

/** O que o cadastro de sócios deixa mudar num sócio: o perfil e o id ficam. */
export interface PartnerChanges {
    readonly name: string;
    readonly percentage: number;
}

/**
 * Pessoa com participação num perfil empresarial (database-design §4.2). Guarda só os invariantes
 * da própria linha — nome e faixa da participação —; as regras que relacionam os sócios entre si
 * (a soma de 100%, o perfil empresarial) ficam no `PartnerService`, que enxerga a lista inteira
 * (database-design §3.10).
 */
export class Partner implements PartnerProps {
    public readonly id: PartnerId;
    public readonly profileId: ProfileId;
    public readonly name: string;
    public readonly percentage: number;

    /**
     * @param props Dados do sócio; privado e congelado como as demais entidades.
     */
    private constructor(props: PartnerProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        this.percentage = props.percentage;
        Object.freeze(this);
    }

    /**
     * Cadastra um sócio novo. Nomes repetidos são permitidos: duas pessoas podem ter o mesmo
     * nome (database-design §4.2).
     *
     * @param props Dados do sócio, com id já gerado pela aplicação.
     * @return O sócio, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 100 caracteres, ou a
     * participação sai de 0 a 100 ou tem mais de duas casas decimais.
     */
    public static create(props: PartnerProps): Partner {
        return new Partner({ ...props, name: requireName(props.name, 'name', PARTNER_NAME_MAX_LENGTH), percentage: requirePercentage(props.percentage) });
    }

    /**
     * @param props Dados lidos do banco pelo Repository; o `CHECK` da coluna já garante a faixa
     * da participação.
     * @return O sócio.
     */
    public static restore(props: PartnerProps): Partner {
        return new Partner(props);
    }

    /**
     * Troca nome e participação de uma vez, porque o cadastro grava a lista inteira e a soma só
     * faz sentido com todas as participações novas juntas.
     *
     * @param changes Nome e participação, como o usuário digitou.
     * @return Um novo sócio com os dados trocados; os lançamentos pagos por ele continuam ligados,
     * porque o vínculo é pelo id.
     * @throws {InvalidValueError} Nas mesmas condições de `create`.
     */
    public revise(changes: PartnerChanges): Partner {
        return Partner.create({ id: this.id, profileId: this.profileId, name: changes.name, percentage: changes.percentage });
    }

    /**
     * A participação como proporção, a forma em que as contas de divisão a usam (0,6 para 60%).
     *
     * @return A participação de 0 a 1.
     */
    public share(): number {
        return this.percentage / 100;
    }

    /**
     * A participação em centésimos inteiros (60,5% → 6050), para somar sem erro de ponto
     * flutuante: 33,33 + 33,33 + 33,34 não dá 100 exato em `number`.
     *
     * @return A participação em centésimos de ponto percentual.
     */
    public hundredths(): number {
        return Math.round(this.percentage * 10 ** PARTNER_PERCENTAGE_DECIMALS);
    }
}

/**
 * Confere a participação de um sócio novo ou editado. O banco só garante a faixa; as duas casas
 * decimais são da aplicação, para que a soma de 100% seja conferida em centésimos exatos.
 *
 * @param percentage Participação informada.
 * @return A própria participação, já conferida.
 * @throws {InvalidValueError} Quando sai de 0 a 100 ou tem mais de duas casas decimais.
 */
function requirePercentage(percentage: number): number {
    const scaled = percentage * 10 ** PARTNER_PERCENTAGE_DECIMALS;
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100 || Math.abs(scaled - Math.round(scaled)) > 1e-6) {
        throw new InvalidValueError('percentage', 'a participação vai de 0 a 100, com até duas casas decimais');
    }
    return percentage;
}

/**
 * Ordem dos sócios no cadastro e no relatório: maior participação primeiro (o sócio majoritário
 * no topo, como nos mockups `DesktopSocios` e `DesktopRelSocio`), desempate pelo nome. Fica no
 * domínio para que as duas telas listem os sócios na mesma ordem.
 *
 * @param a Primeiro sócio.
 * @param b Segundo sócio.
 * @return Negativo quando `a` vem antes.
 */
export function byLargestShare(a: Partner, b: Partner): number {
    const share = b.percentage - a.percentage;
    if (share !== 0) {
        return share;
    }
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return nameA < nameB ? -1 : nameA > nameB ? 1 : 0;
}

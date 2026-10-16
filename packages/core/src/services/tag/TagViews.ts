import type { LocalDate } from '../../domain/shared/LocalDate.ts';
import type { Money } from '../../domain/shared/Money.ts';
import type { Tag } from '../../domain/tag/Tag.ts';

/**
 * Uma tag com o uso dela em todo o período — o que a lista de Tags mostra (mockup
 * `DesktopTags`) e o que o painel de edição precisa para avisar quantos lançamentos perdem
 * a tag ao excluí-la.
 */
export interface TagWithUsage {
    readonly tag: Tag;
    readonly transactionCount: number;
    /** Soma dos valores em módulo dos lançamentos marcados, na moeda do perfil. */
    readonly total: Money;
    /** Maior data de vencimento entre os lançamentos marcados; `null` sem lançamento. */
    readonly lastUsedOn: LocalDate | null;
}

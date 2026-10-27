import type { ProfileId, ReportDefinitionId } from '../shared/ids.ts';
import { requireName } from '../shared/names.ts';
import type { ReportFilter } from './ReportFilter.ts';
import type { ReportLayout } from './ReportLayout.ts';

/**
 * Tamanho máximo do nome de um relatório, o mesmo `CHECK` da migration `0007`. É maior que o dos
 * cadastros (45) porque o nome é a pergunta que o relatório responde ("Gastos com o carro nos
 * últimos 12 meses"), e não um rótulo curto de seletor.
 */
export const REPORT_NAME_MAX_LENGTH = 100;

/** Dados de uma definição de relatório, já validados e tipados. */
export interface ReportDefinitionProps {
    readonly id: ReportDefinitionId;
    readonly profileId: ProfileId;
    readonly name: string;
    readonly filter: ReportFilter;
    readonly layout: ReportLayout;
}

/**
 * Relatório personalizado salvo do perfil (reports-design §1): nome, filtro e formato. Não guarda
 * resultado — abrir o relatório roda o filtro contra as transações do momento —, então editar uma
 * transação nunca deixa um relatório desatualizado.
 */
export class ReportDefinition implements ReportDefinitionProps {
    public readonly id: ReportDefinitionId;
    public readonly profileId: ProfileId;
    public readonly name: string;
    public readonly filter: ReportFilter;
    public readonly layout: ReportLayout;

    /**
     * @param props Dados da definição; privado e congelado como as demais entidades.
     */
    private constructor(props: ReportDefinitionProps) {
        this.id = props.id;
        this.profileId = props.profileId;
        this.name = props.name;
        this.filter = props.filter;
        this.layout = props.layout;
        Object.freeze(this);
    }

    /**
     * A unicidade do nome no perfil e a posse das referências do filtro relacionam linhas, e por
     * isso ficam no Service (database-design §3.10); aqui só o invariante da própria linha.
     *
     * @param props Dados da definição, com id já gerado pela aplicação.
     * @return A definição, com o nome aparado.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 100 caracteres.
     */
    public static create(props: ReportDefinitionProps): ReportDefinition {
        return new ReportDefinition({ ...props, name: requireName(props.name, 'name', REPORT_NAME_MAX_LENGTH) });
    }

    /**
     * @param props Dados lidos do banco pelo Repository.
     * @return A definição.
     */
    public static restore(props: ReportDefinitionProps): ReportDefinition {
        return new ReportDefinition(props);
    }

    /**
     * Regrava a definição inteira, e não campo a campo, porque o filtro e o formato sincronizam
     * como uma célula só (reports-design §4).
     *
     * @param name Novo nome, como o usuário digitou.
     * @param filter Novo filtro.
     * @param layout Novo formato.
     * @return Uma nova definição com o mesmo id e perfil.
     * @throws {InvalidValueError} Quando o nome está vazio ou passa de 100 caracteres.
     */
    public revise(name: string, filter: ReportFilter, layout: ReportLayout): ReportDefinition {
        return ReportDefinition.create({ id: this.id, profileId: this.profileId, name, filter, layout });
    }
}

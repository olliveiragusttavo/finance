import type { Database } from '../ports/Database.ts';

/**
 * Unidade de trabalho dos Services. Um caso de uso inteiro — gravar a transação, garantir
 * extrato e fatura, recalcular saldos — precisa acontecer na **mesma** transação de banco
 * (backend-design §3.5).
 *
 * É reentrante porque Services chamam Services: o lançamento chama o recálculo, que também
 * é um caso de uso por si só. Só a chamada mais externa abre a transação; as internas
 * participam dela. Fazer isso aqui, e não com transações aninhadas no driver, evita
 * depender de savepoints, que cada adaptador implementa (ou não) de um jeito.
 */
export class UnitOfWork {
    private depth = 0;

    /**
     * @param database Conexão compartilhada por todos os Repositories.
     */
    public constructor(private readonly database: Database) {}

    /**
     * @param work Trabalho a executar atomicamente.
     * @return O que `work` devolveu; qualquer exceção desfaz a unidade inteira.
     */
    public run<T>(work: () => T): T {
        if (this.depth > 0) {
            return work();
        }
        this.depth++;
        try {
            return this.database.transaction(work);
        } finally {
            this.depth--;
        }
    }

    /**
     * Como `run`, mas exige ser a unidade mais externa: `work` é confirmado ou desfeito
     * sozinho. Existe para quem trata a falha de uma parte e segue com as outras — o
     * complemento das recorrências, série a série. Dentro de outra unidade, `run` só
     * participaria dela, e as escritas da parte que falhou ficariam gravadas pela metade.
     *
     * @param work Trabalho a executar na sua própria transação.
     * @return O que `work` devolveu; uma exceção desfaz só esta transação.
     * @throws {Error} Quando chamado dentro de outra unidade de trabalho.
     */
    public runAlone<T>(work: () => T): T {
        if (this.depth > 0) {
            throw new Error('UnitOfWork.runAlone não pode rodar dentro de outra unidade de trabalho');
        }
        return this.run(work);
    }

    /**
     * Executa `work` numa transação que é **sempre desfeita**. Existe para conferir o que um
     * caso de uso gravaria sem gravar — a verificação de integridade roda a rotina de
     * recálculo de verdade e compara o resultado com o cache, mas um desvio é bug a expor,
     * não a corrigir em silêncio (database-design §3.7). Reaproveitar a rotina, em vez de
     * reimplementar o cálculo só para leitura, mantém um único oráculo.
     *
     * @param work Trabalho cujas escritas são descartadas; o que ele devolve é preservado.
     * @return O que `work` devolveu, depois do rollback.
     * @throws {Error} Quando chamado dentro de outra unidade de trabalho: o rollback desfaria
     * também as escritas legítimas da unidade externa.
     */
    public rehearse<T>(work: () => T): T {
        if (this.depth > 0) {
            throw new Error('UnitOfWork.rehearse não pode rodar dentro de outra unidade de trabalho');
        }
        const outcome: { result: { readonly value: T } | null } = { result: null };
        try {
            this.run(() => {
                outcome.result = { value: work() };
                throw new RehearsalRollback();
            });
        } catch (error) {
            if (!(error instanceof RehearsalRollback)) {
                throw error;
            }
        }
        if (outcome.result === null) {
            throw new Error('UnitOfWork.rehearse terminou sem resultado');
        }
        return outcome.result.value;
    }
}

/**
 * Sinal interno para o driver desfazer a transação: a porta `Database` só faz rollback por
 * exceção, e um tipo próprio separa esse rollback pedido de uma falha real do trabalho.
 */
class RehearsalRollback extends Error {
    /** Nome fixo, para o caso de o sinal escapar num log por bug. */
    public constructor() {
        super('Rollback intencional de UnitOfWork.rehearse');
        this.name = 'RehearsalRollback';
    }
}

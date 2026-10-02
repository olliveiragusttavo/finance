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
}

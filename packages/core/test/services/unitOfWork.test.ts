import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { describe, expect, it } from 'vitest';
import type { Database } from '../../src/index.ts';
import { UnitOfWork } from '../../src/services/UnitOfWork.ts';

/**
 * @return Uma unidade de trabalho sobre um banco em memória com uma tabela de contagem,
 * suficiente para observar o que foi confirmado e o que foi desfeito.
 */
function counterWorld(): { readonly database: Database; readonly unitOfWork: UnitOfWork; readonly count: () => unknown } {
    const database: Database = BetterSqliteDatabase.open(':memory:');
    database.exec('CREATE TABLE t (v INTEGER) STRICT');
    return { database, unitOfWork: new UnitOfWork(database), count: () => database.get('SELECT count(*) AS n FROM t') };
}

describe('UnitOfWork.rehearse', () => {
    it('devolve o resultado do trabalho e desfaz tudo o que ele gravou', () => {
        const { database, unitOfWork, count } = counterWorld();

        const seen = unitOfWork.rehearse(() => {
            database.run('INSERT INTO t (v) VALUES (1)');
            return database.get('SELECT count(*) AS n FROM t');
        });

        expect(seen).toEqual({ n: 1 });
        expect(count()).toEqual({ n: 0 });
    });

    it('propaga a falha real do trabalho, sem confundi-la com o rollback pedido', () => {
        const { unitOfWork } = counterWorld();
        expect(() => unitOfWork.rehearse(() => {
            throw new Error('falha real');
        })).toThrow('falha real');
    });

    it('recusa rodar dentro de outra unidade, cujas escritas legítimas seriam desfeitas', () => {
        const { database, unitOfWork, count } = counterWorld();

        expect(() => {
            unitOfWork.run(() => {
                database.run('INSERT INTO t (v) VALUES (1)');
                unitOfWork.rehearse(() => null);
            });
        }).toThrow('dentro de outra unidade');
        expect(count()).toEqual({ n: 0 });
    });
});

describe('UnitOfWork.runAlone', () => {
    it('confirma ou desfaz cada execução sozinha: a falha de uma não leva a outra junto', () => {
        const { database, unitOfWork, count } = counterWorld();

        unitOfWork.runAlone(() => database.run('INSERT INTO t (v) VALUES (1)'));
        expect(() => unitOfWork.runAlone(() => {
            database.run('INSERT INTO t (v) VALUES (2)');
            throw new Error('falha da segunda');
        })).toThrow('falha da segunda');

        expect(count()).toEqual({ n: 1 });
    });

    it('recusa rodar dentro de outra unidade, onde a falha não desfaria só a parte dela', () => {
        const { unitOfWork } = counterWorld();
        expect(() => {
            unitOfWork.run(() => unitOfWork.runAlone(() => null));
        }).toThrow('não pode rodar dentro de outra unidade de trabalho');
    });
});

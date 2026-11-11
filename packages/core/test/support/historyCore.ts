import { BetterSqliteDatabase } from '@finance/sqlite-better';
import { createCore, openDatabase, type Core } from '../../src/index.ts';
import { FixedClock, SequentialIds } from './adapters.ts';

/** Núcleo pronto para o gerador de histórico, com o relógio que ele move. */
export interface HistoryCore {
    readonly core: Core;
    readonly clock: FixedClock;
    readonly database: BetterSqliteDatabase;
}

/**
 * Abre o banco de destino, aplica as migrations pelo runner de produção e monta o núcleo com
 * relógio fixo e ids sequenciais. Separado do `TestWorld` porque o gerador precisa abrir um
 * arquivo em disco, e não só `:memory:`, e não semeia nada por SQL direto. Os ids sequenciais
 * tornam o arquivo gerado reproduzível, junto com a semente do sorteio.
 *
 * @param path Caminho do arquivo SQLite, ou `:memory:` no teste.
 * @param today "Hoje" inicial; o gerador o move ao começar.
 * @return O núcleo, o relógio e a conexão, que o chamador fecha ao terminar.
 */
export function openHistoryCore(path: string, today = '2016-01-01'): HistoryCore {
    const clock = new FixedClock(today);
    const database = BetterSqliteDatabase.open(path);
    openDatabase(database, { backups: null, clock });
    const core = createCore({
        database,
        clock,
        ids: new SequentialIds(),
        onUnexpectedError: (error) => {
            throw error;
        },
    });
    return { core, clock, database };
}

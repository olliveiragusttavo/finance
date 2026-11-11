import { randomUUID } from 'node:crypto';
import { parseUuid, type IdGenerator, type Uuid } from '@finance/core';

// O relógio é o mesmo do celular e mora no `client`; reexportado para os chamadores do desktop.
export { SystemClock } from '@finance/client/startup';

/** Gerador de UUID v4 sobre o `crypto` do Node, que o `utilityProcess` tem completo. */
export class CryptoIdGenerator implements IdGenerator {
    /** @return Um UUID v4 aleatório, validado pelo mesmo parser do núcleo. */
    public random(): Uuid {
        return parseUuid(randomUUID());
    }
}

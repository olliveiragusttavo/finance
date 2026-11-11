import { computeClientGoldenVectors } from '@finance/client/golden';
import clientVectors from '@finance/client/golden/vectors.json';
import { computeCoreGoldenVectors } from '@finance/core/golden';
import coreVectors from '@finance/core/golden/vectors.json';
import { ExpoSqliteDatabase, fileUriToPath } from '@finance/sqlite-expo';
import { Directory, Paths } from 'expo-file-system';
import { openDatabaseSync } from 'expo-sqlite';
import { runContract, type ContractReport } from './contractReport.ts';

/**
 * Roda o contrato no aparelho: o adaptador do app (`ExpoSqliteDatabase`) sobre o `expo-sqlite`
 * real, pela JSI, e os vetores gerados no Node recalculados no Hermes (mobile-shell-design §8,
 * itens 1 e 2). Os vetores entram pelo bundle, do mesmo arquivo versionado que o Vitest
 * confere no Node.
 *
 * Cada caso recebe um arquivo próprio numa pasta do cache, apagada antes e depois. Não usa
 * `:memory:`: no emulador, abrir `:memory:` de novo devolveu o mesmo banco, e os casos herdaram
 * as tabelas uns dos outros. Em arquivo, o caso também roda como o app de verdade, em WAL, que
 * um banco em memória ignora.
 *
 * @return O resultado único da execução.
 */
export function runDeviceContract(): ContractReport {
    const folder = new Directory(Paths.cache, 'contract');
    if (folder.exists) {
        folder.delete();
    }
    folder.create({ intermediates: true });
    let next = 0;
    try {
        return runContract({
            openDatabase: () => ExpoSqliteDatabase.wrap(openDatabaseSync(`case-${++next}.sqlite`, {}, fileUriToPath(folder.uri))),
            goldenSuites: [
                { name: 'core', expected: coreVectors, compute: computeCoreGoldenVectors },
                { name: 'client', expected: clientVectors, compute: computeClientGoldenVectors },
            ],
        });
    } finally {
        folder.delete();
    }
}

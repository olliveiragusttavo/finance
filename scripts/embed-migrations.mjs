import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'db', 'migrations');
const targetFile = join(root, 'packages', 'core', 'src', 'infrastructure', 'migrations', 'embedded.generated.ts');
const lockFile = join(sourceDir, 'checksums.lock');

/**
 * Trava de imutabilidade das migrations (backend-design §4.3): uma migration publicada nunca
 * é editada, porque aparelhos que já rodaram a versão antiga não rodariam a corrigida e os
 * bancos divergiriam em silêncio. O hash de cada arquivo entra no `checksums.lock` na
 * primeira vez que ele é embutido e, dali em diante, só é conferido — nunca reescrito. Para
 * corrigir uma migration ainda **não publicada**, apague a linha dela no lock de propósito;
 * a remoção aparece no diff e passa pela revisão.
 *
 * O formato é o do `sha256sum`, para que `sha256sum -c checksums.lock` dentro de
 * `db/migrations` confira os arquivos sem depender do projeto.
 *
 * @param {readonly string[]} files Arquivos `.sql` em ordem de versão.
 * @return {void} Nada; grava o lock com as migrations novas acrescentadas.
 * @throws {Error} Quando uma migration travada mudou de conteúdo ou sumiu do diretório.
 */
function lockMigrations(files) {
    const locked = new Map();
    if (existsSync(lockFile)) {
        for (const line of readFileSync(lockFile, 'utf8').split('\n').filter((entry) => entry !== '')) {
            const match = /^([0-9a-f]{64}) {2}(\S+)$/.exec(line);
            if (match === null) {
                throw new Error(`Linha fora do formato do sha256sum em checksums.lock: ${line}`);
            }
            locked.set(match[2], match[1]);
        }
    }

    for (const file of locked.keys()) {
        if (!files.includes(file)) {
            throw new Error(`Migration travada removida: ${file}. Migrations publicadas não são apagadas.`);
        }
    }

    const lines = files.map((file) => {
        const hash = createHash('sha256').update(readFileSync(join(sourceDir, file))).digest('hex');
        const expected = locked.get(file);
        if (expected !== undefined && expected !== hash) {
            throw new Error(`Migration publicada foi editada: ${file}. Corrija com uma migration nova (backend-design §4.3).`);
        }
        return `${hash}  ${file}`;
    });

    writeFileSync(lockFile, `${lines.join('\n')}\n`);
}

/**
 * Embute os arquivos de `db/migrations` no bundle do `core` como strings, porque o mobile
 * não tem um diretório de arquivos para varrer em tempo de execução e o desktop empacotado
 * também não deveria depender de um (backend-design §4.4). Os `.sql` continuam sendo a
 * fonte da verdade; um teste do `core` falha se o arquivo gerado divergir deles.
 *
 * @return {void} Nada; grava o arquivo gerado ao lado do runner de migrations e atualiza o
 * `checksums.lock` com as migrations novas.
 * @throws {Error} Quando um arquivo não segue a numeração `NNNN_nome.sql` ou a sequência
 * tem lacuna — o número é o próprio `user_version`, então uma lacuna quebraria o runner —, ou
 * quando uma migration travada foi editada ou removida.
 */
function embedMigrations() {
    const files = readdirSync(sourceDir).filter((file) => file.endsWith('.sql')).sort();
    const migrations = files.map((file, index) => {
        const match = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
        if (match === null) {
            throw new Error(`Migration fora do padrão NNNN_nome.sql: ${file}`);
        }
        const version = Number(match[1]);
        if (version !== index + 1) {
            throw new Error(`Sequência de migrations com lacuna: esperado ${index + 1}, encontrado ${file}`);
        }
        const sql = readFileSync(join(sourceDir, file), 'utf8');
        return `    { version: ${version}, name: ${JSON.stringify(file.replace(/\.sql$/, ''))}, sql: ${JSON.stringify(sql)} },`;
    });

    const content = [
        '// Arquivo gerado por scripts/embed-migrations.mjs a partir de db/migrations — não editar.',
        "import type { Migration } from './Migration.ts';",
        '',
        'export const embeddedMigrations: readonly Migration[] = [',
        ...migrations,
        '];',
        '',
    ].join('\n');

    // A trava vem antes da gravação: uma migration publicada editada não pode chegar ao bundle.
    lockMigrations(files);
    writeFileSync(targetFile, content);
}

embedMigrations();

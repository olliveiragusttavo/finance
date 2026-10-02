import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = join(root, 'db', 'migrations');
const targetFile = join(root, 'packages', 'core', 'src', 'infrastructure', 'migrations', 'embedded.generated.ts');

/**
 * Embute os arquivos de `db/migrations` no bundle do `core` como strings, porque o mobile
 * não tem um diretório de arquivos para varrer em tempo de execução e o desktop empacotado
 * também não deveria depender de um (backend-design §4.4). Os `.sql` continuam sendo a
 * fonte da verdade; um teste do `core` falha se o arquivo gerado divergir deles.
 *
 * @return {void} Nada; grava o arquivo gerado ao lado do runner de migrations.
 * @throws {Error} Quando um arquivo não segue a numeração `NNNN_nome.sql` ou a sequência
 * tem lacuna — o número é o próprio `user_version`, então uma lacuna quebraria o runner.
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

    writeFileSync(targetFile, content);
}

embedMigrations();

import type { BackupDirectory } from '../../ports/BackupDirectory.ts';
import type { Clock, Timestamp } from '../../ports/Clock.ts';
import type { Database } from '../../ports/Database.ts';

/** Quantas cópias pré-migration ficam guardadas (backend-design §4.6). */
const KEPT_BACKUPS = 3;

/**
 * Reconhece só os arquivos que esta rotina criou, capturando o instante da cópia. A rotação
 * nunca apaga o que não casa com o padrão: a pasta é do usuário também, e um arquivo que
 * ele guardou ali à mão não é nosso para descartar.
 */
const BACKUP_FILE_PATTERN = /^pre-v\d+-(\d{4}-\d{2}-\d{2}-\d{6})\.sqlite$/;

/**
 * A cópia de segurança falhou e, por isso, nenhuma migration foi aplicada. É um tipo
 * próprio para que a tela de bloqueio do shell diga "não foi possível copiar o banco" em
 * vez de tratar como migration quebrada: o banco continua intacto na versão anterior.
 */
export class MigrationBackupError extends Error {
    /**
     * @param fileName Arquivo que deveria ter sido gravado; ajuda a diagnosticar disco cheio
     * ou permissão na pasta.
     * @param cause Erro original do SQLite ou do sistema de arquivos.
     */
    public constructor(public readonly fileName: string, cause: unknown) {
        super(`Não foi possível gravar o backup ${fileName} antes de migrar`, { cause });
        this.name = 'MigrationBackupError';
    }
}

/** Quem o runner chama antes de aplicar migrations; separado para testar o runner sem disco. */
export interface MigrationBackup {
    /**
     * @param fromVersion `user_version` atual do banco, que entra no nome da cópia.
     * @return O nome do arquivo gravado, para o relatório da abertura e a opção de restaurar.
     * @throws {MigrationBackupError} Quando a cópia não pôde ser gravada.
     */
    create(fromVersion: number): string;
}

/**
 * Backup automático antes de migrar (backend-design §4.6). Sem DBA, esta cópia é o único
 * `down` que existe: uma migration que falha num aparelho de usuário só tem volta se o
 * arquivo de antes ainda estiver em disco.
 *
 * Usa `VACUUM INTO`, e não cópia de arquivo, porque o banco está em WAL: copiar só o
 * `.sqlite` perderia o que ainda está no `-wal`, e o `VACUUM INTO` grava uma imagem
 * consistente e compactada pela própria conexão — a mesma operação do snapshot de
 * pareamento (sync-design §6.4).
 */
export class PreMigrationBackup implements MigrationBackup {
    /**
     * @param database Conexão com o banco a copiar; precisa estar fora de transação, porque
     * o SQLite recusa `VACUUM` dentro de uma.
     * @param directory Pasta de backups ao lado do banco, fornecida pela plataforma.
     * @param clock Instante da cópia, que entra no nome do arquivo.
     */
    public constructor(
        private readonly database: Database,
        private readonly directory: BackupDirectory,
        private readonly clock: Clock,
    ) {}

    /**
     * Grava a cópia e só **depois** descarta as antigas: se a gravação falhar, as três
     * cópias anteriores continuam lá.
     *
     * @param fromVersion `user_version` atual do banco.
     * @return O nome do arquivo gravado.
     * @throws {MigrationBackupError} Quando o `VACUUM INTO` falha (disco cheio, permissão,
     * arquivo com o mesmo nome) — e então nada deve ser migrado.
     */
    public create(fromVersion: number): string {
        const fileName = backupFileName(fromVersion, this.clock.now());
        try {
            // VACUUM INTO aceita expressão, então o caminho vai como parâmetro e não precisa
            // de escape de aspas — um nome de pasta com apóstrofo não quebra o SQL.
            this.database.run('VACUUM INTO :path', { path: this.directory.pathOf(fileName) });
        } catch (error) {
            throw new MigrationBackupError(fileName, error);
        }
        for (const stale of staleBackups(this.directory.list())) {
            this.directory.remove(stale);
        }
        return fileName;
    }
}

/**
 * Monta `pre-v{versão}-{data}-{hora}.sqlite`. A hora (UTC) entra além da data pedida pelo
 * design porque o `VACUUM INTO` recusa sobrescrever arquivo existente: duas tentativas de
 * migrar no mesmo dia — a primeira falhou, o usuário abriu de novo — colidiriam no nome e a
 * segunda abertura falharia sem motivo.
 *
 * @param version `user_version` do banco copiado; diz ao usuário de qual versão é a cópia.
 * @param now Instante da cópia, no formato `YYYY-MM-DD HH:MM:SS` do `Clock`.
 * @return O nome do arquivo, que ordena cronologicamente pela parte de data e hora.
 */
export function backupFileName(version: number, now: Timestamp): string {
    const [date = '', time = ''] = now.split(' ');
    return `pre-v${String(Math.trunc(version))}-${date}-${time.replaceAll(':', '')}.sqlite`;
}

/**
 * A rotação ordena pelo instante (`newestFirst`); ordenar pelo nome inteiro apagaria a cópia
 * mais nova, porque `pre-v10` vem antes de `pre-v9` na ordem de texto.
 *
 * @param fileNames Conteúdo da pasta de backups.
 * @return Os backups desta rotina além dos três mais recentes, que podem ser apagados.
 */
export function staleBackups(fileNames: readonly string[]): readonly string[] {
    return newestFirst(fileNames).slice(KEPT_BACKUPS);
}

/**
 * A cópia que a tela de bloqueio oferece para restaurar quando uma migration falha
 * (backend-design §4.5, passo 4): a mais recente desta rotina, que é a gravada antes da
 * tentativa que falhou. Fica aqui, ao lado da rotação, para que o shell não reimplemente o
 * padrão do nome nem a ordem pelo instante.
 *
 * @param fileNames Conteúdo da pasta de backups.
 * @return O nome do backup mais recente; `null` quando não há nenhum desta rotina.
 */
export function newestBackup(fileNames: readonly string[]): string | null {
    return newestFirst(fileNames)[0] ?? null;
}

/**
 * Ordena pelo instante gravado no nome, e não pelo nome inteiro, porque `pre-v10` vem antes
 * de `pre-v9` na ordem de texto.
 *
 * @param fileNames Conteúdo da pasta de backups.
 * @return Só os backups desta rotina, do mais recente ao mais antigo; arquivos do usuário
 * na mesma pasta ficam de fora.
 */
function newestFirst(fileNames: readonly string[]): readonly string[] {
    return fileNames
        .flatMap((fileName) => {
            const instant = BACKUP_FILE_PATTERN.exec(fileName)?.[1];
            return instant === undefined ? [] : [{ fileName, instant }];
        })
        .sort((a, b) => compareText(b.instant, a.instant) || compareText(b.fileName, a.fileName))
        .map(({ fileName }) => fileName);
}

/**
 * Comparação por código de caractere, e não `localeCompare`: a ordem dos backups não pode
 * depender da localidade do aparelho.
 *
 * @param a Primeiro texto.
 * @param b Segundo texto.
 * @return Negativo, zero ou positivo, como espera o `sort`.
 */
function compareText(a: string, b: string): number {
    if (a === b) {
        return 0;
    }
    return a < b ? -1 : 1;
}

/**
 * Porta da pasta de backups ao lado do banco (backend-design §4.6). É porta porque o núcleo
 * não lê disco (backend-design §3.1): o desktop usa `node:fs` e o mobile o sistema de
 * arquivos do Expo, mas a regra — quando copiar, como nomear, quantas cópias guardar — é
 * uma só e mora no núcleo. Síncrona como a porta `Database`, porque a cópia acontece no
 * meio da sequência de abertura, que é síncrona por inteiro.
 */
export interface BackupDirectory {
    /**
     * @param fileName Nome do arquivo de backup, sem pasta.
     * @return O caminho completo do arquivo, no formato que o SQLite aceita no `VACUUM INTO`;
     * a pasta já existe quando o caminho é devolvido, porque o SQLite não a cria.
     */
    pathOf(fileName: string): string;

    /**
     * @return Os nomes dos arquivos presentes na pasta, em qualquer ordem; vazio quando a
     * pasta ainda não existe.
     */
    list(): readonly string[];

    /**
     * @param fileName Nome do arquivo a apagar; ausente não é erro, porque a rotação só
     * quer garantir que ele não esteja mais lá.
     * @return void
     */
    remove(fileName: string): void;
}

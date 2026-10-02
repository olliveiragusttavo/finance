/**
 * Uma migration embutida no bundle. A versão é o próprio `PRAGMA user_version` que ela
 * produz (backend-design §4.2), por isso é sequencial e sem lacunas.
 */
export interface Migration {
    readonly version: number;
    readonly name: string;
    readonly sql: string;
}

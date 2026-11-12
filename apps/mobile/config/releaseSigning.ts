/**
 * Variáveis de ambiente da chave de release (mobile-mvp-plan, Fase 19). A chave e as senhas
 * ficam fora do repositório e fora do `android/` gerado: o Gradle as lê no build, e o
 * `pnpm dist:mobile` confere que existem antes de começar.
 */
export const RELEASE_SIGNING_ENV = {
    keystore: 'FINANCE_ANDROID_KEYSTORE',
    keystorePassword: 'FINANCE_ANDROID_KEYSTORE_PASSWORD',
    keyAlias: 'FINANCE_ANDROID_KEY_ALIAS',
    keyPassword: 'FINANCE_ANDROID_KEY_PASSWORD',
} as const;

/** Marca do trecho inserido, para o `prebuild` repetido não inserir duas vezes. */
const MARKER = '// finance: assinatura de release (app.config.ts, withReleaseSigning)';

/** Linha do template do Expo que assina o build de release com a chave de depuração. */
const DEBUG_SIGNED_RELEASE = /(release\s*\{[^}]*?)signingConfig signingConfigs\.debug/;

/** Abertura do bloco de chaves do template, onde a configuração de release entra. */
const SIGNING_CONFIGS_OPENING = 'signingConfigs {';

/**
 * Bloco `release` de `signingConfigs`, lido das variáveis de ambiente no build. Fica vazio sem
 * a chave: o CI e o `build:benchmark` geram o APK de release sem ela.
 */
const RELEASE_SIGNING_CONFIG = [
    `        ${MARKER}`,
    '        release {',
    `            def keystore = System.getenv('${RELEASE_SIGNING_ENV.keystore}')`,
    '            if (keystore) {',
    '                storeFile file(keystore)',
    `                storePassword System.getenv('${RELEASE_SIGNING_ENV.keystorePassword}')`,
    `                keyAlias System.getenv('${RELEASE_SIGNING_ENV.keyAlias}')`,
    `                keyPassword System.getenv('${RELEASE_SIGNING_ENV.keyPassword}')`,
    '            }',
    '        }',
].join('\n');

/** Escolha da chave no build de release: a do usuário quando informada, a de depuração quando não. */
const RELEASE_SIGNING_CHOICE = `signingConfig System.getenv('${RELEASE_SIGNING_ENV.keystore}') ? signingConfigs.release : signingConfigs.debug`;

/**
 * Liga a chave de release ao `android/app/build.gradle` gerado pelo `expo prebuild`. O template
 * assina o release com a chave de depuração, que é pública: um APK assim pode ser substituído
 * por qualquer outro assinado com ela, e a atualização do app instalado deixaria de provar que
 * veio do mesmo autor. Sem a variável da chave, o release continua com a de depuração, porque o
 * CI e a medição da Fase 5 (que instala o release por cima do development build, mantendo os
 * dados) dependem disso; o `pnpm dist:mobile` é que recusa gerar o APK distribuído sem ela.
 *
 * A troca é por texto porque o `android/` não é versionado: um plugin é o único lugar estável
 * para a mudança. Se o template do Expo mudar a ponto de a âncora sumir, o `prebuild` falha, em
 * vez de seguir assinando em silêncio com a chave de depuração.
 *
 * @param gradle Conteúdo do `app/build.gradle` gerado.
 * @return O conteúdo com a configuração de release; o mesmo texto quando ela já foi aplicada.
 * @throws Error Quando o template não tem o bloco `signingConfigs` ou o release assinado com a chave de depuração.
 */
export function addReleaseSigning(gradle: string): string {
    if (gradle.includes(MARKER)) {
        return gradle;
    }
    if (!gradle.includes(SIGNING_CONFIGS_OPENING) || !DEBUG_SIGNED_RELEASE.test(gradle)) {
        throw new Error('build.gradle do Expo sem a assinatura de release esperada; revise o withReleaseSigning do app.config.ts');
    }
    return gradle
        .replace(SIGNING_CONFIGS_OPENING, `${SIGNING_CONFIGS_OPENING}\n${RELEASE_SIGNING_CONFIG}`)
        .replace(DEBUG_SIGNED_RELEASE, `$1${RELEASE_SIGNING_CHOICE}`);
}

/**
 * Converte a versão SemVer do app no `versionCode` do Android. O Android só instala uma
 * atualização com `versionCode` maior ou igual ao instalado; com o `1` fixo do template, um APK
 * antigo instalaria por cima de um novo sem aviso, e a versão do pacote (que o `CLAUDE.md` sobe a
 * cada entrega) não chegaria ao sistema. Três dígitos por parte mantêm a ordem do SemVer.
 *
 * @param version Versão do `package.json` do app (`1.14.0`).
 * @return O `versionCode` (`1014000` para `1.14.0`).
 * @throws Error Quando a versão não é `maior.menor.correção` ou uma parte passa de 999.
 */
export function versionCodeOf(version: string): number {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (match === null) {
        throw new Error(`versão "${version}" não é maior.menor.correção`);
    }
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    // O teto do Android é 2.100.000.000.
    if (minor > 999 || patch > 999 || major > 2100) {
        throw new Error(`versão "${version}" não cabe no versionCode do Android`);
    }
    return major * 1_000_000 + minor * 1_000 + patch;
}

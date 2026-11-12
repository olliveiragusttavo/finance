import { addReleaseSigning, RELEASE_SIGNING_ENV, versionCodeOf } from '../config/releaseSigning';

/**
 * Trecho do `android/app/build.gradle` que o `expo prebuild` do SDK 58 gera, com o release
 * assinado pela chave de depuração. Copiado do arquivo gerado, porque o template é baixado no
 * `prebuild` e não existe no `node_modules` para o teste ler.
 */
const EXPO_TEMPLATE = `android {
    defaultConfig {
        applicationId 'br.com.finance.app'
        versionCode 1
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            minifyEnabled enableMinifyInReleaseBuilds
        }
    }
}
`;

describe('assinatura de release (mobile-mvp-plan, Fase 19)', () => {
    it('o release usa a chave das variáveis de ambiente e só cai na de depuração sem ela', () => {
        const gradle = addReleaseSigning(EXPO_TEMPLATE);

        expect(gradle).toContain(`storeFile file(keystore)`);
        expect(gradle).toContain(`System.getenv('${RELEASE_SIGNING_ENV.keyPassword}')`);
        expect(gradle).toContain(`signingConfig System.getenv('${RELEASE_SIGNING_ENV.keystore}') ? signingConfigs.release : signingConfigs.debug`);
    });

    it('o debug continua com a chave de depuração, para o development build manter os dados', () => {
        const gradle = addReleaseSigning(EXPO_TEMPLATE);

        expect(gradle).toMatch(/debug \{\s*signingConfig signingConfigs\.debug\s*\}/);
    });

    it('nenhuma senha da chave de release fica escrita no build.gradle; só as públicas da de depuração', () => {
        const gradle = addReleaseSigning(EXPO_TEMPLATE);

        expect(gradle.match(/(storePassword|keyPassword) '[^']*'/g)).toEqual(["storePassword 'android'", "keyPassword 'android'"]);
    });

    it('o prebuild repetido não insere a configuração duas vezes', () => {
        const once = addReleaseSigning(EXPO_TEMPLATE);

        expect(addReleaseSigning(once)).toBe(once);
    });

    it('sem a âncora do template, falha em vez de seguir com a chave de depuração', () => {
        const changed = EXPO_TEMPLATE.replace(/signingConfig signingConfigs\.debug\s*minifyEnabled/, 'minifyEnabled');

        expect(() => addReleaseSigning(changed)).toThrow('assinatura de release esperada');
    });
});

describe('versionCode a partir da versão do app', () => {
    it('mantém a ordem do SemVer', () => {
        expect(versionCodeOf('1.14.0')).toBe(1_014_000);
        expect(versionCodeOf('1.14.1')).toBeGreaterThan(versionCodeOf('1.14.0'));
        expect(versionCodeOf('1.15.0')).toBeGreaterThan(versionCodeOf('1.14.999'));
        expect(versionCodeOf('2.0.0')).toBeGreaterThan(versionCodeOf('1.999.999'));
    });

    it('recusa versão fora do formato ou que não cabe', () => {
        expect(() => versionCodeOf('1.14')).toThrow('maior.menor.correção');
        expect(() => versionCodeOf('1.14.0-rc.1')).toThrow('maior.menor.correção');
        expect(() => versionCodeOf('1.1000.0')).toThrow('não cabe');
    });
});

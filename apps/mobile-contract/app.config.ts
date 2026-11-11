import type { ExpoConfig } from 'expo/config';
import packageJson from './package.json';

/**
 * App de contrato (mobile-mvp-plan, Fase 3; mobile-shell-design §8): roda no Hermes, com o
 * `expo-sqlite` real, o que o Vitest só alcança no Node. Tem pacote Android próprio para
 * conviver no aparelho com o app de verdade sem tocar no banco dele. Não guarda nada: o banco
 * de cada caso é em memória, e o backup fica desligado mesmo assim, por coerência com o app.
 */
const config: ExpoConfig = {
    name: 'Finance Contrato',
    slug: 'finance-contract',
    version: packageJson.version,
    orientation: 'portrait',
    userInterfaceStyle: 'automatic',
    android: {
        package: 'br.com.finance.contract',
        allowBackup: false,
        permissions: [],
        blockedPermissions: [
            'android.permission.READ_EXTERNAL_STORAGE',
            'android.permission.WRITE_EXTERNAL_STORAGE',
            'android.permission.SYSTEM_ALERT_WINDOW',
            'android.permission.VIBRATE',
            'android.permission.RECORD_AUDIO',
        ],
    },
    plugins: ['expo-sqlite'],
};

export default config;

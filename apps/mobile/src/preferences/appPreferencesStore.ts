import { Paths } from 'expo-file-system';
import { expoFileSystem, joinUri } from '../platform/AppFileSystem.ts';
import { DevicePreferencesStore } from './devicePreferences.tsx';

/**
 * @return As preferências do aparelho em `preferences.json`, no diretório de documentos do app —
 * o mesmo do log, fora da pasta do banco, para que restaurar ou substituir o banco não leve o
 * tema e o último mês junto. Separado do `devicePreferences`, que não conhece o disco real, para
 * que os testes montem a loja sobre um disco em memória sem o módulo nativo.
 */
export function appPreferencesStore(): DevicePreferencesStore {
    return new DevicePreferencesStore(expoFileSystem, joinUri(Paths.document.uri, 'preferences.json'));
}

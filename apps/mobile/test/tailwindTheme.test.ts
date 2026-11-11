import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../tailwind.config.js';

/**
 * Tema efetivo do Tailwind do app, depois de juntar o preset do NativeWind com o dos tokens. É
 * o que o NativeWind compila: conferir só o preset dos tokens não pegaria uma chave que o preset
 * do NativeWind sobrescreve por `extend`, como aconteceu com a fonte.
 */
const theme: object = resolveConfig(tailwindConfig).theme;

/**
 * Lê uma chave do tema sem confiar nos tipos do `resolveConfig`, que descrevem o tema padrão
 * do Tailwind (`text-sm`, `red-500`) e não o substituído pelos tokens.
 *
 * @param section Seção do tema (`fontSize`, `colors`).
 * @param key Chave dentro da seção.
 * @return O valor resolvido, ou `undefined` quando a chave não existe.
 */
function themeValue(section: string, key: string): unknown {
    const values: unknown = Reflect.get(theme, section);
    return typeof values === 'object' && values !== null ? Reflect.get(values, key) : undefined;
}

describe('tema do NativeWind resolvido (preset do NativeWind + tokens)', () => {
    it('font-sans é a IBM Plex Sans registrada no Android, e não a fonte do sistema do preset do NativeWind', () => {
        expect(themeValue('fontFamily', 'sans')).toEqual(['"IBM Plex Sans"']);
    });

    it('as escalas são as dos tokens, sem as padrão do Tailwind', () => {
        expect(themeValue('fontSize', '26')).toBe('26px');
        expect(themeValue('fontSize', 'sm')).toBeUndefined();
        expect(themeValue('colors', 'surface')).toBe('var(--surface)');
        expect(themeValue('colors', 'red')).toBeUndefined();
        expect(themeValue('spacing', '3')).toBe('12px');
    });
});

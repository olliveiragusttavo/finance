import { AppLifecycle } from '../src/startup/AppLifecycle.tsx';
import { afterFrame } from '../src/startup/openMobileCore.ts';
import { resolveTheme } from '../src/theme/ThemeRoot.tsx';
import { appTextClassName } from '../src/ui/AppText.tsx';

jest.mock('@finance/sqlite-expo/open', () => ({}));
jest.mock('expo-file-system', () => ({ Paths: {} }));

describe('AppLifecycle (mobile-shell-design §5.3)', () => {
    it('avisa uma vez a cada troca real de primeiro plano, e não a cada evento do sistema', () => {
        const lifecycle = new AppLifecycle();
        const events: string[] = [];
        lifecycle.subscribe({ onForeground: () => events.push('frente'), onBackground: () => events.push('fundo') });

        lifecycle.update('inactive');
        lifecycle.update('background');
        lifecycle.update('background');
        lifecycle.update('active');

        expect(events).toEqual(['fundo', 'frente']);
    });

    it('para de avisar quem cancelou a inscrição', () => {
        const lifecycle = new AppLifecycle();
        const events: string[] = [];
        const cancel = lifecycle.subscribe({ onForeground: () => events.push('frente'), onBackground: () => events.push('fundo') });

        cancel();
        lifecycle.update('background');

        expect(events).toEqual([]);
    });
});

describe('agendamento pós-frame (mobile-shell-design §4.3)', () => {
    it('roda a chamada depois do frame, e não na hora, mantendo a ordem', () => {
        jest.useFakeTimers();
        const order: string[] = [];

        afterFrame(() => order.push('lançar'));
        afterFrame(() => order.push('listar'));
        expect(order).toEqual([]);

        jest.runAllTimers();
        expect(order).toEqual(['lançar', 'listar']);
        jest.useRealTimers();
    });
});

describe('tema', () => {
    it('segue o sistema por padrão e cai no claro quando o sistema não informa', () => {
        expect(resolveTheme('system', 'dark')).toBe('dark');
        expect(resolveTheme('system', null)).toBe('light');
        expect(resolveTheme('dark', 'light')).toBe('dark');
    });
});

describe('AppText', () => {
    it('só aplica tamanho e cor base quando o chamador não define, porque o NativeWind não resolve conflito pela ordem', () => {
        expect(appTextClassName('')).toBe('font-sans text-15 text-ink');
        expect(appTextClassName('text-13 text-muted')).toBe('font-sans text-13 text-muted');
        expect(appTextClassName('text-22 font-semibold')).toBe('font-sans text-ink text-22 font-semibold');
        expect(appTextClassName('text-on-accent')).toBe('font-sans text-15 text-on-accent');
    });
});

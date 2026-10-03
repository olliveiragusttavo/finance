import { app, session, type WebContents } from 'electron';
import { isAppUrl } from './appUrl.ts';

/**
 * Trava de segurança de toda janela (desktop-shell-design §3.6): o renderer é entrada não
 * confiável, então não navega para fora do app, não abre janelas novas, não embute
 * `<webview>` e não recebe permissão alguma (câmera, notificação, geolocalização) — o app
 * não usa nenhuma, e conceder por padrão só aumentaria o que um conteúdo injetado alcança.
 *
 * Aplicada no evento `web-contents-created`, e não por janela, para valer também para
 * qualquer janela criada no futuro sem que alguém lembre de chamá-la.
 *
 * @param appUrl Endereço do app, para distinguir a navegação interna da externa.
 */
export function installSecurityGuards(appUrl: string): void {
    app.on('web-contents-created', (_event, contents: WebContents) => {
        contents.on('will-navigate', (event, url) => {
            if (!isAppUrl(url, appUrl)) {
                event.preventDefault();
            }
        });
        contents.on('will-redirect', (event, url) => {
            if (!isAppUrl(url, appUrl)) {
                event.preventDefault();
            }
        });
        contents.on('will-attach-webview', (event) => {
            event.preventDefault();
        });
        contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    });
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
        callback(false);
    });
    session.defaultSession.setPermissionCheckHandler(() => false);
}

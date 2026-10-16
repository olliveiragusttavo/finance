/**
 * @param url Endereço para onde a janela tenta navegar.
 * @param appUrl Endereço de onde o app foi carregado: o `index.html` empacotado (`file://`)
 * ou o servidor do Vite em desenvolvimento.
 * @return `true` só para o próprio app. Com histórico em hash, navegar entre telas nunca muda
 * o documento; qualquer outro destino é conteúdo remoto que o renderer não deve carregar.
 */
export function isAppUrl(url: string, appUrl: string): boolean {
    let target: URL;
    let app: URL;
    try {
        target = new URL(url);
        app = new URL(appUrl);
    } catch {
        return false;
    }
    if (app.protocol === 'file:') {
        return target.protocol === 'file:' && target.pathname === app.pathname;
    }
    return target.origin === app.origin;
}

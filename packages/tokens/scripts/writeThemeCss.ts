import { writeFileSync } from 'node:fs';
import { renderThemeCss } from '../src/themeCss.ts';

/*
 * Grava o `theme.generated.css` a partir dos tokens. O arquivo é versionado, e não gerado no
 * build, para que o CSS de tema apareça no diff da revisão quando um token muda e para que o
 * Metro do mobile não precise rodar o gerador; o teste de sincronia falha se ele ficar velho.
 */
writeFileSync(new URL('../src/theme.generated.css', import.meta.url), renderThemeCss());

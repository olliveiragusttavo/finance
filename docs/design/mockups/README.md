# Mockups de referência — Finanças Pessoais

Rascunhos aprovados das telas. Use como **referência de layout, conteúdo e comportamento**,
não como código para copiar. O design final será implementado com:

- **Desktop** (Electron + React): Tailwind CSS + shadcn/ui (+ TanStack Table nas tabelas)
- **Celular** (React Native + Expo): NativeWind
- Um pacote de **tokens** compartilhado alimenta o `tailwind.config` dos dois apps
  (raciocínio em [desktop-shell-design.md §4.5](../../plans/desktop-shell-design.md#45-estilo-e-tokens-de-design)).

## Como ler os arquivos

Cada tela é um arquivo `screens/*.dc.html` (HTML de um editor de design):

- O markup dentro de `<x-dc>` é a tela. `{{nome}}` é um valor dinâmico; `<sc-if>` é condicional.
- O `<script type="text/x-dc">` no fim só simula o mockup (troca de tema e de mês). Ignore como lógica real.
- `<script src="./support.js">` é do editor; não existe aqui e não é necessário.
- Links `href="Outra.dc.html"` indicam a navegação entre telas.
- `canvas.json` lista todas as telas, com título, página (desktop/mobile) e tamanho.
- Valores com `[valor]`, `[data]` etc. são placeholders. Os números dos relatórios são ilustrativos.

## Decisões de interface (seguir)

1. **Tema claro e escuro** desde o início, via variáveis de cor (tokens abaixo).
2. **Mês de referência fixo** em toda tela que depende de período:
   - desktop: barra superior fixa (‹ mês ›, "Voltar ao mês atual");
   - celular: faixa abaixo do cabeçalho.
   - Não aparece no formulário de lançamento nem em fluxos de configuração.
3. **Contas e Cartões são seções separadas**, cada uma com item próprio no menu:
   lista com resumo do mês (saldo da conta / total e situação da fatura) → clique abre o detalhe.
4. **Listas em vez de abas** no topo para escolher entidades (contas, cartões, tags, metas, tipos de cadastro).
5. **Relatórios** são subitens de "Relatórios" no menu lateral do desktop. "Por sócio" só existe em perfil empresarial.
6. **Consolidado e previsto** sempre juntos; previsto com peso menor.
7. Entrada/saída distinguíveis **sem depender só da cor**: sinal (+/−), ⇄ para transferência, rótulos.
8. Números com algarismos tabulares e alinhados à direita nas tabelas.
9. Celular: barra inferior com Início · Transações · Contas · Cartões · Mais; alvos de toque ≥ 44px; escolhas em folhas inferiores.

## Tokens de cor

Fonte: IBM Plex Sans.

| Token | Claro | Escuro |
|---|---|---|
| bg | #F4F5F2 | #111413 |
| surface | #FFFFFF | #1A1E1C |
| surface2 | #FAFAF8 | #151917 |
| line | #DDE1DC | #2E3431 |
| line2 | #EEF0EC | #242926 |
| ink | #1B1F1D | #E7EAE7 |
| ink2 | #3D4541 | #C3C9C5 |
| muted | #5A625E | #9AA29E |
| accent | #1F5F8B | #6AAAD8 |
| on-accent | #FFFFFF | #0B1A24 |
| soft (fundo selecionado) | #E6EEF4 | #1D3040 |
| soft-ink | #163F5C | #B5D7F0 |
| in (entrada) | #1F5F8B | #7DB8E2 |
| out (saída) | #A04A12 | #E89A63 |
| warn-bg / warn-ink | #FFF1D6 / #5C3D00 | #3A2C10 / #F2D38F |
| ok-bg / ok-ink | #E2F1E8 / #1E5A3F | #16302A / #8FD9B4 |
| track (barras) | #EEF0EC | #2A302D |
| danger | #9B2C1F | #F08A7A |

## Telas

**Desktop** (`page: desktop`, 1440px)

| Arquivo | Tela |
|---|---|
| Main | D2 Visão geral |
| DesktopTransacoes | D3 Transações (tabela densa + painel de edição) |
| DesktopContas | Contas → extrato do mês |
| DesktopCartoes | Cartões → fatura do mês |
| DesktopMetas | D9 Metas |
| DesktopRelCategoria | D4 Relatório por categoria |
| DesktopRelFluxo | D5 Fluxo mensal por conta |
| DesktopRelCartao | D6 Impacto do cartão |
| DesktopRelSocio | D7 Relatório por sócio (empresarial) |
| DesktopRelTag | D8 Relatório por tag |
| DesktopCadastros | D10 Cadastros |
| DesktopDispositivos | D10 Dispositivos e convite (QR + código) |
| DesktopAjustes | Ajustes |
| DesktopPrimeiroUso | Primeiro uso |

**Celular** (`page: mobile`, 390×844)

| Arquivo | Tela |
|---|---|
| MobileInicio | M1 Início |
| MobileTransacoes | M5 Transações do mês |
| MobileTransacaoDetalhe | M6 Detalhe da transação |
| MobileLancamento | M2/M3 Lançamento (fatura sugerida) |
| MobileParcelar | M4 Repetir / parcelar |
| MobileEscopo | M7 Escopo de edição/exclusão recorrente |
| MobileContas | Contas |
| MobileExtrato | M8 Extrato da conta |
| MobileCartoes | Cartões |
| MobileFatura | M9 Detalhe da fatura |
| MobilePagarFatura | Pagar fatura |
| MobileMais | Menu Mais |
| MobileMetas | M10 Metas |
| MobileCadastros | M11 Cadastros |
| MobileDispositivos | M12 Dispositivos |
| MobileParear | Entrar num grupo |
| MobileRecebendo | Recebendo dados (pareamento) |
| MobileAjustes | M13 Ajustes |
| MobilePrimeiroUso | Primeiro uso |

As regras de negócio completas estão no brief do projeto ([claude-design-brief.md](../claude-design-brief.md)).

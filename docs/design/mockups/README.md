# Mockups de referência — Finanças Pessoais

Rascunhos aprovados das telas. Use como **referência de layout, conteúdo e comportamento**,
não como código para copiar. O design final será implementado com:

- **Desktop** (Electron + React): Tailwind CSS + shadcn/ui (+ TanStack Table nas tabelas)
- **Celular** (React Native + Expo): NativeWind
- Um pacote de **tokens** compartilhado alimenta o `tailwind.config` dos dois apps.

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
9. Anotação é texto livre; a primeira linha é usada como título na lista.
10. **Sócios** (só perfil empresarial): nome até 100 caracteres e participação %; a soma precisa dar 100% para salvar (soma ao vivo + barra de divisão). Remover sócio com lançamentos deixa esses lançamentos "sem sócio atribuído". Por enquanto a participação atual vale para todo o histórico (regra a confirmar).
11. Importação de arquivos só no desktop (ver seção Importação).
12. Celular: barra inferior com Início · Transações · Contas · Cartões · Mais; alvos de toque ≥ 44px; escolhas em folhas inferiores.

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
| DesktopVisaoGeral2 | **D2 Visão geral — versão atual (usar esta)**, 1920px, menu igual ao app implementado |
| Main | D2 Visão geral — versão antiga, substituída por DesktopVisaoGeral2 |
| DesktopTransacoes | D3 Transações (tabela densa + painel de edição) |
| DesktopContas | Contas → extrato do mês |
| DesktopCartoes | Cartões → fatura do mês |
| DesktopMetas | D9 Metas |
| DesktopRelCategoria | D4 Relatório por categoria |
| DesktopRelFluxo | D5 Fluxo mensal por conta |
| DesktopRelCartao | D6 Impacto do cartão |
| DesktopRelSocio | D7 Relatório por sócio (empresarial) |
| DesktopRelTag | D8 Relatório por tag |
| DesktopCadastros | D10 Categorias — opção A: lista de categorias + detalhe com tabela de subcategorias (recomendada) |
| DesktopCategoriasArvore | D10 Categorias — opção B: árvore recolhível (alternativa; escolher uma) |
| DesktopDispositivos | D10 Dispositivos e convite (QR + código) |
| DesktopAjustes | Ajustes |
| DesktopPrimeiroUso | Primeiro uso |
| DesktopTags | Cadastros › Tags (lista + painel de edição) |
| DesktopAnotacoes | Cadastros › Anotações (lista + editor) |
| DesktopSocios | Cadastros › Sócios (só perfil empresarial) |
| DesktopImportArquivo | Importar 1/3 · Arquivo (tipo, separadores, prévia bruta) |
| DesktopImportMapear | Importar 2/3 · Ligar colunas aos campos (arrastar e soltar) |
| DesktopImportRevisar | Importar 3/3 · Revisar (perfil por conta, contas, cartões, categorias, recorrências) |

### Visão geral (DesktopVisaoGeral2)

Substitui a D2 anterior. Layout fluido para telas largas (desenhado em 1920px):

- **Selo de atrasados** ao lado do título (não ocupa a largura toda): "⚠ N atrasados · R$ X a pagar · R$ Y a receber".
  Lançamentos com vencimento antes de hoje e sem pagamento. Clique abre um painel (popover) com cada item
  (nome, data, "há N dias", conta, valor) e ação "Marcar como pago/recebido" com "Desfazer".
  Rodapé indica o que ainda vence até o fim do mês. Sem atrasos: selo verde "Nada atrasado".
- **Indicadores (5):** saldo consolidado (previsto na mesma caixa), patrimônio (inclui investimentos fora do total),
  gastos do mês (vs média de 6 meses), entradas do mês, próximas faturas.
- **Gastos por mês** (6 meses, barras + linha da média) e **Para onde foi no mês** (top 5 categorias + "outras").
  Sem links para relatórios (relatórios removidos do app).
- **Próximos 30 dias:** vencimentos a pagar/receber, transferências e faturas, com totais no rodapé.
- **Contas** compactas (saldo zero esmaecido; investimentos fora do total em grupo próprio),
  **Cartões** (fatura do mês + próxima em aberto), **Metas** (alerta "Prazo vencido"; ritmo necessário),
  **Anotações** (recentes, bloco pequeno).
- Botão de tema alterna Seguir o sistema → Claro → Escuro.

### Importação (desktop)

Entrada por Ajustes › Dados › Importar… e pelo botão "Importar arquivo…" em Transações.
Assistente de 3 passos, um arquivo por vez (CSV ou XLSX).

- **Arquivo:** detecta tipo (Despesas, Receitas, Transferências ou vários tipos com coluna de tipo),
  separador de colunas, separador decimal, formato de data, codificação e cabeçalho; mostra as linhas brutas.
- **Ligar colunas:** cada coluna do arquivo (A, B, C…) recebe um campo do app arrastando o campo até ela,
  ou clicando no campo e depois na coluna (alternativa acessível por teclado). Um campo liga a uma só coluna;
  colunas sem campo são ignoradas. Ligação automática pelo nome do cabeçalho; dicas para colunas com
  nomes ambíguos ("Efetivação" → Data de pagamento). Campos dependem do tipo:
  - todos: Nome*, Valor*, Vencimento*, Observação, Tags, Data de pagamento, Recorrência, Nº da parcela, Total de parcelas;
  - despesas/receitas: Conta*, Categoria*, Subcategoria*, Data da compra; só despesas: Cartão, Encargos;
  - transferências: Conta de origem*, Conta de destino* (subcategoria padrão escolhida na revisão).
  Prévia dos lançamentos interpretados; mapeamento pode ser salvo como modelo.
- **Revisar:**
  - **Perfil de destino por conta** (com padrão + "aplicar a todas"). O lançamento vai para o perfil da sua conta;
    o cartão segue o perfil da conta que paga a fatura. "Ligar a" lista só contas/cartões do perfil escolhido.
  - Contas e cartões do arquivo: criar novos ou ligar a existentes. Cartão exige **dia de fechamento**
    (não vem no arquivo); vencimento é detectado pelas datas.
  - Categorias por perfil: existentes × a criar (criadas em cada perfil que as usa).
  - Recorrências: agrupar linhas da mesma série numa recorrência do app (padrão) ou importar avulsas;
    manter ocorrências futuras do arquivo ou deixar o app gerar 12 meses à frente.
  - "-" ou vazio em datas = sem data; sem data de pagamento = pendente. Sufixo "12/12" sai do nome quando há colunas de parcela.
  - Opção de transformar #palavras das observações em tags; exportar cópia do banco antes de importar (marcado).
  - Botão Importar desabilitado enquanto faltar informação obrigatória (ex.: fechamento dos cartões).

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
| MobileTags | Tags (lista + folha de edição) |
| MobileAnotacoes | Anotações (lista) |
| MobileAnotacaoEditar | Editar anotação |
| MobileSocios | Sócios (só perfil empresarial) |

As regras de negócio completas estão no brief do projeto (`claude-design-brief.md`).

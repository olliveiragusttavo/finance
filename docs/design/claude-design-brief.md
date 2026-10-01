# Brief para mockup das telas — Sistema de Finanças Pessoais

> Documento de entrada para o **Claude Design** gerar mockups. Compila o estado atual do
> projeto (README e `docs/plans/*`) sob a ótica de tela: o que existe, o que cada tela
> precisa mostrar e quais regras de negócio mudam a interface. Nada aqui está
> implementado ainda — o projeto está em fase de design; o schema do banco é a única peça
> materializada ([db/migrations/0001_initial_schema.sql](../../db/migrations/0001_initial_schema.sql)).
>
> Itens marcados **(proposta)** não estão decididos nos documentos de design: são
> sugestões para o mockup e podem mudar.

---

## 1. O produto em uma página

- **O que é:** app de finanças pessoais de uso próprio, criado porque os apps comerciais
  não oferecem os relatórios desejados (detalhamento por categoria/subcategoria, visões
  entre contas, impacto da fatura do cartão no saldo mensal).
- **Usuário:** uma pessoa só (o próprio autor), com seus vários dispositivos. Não é SaaS,
  não tem cadastro/login, não tem monetização.
- **Dados locais:** tudo fica no aparelho, num arquivo SQLite. Não há nuvem nem servidor.
- **Sincronização:** os dispositivos do usuário (celular e desktop) sincronizam
  diretamente entre si, **somente na mesma rede Wi-Fi**, com os dois apps abertos. São
  pareados por **QR code** ou **código de 8 caracteres**.
- **Idioma e moeda:** interface em **português (pt-BR)**, moeda principal **BRL (R$)**.

### Duas plataformas, dois papéis

| Plataforma | Papel | Tecnologia | Implicação para o design |
|---|---|---|---|
| **Celular** (Android e iPhone) | Uso **diário**: lançar transações, consultar saldos, consultas rápidas | React Native + Expo | Abrir o app e lançar uma despesa precisa ser **rápido**. Toque, telas estreitas, poucos campos visíveis por vez. |
| **Desktop** (Linux/Windows/macOS) | **Análise**: relatórios, tabelas densas, comparação entre meses, gráficos | Electron + React DOM | Várias áreas na mesma tela, tabelas com muitas colunas, ordenação, hover, menus de contexto, atalhos de teclado, tema claro e escuro. |

As duas plataformas **não compartilham componentes visuais** — cada uma tem layout
próprio, pensado para o seu uso. Compartilham regras, dados e formatação (o mesmo saldo
nunca aparece de dois jeitos).

---

## 2. Glossário (termos que aparecem na interface)

| Termo na UI | Significado |
|---|---|
| **Perfil** | O "espaço" dos dados. **Pessoal** ou **Empresarial**. Cada perfil tem moeda própria, contas, categorias e tags próprias; um não vê o outro. |
| **Sócio** | Pessoa com participação (%) num perfil **empresarial**. Não existe em perfil pessoal. |
| **Conta** | Conta **corrente** ou de **investimentos**. |
| **Cartão de crédito** | Pertence ao perfil e é pago por uma conta. Tem limite, dia de fechamento e dia de vencimento. |
| **Extrato** | O mês de uma conta (um por conta por mês). |
| **Fatura** | O mês de um cartão (uma por cartão por mês). **Paga** ou **em aberto** — nunca "meio paga". |
| **Transação / Lançamento** | Toda movimentação: **Receita**, **Despesa**, **Transferência** ou **Investimento**. |
| **Categoria / Subcategoria** | Classificação em dois níveis. Toda transação aponta para uma **subcategoria**. |
| **Tag** | Etiqueta livre, várias por transação. |
| **Meta** | Alvo de economia ou de gasto, com valor e data opcional. Progresso = soma das transações vinculadas. |
| **Recorrência** | **Parcelamento** (ex.: 12x) ou **Fixa** (aluguel, assinatura; com ou sem data de fim). |
| **Saldo consolidado** | Só o que já foi **pago/recebido**. |
| **Saldo previsto** | Tudo que está lançado, pago ou não (inclui faturas em aberto no mês do vencimento). |
| **Estorno** | Transação com valor negativo: inverte o efeito do tipo (ex.: despesa negativa no cartão reduz a fatura). |
| **Anotação** | Lista simples de observações e lembretes do perfil. |
| **Anexo** | Arquivo de uma transação (foto de recibo, PDF de nota fiscal). |

---

## 3. Entidades e campos (o que os formulários e listas mostram)

Limites vêm do schema; use-os para dimensionar campos e truncamentos.

### Perfil
- Nome (até 45 caracteres)
- Tipo: Pessoal | Empresarial
- Moeda (código ISO de 3 letras, ex.: BRL, USD)

### Sócio *(só perfil empresarial)*
- Nome (até 100)
- Participação % (0–100; a soma dos sócios do perfil deve dar 100)

### Conta
- Nome (até 45)
- Tipo: Corrente | Investimentos
- Saldo inicial (o que a conta já tinha antes do primeiro mês registrado; padrão 0)
- Moeda (rótulo; só informativo)
- "Considerar no saldo total" (liga/desliga — usado para contas no exterior que não
  devem entrar no consolidado)
- Exibidos (calculados): **saldo consolidado** e **saldo previsto** do mês corrente

### Cartão de crédito
- Nome (até 45)
- Conta que paga as faturas
- Limite (R$)
- Dia de fechamento (1–31)
- Dia de vencimento (1–31)

### Fatura *(gerada pelo sistema, uma por mês)*
- Cartão, mês/ano
- Total a pagar (mostrado em módulo)
- Status: **Em aberto** | **Paga** (com o mês do extrato em que foi paga)
- Transações da fatura

### Extrato *(gerado pelo sistema, um por conta por mês)*
- Conta, mês/ano
- Saldo inicial e final — **consolidado** e **previsto** (4 números)
- Transações do mês, transferências que chegam, faturas pagas no mês

### Transação
| Campo | Observação |
|---|---|
| Tipo | Receita, Despesa, Transferência, Investimento |
| Nome | obrigatório, até 100 |
| Descrição | texto livre opcional |
| Valor | positivo por padrão; o usuário pode inverter o sinal (estorno/devolução) |
| Data de vencimento | obrigatória |
| Pago? + data de pagamento | os dois andam juntos |
| Encargos | juros/tarifas sobre o valor (padrão 0) |
| Conta **ou** fatura | sempre exatamente um: transação de conta cai num extrato, de cartão cai numa fatura |
| Conta de destino | só Transferência e Investimento |
| Subcategoria | obrigatória (mostrar como "Categoria › Subcategoria") |
| Tags | várias |
| Meta | opcional |
| Sócio que pagou | só perfil empresarial, opcional |
| Moeda de origem + taxa de conversão | opcional, só registro; o valor já é digitado convertido para a moeda do perfil |
| Anexos | arquivos (recibos, PDFs) |
| Recorrência | indicador se a transação veio de uma regra (ex.: "3/12") |

### Recorrência
- Tipo: **Parcelado** | **Fixo**
- Frequência: Diária, Semanal, Mensal, Anual
- Parcelado: nº de parcelas + como ler o valor — **"Valor total"** (1.200 em 12x) ou
  **"Valor por parcela"** (12x de 100)
- Fixo: data de fim (opcional — sem fim)

### Categoria / Subcategoria / Tag
- Nome (até 45), único no perfil sem diferenciar maiúsculas.

### Meta
- Nome (até 45), valor-alvo, data-alvo (opcional)
- Progresso calculado: quanto já foi destinado / alvo, transações vinculadas

### Anotação
- Texto livre.

---

## 4. Regras de negócio que mudam a interface

Cada uma destas regras precisa aparecer no mockup de algum jeito.

1. **Dois saldos sempre lado a lado.** Contas e extratos mostram **consolidado** (já
   pago) e **previsto** (tudo lançado). A tela inicial mostra os dois sem abrir extrato.
2. **Contas fora do total.** Uma conta com "considerar no saldo" desligado aparece na
   lista, mas fora da soma consolidada — precisa de indicação visual.
3. **Fatura sugerida, mas escolhível.** Ao lançar despesa no cartão, o app **sugere** a
   fatura pela data da compra e pelo fechamento; o usuário pode trocar para qualquer
   fatura do mesmo cartão. Compra no dia do fechamento cai na fatura seguinte. Escolher
   uma fatura já paga a **reabre** (avisar).
4. **Pagar fatura.** Pagar vincula a fatura ao extrato do mês do pagamento. **Reabrir**
   desfaz o pagamento (o saldo da conta volta). **Pagamento parcial** é uma
   transferência de valor negativo dentro da fatura — aparece como uma linha na fatura.
5. **Fatura em aberto no previsto.** Fatura não paga entra no saldo previsto da conta no
   mês do **vencimento**.
6. **Sinal do valor.** O valor é digitado positivo; o tipo diz a direção. Há um controle
   para inverter o sinal (estorno/devolução). Estornos ficam na mesma subcategoria da
   compra.
7. **Transferência é uma linha só.** Sai da origem e entra no destino na mesma data;
   editar/excluir afeta as duas contas. Não conta como receita nem despesa no total do
   perfil.
8. **Parcelamento.** "Valor total" divide e joga a diferença do arredondamento na
   **primeira** parcela (R$ 1.000,00 em 3x = 333,34 + 333,33 + 333,33). O formulário
   deve mostrar a prévia das parcelas e em qual fatura/mês cada uma cai. Séries finitas
   aparecem inteiras logo após a criação; séries fixas sem fim aparecem 12 meses à
   frente.
9. **Editar/excluir transação recorrente pergunta o escopo:** **Somente esta** |
   **Esta e as futuras** | **Todas**. Se o conjunto incluir ocorrências **já pagas**,
   confirmar dizendo exatamente quantas e quais meses terão o saldo alterado (nada de
   aviso genérico).
10. **Histórico é editável.** Editar um mês passado recalcula aquele mês e todos os
    seguintes da conta.
11. **Cartão com fechamento em dia inexistente** (ex.: 31) fecha no último dia do mês.
12. **Perfil empresarial** ganha: cadastro de sócios, campo "quem pagou" na transação e
    relatórios por sócio (quanto cada um pagou × quanto deveria pela participação).
    Perfil pessoal não mostra nada disso.
13. **Meta**: barra de progresso calculada pelas transações vinculadas.

---

## 5. Inventário de telas

Os documentos de design ainda não detalham telas nem navegação; a lista abaixo é
derivada do domínio e dos papéis de cada plataforma **(proposta)**.

### 5.1 Celular — uso diário

| # | Tela | Conteúdo principal |
|---|---|---|
| M1 | **Início** | Seletor de perfil; saldo total consolidado e previsto do mês; lista de contas com os dois saldos; faturas abertas com vencimento próximo; botão de lançamento rápido sempre visível. |
| M2 | **Lançamento rápido** | Abre direto no valor (teclado numérico); tipo (Receita/Despesa/Transferência/Investimento); conta **ou** cartão; subcategoria (com recentes/favoritas); data (hoje por padrão); pago? Campos extras recolhidos ("Mais detalhes": descrição, tags, meta, encargos, moeda, anexo, sócio, repetir). |
| M3 | **Despesa no cartão** | Variante de M2: mostra a **fatura sugerida** com opção de trocar; aviso se a escolhida já estiver paga. |
| M4 | **Repetir / Parcelar** | Parcelado (nº, valor total × por parcela, prévia das parcelas) ou Fixo (frequência, fim opcional). |
| M5 | **Transações do mês** | Lista agrupada por dia; navegação mês anterior/seguinte; filtros (conta, cartão, categoria, tag, pago/pendente); indicação de recorrência ("3/12"), anexo e estorno. |
| M6 | **Detalhe da transação** | Todos os campos, anexos (miniaturas), ações editar/excluir/marcar como pago. |
| M7 | **Escopo da edição recorrente** | Folha inferior com as três opções e a confirmação detalhada quando há ocorrências pagas. |
| M8 | **Conta / Extrato** | Saldo inicial e final (consolidado e previsto) do mês, movimentos, navegação entre meses. |
| M9 | **Cartão / Fatura** | Fatura atual e próximas; total, fechamento, vencimento, limite usado; status; ações **Pagar**, **Pagamento parcial**, **Reabrir**. |
| M10 | **Metas** | Lista com barra de progresso, valor-alvo e data. |
| M11 | **Cadastros** | Contas, cartões, categorias/subcategorias, tags, sócios (empresarial), perfis, anotações. |
| M12 | **Dispositivos e sincronização** | Membros do grupo (nome, plataforma, último sync), "Adicionar dispositivo" (QR + código), "Entrar num grupo" (ler QR / digitar código), endereço manual, remover dispositivo, sair do grupo. |
| M13 | **Ajustes** | Bloqueio por biometria (opcional), exportar cópia do banco (folha de compartilhamento), lembrete de exportação, perfil e moeda. |

### 5.2 Desktop — análise

| # | Tela | Conteúdo principal |
|---|---|---|
| D1 | **Shell** | Barra lateral (Visão geral, Transações, Contas, Cartões, Relatórios, Metas, Cadastros, Dispositivos, Ajustes); seletor de perfil; seletor de período global; indicador de sincronização. |
| D2 | **Visão geral** | Cartões de KPI (consolidado, previsto, receitas e despesas do mês, faturas em aberto); evolução do saldo por mês; maiores categorias do mês. |
| D3 | **Transações** | Tabela densa: data, nome, categoria › subcategoria, conta/fatura, tags, valor, pago, recorrência, anexo. Ordenação, filtros combináveis, seleção múltipla, edição em painel lateral, menu de contexto, atalhos. |
| D4 | **Relatório por categoria** | Drill-down categoria → subcategoria → transações; comparação mês a mês (variação absoluta e %); gráfico + tabela equivalente. |
| D5 | **Fluxo mensal por conta** | Extratos encadeados: saldo inicial, entradas, saídas, faturas pagas, saldo final, consolidado × previsto. |
| D6 | **Impacto do cartão** | Por mês: faturas de cada cartão, em qual extrato foram pagas, peso no saldo da conta. |
| D7 | **Relatório por sócio** *(empresarial)* | Quanto cada sócio pagou × quanto deveria pela participação; diferença; transações sem sócio atribuído em linha própria. |
| D8 | **Relatório por tag** | Totais por tag no período, cruzando categorias. |
| D9 | **Metas** | Progresso, ritmo necessário até a data-alvo, transações vinculadas. |
| D10 | **Cadastros e Dispositivos** | Mesmo conteúdo de M11/M12 em layout de desktop (o desktop também pode convidar e mostrar QR). |

A lista definitiva de relatórios do desktop ainda é um passo pendente do projeto
(desktop-shell-design §6). D4–D8 são as perguntas citadas no README.

---

## 6. Fluxos para mockar de ponta a ponta

1. **Lançar despesa no celular em poucos toques** — M1 → M2 → salvar → volta com o
   saldo atualizado.
2. **Compra parcelada no cartão** — M3 → fatura sugerida → M4 "12x, valor total
   R$ 1.200,00" → prévia das 12 parcelas e das faturas → salvar.
3. **Pagar fatura** — M9 → Pagar (conta, data) → fatura vira "Paga em abr/2026" e o
   saldo consolidado da conta cai. Variante: pagamento parcial e reabrir.
4. **Editar uma assinatura que subiu de preço** — M6 → editar valor → M7 "Esta e as
   futuras" → confirmação.
5. **Excluir série com ocorrências pagas** — M7 "Todas" → confirmação: "3 ocorrências já
   pagas serão excluídas; os saldos de jan, fev e mar/2026 da Conta Nubank vão mudar."
6. **Parear o celular com o desktop** — Desktop D10 "Adicionar dispositivo" mostra QR e
   código de 8 caracteres com contagem regressiva de 5 min → celular M12 "Entrar num
   grupo" → lê QR → tela de progresso recebendo os dados → pronto.
7. **Análise no desktop** — D4 abre "Alimentação", desce para "Restaurantes", compara
   com o mês anterior e abre as transações.

---

## 7. Estados que precisam de tela

| Estado | Onde | O que mostrar |
|---|---|---|
| **Primeiro uso / vazio** | Celular e desktop | Criar perfil (nome, tipo, moeda) e a primeira conta (com saldo inicial) — **ou** "Entrar num grupo existente". |
| **Mês sem movimento** | Listas e extratos | Vazio com saldo inicial = final. |
| **Sincronizando** | Indicador global + M12/D10 | Discreto; "Sincronizado com *Notebook* agora". Só acontece com os dois apps abertos na mesma rede. |
| **Sessão recusada por versão** | M12/D10 | "Atualize o app no *iPhone* para sincronizar" — nomeia o aparelho. |
| **Relógio divergente** | M12/D10 | Recusa com orientação para acertar a hora. |
| **Entrar num grupo com dados locais** | Fluxo de pareamento | Exige descartar os dados locais explicitamente antes (confirmação forte). |
| **Convite expirado / 3 tentativas erradas** | Pareamento | Gerar novo convite. |
| **Rede bloqueia descoberta** | Pareamento | Opção de digitar o endereço local do outro aparelho. |
| **Conta revivida pela sincronização** | Aviso | "A conta X tinha sido excluída em outro aparelho, mas recebeu lançamentos aqui; ela foi restaurada." |
| **Ocorrência desvinculada da recorrência** | Aviso | Conflito raro de sincronização; as duas transações foram mantidas. |
| **Operação longa** | Tela cheia | Barra/animação de progresso para: atualização do banco (migration), recebimento dos dados no pareamento, primeira sincronização, importação de histórico, exportação. |
| **Erro na atualização do banco** | Tela cheia | Modo de erro com opção de restaurar o backup automático. |
| **Banco mais novo que o app** | Tela cheia | Bloqueio: "Atualize o app para abrir estes dados." |
| **App bloqueado** | Celular | Tela de biometria (opcional). |
| **Só um dispositivo** | Celular | Lembrete periódico para exportar uma cópia (não há backup em nuvem). |

---

## 8. Formatação

- Dinheiro em pt-BR: `R$ 1.234,56`; negativo `−R$ 1.234,56`. Fatura mostra o valor a
  pagar **em módulo**.
- Precisão por moeda (2 casas em BRL/USD).
- Datas `01/10/2026`; mês de referência `out/2026` ou `Outubro de 2026`.
- Cores de valor: receita/entrada e despesa/saída distinguíveis **sem depender só da cor**
  (sinal, ícone ou rótulo), por acessibilidade.
- Gráficos sempre com tooltip e uma **tabela equivalente** (exigência do design do
  desktop), funcionando em tema claro e escuro.

---

## 9. Direção visual **(proposta)**

Não há identidade visual definida no projeto. Sugestões coerentes com os objetivos:

- Tom **sóbrio e confiável**, de ferramenta pessoal — sem gamificação nem marketing.
- Números são o protagonista: tipografia com algarismos tabulares, valores alinhados à
  direita nas tabelas.
- **Celular:** ação de lançamento sempre a um toque; alvos de toque grandes; folhas
  inferiores para escolhas (categoria, fatura, escopo).
- **Desktop:** alta densidade de informação, barra lateral fixa, painéis redimensionáveis,
  tema claro e escuro desde o início.
- Consolidado × previsto com tratamento visual consistente nas duas plataformas (ex.:
  previsto em peso menor ou com rótulo "previsto").
- Indicador de privacidade/local-first discreto ("Dados só neste aparelho e nos seus
  dispositivos pareados").

---

## 10. Dados de exemplo para os mockups

**Perfil pessoal "Gustavo" — BRL**

| Conta | Tipo | Consolidado | Previsto | No total? |
|---|---|---|---|---|
| Nubank | Corrente | R$ 4.320,15 | R$ 1.870,40 | sim |
| Itaú | Corrente | R$ 1.250,00 | R$ 1.250,00 | sim |
| Tesouro Direto | Investimentos | R$ 18.400,00 | R$ 18.900,00 | sim |
| Wise (USD) | Corrente | R$ 2.100,00 | R$ 2.100,00 | **não** |

| Cartão | Paga com | Limite | Fecha | Vence | Fatura out/2026 |
|---|---|---|---|---|---|
| Nubank Roxinho | Nubank | R$ 8.000,00 | dia 3 | dia 10 | R$ 2.449,75 — em aberto |
| Itaú Click | Itaú | R$ 5.000,00 | dia 31 | dia 7 | R$ 612,30 — paga |

Categorias › subcategorias: Moradia › Aluguel, Condomínio, Energia · Alimentação ›
Mercado, Restaurantes, Delivery · Transporte › Combustível, App de transporte ·
Assinaturas › Streaming, Software · Compras › Eletrônicos, Vestuário · Saúde › Farmácia, Plano · Renda › Salário, Freelance ·
Investimentos › Aporte.

Tags: `viagem-floripa`, `reembolsável`, `presente`.

Transações de exemplo:

| Data | Nome | Tipo | Onde | Categoria | Valor | Situação |
|---|---|---|---|---|---|---|
| 01/10 | Salário | Receita | Nubank | Renda › Salário | R$ 9.500,00 | pago |
| 05/10 | Aluguel | Despesa | Nubank | Moradia › Aluguel | R$ 2.300,00 | pendente · fixa mensal |
| 06/10 | Supermercado Zona Sul | Despesa | Roxinho (fat. nov) | Alimentação › Mercado | R$ 487,32 | — |
| 08/10 | Notebook | Despesa | Roxinho | Compras › Eletrônicos | R$ 400,00 | parcela 3/12 |
| 09/10 | Estorno Uber | Despesa (negativa) | Roxinho | Transporte › App | −R$ 23,90 | estorno |
| 10/10 | Aporte Tesouro | Investimento | Nubank → Tesouro Direto | Investimentos › Aporte | R$ 500,00 | pendente |
| 12/10 | Netflix | Despesa | Itaú Click | Assinaturas › Streaming | R$ 55,90 | fixa mensal |

Metas: "Reserva de emergência" R$ 30.000,00 (62%) · "Viagem Floripa" R$ 4.000,00 até
15/01/2027 (35%).

**Perfil empresarial "Estúdio GO" — BRL**, sócios: Gustavo 60%, Ana 40%. Exemplo de
relatório por sócio: Gustavo pagou R$ 3.200,00 (deveria R$ 3.000,00, +R$ 200,00); Ana pagou
R$ 1.800,00 (deveria R$ 2.000,00, −R$ 200,00); R$ 150,00 sem sócio atribuído.

**Dispositivos:** "Notebook (Linux)", "iPhone de Gustavo", "Galaxy S23".

---

## 11. Fora do escopo dos mockups

- Login, cadastro de usuário, planos, pagamentos (não existem).
- Integração com bancos / open finance / importação automática de extratos.
- Backup em nuvem e sincronização pela internet (recusados por design).
- Widgets da tela inicial, extensões de compartilhamento e atalhos de voz (fora do
  escopo atual; se vierem, nunca escrevem direto nos dados).
- Detalhes da importação do histórico do app atual (ainda não modelada) — só a tela de
  progresso.

## 12. Fontes

- [README.md](../../README.md)
- [docs/plans/database-design.md](../plans/database-design.md) — entidades e regras de negócio
- [docs/plans/backend-design.md](../plans/backend-design.md) — dinheiro, arredondamento, abertura do banco
- [docs/plans/sync-design.md](../plans/sync-design.md) — pareamento, sessões, conflitos
- [docs/plans/desktop-shell-design.md](../plans/desktop-shell-design.md) — papel do desktop, tabelas, gráficos
- [docs/plans/mobile-shell-design.md](../plans/mobile-shell-design.md) — papel do celular, desempenho, exportação, biometria

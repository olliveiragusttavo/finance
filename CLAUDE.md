# Regras de trabalho neste projeto

## Projeto

Monorepo pnpm em TypeScript estrito (Node 24) de finanças pessoais: núcleo compartilhado + app desktop (Electron) + app mobile (React Native), com sincronização entre dispositivos.

- `packages/core` — núcleo em camadas Request → Controller → Service → Repository → Model, com domínio puro (`Money`, `LocalDate`, `Invoice`...) e portas (`Database`, `Clock`, `IdGenerator`) implementadas em `infrastructure/`. As fronteiras entre camadas são verificadas pelo `eslint.config.js`.
- `packages/sqlite-better` — adaptador `better-sqlite3` da porta `Database`.
- `docs/plans/` — designs e planos aprovados (banco, backend, sync, shells, MVP desktop). Consulte o documento do módulo antes de alterá-lo; as regras de negócio estão lá.

Comandos (na raiz):

- `pnpm check` — lint + typecheck + testes; rodar antes de dar uma entrega por concluída.
- `pnpm test`, `pnpm typecheck`, `pnpm lint` — etapas isoladas.
- `pnpm embed:migrations` — regenerar após criar/alterar migration em `db/migrations`, porque o mobile usa as migrations embutidas.

## Idioma

- PT-BR com acentuação correta em mensagens de commit, comentários, docblocks e documentação.
- Identificadores de código (tipos, classes, funções, variáveis, arquivos) em inglês.

## Padrão de código — obrigatório

Todo código implementado, corrigido ou refatorado deve seguir este padrão, não apenas "funcionar":

- **Tipagem estrita:** sem `any`, sem `as` para silenciar o compilador; tipos marcados (`Brand`) para ids e valores que não podem se misturar.
- **Contratos explícitos:** validação de entrada com schemas zod em `requests/`, DTOs de resposta em `dto/` e Value Objects no domínio, em vez de objetos soltos e tipos primitivos.
- **Imutabilidade:** propriedades `readonly`; operações retornam novas instâncias em vez de mutar.
- **Desacoplamento da infraestrutura:** domínio e services dependem só de portas; implementações concretas entram apenas pela raiz de composição (`createCore`).
- **Design Patterns** quando resolvem um problema real (Strategy, Repository, Factory...), nunca por enfeite.
- **Testes:** toda regra de negócio nova ou alterada ganha teste Vitest em `packages/<pacote>/test`.

## Docblock com motivação — obrigatório

Toda função, método, classe e tipo criado ou editado (inclusive privados, closures nomeadas, helpers de teste e migrations) tem docblock JSDoc. Ao editar, atualize o docblock se a motivação mudou.

- **Explique o porquê, não o quê:** o problema que resolve, a invariante que protege, a falha que evita ou por que a alternativa óbvia foi descartada. O que o código faz se lê no próprio código.
- **Regra de negócio é citada explicitamente**, com domínio e regra (ex.: `// Regra de negócio (Relatórios): todo valor conta no mês do pagamento`), referenciando a seção do design em `docs/plans/` quando houver.
- **`@param nome Descrição`** para todo parâmetro: o que é e por que a função precisa dele. Não repita o tipo — a assinatura TS já o declara.
- **`@return`** sempre que a função retornar algo: o que vem e em que situação (ex.: quando pode ser `null` ou vazio). Funções `void` dispensam.
- **`@throws`** quando a função lançar erro de forma intencional.

```ts
/**
 * Calcula o saldo do extrato a partir da fatura paga, e não da data da compra, porque o
 * relatório precisa refletir quando o dinheiro de fato saiu da conta.
 * Regra de negócio (Relatórios): compras no cartão contam no extrato em que a fatura foi paga.
 *
 * @param invoice Fatura cujo pagamento define o mês em que as compras entram no extrato.
 * @param statement Extrato de destino; fornece o saldo de abertura sobre o qual o valor é somado.
 * @return O novo extrato com o saldo atualizado; o original não é alterado.
 * @throws InvoiceNotPaidError Quando a fatura ainda não foi paga e não tem mês de pagamento.
 */
```

## Formatação — sem espaços de alinhamento

Siga o `.editorconfig`: 4 espaços por nível (2 em YAML), nunca tab. **Não alinhe código em colunas** com espaços extras — nem `=`, nem `:` de objetos, nem descrições de `@param`, nem comentários de fim de linha. Em docblock, a continuação de uma linha longa começa logo após o ` * `.

**Por quê:** o alinhamento quebra quando entra um nome mais longo e obriga a reformatar as linhas vizinhas, sujando o diff e escondendo a alteração real no review.

```ts
// Errado
const companyId   = request.companyId;
const workareaId  = request.workareaId;

// Certo
const companyId = request.companyId;
const workareaId = request.workareaId;
```

## Telas — mockups como referência

**Antes de criar ou alterar qualquer tela** (desktop ou mobile), leia `docs/design/mockups/README.md` e o mockup correspondente em `docs/design/mockups/screens/`.

- Os mockups são a referência de layout, conteúdo e navegação — não código para copiar.
- Desktop: Tailwind + shadcn/ui. Mobile: NativeWind. Cores, tipografia e espaçamentos só a partir de `packages/tokens` (nunca valor literal).
- Siga as "Decisões de interface" do README dos mockups; se a implementação precisar divergir de um mockup, pergunte antes.

**Por quê:** as telas já foram aprovadas e as decisões de interface (tema claro/escuro, mês de referência fixo, entrada/saída sem depender só da cor) valem para todas; ignorá-las gera retrabalho e inconsistência entre desktop e celular.

## Git

- **Commit:** pelo comando `/commit` (`.claude/commands/commit.md`), que monta a mensagem em Conventional Commits/PT-BR e só commita após pedido explícito do usuário.
- Nunca rode `git add` por conta própria; o usuário decide o que vai para o stage.
- `push`/`merge` exigem confirmação própria e separada — autorizar o commit não autoriza o push.
- Fluxos que dependem de interação com o usuário (validação, commit) rodam na conversa principal, nunca como sub-agente: o sub-agente não consegue perguntar nem confirmar nada.

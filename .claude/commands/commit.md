---
description: Lê o diff staged e monta a mensagem de commit (Conventional Commits, PT-BR) para o usuário aprovar.
argument-hint: "[contexto opcional, ex.: issue #17 ou motivo da alteração]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*)
disable-model-invocation: true
---

Monte a mensagem de commit das alterações **staged**, no padrão Conventional Commits e em PT-BR, e apresente-a ao usuário. Siga também as convenções do `CLAUDE.md`.

Contexto extra informado pelo usuário (pode estar vazio): $ARGUMENTS

## Estado do repositório (coletado agora)

- Branch: !`git branch --show-current`
- Status: !`git status --porcelain`
- Arquivos staged: !`git diff --cached --name-status`
- Tamanho do diff: !`git diff --cached --stat`
- Últimos commits (referência de estilo e escopo): !`git log --oneline -10`

## Regras de execução

- **Nada staged:** avise o usuário e pare. Nunca rode `git add`. Quem decide o que entra no commit é o usuário.
- **Leitura do diff:** com base no `--stat` acima, leia o conteúdo com `git diff --cached`. Se o diff for grande (dezenas de arquivos ou milhares de linhas), leia por arquivo (`git diff --cached -- <arquivo>`), priorizando código-fonte sobre lockfiles e arquivos gerados.
- **Escopos distintos** (ex.: um fix + uma feature sem relação): não decida sozinho. Monte a melhor mensagem única e, ao apresentá-la, proponha a divisão em commits separados (quais arquivos em cada um).
- **Branch com número de issue** (ex.: `16-desktop-app`): considere `Refs #16` no rodapé quando fizer sentido.

## Formato da mensagem

```
<tipo>(<escopo>): <descrição no imperativo>

- <Bullet 1>
- <Bullet 2>

[Refs #N | Closes #N | BREAKING CHANGE: ...]
```

**Idioma:** a mensagem inteira em PT-BR, com acentuação correta. Só as palavras-chave (`feat`, `fix`, `BREAKING CHANGE`...) e os identificadores de código ficam no original.

**Tipos:**

| Tipo | Quando usar |
|------|-------------|
| `feat` | Nova funcionalidade |
| `fix` | Correção de bug |
| `refactor` | Refatoração sem mudança de comportamento |
| `perf` | Melhoria de desempenho |
| `style` | Formatação/lint, sem mudança de lógica |
| `test` | Adição ou correção de testes |
| `docs` | Documentação, planos, designs, comentários |
| `chore` | Configuração, dependências, ambiente de desenvolvimento |
| `build` | Sistema de build e empacotamento |
| `ci` | Pipelines de CI/CD |
| `revert` | Reversão de commit anterior |

**Escopo:** o pacote ou módulo afetado, reaproveitando os já usados no histórico (`core`, `desktop`, `mobile`, `database`, `backend`, `sync`, `design`, `devcontainer`...). Omita quando a alteração for transversal.

**Título:**
- Imperativo em PT-BR, minúsculo após os dois-pontos: "adiciona", "corrige", "remove", "atualiza"
- No máximo 72 caracteres, sem ponto final

**Corpo:**
- Separado do título por **uma linha em branco**
- Sempre em lista com `- `, nunca em parágrafo corrido; um único nível, sem sub-bullets
- Cada bullet começa com verbo no presente com inicial maiúscula ("Adiciona", "Implementa", "Remove") e descreve **um** aspecto da alteração
- Cite os nomes reais de arquivos, classes, funções e tipos entre crases (ex.: `InvoiceService`)
- Explique o **porquê** quando ele não for óbvio (o que resolve, qual regra de negócio atende), não o "como"
- Bullets sem ponto final
- Omita o corpo só quando a alteração for trivial e o título bastar (ex.: correção de digitação em um único arquivo)

**BREAKING CHANGE:** `!` após o tipo/escopo (`feat(core)!:`) e/ou rodapé `BREAKING CHANGE: <o que quebra>`.

## Exemplos do próprio repositório

Replique este padrão (commits `dd74d3e` e `1fbddf6`):

```
chore(devcontainer): adiciona ambiente de desenvolvimento em Docker

- Adiciona `.devcontainer/Dockerfile` com Node 24 (Debian completo, por causa do módulo nativo `better-sqlite3`), as bibliotecas do Chromium/Electron e o pnpm via corepack
- Adiciona `.env.example` com `CLAUDE_CODE_OAUTH_TOKEN`, para o Claude Code entrar autenticado no container após cada rebuild
- Ignora `.env` e `.devcontainer/.env` no `.gitignore` para não versionar segredos nem o GID gerado por máquina
```

```
docs(desktop): adiciona plano do MVP desktop com CRUD e primeiros relatórios

- Adiciona `docs/plans/desktop-mvp-plan.md` com escopo, decisões e lista de tarefas em 15 fases, espelhadas nas issues #17 a #31
- Define a regra-mestra dos relatórios: todo valor conta no mês do pagamento, com compras no cartão no extrato em que a fatura foi paga
- Fecha a escolha de electron-vite, electron-builder, TanStack Router e Recharts, pendente no `desktop-shell-design.md`

Refs #15, #16
```

## Entrega

1. Apresente a mensagem em um bloco de código, seguida (se houver) do aviso de divisão em commits separados.
2. **Pare e aguarde.** Não execute o commit sem um pedido explícito do usuário depois de ele ver a mensagem.
3. Se o usuário aprovar, faça o commit com a mensagem exata via heredoc (`git commit -F - <<'EOF' ... EOF`), incluindo o rodapé `Co-Authored-By` de atribuição, como nos commits anteriores. Nunca use `--no-verify` nem `--amend` sem pedido explícito; se um hook falhar, mostre o erro e pare.
4. `push`/`merge` exigem confirmação própria e separada. Aprovar o commit não autoriza o push.

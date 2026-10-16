---
description: Revisa as alterações staged em busca de bugs e violações do CLAUDE.md, sugere a correção de cada problema e grava o relatório em .claude/code-review/<branch>.md.
argument-hint: "[foco opcional, ex.: regras de fatura ou performance da grade]"
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git blame:*), Bash(git show:*), Bash(git branch:*), Bash(git rev-parse:*), Bash(date:*), Read, Grep, Glob, Agent, Write
disable-model-invocation: true
---

Faça o code review das alterações **staged** (e somente delas), no mesmo espírito do `/code-review` nativo do Claude Code: revisores independentes em paralelo, verificação de cada achado para descartar falsos positivos e só problemas de alta confiança no resultado. A diferença: **cada problema vem acompanhado de uma sugestão concreta de solução**, e o relatório é gravado em `.claude/code-review/<branch>.md`.

Foco extra informado pelo usuário (pode estar vazio): $ARGUMENTS

## Estado do repositório (coletado agora)

- Branch: !`git branch --show-current`
- Commit base: !`git rev-parse --short HEAD`
- Arquivos staged: !`git diff --cached --name-status`
- Tamanho do diff: !`git diff --cached --stat`
- Data: !`date '+%Y-%m-%d %H:%M'`

## Regras de execução

- **Nada staged:** avise o usuário e pare. Nunca rode `git add`, `git stash`, `git checkout` nem qualquer comando que altere o stage ou a árvore de trabalho.
- **Só o staged conta:** o arquivo no disco pode ter alterações não staged que não fazem parte da review. Leia o diff com `git diff --cached` e o conteúdo completo de um arquivo na versão staged com `git show :<caminho>` — nunca com `Read` no arquivo do disco. Números de linha do relatório referem-se à versão staged.
- **Não corrija nada:** a review só aponta e sugere. O único arquivo que este comando escreve é o relatório em `.claude/code-review/`.
- **Diff grande** (dezenas de arquivos ou milhares de linhas): leia por arquivo (`git diff --cached -- <arquivo>`), priorizando código-fonte sobre lockfiles, migrations embutidas e arquivos gerados.

## Passo 1 — Contexto

1. Liste os arquivos de instrução que se aplicam: o `CLAUDE.md` da raiz e qualquer `CLAUDE.md` em diretórios que contenham arquivos staged.
2. Identifique os documentos de `docs/plans/` dos módulos tocados (as regras de negócio estão lá) e, se o diff mexer em telas, `docs/design/mockups/README.md` e o mockup correspondente.
3. Escreva um resumo curto (3 a 6 linhas) do que o diff staged faz. Ele será repassado aos revisores.

## Passo 2 — Revisores em paralelo

Dispare **em uma única mensagem** os quatro sub-agentes abaixo (`Agent`, tipo `general-purpose`), para rodarem em paralelo. Passe a cada um: o resumo do passo 1, a lista de arquivos staged, os caminhos dos `CLAUDE.md` e dos documentos relevantes, o foco extra do usuário e as regras "Só o staged conta" e "Não corrija nada" acima.

1. **Conformidade com o CLAUDE.md:** confere o diff contra as regras do projeto — tipagem estrita (sem `any`, sem `as` para silenciar), contratos (zod em `requests/`, DTOs em `dto/`, Value Objects), imutabilidade, fronteiras de camadas e portas, docblock com motivação (`@param`, `@return`, `@throws`, regra de negócio citada), testes para regra nova, idioma PT-BR com acentuação, formatação sem alinhamento em colunas, mockups/tokens em telas. Só aponte violação de regra que esteja **escrita** no CLAUDE.md, citando o trecho.
2. **Bugs no diff:** leitura focada nas linhas alteradas em busca de bugs evidentes — lógica invertida, casos de borda (lista vazia, `null`, fim de mês, fuso, arredondamento de `Money`), erros não tratados, condições de corrida, vazamento de recursos. Não especule além do diff.
3. **Bugs no contexto:** lê os chamadores, os chamados, os testes e o documento de `docs/plans/` do módulo para achar quebras que o diff isolado não mostra — contrato alterado sem atualizar quem usa, invalidação de cache faltando, regra de negócio do plano contrariada, migration sem `pnpm embed:migrations`, teste que deixou de cobrir o caso.
4. **Histórico e comentários:** usa `git log` e `git blame` nas regiões alteradas e lê os comentários e docblocks do código ao redor, procurando alterações que reintroduzem um bug já corrigido, desfazem uma decisão registrada ou contrariam uma instrução deixada em comentário.

Cada revisor devolve uma lista de achados, cada um com: arquivo, linha (na versão staged), categoria, descrição do problema, evidência (trecho de código ou regra citada) e o cenário concreto em que falha. **Cada achado já vem com uma sugestão de solução**, conforme o passo 4.

## Passo 3 — Verificação

Para cada achado, dispare um sub-agente de verificação (em paralelo, em uma única mensagem) que tenta **refutar** o achado lendo o código staged e atribui uma confiança de 0 a 100:

- 0: falso positivo que não resiste a uma leitura atenta, ou problema pré-existente.
- 25: talvez real, mas não verificado; se for de estilo, não está escrito no CLAUDE.md.
- 50: real, mas um detalhe pouco relevante na prática.
- 75: muito provavelmente real e com impacto; ou violação direta de regra escrita no CLAUDE.md.
- 100: confirmado, com cenário de falha reproduzível pela leitura do código.

Descarte achados com confiança **abaixo de 80** e una duplicados. Também são falsos positivos, mesmo com confiança alta:

- Problemas em linhas que não foram alteradas no stage, ou que já existiam antes dele.
- O que o `pnpm lint` ou o `pnpm typecheck` acusariam sozinhos (import faltando, tipo errado, formatação).
- Preferências de estilo e "nitpicks" que um engenheiro sênior não levantaria, quando não estão escritos no CLAUDE.md.
- Alterações intencionais de comportamento que o próprio diff ou o plano em `docs/plans/` justificam.
- Trechos silenciados de propósito no código (ex.: comentário de `eslint-disable` com motivo).

## Passo 4 — Sugestão de solução

Todo achado que sobreviver à verificação precisa de uma sugestão de solução **concreta e aplicável**, não genérica ("trate o caso de borda" não serve):

- Mostre o código sugerido em um bloco `diff` (linhas `-`/`+`) contra a versão staged, ou um trecho de código completo quando a mudança for estrutural.
- O código sugerido segue o padrão do CLAUDE.md: tipagem estrita, `readonly`, docblock com motivação nos símbolos criados ou editados, sem alinhamento em colunas, identificadores em inglês e comentários em PT-BR.
- Quando a correção exigir um teste novo, inclua o esboço do teste Vitest e o caminho em `packages/<pacote>/test`.
- Se houver mais de uma solução razoável, indique a recomendada e cite a alternativa em uma linha, com o motivo da escolha.

## Passo 5 — Relatório

Monte o nome do arquivo a partir da branch: substitua `/` e qualquer caractere fora de `[A-Za-z0-9._-]` por `-`. Em HEAD destacado (branch vazia), use `detached-<commit base>`. Grave em `.claude/code-review/<nome>.md` com `Write`, sobrescrevendo a review anterior da mesma branch.

Use este formato, com os achados ordenados do mais grave para o menos grave:

````markdown
# Code review — <branch>

- **Data:** <data>
- **Commit base:** <commit base>
- **Escopo:** alterações staged (<N> arquivos, +<adições> −<remoções>)
- **Foco extra:** <foco do usuário ou "nenhum">

## Resumo

<3 a 6 linhas sobre o que o diff faz e a avaliação geral.>

## Problemas encontrados

### 1. <título curto do problema>

- **Arquivo:** `<caminho>:<linha>`
- **Categoria:** <bug | regra de negócio | CLAUDE.md | testes | segurança | performance>
- **Severidade:** <alta | média | baixa>
- **Confiança:** <80–100>

**Problema:** <o que está errado e por quê, citando a regra do CLAUDE.md ou de `docs/plans/` quando for o caso.>

**Cenário de falha:** <entrada ou estado concreto → resultado errado.>

**Sugestão de solução:** <explicação curta da correção.>

```diff
- <código atual>
+ <código sugerido>
```

---

### 2. ...

## Arquivos revisados

- `<caminho>` — <A | M | D | R>
````

Se nenhum achado sobreviver, grave o relatório mesmo assim, com a seção "Problemas encontrados" contendo apenas: `Nenhum problema encontrado. Verificado: bugs no diff e no contexto, conformidade com o CLAUDE.md e histórico.`

## Entrega

1. Informe o caminho do relatório gravado.
2. Liste na conversa, em uma linha cada, os problemas encontrados (`arquivo:linha` — título — severidade), sem repetir o conteúdo completo do relatório.
3. **Não aplique as sugestões.** Pergunte ao usuário se ele quer que alguma seja aplicada; só altere código após pedido explícito.

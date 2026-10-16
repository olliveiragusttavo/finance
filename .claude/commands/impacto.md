---
description: Mapeia o raio de impacto de um símbolo ou arquivo com o graphify, para planejar uma refatoração.
argument-hint: "<símbolo ou arquivo> [segundo símbolo, para ver o caminho entre os dois]"
allowed-tools: Bash(graphify update:*), Bash(graphify affected:*), Bash(graphify path:*), Bash(graphify explain:*)
disable-model-invocation: true
---

Levante o impacto de uma refatoração usando o graphify, instalado no devcontainer. O grafo é só um ponto de partida para a análise: o código e os documentos em `docs/plans/` continuam sendo a fonte da verdade.

Alvo informado pelo usuário: $ARGUMENTS

## Passos

1. Atualize o grafo com `graphify update .` na raiz do repositório. A atualização é incremental, local e não usa LLM. Na primeira vez em um container novo, ela gera o grafo inteiro.
2. Com **um** alvo, rode `graphify affected "<alvo>" --depth 2`. Com **dois**, rode também `graphify path "<alvo 1>" "<alvo 2>"`. Use `graphify explain "<alvo>"` só se o nome for ambíguo e for preciso saber qual nó é qual.
3. Se o resultado passar de uns 40 arquivos (tipos centrais como `Money`, `YearMonth` ou `ProfileId`), refaça com `--depth 1` e avise que o símbolo é central demais para um raio transitivo ser útil.
4. Confira no código as ligações marcadas como `INFERRED` antes de contar com elas, porque o graphify as deduz e pode errar (por exemplo, ligações de documento para código baseadas só no nome).

## Restrições

- Consulte o grafo **apenas** pelo CLI. Não leia `graph.json`, `graph.html`, `GRAPH_REPORT.md` nem nada em `$GRAPHIFY_OUT` (`/home/node/.cache/graphify`): são arquivos de vários MB que lotariam o contexto. A leitura direta pede confirmação ao usuário por uma regra em `.claude/settings.json`.
- Não rode `graphify install`, `graphify claude install` nem `graphify hook install`: eles colocariam o grafo no contexto ou no fluxo de toda sessão, e o projeto decidiu usá-lo só sob demanda.

## Resposta

Apresente, agrupados por pacote (`core`, `client`, `desktop`...), os arquivos afetados e a relação de cada um com o alvo (importa, chama, implementa...). Destaque o que cruza fronteiras de camada ou de pacote e o que ainda não foi conferido no código.

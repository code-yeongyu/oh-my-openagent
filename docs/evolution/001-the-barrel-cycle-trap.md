# Evolution Report 001: The Barrel-Cycle Trap & Base Layer Extraction

## 1. O Desafio Inicial (Contexto Histórico)
O Oh-My-OpenAgent estava sofrendo de instabilidade arquitetural profunda. Uma varredura revelou que o arquivo `src/shared/index.ts` havia se tornado um "God Node" (um ponto único de falha e congestionamento). Esse funil central gerou mais de 99 cadeias de dependência circular (Circular Dependencies). Sempre que uma ferramenta de baixo nível importava o logger de `shared/index.ts`, ela carregava acidentalmente a árvore inteira de módulos de alto nível (incluindo migrações e configs de agentes), causando travamentos silenciosos em tempo de execução.

## 2. A Falha e suas Causas
- **Causa Raiz:** Arquivos de utilidade pura, que não deveriam ter dependências (como `logger.ts` e `errors.ts`), estavam acoplados à lógica complexa de negócio dentro do mesmo "barrel file".
- **O Epicentro (Ciclo 4):** A função de migração `shouldDeleteAgentConfig` em `src/shared/migration/agent-category.ts` precisava das categorias padrão do sistema. Para evitar importações estáticas que quebravam o código, a solução temporária (e perigosa) foi usar um `require()` dinâmico no meio da execução. Isso cruzava a barreira arquitetural de forma ilegal e mantinha o ciclo ativo.

## 3. Soluções Propostas e a Decisão
1. **Remoção Simples do Index:** Apenas parar de exportar tudo do arquivo central. (Rejeitada: causaria quebra em cascata sem resolver o acoplamento real).
2. **Leaf-First Decoupling (ADR-001):** Extrair utilitários absolutos para uma nova "Base Layer" cega (`src/shared/base/`) que nunca pode importar de fora dela mesma. Simultaneamente, aplicar Injeção de Dependência (DI) no Ciclo 4. (Aprovada: Solução sistêmica e definitiva, padrão "Engenharia de Elite").

## 4. A Execução e o Saneamento
A cirurgia ocorreu em várias frentes simultâneas:
1. **Base Layer:** `logger.ts` foi extraído de `shared/` e confinado em `shared/base/`.
2. **Injeção de Dependência:** Reescrevemos a assinatura de `shouldDeleteAgentConfig` para aceitar `DEFAULT_CATEGORIES` como um argumento puro, removendo o `require()` e quebrando fisicamente o ciclo.
3. **Cirurgia de Massa:** Lançamos o sub-agente `@generalist` para reescrever os imports de logger em mais de 170 arquivos do projeto.
4. **Resgate do Tmux:** O `typecheck` revelou que 8 utilitários do Tmux usavam imports dinâmicos (`await import("../../logger")`) que o agente não detectou. Eles foram corrigidos manualmente via substituição por linha de comando.

## 5. Dificuldades Encontradas (O Atrito)
- **A Corrupção da Linha 1533:** A maior dificuldade não foi a arquitetura, mas a mecânica. Durante a reescrita em massa dos 170 arquivos, o motor de substituição engasgou no `src/shared/migration.test.ts`. O final do arquivo foi corrompido, gerando linhas duplicadas a partir da linha 1533, o que causou o colapso do compilador do Bun.
- **A Solução "Head":** Para salvar a Árvore de Sintaxe Abstrata (AST) do arquivo de testes, tivemos que recorrer à amputação literal via shell (`head -n 1532`), cortando fisicamente o arquivo logo após a última chave de fechamento válida.

## 6. O Desfecho e Aprendizado
- Os 84 testes de migração passaram integralmente e o `bun run typecheck` finalizou com `0 errors`. O repositório atingiu o grau "Clean PR".
- **Aprendizado Crucial:** Documentar o atrito técnico (como a corrupção sintática e as falhas de cache) provou ser tão valioso quanto o código final. Esses registros não apenas blindam a IA contra repetição de erros, mas servem como alicerce literário (combustível narrativo) para a geração das "Chronicles" Gibsonianas do projeto.

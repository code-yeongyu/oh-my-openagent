# Sovereign Upstream Hard Gate Protocol (USP)

## Visão Geral
Este protocolo define o "Portão Rígido" (Hard Gate) para submissões ao repositório público (Upstream). Ele garante a separação total entre o **Sovereign Fork** (onde reside a inteligência estratégica e arquitetural) e o **Public Upstream** (onde reside apenas o código de produção).

## Arquivos Proibidos (Sovereign-Only)
Os seguintes itens **NUNCA** devem cruzar a fronteira para o upstream:
- `docs/process/sentinel-log.md` (Log histórico de decisões)
- `docs/superpowers/specs/` (Especificações de superpoderes do agente)
- `.sisyphus/` (Espaço de trabalho do agente)
- `implementation_plan.md`, `task.md`, `walkthrough.md` (Planos de sessão)
- `.gemini/` (Dados de aplicação da IA)
- `graphify-out/` (Caches de diagramação)

## O Fluxo de Extração
Para enviar uma mudança para o upstream, siga este processo:

1.  **Branch de Extração**: Crie uma branch com o prefixo `upstream-pr/`.
    ```bash
    git checkout -b upstream-pr/minha-feature
    ```
2.  **Surgical Selection**: Limpe a branch e faça checkout apenas do necessário.
    ```bash
    git fetch upstream
    git reset --hard upstream/dev
    git checkout feature-branch-original -- src/ AGENTS.md package.json
    ```
3.  **Auditoria Local**: Execute o script de auditoria.
    ```bash
    ./script/audit-upstream.sh
    ```
4.  **Push**: Apenas se a auditoria retornar ✅, faça o push.

## Script de Automação
O script `./script/audit-upstream.sh` realiza a comparação da branch atual contra `upstream/dev` (ou outra base especificada) e bloqueia o processo se detectar padrões proibidos.

---
**Status**: Operacional | **Dono**: Senior AI Architect (EmiyaKiritsugu)

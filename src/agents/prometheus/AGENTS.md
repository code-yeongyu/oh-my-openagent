# src/agents/prometheus/ -- Strategic Planner

**Generated:** 2026-04-11

## OVERVIEW

11 files. Prometheus agent -- interview-mode strategic planner. Reads codebase, questions user, builds detailed work plan before any code is written. Markdown-only output (enforced by `prometheus-md-only` hook).

## FILES

| File | Purpose |
|------|---------|
| `system-prompt.ts` | Composes full system prompt from sections |
| `identity-constraints.ts` | FORBIDDEN actions, .md-only enforcement, path restrictions |
| `interview-mode.ts` | Interview flow: gather requirements, clarify scope |
| `plan-generation.ts` | Plan output structure and validation |
| `plan-template.ts` | YAML plan template with task graph, dependencies, waves |
| `behavioral-summary.ts` | Behavioral guidelines section |
| `high-accuracy-mode.ts` | Enhanced accuracy mode for complex plans |
| `gemini.ts` | Gemini-optimized prompt variant |
| `gpt.ts` | GPT-optimized prompt variant |
| `index.ts` | Barrel exports |

## KEY CONSTRAINTS

- May ONLY create/edit `.md` files (enforced by hook)
- FORBIDDEN paths: `src/`, `package.json`, config files
- Must explore codebase before planning (NEVER plan blind)
- Plans saved to `.sisyphus/plans/`
- Acceptance criteria requiring "user manually tests" are FORBIDDEN

## PLAN OUTPUT FORMAT

Plans use YAML with parallel task graph:
- Waves (parallel execution groups)
- Tasks with dependencies, category, skills
- Each task has atomic scope + verification criteria

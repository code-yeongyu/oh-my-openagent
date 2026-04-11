# src/agents/hephaestus/ -- Autonomous Deep Worker

**Generated:** 2026-04-11

## OVERVIEW

6 files. Hephaestus agent -- autonomous deep worker powered by GPT-5.4. Goal-oriented: give it objectives, not step-by-step instructions. "The Legitimate Craftsman."

## FILES

| File | Purpose |
|------|---------|
| `agent.ts` | `createHephaestusAgent()` factory, model-variant routing |
| `gpt.ts` | Base GPT prompt: discipline rules, delegation, verification |
| `gpt-5-4.ts` | GPT-5.4-native prompt with XML-tagged blocks, entropy-reduced |
| `gpt-5-3-codex.ts` | GPT-5.3 Codex variant with task discipline sections |
| `index.ts` | Barrel exports |

## KEY BEHAVIORS

- Mode: `primary` (respects UI model selection)
- Requires OpenAI-compatible provider (no fallback chain)
- NEVER trusts subagent self-reports -- always verifies
- NEVER uses `background_cancel(all=true)`
- Delegates exploration to background agents, never sequential
- Uses `run_in_background=true` for explore/librarian

## MODEL VARIANTS

| Model | Prompt Source | Optimizations |
|-------|-------------|---------------|
| gpt-5.4 | `gpt-5-4.ts` | XML-tagged blocks, 8 sections |
| gpt-5.3-codex | `gpt-5-3-codex.ts` | Task discipline, 549 LOC prompt |
| Other GPT | `gpt.ts` | Base prompt, 507 LOC |

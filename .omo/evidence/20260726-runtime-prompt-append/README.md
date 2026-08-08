# Runtime model-aware prompt append QA

## What was tested

OpenCode 1.18.3 was driven through the real non-interactive CLI in an isolated XDG sandbox. The sandbox loaded this worktree's `dist/index.js`, registered a primary agent with the exact key `meidocho`, and applied the production Meidocho override:

- configured model: `openai/gpt-5.6-luna`
- conditional append: `file:///home/celestia/.config/opencode/CELESTIA.md`
- exclusion keywords: `claude`, `gpt`

The prompt asked for `CELESTIA_PRESENT` only when the system instructions identified the agent as Celestia, Xinghui, or 星绘. Two fresh first-message sessions were run:

```text
opencode run --agent meidocho --model opencode-go/glm-5.2 --format json <probe>
opencode run --agent meidocho --model openai/gpt-5.6-luna --format json <probe>
```

`agent-registration.txt` records the resolved agent identity and local plugin path.

## What was observed

- GLM runtime selection returned `CELESTIA_PRESENT`; exact stream: `glm.jsonl`.
- GPT runtime selection returned `CELESTIA_ABSENT`; exact stream: `gpt.jsonl`.
- No fallback warning was emitted in either valid run.
- Host OpenCode DB sessions remained `89` before and after.
- The isolated sandbox DB contained exactly two sessions, one per valid probe; see `isolation.txt`.

## Why it is enough

Both runs use the same registered agent and registration-time GPT model. Only the request-time model changes. The opposite observed answers prove that conditional `prompt_append` is reconciled from the actual request model rather than the registration model. The GLM run also proves the file-backed append was loaded into the real model-visible system prompt, while the GPT run proves the excluded append did not leak.

Unit regressions separately cover unconditional append preservation, provider-aware matching, display-name resolution, first-request default-agent capture, duplicate text, and compaction suppression.

## What was omitted

The isolated config copied provider credentials and auth state from the host solely into the temporary sandbox. Config dumps, auth files, environment dumps, API keys, and unrelated plugin logs are intentionally not included. The first invalid probe from an earlier sandbox was discarded because its agent was not registered and OpenCode fell back to the default agent.

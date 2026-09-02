# OpenCode QA evidence

## What was tested

- Built the repaired source and loaded the local plugin bundle into two OpenCode 1.18.26 servers.
- Isolated both servers with separate `HOME`, XDG data/config/state/cache roots, plugin config
  roots, authentication, and the same empty project directory.
- Queried the authenticated `/agent` API. The baseline had no disabled provider; the candidate
  configured `[opencode].disabled_providers` with only `openai-codex`.
- Queried `/experimental/tool/ids` to confirm that the tested plugin registered
  `call_omo_agent`, `task`, and `look_at`.

## What was observed

- Baseline Explore and Librarian selected `openai/gpt-5.6-luna-fast` with variant `low` from the
  first static entry, whose provider mirrors are `openai` and `openai-codex`.
- With only `openai-codex` disabled, both agents selected the next allowed entry,
  `deepseek/deepseek-v4-flash` with variant `max`.
- The server exposed 27 registered tools and included all three required plugin tools.
- The real OpenCode database moved from 73 to 74 sessions during concurrent workstation work,
  but an exact directory query found zero rows for every QA sandbox path. The new real row belonged
  to an unrelated project. Candidate and baseline isolated databases each contained zero sessions.
- Both server processes terminated cleanly.

## Why this is enough

The `/agent` response is the model configuration consumed by real OpenCode after plugin config
hooks run. The two isolated servers differed only in `disabled_providers`; the machine-consumed
model moved from the mirrored entry to its next allowed fallback. Focused tests separately drive
the actual tool registry plus `call_omo_agent`, delegation, `look_at`, Prometheus, and the runtime
fallback controller.

## What was omitted

Authentication headers, credentials, environment dumps, private provider configuration, and raw
machine-local paths were intentionally excluded. TUI smoke was unavailable because `tmux` is not
installed; the CLI/server surface required for this configuration behavior was exercised.

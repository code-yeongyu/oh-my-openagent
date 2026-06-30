# OpenCode Skill Loading QA

## What Was Tested

- Started `opencode serve` 1.17.8 in the `opencode-qa` isolated XDG sandbox.
- Created normal-path skills under isolated project `.agents/skills`, project `.claude/skills`, isolated OpenCode config `skills/`, and isolated home `.agents/skills`.
- Called the real OpenCode `GET /skill?directory=<isolated-project>` endpoint.
- Invoked OmO's patched native-skill adapter plus `skill` tool against that live endpoint.
- Invoked the delegate skill resolver with the same native-skill accessor.

## What Was Observed

- `opencode-health.json`: server reported `healthy: true`, version `1.17.8`.
- `opencode-skills.filtered.json`: OpenCode returned `customize-opencode`, `user-normal-skill`, `claude-normal-skill`, `config-normal-skill`, and `global-normal-skill`.
- `omo-skill-tool-output.json`: OmO loaded `user-normal-skill` through the `skill` tool and loaded `global-normal-skill` through delegate skill resolution.
- `manual-qa.log`: live DB session count stayed `5737` before and after, proving the run did not write to the real OpenCode DB.

## Why It Is Enough

This drives the reported path at the boundary that was broken: OpenCode owns normal-path skill discovery and exposes it through `app.skills`; OmO now adapts that live endpoint into the existing `skill` and `task` native-skill surfaces.

## What Was Omitted

- The raw `/skill` response was not kept because it includes the full built-in `customize-opencode` body with token/auth placeholder examples. The filtered JSON keeps the names, locations, descriptions, and content previews needed for review.
- The temporary server password and Authorization header were never written to evidence.

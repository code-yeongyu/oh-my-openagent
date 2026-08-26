# Issue #6987 Senpi skill roster QA

## What was tested

- Ran `node packages/omo-senpi/plugin/scripts/sync-skills.mjs` against the real generated Senpi skill tree.
- Scanned every generated Markdown file using the runtime exports `BUILTIN_AGENTS` and `DEFAULT_CATEGORIES` as the allowlists.
- Rejected literal `subagent_type` and `category` targets outside those registries, plus the stale raw `oracle`, `plan`, and `lead: sisyphus` forms from the issue.

## What was observed

- Sync completed successfully; output is captured in `sync-output.txt`.
- `roster-scan.json` reports 308 Markdown files scanned, zero invalid targets, and zero stale skill files.
- The runtime roster resolved to `explore`, `librarian`, `metis`, and `momus`; the category list contains the nine actual builtin categories and no `git` category.

## Why it is enough

This drives the same sync script that materializes the shipped Senpi skills, then validates the generated artifacts against the runtime registries that resolve task calls. It directly covers the issue's failure boundary without changing or testing shared OpenCode prose.

## What was omitted

No secrets, credentials, user configuration, live model calls, or real Senpi agent directory were used. The QA is deterministic generated-artifact validation; no runtime process or sandbox cleanup was required.

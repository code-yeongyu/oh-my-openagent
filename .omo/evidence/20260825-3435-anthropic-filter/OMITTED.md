# WHAT WAS OMITTED

1. Live Anthropic round-trip: no real API call was made. The sandbox has no
   Anthropic credentials, and the filter itself is upstream and opaque; the
   unit-level payload assertion is the strongest reproducible seam available.
   No secrets, tokens, or auth headers were involved or recorded.
2. Markdown prompt prose scrub (agent prompts under packages/omo-opencode/src/
   agents/, packages/prompts-core/prompts/, docs): issue-thread owner analysis
   states a full scrub/re-key of prompt identity needs maintainer direction
   (overlaps #4036 Azure Prompt Shield). This PR fixes the machine-generated
   directive identity only.
3. OpenCode-core outbound surfaces (user-agent header, provider metadata set by
   the harness itself): upstream `opencode` core, not this repository.
4. Full root gates (`bun test` whole repo, `bun run typecheck` all packages):
   scoped to the touched package + consumer hook dirs per task scope;
   prepare-step submodule materialization is known-broken in this network-
   restricted environment (pre-existing, unrelated).
5. Renaming user-facing docs/AGENTS.md headline branding: local files, not
   outbound payload content; out of scope for the minimal fix.

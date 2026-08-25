# btw-side — Ephemeral Side Conversations (TUI)

**Generated:** 2026-08-24

**Score:** 16 (32 files, ~6k LOC, distinct domain; parent `features/AGENTS.md` carries one line)

## OVERVIEW

Codex-aligned ephemeral "btw" side conversations launched from the OpenCode TUI: a side session spawned off the parent with bounded parent-context injection, its own keymap/picker/prompt queue, adoption guards, and full lifecycle cleanup. Server-side state is separated from TUI state.

## WHERE TO LOOK

| Task | Location |
|------|----------|
| Controller state machine | `tui-controller.ts` + `tui-controller-types.ts` (`BtwSideState`, phase machine, generation counter) |
| Parent-context injection | `context-injector.ts` (`BTW_BOUNDARY_SENTINEL`, `createBtwSideContextInjectorHook`) + `parent-context-budget.ts` (bounded injection) |
| Session identity/metadata | `metadata.ts` (`BTW_SIDE_METADATA_KEY`/`_VERSION`, `createBtwSideMetadata`/`parse`) |
| Server session tracking | `server-session-registry.ts` (`trackBtwSideSession`, `forgetBtwSideSession`, `isTrackedBtwSideSession`) |
| Adoption protection | `tui-adoption-guard.ts` + `tui-adoption-cache.ts` |
| Keymap / escape | `tui-keymap.ts`, `tui-escape-return.ts` |
| Session picking / bridging | `tui-picker.ts` + `tui-picker-options.ts`, `tui-session-bridge.ts`, `tui-session-catalog.ts` |
| Prompt queueing | `tui-prompt-queue.ts` (`createBtwPromptQueue`) |
| Start / removal lifecycle | `tui-side-start.ts`, `tui-side-removal.ts` (`abortBtwSide`, `deleteBtwSide`) |
| Draft preservation | `btw-command-draft.ts` (`isBtwCommandDraft`) |
| TUI registration | `tui-wiring.ts` (`registerBtwSideTui`) |

## CONVENTIONS

- Controller holds a monotonically increasing `stateGeneration`; async completions must belong to the current generation or be discarded.
- Deleted-session tombstones are bounded (`MAX_DELETED_SESSION_TOMBSTONES = 512`, FIFO eviction).
- TUI files talk to server sessions only through the bridge/registry, never directly.

## ANTI-PATTERNS

- NEVER inject the full parent transcript — parent context goes through `parent-context-budget.ts` only.
- NEVER let a side session mutate parent-scoped state; the adoption guard exists to prevent exactly this.
- Do not track side-session state outside `server-session-registry.ts`.

# loader

## OVERVIEW
Layer discovery, JSONC reading, safe merging, and harness/profile view resolution; earned a file by owning the precedence and input-trust boundary of the config surface.

## WHERE TO LOOK

| Area | Location | Notes |
|------|----------|-------|
| Orchestration | `loader.ts` | Reads candidates, validates each layer, merges, resolves the view, then applies defaults once at the end. |
| Path discovery | `paths.ts` | User and project candidates, home boundary detection, walk depth cap, and symlink refusal. |
| View selection | `resolution.ts` | Folds base, harness block, profile, profile+harness; strips control keys; reports unknown profiles. |
| Merge safety | `merge.ts` | Recursive plain-object merge with unsafe-key filtering. |
| Ports and results | `types.ts` | Read filesystem seam, diagnostics kinds, source records, and load result shape. |
| Tests | `*.test.ts` | Precedence, resolution, unknown keys, path discovery, telemetry wiring, and legacy user-path purge. |

## CONVENTIONS

- The precedence, diagnostic-kind, and filename-resolution contract is stated once in the package file; extend it there rather than restating it here.
- A layer carrying prototype-pollution keys or a tampered prototype is rejected whole. Unknown-key tolerance is deliberately not extended to hostile input.
- The project walk is depth-capped and stops at the home boundary, comparing real paths so symlinked home spellings (`/var` versus `/private/var`) still match.
- An activated profile that does not exist yields a `profile` diagnostic and the base configuration rather than an error or an empty view.
- Filesystem and environment access flows through injected ports; the process-backed defaults exist only as production fallbacks, so tests never touch a real home directory.
- Loading never throws: every failure mode has a diagnostic representation, including a merged config that fails the final parse.

## ANTI-PATTERNS

- Do not reintroduce `$XDG_CONFIG_HOME`, `%APPDATA%`, or `~/.config/omo` user paths; the user directory is `~/.omo` on every platform and a test enforces it.
- Do not count the home `.omo` directory as a project layer or accept symlinked project config sources.
- Do not let one bad layer invalidate the whole load, and do not drop diagnostics that callers surface to users.
- Do not resolve harness blocks or profiles in consumers; they must consume the loader's already-resolved view.
- Do not apply schema defaults per layer; defaults belong to the single final parse.

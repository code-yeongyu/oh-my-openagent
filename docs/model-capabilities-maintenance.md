# Model Capabilities Maintenance

This project treats model capability resolution as a layered system:

1. runtime metadata from connected providers
2. `models.dev` bundled/runtime snapshot data
3. explicit compatibility aliases
4. heuristic fallback as the last resort

## Internal policy

- Built-in OmO agent/category requirement models must use canonical model IDs.
- Aliases exist only to preserve compatibility with historical OmO names or provider-specific decorations.
- New decorated names like `-high`, `-low`, or `-thinking` should not be added to built-in requirements when a canonical model ID plus structured settings can express the same thing.
- If a provider or config input still uses an alias, normalize it at the edge and continue internally with the canonical ID.

## When adding an alias

- Add the alias rule to `packages/model-core/src/model-capability-aliases.ts`.
- Include a rationale for why the alias exists.
- Add or update tests so the alias is covered explicitly.
- Ensure the alias canonical target exists in the bundled `models.dev` snapshot.

## Hand-scoped snapshot entries

`packages/omo-opencode/src/generated/model-capabilities.generated.json` has two writers:

- the scheduled `refresh-model-capabilities` workflow (`bun run build:model-capabilities`, fetched from `models.dev`), and
- feature PRs that add one scoped entry for a model the upstream catalog does not carry yet (for example #10187 added `gemini-4-argon`).

Today the refresh **overwrites** the file: `script/build-model-capabilities.ts` writes the fetched `models.dev` snapshot over it and keeps nothing from the committed copy. A refresh PR therefore deletes every hand-scoped entry upstream lacks; the refresh PR open at the time of writing (#7531) was missing 501 entries that `dev` carries.

Hand-scoped entries must survive the refresh, so the refresh has to change to a merge: add or update upstream entries, and keep committed entries upstream lacks unless a PR retires them on purpose. That change is not made yet; it is tracked in #10665.

Until it lands:

- When you add an entry by hand, keep it to the entry itself: do not regenerate the whole file from `models.dev` in a feature PR, and leave `generatedAt` alone.
- When you review a refresh PR, check its removed entries and restore any hand-scoped ones before merging.

## Guardrails

`collectModelCapabilityGuardrailIssues()` in `packages/model-core/src/model-capability-guardrails.ts` reports these issue kinds:

- exact alias targets missing from the bundled snapshot
- exact alias keys that became canonical `models.dev` IDs
- pattern aliases that rewrite canonical snapshot IDs
- built-in requirement models that rely on an alias or are missing from the snapshot

`bun run test:model-capabilities` checks that the detector finds each kind on synthetic snapshots. Against the bundled snapshot it asserts only that a short list of built-in models is not missing from it (`model-capability-guardrails.test.ts`); it does not fail on every issue the detector reports for the real file. The scheduled `refresh-model-capabilities` workflow runs that suite before it opens a refresh PR, so the same limit applies there.

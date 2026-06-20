# omo-native Wave 0 Post-Patch Gate Addendum

reviewedAt: 2026-06-20T10:26:30Z

## Verdict

PASS.

After the final gate reviewer returned PASS, the native package was adjusted to follow the repo's Bun package convention:

- `packages/omo-native/package.json` uses `bun-types`.
- `packages/omo-native/tsconfig.json` uses `"types": ["bun-types"]`.
- The package no longer declares package-local `@types/node`.

## Fresh Verification

Artifact: `.omo/evidence/20260620-omo-native-wave-0/final-convention-fix-verification.txt`

Fresh commands observed:

- `bun install --frozen-lockfile --ignore-scripts`: PASS.
- `node packages/omo-native/build.mjs`: PASS.
- `bun run build:native`: PASS.
- `node -e "import('./packages/omo-native/dist/index.js').then(m => console.log(typeof m.default))"`: PASS, printed `function`.
- `bun run --cwd packages/omo-native typecheck`: PASS.
- `bun run --cwd packages/omo-native test`: expected RED, exit 1 only because the planned Wave 1 assertion requires a real Senpi/pi type-layer import.
- `git diff --check`: PASS.
- `git diff --cached --check`: PASS.
- tmux cleanup: PASS, no `ulw-qa-omo-native-wave0-terminal` session remains.

## Superseded Note

The previous gate review remains valid for scope and architecture review, but its package-type details predate this final convention fix. This addendum is the fresh post-patch gate evidence for the final committed state.

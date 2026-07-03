# omo-pi Package

`packages/omo-pi` is the OMO adapter package for the senpi fork shipped as `omoai`. The workspace manifest stays private and scoped as `@oh-my-opencode/omo-pi`; the publishable `omo-pi` package name is stamped only by the later pack-staging pipeline.

## Fork Model

- Senpi source is vendored under `vendor/` at the SHA recorded in `vendor/SENPI_SHA`.
- The fork is one package: `coding-agent`, `agent`, `ai`, and `tui` are mirrored into the final artifact rather than registered as root workspaces.
- Runtime configuration is intended to use `.omo` for the fork while plain senpi remains untouched.

## Vendor And Patch Workflow

- Refresh vendored source with `node scripts/sync-senpi.mjs`; verify committed source with `node scripts/sync-senpi.mjs --check`.
- Patch files live in `patches/` and are applied in filename order by the sync script.
- Do not hand-edit `vendor/**` unless producing or validating a patch. Generated `dist`, `node_modules`, and vendored tests must stay out of this package.
- Keep dependency declarations generated from vendored manifests with `node scripts/mirror-deps.mjs --check`; update the generator rather than hand-maintaining dependency blocks.

## Build Pipeline Guardrails

- Root typecheck covers only OMO-authored glue and tests. Vendored source compiles through the package build pipeline, not the root package audit.
- `vendor/`, `.staging/`, and `test-dist/` stay outside the package tsconfig.
- Until task 7 wires the full package build, `build`, `test:dist`, and `pack:check` are intentional task-local stubs.
- Do not add workspace dependencies on `@earendil-works/pi-*`; those internals are bundled from the vendored tree.

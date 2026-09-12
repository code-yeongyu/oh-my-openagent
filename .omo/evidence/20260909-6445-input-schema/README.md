# Defaulted root settings remain optional

Related: #6445 and the required-key portion of #6626. This extends PR 7818's
identifier fix rather than introducing a competing schema change.

The generators use targeted schema views: only `profiles` and `git_master`
become optional. Runtime schemas, property definitions, defaults and strict
unknown-root-key handling remain unchanged.

## Observed verification

- Failing first: 8 pass / 4 fail; all four failures were unwanted `required`
  entries. After the two source changes: 12 pass / 0 fail.
- Schema and freshness suites: 15 pass / 0 fail. Full typecheck and build
  passed with Bun 1.4.0 and Node 24.
- The real isolated `config migrate --json` command produced
  `valid-unified-migrated.json`, with neither defaulted setting present.
- Ajv rejected that document before the fix for missing `profiles` and
  `git_master`. The regenerated unified/profile/flat schemas accept the
  valid inputs and still reject wrong types and unknown root keys.
- Real OpenCode 1.18.4 loaded the locally built plugin and migrated config.
  HTTP health passed and `/experimental/tool/ids` exposed the plugin-only
  `call_omo_agent` tool. The server exited; the container was removed.
  Host DB session counts were 8083 before and after.

## Replay and artifacts

Prepare repository dependencies and the `omo-qa` image documented by the
repository QA skill. Select Bun 1.4.0 and Node 24 on PATH, then run:

```sh
bun run build:schema
bun test script/build-schema.test.ts script/build-omo-schema.test.ts tests/omo-schema-freshness.test.ts
bun run typecheck
bun run build
bash .omo/evidence/20260909-6445-input-schema/commands.sh
```

`tests-red.txt`, `tests-green.txt`, `build-and-checks.txt`, `migration-cli.txt`,
`schema-consumer-red.txt`, `schema-flat-red.txt`, `schema-consumer-green.txt`,
`server-smoke.json` and `isolation.txt` contain the captured results.
The JSON fixtures and `server-smoke.mjs` are the actual replay inputs.

The first network-disabled container timed out during project initialization
(`server-smoke-attempt1.json`). Normal container networking allowed bootstrap
to complete; private HOME/XDG roots and no host configuration mounts were
retained. No model inference was requested. Ajv uses `--strict=false` without
default insertion; its existing URI-format warnings are retained, and URI
format validation is not claimed. Local paths in command captures are
redacted and trailing whitespace is normalized; no credentials or personal
configuration are included.

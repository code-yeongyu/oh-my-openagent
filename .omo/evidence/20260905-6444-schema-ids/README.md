# Unified schema identifier verification

Tested against dev `277c854a0` with Bun 1.4.0. The composed schema must not
declare the same OpenCode document identifier at two different locations.

## Before the fix

The existing generator tests passed: 6 pass, 0 fail. The new identifier test
then failed: 6 pass, 1 fail, receiving two extra copies of the OpenCode schema
URL instead of only the unified document URL.

The actual schema compiler reproduced the reported error:

```sh
bunx --package ajv-cli@5.0.0 ajv compile -s assets/omo.schema.json --strict=false
```

```text
schema assets/omo.schema.json is invalid
error: reference "https://raw.githubusercontent.com/code-yeongyu/oh-my-openagent/dev/assets/oh-my-opencode.schema.json" resolves to more than one schema
```

## After the fix

- The identical Ajv command exits 0: `schema assets/omo.schema.json is valid`.
- Compiling `assets/oh-my-opencode.schema.json` with the same command succeeds.
  That standalone artifact is byte-identical to HEAD.
- `bun test script/build-omo-schema.test.ts tests/omo-schema-freshness.test.ts`:
  10 pass, 0 fail. This includes root/profile configuration validation,
  invalid configuration rejection, identifier coverage and artifact freshness.
- `bun run typecheck` and `bun run build`: both exit 0.
- The LSP tool cannot access the sibling worktree; compiler checks ran against
  the actual changed worktree instead.

## Actual OpenCode regression smoke

Used the existing `omo-qa` Docker image with no host configuration mounts,
the locally built plugin, and the `opencode-qa` isolated server helpers.
Authenticated `curl -i /global/health` returned:

```text
HTTP/1.1 200 OK
Content-Type: application/json
Content-Length: 35

{"healthy":true,"version":"1.18.4"}
```

`GET /config` included `file:///workspaces/oh-my-openagent/dist/index.js`.
The server PID and isolated HOME/XDG sandbox were removed; the named container
was absent after `--rm`. Host session count remained 8072 before and after.

## Scope and remaining risk

The source fix removes only the fresh embedded schema's `$id`. Regeneration
also removes 44 stale `tool_exposure` lines: the unmodified dev generator
already omits that removed setting. No runtime policy was changed. Required
default-field behavior reported in #6445 remains outside this change.

The host Docker wrapper's `--no-config` path initially failed on Bash 3 with
`config_mounts[@]: unbound variable`, before creating a container. The same
isolated QA image and probe passed via direct `docker run`. No infrastructure
code was changed. Credentials, private configuration, machine-specific paths
and the unrelated authored prompts in `/config` were omitted.

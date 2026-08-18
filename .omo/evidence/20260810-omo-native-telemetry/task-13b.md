# Task 13b Evidence

## Generator stdout

Command:

```text
$ bun script/telemetry-schema-block.mjs
```

Real stdout:

```markdown
<!-- BEGIN GENERATED SCHEMA -->
## Event schema

| Event | Allowed properties |
|-------|--------------------|
| `daily_active` | `$session_id`, `day_utc`, `reason` |
| `session_started` | `$session_id`, `$os`, `$os_version`, `arch`, `cpu_count`, `default_model`, `default_provider`, `memory_bucket`, `model_count`, `provider_count`, `providers`, `reason` |
| `prompt_submitted` | `$session_id`, `input_source`, `invocation_stage`, `is_effective_ultrawork_invocation`, `is_real_user_prompt`, `is_turn_start`, `keyword_any`, `keyword_occurrence_bucket`, `keyword_ultrawork_full`, `keyword_ulw_abbrev`, `keyword_variant`, `prompt_length_bucket`, `queue_mode`, `real_prompt_ordinal_bucket`, `suppression_reason` |
| `turn_completed` | `$session_id`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `input_tokens`, `model_id`, `output_tokens`, `provider`, `reasoning_tokens`, `total_tokens`, `turn_index` |
| `skill_loaded` | `$session_id`, `skill_name` |
| `delegation_started` | `$session_id`, `background`, `batch_size_bucket`, `kind`, `name` |
| `feature_used` | `$session_id`, `feature` |
<!-- END GENERATED SCHEMA -->
```

All 7 canonical event names are present.

## Mutation proof RED

Mutation: removed this row from `docs/reference/senpi-telemetry.md`:

```markdown
| `skill_loaded` | `$session_id`, `skill_name` |
```

Command:

```text
$ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
```

Real failure capture, with the machine-local stack path omitted so this committed evidence passes the markdown path audit:

```text
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/schema-doc.test.ts:
error: Telemetry schema documentation drifted.

Paste this exact generated block into docs/reference/senpi-telemetry.md:

<!-- BEGIN GENERATED SCHEMA -->
## Event schema

| Event | Allowed properties |
|-------|--------------------|
| `daily_active` | `$session_id`, `day_utc`, `reason` |
| `session_started` | `$session_id`, `$os`, `$os_version`, `arch`, `cpu_count`, `default_model`, `default_provider`, `memory_bucket`, `model_count`, `provider_count`, `providers`, `reason` |
| `prompt_submitted` | `$session_id`, `input_source`, `invocation_stage`, `is_effective_ultrawork_invocation`, `is_real_user_prompt`, `is_turn_start`, `keyword_any`, `keyword_occurrence_bucket`, `keyword_ultrawork_full`, `keyword_ulw_abbrev`, `keyword_variant`, `prompt_length_bucket`, `queue_mode`, `real_prompt_ordinal_bucket`, `suppression_reason` |
| `turn_completed` | `$session_id`, `cache_read_tokens`, `cache_write_tokens`, `cost_usd`, `input_tokens`, `model_id`, `output_tokens`, `provider`, `reasoning_tokens`, `total_tokens`, `turn_index` |
| `skill_loaded` | `$session_id`, `skill_name` |
| `delegation_started` | `$session_id`, `background`, `batch_size_bucket`, `kind`, `name` |
| `feature_used` | `$session_id`, `feature` |
<!-- END GENERATED SCHEMA -->
(fail) OmO Native telemetry schema documentation > #given the product allowlists #when the reference is checked #then the generated schema block is byte exact
(pass) OmO Native telemetry schema documentation > #given an empty property allowlist #when generation is attempted #then no corrupt block is emitted

 1 pass
 1 fail
 1 expect() calls
Ran 2 tests across 1 file.
```

Exit status: `1`.

## Restored GREEN

The original file bytes were restored from the pre-mutation copy.

```text
$ bun test packages/omo-senpi/src/components/telemetry/schema-doc.test.ts
bun test v1.4.0-canary.1 (b58cd4685)

packages/omo-senpi/src/components/telemetry/schema-doc.test.ts:
(pass) OmO Native telemetry schema documentation > #given the product allowlists #when the reference is checked #then the generated schema block is byte exact
(pass) OmO Native telemetry schema documentation > #given an empty property allowlist #when generation is attempted #then no corrupt block is emitted

 2 pass
 0 fail
 1 expect() calls
Ran 2 tests across 1 file.
```

A byte comparison against the pre-mutation copy reported `restore_cmp=identical`.

## Full telemetry suite and test count delta

Baseline before adding `schema-doc.test.ts`:

```text
63 pass
0 fail
193 expect() calls
Ran 63 tests across 9 files.
```

Final:

```text
$ bun test packages/omo-senpi/src/components/telemetry
65 pass
0 fail
194 expect() calls
Ran 65 tests across 10 files.
```

Delta: 2 tests and 1 test file added. The count did not decrease.

## Typecheck

```text
$ bun run --cwd packages/omo-senpi typecheck
$ tsgo --noEmit -p tsconfig.json
```

Exit status: `0`.

## Link audit

```text
$ bun test packages/omo-opencode/src/shared/markdown-link-audit.test.ts
16 pass
0 fail
21 expect() calls
Ran 16 tests across 1 file.
```

## Adversarial results

- Stale state: deleting one generated event row made the byte-exact drift test fail and print the exact canonical block to paste.
- Malformed input: `{ empty_event: [] }` throws `Telemetry event empty_event must contain at least one allowed property`; no partial block is returned.
- Misleading success output: the full telemetry count increased from 63 tests across 9 files to 65 tests across 10 files.
- Freshness: the restored document passed generation from the imported `OMO_NATIVE_PROPERTY_ALLOWLISTS` at test time.

## Cleanup receipt

- The temporary mutation was restored byte for byte.
- No scratch file remains in the worktree.
- `git diff --check` passed.
- The only source and documentation changes are the four task-owned paths.
- This evidence file is the only additional task artifact.

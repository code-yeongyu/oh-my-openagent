# Recovered session diagnosis

## Primary session

- Session ID: `019fcb34-df92-78b4-af23-747951793586`
- Transcript:
  `/Users/yeongyu/.pi/agent/sessions/--Users-yeongyu-sionicai-kimiblog-kimik3ultrafast--/2026-08-04T05-17-47-794Z_019fcb34-df92-78b4-af23-747951793586.jsonl`
- Provider/model/API: `apitopia` / `kimi-k3-ultrafast-unlocked` /
  `openai-completions`

Recovered tool sequence:

| Tool call | Argument shape | Result |
|---|---|---|
| `team_create:23` | `team_name` + `inline_spec` | `invalid_arguments` |
| `team_create:24` | `team_name` only | named spec not found |
| `team_create:25` | `team_name` + `inline_spec` | `invalid_arguments` |
| `team_create:26` | `team_name` + `inline_spec` | `invalid_arguments` |
| `team_create:27` | `team_name` + `inline_spec` | `invalid_arguments` |
| `team_create:28` | `team_name` + `inline_spec` | `invalid_arguments` |
| `team_create:29` | `team_name` + `inline_spec` | `invalid_arguments` |
| `team_create:30` | `team_name` + `inline_spec` | `invalid_arguments` |

Before calls `:25` through `:30`, the assistant reasoning explicitly said it
would remove `team_name`, but the emitted tool arguments still retained both
fields. Every invalid result had `isError: false`.

## Independent recurrence

- Session ID: `019fc0fb-d81b-7d40-9e58-c1ae3130f858`
- Transcript:
  `/Users/yeongyu/.pi/agent/sessions/--Users-yeongyu-Documents--/2026-08-02T05-39-18-171Z_019fc0fb-d81b-7d40-9e58-c1ae3130f858.jsonl`
- Same model/provider path.
- Dual-field calls recurred at `team_create:39`, `:46`, `:47`, and `:49`.

## Root cause

1. `TeamCreateParams` exposed two optional sibling fields. The XOR rule existed
   only in prose and runtime validation.
2. Kimi repeatedly emitted both fields despite correctly restating the prose
   rule.
3. A root `oneOf`/`anyOf` schema would not be reliable for this path because
   Senpi's Moonshot compatibility normalization flattens root object unions and
   keeps only requirements common to every branch.
4. Marking the result as an error would not solve the primary failure: the
   model already understood the textual error and repeated the same shape.

## Fix decision

Treat `inline_spec` as authoritative whenever it is present. Use `team_name`
only when no inline spec is supplied. The richer inline payload can then
execute on the first over-specified call instead of entering a model-driven
retry loop.

## History evidence

- `0be02d59f389`: introduced the Senpi `team_create` runtime XOR validation.
- `1b580615ad0e`: removed model-supplied lead-session override.
- `a8654d385a7d`: added JSON-string `inline_spec` support.
- Sibling Senpi `packages/ai/src/utils/tool-schema-compat.ts` contains the
  Moonshot root-union merge used by the affected provider path.

No raw credentials, provider keys, or auth material are included.

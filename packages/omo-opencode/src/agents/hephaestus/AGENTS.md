# Hephaestus

`agent.ts` keeps the subagent factory, existing tuning, permissions and metadata.
`model-support.ts` owns the unchanged model eligibility predicate and error.
Registration uses that predicate; an unsupported per-request model leaves
the previous prompt intact so an allowed runtime override cannot fail the turn.

Model content comes only from Senpi through `../native-model-prompt.ts`;
`gpt.ts` retains the existing OpenCode deep-worker role and context.
There are no local Native model-core copies. The role delegation table permits
explore, librarian and oracle, not planning agents.

On a Native preset that is the whole deep-work prompt by itself (`gpt-6.2`,
`isStandaloneHephaestusPreset` in `model-support.ts`) no role is appended: the
prompt is the framed core alone (#14186). The role still rides in the frame
context, so a per-request model switch drops it for GPT-6.2 and restores it
for every other supported model. The refusal-is-final rule is stated once by
the frame for every agent that carries it: by the model core when the core
states it, right after the core otherwise, so it survives without the role.

Tests cover support/rejection, registration, transport aliases and delegation.
The parent catalog matrix compares full rendered content with Native.

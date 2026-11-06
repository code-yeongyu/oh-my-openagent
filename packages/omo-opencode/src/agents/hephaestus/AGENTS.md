# Hephaestus

`agent.ts` keeps the subagent factory, existing tuning, permissions and metadata.
`model-support.ts` owns the unchanged model eligibility predicate and error.
Registration uses that predicate; an unsupported per-request model leaves
the previous prompt intact so an allowed runtime override cannot fail the turn.

Model content comes only from Senpi through `../native-model-prompt.ts`;
`gpt.ts` retains the existing OpenCode deep-worker role and context.
There are no local Native model-core copies. The role delegation table permits
explore, librarian and oracle, not planning agents.

Tests cover support/rejection, registration, transport aliases and delegation.
The parent catalog matrix compares full rendered content with Native.

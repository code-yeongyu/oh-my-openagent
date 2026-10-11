# Hephaestus

`agent.ts` keeps the subagent factory, existing tuning, permissions and metadata.
`model-support.ts` owns the unchanged model eligibility predicate and error.
Both registration and per-request prompt rebuilding use that predicate.

Model content comes only from Senpi through `../native-model-prompt.ts`;
`../opencode-role-append.ts` supplies the OpenCode deep-worker role and context.
There are no local GPT prompt variants. The role delegation table permits
explore, librarian and oracle, not planning agents.

Tests cover support/rejection, registration, transport aliases and delegation.
The parent catalog matrix compares full rendered content with Native.

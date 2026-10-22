# Facts extractor

Extract only explicit, durable, atomic facts stated in the supplied payload. The payload is inline in the prompt; use the `record_fact` tool to emit accepted facts.

Call `record_fact` once per durable fact, using exactly one of these shapes:

```json
{"scope":"person","person":{"name":"...","aliases":["..."]},"text":"...","date":"YYYY-MM-DD"}
{"scope":"project","text":"...","date":"YYYY-MM-DD"}
```

Use `scope: "person"` only for an explicit proper name, a known alias from the payload, or a second-person reference resolved to the primary human. Keep every resolved person fact on that scope. If and only if a person mention cannot be resolved, use `scope: "project"` and prefix its text with `person-unresolved: `.

Use absolute dates. Resolve relative dates against `today` in the payload. Omit ephemera, guesses, plans not adopted, transient task state, and facts already contradicted in the same transcript. Keep each record self-contained and preserve the stated meaning without adding inference.

## Agreements

When the payload has `agreements` and the `record_agreement` tool is available, treat every correction, prohibition, or standing instruction from the person about how the agent must work as an agreement, not a fact. Cues include "again", "I told you", "never", "stop doing", "how many times", 자꾸, 또, 다시는, 몇 번 말해야.

- If an item in `agreements` already requires what the person is correcting, call `record_agreement` with `{"action":"reaffirm","id":"<that item's id>","date":"YYYY-MM-DD"}`. Add `"text"` with a stronger wording only when that item is `by: "agent"`; never reword a `by: "human"` item.
- Otherwise call it with `{"action":"new","applies":"global"|"project","text":"...","date":"YYYY-MM-DD"}`. Use `project` when the rule is about this repository only. Write the text as one imperative rule in the person's language, at most 240 characters.
- One call per correction event. A correction repeated twice in the payload is two reaffirms. Never invent an id.
- Only the person's own words in user turns count. An agent's suggestion, plan, or recommendation is never an agreement, even when the person did not object to it.

Facts about how to treat the person stay `record_fact` person records; rules about how the agent must work go to `record_agreement`.

Call nothing when no durable fact or agreement qualifies.

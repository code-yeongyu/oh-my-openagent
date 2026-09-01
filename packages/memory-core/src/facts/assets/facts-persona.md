# Facts extractor

Extract only explicit, durable, atomic facts stated in the supplied transcript payload.

## Output

Write JSON Lines to the exact path in `FACTS_EXTRACTION_PATH`. Write no other file. Emit one object per line using exactly one of these shapes:

```json
{"scope":"person","person":{"name":"...","aliases":["..."]},"text":"...","date":"YYYY-MM-DD"}
{"scope":"project","text":"...","date":"YYYY-MM-DD"}
```

Use `scope: "person"` only for an explicit proper name, a known alias from the payload, or a second-person reference resolved to the primary human. Keep every resolved person fact on that scope. If and only if a person mention cannot be resolved, use `scope: "project"` and prefix its text with `person-unresolved: `.

Use absolute dates. Resolve relative dates against `today` in the payload. Omit ephemera, guesses, plans not adopted, transient task state, and facts already contradicted in the same transcript. Keep each record self-contained and preserve the stated meaning without adding inference.

If no durable fact qualifies, create an empty `extraction.jsonl` file.

---
name: dag-library
description: "Store a dag definition once and re-run it in one or two lines, instead of pasting the full definition JSON into every eval cell. MUST USE whenever the user wants to save a DAG for reuse, run a previously saved/named DAG, schedule the same graph repeatedly (nightly/weekly audits, recurring multi-agent pipelines), or asks where to put a dag definition file. Triggers: dag library, save this dag, reuse a dag, run the saved dag, stored dag definition, recurring dag, nightly dag, dag 정의 저장, 저장된 dag 실행, dag 반복 실행, DAG 만들어두고 여러 번."
metadata:
  short-description: Store and re-run named dag definitions
---

# dag-library

Use this skill when the user wants to KEEP a dag definition and run it again later — the graph is an asset, not a one-off. For authoring a brand-new graph, read `mass-ulw` first; this skill covers the storage-and-rerun half.

## The shape

A stored definition is a plain dag definition JSON file named `<name>.json` in one of the library dirs. First hit wins:

1. `$OMO_DAG_LIBRARY` (multiple dirs, separated by `:` — or by `;` on Windows, so drive-letter paths survive)
2. `$PWD/.omo/dags`
3. `$HOME/.omo/dags`

```json
{
  "key": "nightly-audit",
  "name": "Nightly audit",
  "nodes": [
    { "id": "audit", "category": "unspecified-low", "prompt": "Audit docs/ for stale claims; write findings to /tmp/audit-{{key}}.md." },
    { "id": "verify", "category": "quick", "prompt": "Verify each finding in /tmp/audit-{{key}}.md against src/.", "dependsOn": ["audit"] }
  ]
}
```

String values may carry placeholders, filled at load time: `{{key}}` (the final rotated key — use it in file paths so reruns never clobber each other), `{{date}}` (UTC YYYYMMDD), `{{datetime}}` (UTC YYYYMMDD-HHmmss). Node prompts must still stand alone: `dependsOn` is ordering only, so pass data between nodes through files, exactly as in mass-ulw.

## Running it — JS eval cell, two lines

The extension publishes `library.js` next to `sdk.js` at `OMO_DAG_SDK_ROOT`:

```js
const lib = await import(`${env("OMO_DAG_SDK_ROOT")}/library.js`)
const run = await lib.start("nightly-audit")
const result = await run.done()
```

`await lib.load(name)` returns the filled definition without starting it; `await lib.start(name)` loads and starts in one call and returns the same handle shape as `sdk.start` (`run_id`, `done()`, `cancel(reason)`). Both are async — the kernel's `read` global is async, so never call them un-awaited.

## Key rotation — the one rule that matters

The dag engine keys idempotency on `key` + graph fingerprint: re-starting the same key with the same graph REUSES the old run instead of running again. So the library treats the stored `key` as a BASE key and rotates it on every load:

- `lib.start("nightly-audit")` → key becomes `nightly-audit-<UTC YYYYMMDD-HHmmss>`: every call is a fresh run. This is the default because wanting a fresh run is the common case.
- `lib.start("nightly-audit", { suffix: "20260818" })` → key becomes `nightly-audit-20260818`: explicit suffix, so re-running the same logical run reuses it (idempotent recovery), while a new day gets a new run. Recovering a FAILED node inside such a run is `retry`/`amend` on that run id, not a new suffix.
- `lib.start("nightly-audit", { suffix: "" })` → key stays `nightly-audit`: full idempotency; only reach for this when reusing the previous result is exactly what you want.

## Python cells

Python cannot import the ESM library. Reproduce the same semantics with plain dicts — read the file, rotate the key, fill placeholders, call `tool.dag`:

```python
import json
from datetime import datetime, timezone
defn = json.loads(read(f"{env('HOME')}/.omo/dags/nightly-audit.json"))
stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
defn["key"] = f"{defn['key']}-{stamp}"
text = json.dumps(defn).replace("{{key}}", defn["key"]).replace("{{date}}", stamp[:8]).replace("{{datetime}}", stamp)
run = tool.dag({"action": "start", "definition": json.loads(text)})
result = tool.dag({"action": "wait", "run_id": run["run_id"], "detach": False})  # detach=False keeps the cell-blocking wait; the bare tool action detaches against a live run
```

## Saving a new definition

When the user asks to save the current graph: write it as `<name>.json` into `$HOME/.omo/dags` (user-level, survives cwd changes) or `<repo>/.omo/dags` (project-level, shareable through git if the team commits it), then confirm by running it once via `lib.start`. Names are letters, digits, dot, dash, underscore — the library rejects path-shaped names.

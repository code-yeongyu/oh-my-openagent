# @oh-my-opencode/senpi-desktop-prelude

Holds the eval-kernel facades and the model documentation for the `computer` tool. The package exports one object, `computerPreludeAssets`:

| Key | Source | Use |
|---|---|---|
| `javascript` | `src/prelude.js` | Defines `globalThis.computer` in the JS kernel. |
| `python` | `src/prelude.py` | Defines `computer` in the Python kernel (synchronous, like senpi's Python helpers). |
| `declarations` | `declarations.d.ts` | TypeScript declarations of the JS `computer` global. |
| `documentation` | `docs/computer.md` | Helper-list lines for the eval prompt's `<prelude>` block. It is rendered inside that block's code fence, so it holds no fences itself. |
| `safety` | `docs/computer-safety.md` | System-prompt fragment for sessions where `computer` is active. |
| `exports` | - | `["computer"]`, the kernel globals the snippets define. |
| `methodAllowlist` | - | Every call-chain method: the union of the `desktop-protocol` tier tables. |

`javascript`, `python`, `documentation`, and `exports` together form the tool's `kernelPrelude` (`ToolDefinition.kernelPrelude`). The texts are compiled into `src/assets.generated.ts` by `scripts/generate-assets.ts`, which runs first in `build`. The committed module is checked for drift by `test/assets.test.ts`, so no text-import attribute is needed.

## Tool contract the facades rely on

Every facade helper is one ordinary `tool.computer(args)` call, so tool activation and the permission-system preflight apply to it. The `computer` tool must accept these `args`:

- `{ action: "call", chain }`: `chain` holds at most two `{ method, args }` steps: a desktop root method, optionally followed by one window (`window` root) or element (`ref` root) method. Handles re-resolve on every call.
- `{ action: "run", code, read_only?, timeout? }`: `code` is an async function body. `computer.run(fn, { args })` serializes `fn` and each argument (JSON data, functions, and `RegExp`) into `return await (fn)({ desktop, wait, assert }, ...args);`. `timeout` is in seconds.
- `{ action: "capabilities" }` and `{ action: "close" }`.

The facades read the kernel result `{ text, details?, images?, hasError? }` this way: `hasError` throws with `text`, each `images[i]` goes to `display()`, and `details.value` is the return value.

## Settings

None.

## Import direction

`scripts/desktop-package-boundaries.test.mjs` enforces these edges, in both `package.json` and `src/`:

- `@oh-my-opencode/senpi-desktop-protocol` and `@oh-my-opencode/senpi-desktop-prelude` import no workspace package.
- `@oh-my-opencode/senpi-desktop-engine` may import `-protocol`.
- `@oh-my-opencode/senpi-desktop-service` may import `-protocol`, `-engine`, and `-prelude`.
- `@oh-my-opencode/senpi-desktop-tool` may import `-protocol`, `-engine`, `-prelude`, and `-service`.
- Only omo-senpi's computer-use component imports these packages, and only `-tool` and `-service`. senpi itself imports none of them.
- No desktop package imports `pi-agent-core`, `pi-ai`, or `pi-tui`. There is no shared utils package: the five desktop packages are the whole set.

The Rust side runs the other way: `senpi-desktop-core` <- `-safety` <- `-session` <- backends <- `senpi-desktop-engine` (the binary). The TS packages reach it only through the engine's stdio JSON-RPC.

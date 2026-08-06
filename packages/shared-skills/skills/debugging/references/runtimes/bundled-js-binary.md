# Bundled-JS / Embedded-Source Binaries (Bun SEA, Node SEA, Deno compile, pkg, Electron, PyInstaller)

A growing class of "binaries" are not stripped C/C++ at all — they are a runtime VM glued onto a high-level-language bundle. The bundle is **plaintext or trivially-decodable** inside the binary.

If you reach for `native-binary.md` workflow on these (Ghidra → pwndbg → hex), you will waste hours decompiling a runtime you don't care about while the actual logic sits exposed three megabytes away.

**This reference exists because the workflow is fundamentally different from stripped C.**

---

## When to use this reference instead of `native-binary.md`

Open this if `file ./target` shows a generic Mach-O / ELF / PE BUT any of:

- Size is suspiciously large (50 MB+ for a "simple CLI")
- `strings -n 8 ./target | rg -i "node_modules|webpack|esbuild|bun|pkg/lib|electron|pyinstaller"` returns hits
- The binary's CLI flags include things like `--inspect`, `--unhandled-rejections`, npm-style help text
- Vendor docs say it's built with Bun / pkg / nexe / Deno compile / PyInstaller / Electron / Tauri (UI shell)
- `head -c 4 ./target | xxd` shows a known runtime magic for an embedded archive section

If yes → **stop following `native-binary.md` and follow this**. Triage and dynamic tracing are the same. Static analysis is completely different.

---

## The workflow

```
  [1] Triage           →  identify the bundler (Bun? pkg? Deno? Electron? PyInstaller?)
  [2] Locate the bundle → find where the embedded source archive starts
  [3] Extract           → dump source to disk so you can grep / read it
  [4] Source-level static analysis (rg + Read, NOT Ghidra)
  [5] Runtime verification → debug logs, --inspect, partial-evidence patterns
  [6] Fix / report
```

Step 3 is the unlock — once you have plaintext source on disk, the rest is normal codebase exploration.

---

## [1] Identify the bundler — 30-second fingerprint

```bash
# Look for runtime-specific markers in plaintext strings
strings -n 12 ./target 2>/dev/null | rg -iE 'bun|node_modules|webpack|esbuild|deno|pkg/lib|electron|pyinstaller|nexe|NODE_SEA_FUSE|NODE_SEA_BLOB|tauri|ESZIP_V2|denort' | head -20
```

| Marker pattern | Bundler | Source format |
|---|---|---|
| `@oven/bun-darwin`, `bun-lockfile-format-v`, `// @bun` | **Bun SEA** (compiled via `bun build --compile`) | Plaintext JS, single big bundle |
| `NODE_SEA_BLOB` + `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1` | **Node SEA** (`node --build-sea` or `--experimental-sea-config`) | Plaintext JS, or V8 code cache (when `useCodeCache: true`), or startup snapshot (when `useSnapshot: true`) — the latter two are NOT plaintext |
| `pkg/lib/bootstrap.js`, `pkg/prelude`, `PAYLOAD_POSITION` | **pkg** (vercel/pkg) | Plaintext or v8 cached data |
| `ESZIP_V2`, `denort`, `deno_runtime` | **Deno compile** (`deno compile`) | TS/JS in eszip archive — readable but needs `eszip` crate to walk; not pure plaintext |
| `Electron`, `app.asar`, `chrome.dll`, `Squirrel.Mac` | **Electron** | `app.asar` archive (TAR-like with JSON header). Source is plaintext JS once extracted |
| `PyInstaller`, `pyz`, `_MEIPASS`, `pyi-os-utils` | **PyInstaller** | Compressed `.pyc` bytecode — needs `pyinstxtractor` + `decompyle3` to recover Python source |
| `nexe-`, `nexe_compile`, `:::nexe::` | **nexe** | Plaintext JS appended to node binary |
| `Tauri`, `tao`, `wry`, `tauri::generate_context` | **Tauri** (Rust shell + JS UI) | **Two worlds**: JS frontend in resource section is extractable here; Rust commands / core logic are native and require [native-binary.md](native-binary.md) |

If multiple match (e.g. Tauri + Bun): the outer shell is the first one (Tauri/Electron). The inner JS is the second one's format. **For Tauri specifically, expect to use both this reference (for the UI bundle) and `native-binary.md` (for the Rust binary side).**

> **Source-format reality check**: only Bun SEA, pkg (when not using `--public-packages`), nexe, and Electron `.asar` are reliably plaintext. Node SEA with code-cache or snapshot, PyInstaller `.pyc`, and Deno eszip require additional tooling. Don't assume `strings` will find readable code — verify the bundler first.

---

## [2] Locate the bundle

### Bun SEA — JS is just embedded plaintext

The JS source is concatenated into the binary as a giant template literal / string. No decoding needed.

```bash
# Verify by searching for typical JS bundle markers
strings -n 8 ./target | rg "function|var |let |const |async function" | head -5

# Find where the bundle starts (look for "use strict" or banner comment)
LC_ALL=C grep -aob '"use strict"' ./target | head -5
LC_ALL=C grep -aob '#!/usr/bin/env bun' ./target | head -5
```

### Node SEA — `NODE_SEA_BLOB` resource/segment + activated fuse

Per the [Node.js SEA docs](https://nodejs.org/api/single-executable-applications.html), a Node-built SEA contains:
- A resource (PE), section in `NODE_SEA` segment (Mach-O), or note (ELF) named `NODE_SEA_BLOB`
- The fuse string `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1` (with trailing `:1` indicating injected; `:0` means a copy of the node binary that has not yet had a blob injected)

```bash
# Confirm it is a SEA at all
LC_ALL=C grep -aob 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2:1' ./target | head -1

# Find the blob resource/section
LC_ALL=C grep -aob 'NODE_SEA_BLOB' ./target | head

# On Mach-O, inspect the segment directly
otool -l ./target | grep -A4 'NODE_SEA'
```

The blob format is documented but non-trivial to walk by hand. For extraction, **use postject in reverse** (carve the section bytes) or read the blob via `node:sea` API from inside a debug build of the same binary. Plain `strings` will get you the embedded JS only when the SEA was built without `useCodeCache` and without `useSnapshot` — both of those replace plaintext with V8 cache data or startup snapshot bytes.

`node --build-sea sea-config.json` and `node --experimental-sea-config sea-config.json` *generate* SEA blobs; neither inspects an existing executable.

### Deno compile — eszip archive section

```bash
# Deno-compile binaries embed an eszip v2 archive
LC_ALL=C grep -aob 'ESZIP_V2' ./target | head -3
# Also confirm the runtime
LC_ALL=C grep -aob 'denort' ./target | head -1
```

To extract, use the `eszip` Rust crate (or the `@deno/eszip` JS port) to parse the archive after carving it out at the offset above. There is no stable Deno CLI flag that inspects compiled-executable eszip contents as of 2026-04 — `deno info` only works on source files.

### pkg — `PAYLOAD_POSITION` marker

```bash
LC_ALL=C grep -aob 'PAYLOAD_POSITION' ./target | head
LC_ALL=C grep -aob 'pkg/prelude' ./target | head
```

For source extraction, use the `pkg-extract` tooling community projects or carve based on the offset reported by the `PAYLOAD_POSITION:<n>` value.

### Electron — `app.asar` is usually a separate file

Most Electron apps ship `app.asar` next to the binary, not embedded inside. Extract it with the official tool:

```bash
# macOS layout
ls -la /Applications/MyApp.app/Contents/Resources/app.asar
npx @electron/asar extract app.asar ./extracted/
# or older:
npx asar extract app.asar ./extracted/
```

For single-file builds where the asar is embedded inside the executable, **do not pattern-match arbitrary 4-byte sequences** (the asar format starts with a Pickle-encoded uint32 header size + JSON metadata, and the same bytes appear elsewhere in any binary). Instead, use a Pickle-aware extractor that validates the JSON header before claiming a match — the `asar` npm package's programmatic `extractAll()` API does this. Carve the asar bytes by scanning for a candidate Pickle header (4-byte size + 4-byte payload size + `{"files":` prefix), validate the JSON parses, then feed the carved buffer to `extractAll()`.

### PyInstaller — use `pyinstxtractor`, NOT runtime self-extraction

```bash
# Recover the embedded archive without running the binary
python3 pyinstxtractor.py ./target
# Output: ./target_extracted/ with .pyc files

# Decompile the .pyc files back to Python source
decompyle3 ./target_extracted/main.pyc          # Python 3.7+
uncompyle6 ./target_extracted/main.pyc          # older Python
```

If `pyinstxtractor` cannot read the archive (e.g. non-standard PyInstaller version), use the official `pyi-archive_viewer` tool that ships with PyInstaller. Avoid the "run-the-binary-and-snoop-`/tmp/_MEI*`" approach: it only catches what runs in the time window between `_MEIPASS` extraction and cleanup, and it executes potentially untrusted code.

---

## [3] Extract source to disk — DO NOT skip this

**The single biggest mistake** with bundled-JS reverse engineering is trying to read the source out of `strings` output or `xxd` dumps. You will lose data. See "Gotchas" below.

### For Bun SEA / nexe / single-string-blob bundlers

Read the binary as bytes, find the JS section, save to a `.js` file:

```python
# extract_bundled_js.py
import sys

if len(sys.argv) < 2:
    raise SystemExit("usage: extract_bundled_js.py <target>")

with open(sys.argv[1], 'rb') as f:
    data = f.read()

markers = [b'// @bun', b'"use strict"', b"'use strict'", b'#!/usr/bin/env']
start = -1
for m in markers:
    p = data.find(m)
    if p != -1 and (start == -1 or p < start):
        start = p

if start == -1:
    raise SystemExit(
        "no bundle marker found — binary may not be Bun/nexe, "
        "or markers were stripped. Try strings(1) for hints."
    )

# Heuristic end: look for a long null run AFTER start.
# This is a heuristic, NOT a guarantee. Verify the tail of the output
# looks like JS (closing braces, EOF) before trusting it.
end = data.find(b'\x00' * 1024, start)
if end == -1:
    end = len(data)

bundle = data[start:end]
print(f'Extracted {len(bundle)} bytes from offset {start} to {end}', file=sys.stderr)
sys.stdout.buffer.write(bundle)
```

```bash
python3 extract_bundled_js.py ./target > extracted-bundle.js
wc -c extracted-bundle.js
# Sanity check the tail is JS, not random binary
tail -c 200 extracted-bundle.js
```

### For PyInstaller

Use `pyinstxtractor` then `uncompyle6` / `decompyle3` on the `.pyc` files.

### For Electron .asar

```bash
npx asar extract app.asar ./extracted/
# Now ./extracted/ has a normal node_modules + your source layout
```

### For Deno compile

Use the `eszip` Rust crate or the `@deno/eszip` JS port to walk the archive after carving the eszip section out at the offset reported by the `ESZIP_V2` magic search. There is no stable Deno CLI as of 2026-04 that inspects compiled-binary eszip contents directly.

---

## [4] Source-level static analysis — `rg` + `Read`, not Ghidra

Once you have the source on disk, treat it as a normal codebase:

```bash
# Find function definitions
rg -n "^function |^const \w+ = (function|\(.*\) =>)" extracted-bundle.js | head

# Find specific behavior
rg -n "claude-opus-4-7|reasoning_effort|api_key" extracted-bundle.js

# Resolve minified identifiers — they show up as `var XYZ="value"`
rg -aoP 'var \w+="[^"]+"' extracted-bundle.js | head -50
```

For minified bundles, use a template-literal-aware parser to extract specific functions or template strings. Example skeleton:

```python
def find_template_end(data, start):
    """Walk a JS template literal preserving ${...} interpolation depth.
    Returns position of closing backtick."""
    i = start
    while i < len(data):
        c = data[i:i+1]
        if c == b'\\':
            i += 2; continue
        if c == b'$' and data[i+1:i+2] == b'{':
            depth = 1; i += 2
            while i < len(data) and depth > 0:
                cc = data[i:i+1]
                if cc == b'\\': i += 2; continue
                if cc == b'`':
                    j = find_template_end(data, i+1)
                    i = j + 1; continue
                if cc == b'{': depth += 1
                elif cc == b'}': depth -= 1
                elif cc in (b'"', b"'"):
                    q = cc; i += 1
                    while i < len(data) and data[i:i+1] != q:
                        if data[i:i+1] == b'\\': i += 2
                        else: i += 1
                    i += 1; continue
                i += 1
            continue
        if c == b'`': return i
        i += 1
    return -1
```

For function-body extraction, **track the parameter list separately** before tracking body braces. The naive approach mis-counts destructuring `function f({a, b, ...c})` as the body `{` and exits early.

---

## [5] Runtime verification

You usually cannot single-step JS inside a Bun-compiled binary the way you would with `node --inspect`. Workarounds:

### Bun-compiled

Bun's inspector takes `--inspect[=<host>:<port>[/<prefix>]]` on the command line. For env-var control of compiled binaries, the form is the same minus the leading `--`:

```bash
# Default port (6499) auto-prefix
./target --inspect
# → ws://localhost:6499/<auto-prefix>  (paste into https://debug.bun.sh)

# Explicit host:port[/prefix]
./target --inspect=localhost:9229/dbg
# Or via env var (if --inspect cannot be passed)
BUN_INSPECT=localhost:9229/dbg ./target
```

**For HTTP request tracing without an interactive debugger** (highest-value Bun-specific runtime evidence):

```bash
# Print every fetch() / node:http request as a curl command + full headers/body
BUN_CONFIG_VERBOSE_FETCH=curl ./target ...

# Or just print the request/response without curl-format
BUN_CONFIG_VERBOSE_FETCH=true ./target ...
```

Plus generic env-var-based debug logging if the app supports it:

```bash
APP_DEBUG=1 APP_LOG_LEVEL=debug APP_LOG_FILE=/tmp/trace.log ./target
```

### Node SEA / pkg / nexe
```bash
# These usually accept --inspect since they are real Node
./target --inspect
# Then chrome://inspect or node --inspect-brk
```

### Electron
```bash
./target.app/Contents/MacOS/target --inspect=9229 --remote-debugging-port=9223
# Renderer process is at chrome://inspect, main process via the inspector port
```

### When you cannot make a real call
The target's API may require credentials, network access, or paid quota you don't have. **You are not stuck** — see [methodology/partial-runtime-evidence.md](../methodology/partial-runtime-evidence.md) for the fallback patterns.

---

## ⚠️ Gotchas — read these before extracting

### G1. `strings -n N` silently drops short identifier interpolations

`strings` outputs runs of printable characters of length **≥ N**. Default is 4 on most systems; many references (including older versions of `native-binary.md`) recommend `-n 8` for less noise.

**With `-n 8`, short template-literal interpolations like `${x}`, `${i}`, `${R}` are silently dropped** because they are 4 chars surrounded by non-printable bytes (newlines or section padding). The result looks like:

```text
expected:  <INSTRUCTIONS>\n${x}\n</INSTRUCTIONS>
strings:   <INSTRUCTIONS>\n</INSTRUCTIONS>      ← ${x} is gone, no warning
```

A consumer reading the strings output would conclude the template is empty.

**Mitigation**:
1. Use `strings` only for **fingerprinting** (Phase 1 triage), never as the source of extracted text.
2. For actual extraction, **read the binary as bytes** with `python3 -c "open('./target','rb').read()"` and grep / parse from there.
3. If you must use `strings`, try `strings -n 1 -t x ./target` and post-filter — but byte-level reads are still more reliable.

### G2. Stale cached binary ≠ latest features

Bundled-app installers often check a remote version and skip download if a cached binary exists. If you reverse-engineered an old version and the user reports behavior you don't see in the source, **re-run the installer** (or fetch the version manifest manually) before assuming the source is current.

```bash
# Example pattern - varies by tool
curl -fsSL https://example.com/install.sh | head -50  # find version-fetch URL
curl -fsSL https://static.example.com/cli/cli-version.txt
./your-tool --version
# Compare. If different, re-install.
```

### G3. APFS / NTFS case-insensitivity silently overwrites files

When extracting many minified function bodies (`cVR`, `CVR`, `dpr`, `DPR`, …) and saving each to its own file, **macOS APFS and Windows NTFS treat `cVR.txt` and `CVR.txt` as the same file**. The second write silently overwrites the first.

**Mitigation**: prefix filenames with something case-distinguishing, e.g. `mode-cVR.txt`, `mode-CVR.txt`, or use a hash suffix.

### G4. Bun's runtime adds 30-50 MB of unrelated symbols

A 70 MB Bun-compiled binary is **mostly Bun runtime** (~50 MB) plus your app (~20 MB). When fingerprinting, you will see thousands of strings like `tree-sitter-typescript`, `react-native-stylex` etc. that the user's actual app doesn't use — these are package names baked into Bun's package-resolution data.

**Mitigation**: when grepping for "what does this app do?", filter out runtime noise:
```bash
strings -n 8 ./target | rg -v 'node_modules|@oven/bun|package-lock|tree-sitter|ffmpeg-installer' | head
```

### G5. Source maps usually NOT shipped

Bundled apps strip source maps for production. Variable names are minified to `T`, `R`, `a`, `r`, etc. Treat the bundle like an obfuscated codebase: identify constants by tracing assignments (`var T="actual-name"`) and resolve interpolations manually.

### G6. The "extract" file is not legally redistributable

If reverse-engineering proprietary software, the extracted source is the vendor's IP. Use it for understanding behavior, **never commit it to git**, never post snippets in public issues. Cleanup your `extracted-bundle.js` files in Phase 9.

---

## Silent-failure patterns specific to bundled JS

| Pattern | Why it's silent |
|---|---|
| Bundle includes unreachable dead code from tree-shaking failures | You read code that never runs — verify with runtime trace |
| `process.env.X` resolved at BUILD time, not RUNTIME | Setting the env var at runtime has no effect; the value is baked in |
| `import.meta.url` in compiled binary returns `bun://...` not a real path | File-relative resolution silently breaks |
| Worker threads spawn from embedded code, look for sub-bundle inside main bundle | Workers may have their own copy of dependencies |
| Minified identifiers with case variants used in same module | Easy to confuse `cVR` with `CVR` when reading fast |

---

## Phase 9 cleanup specifics for bundled-JS work

```bash
# Remove extracted bundles — they may contain proprietary source
rm -f /tmp/extracted-bundle.js /tmp/extracted-*.js
rm -rf /tmp/asar-extracted/
rm -rf /tmp/_MEI*

# Remove strings dumps
rm -f /tmp/*-strings.txt /tmp/*-strings-v*.txt

# Remove Python helper scripts created for parsing
rm -f /tmp/extract_bundled_js.py /tmp/parse_template.py

# Verify the extraction directory is gone (if you used a workspace dir)
ls /Users/$USER/local-workspaces/*-extracted/ 2>/dev/null
# rm -rf only after journal review confirms nothing important is there
```

---

## When to escalate back to `native-binary.md`

If extraction reveals the "bundle" is actually compiled to v8 cached data (pkg with `--public-packages` or PyInstaller with bytecode-only mode), and decompilation is non-trivial, **switch back to `native-binary.md` workflow** (Ghidra against the runtime + careful tracing). Bundled-JS workflow only helps when the high-level source is recoverable as readable text.

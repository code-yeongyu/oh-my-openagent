# Ghidra — Decompile Binaries Into Readable C

**https://github.com/NationalSecurityAgency/ghidra**

Ghidra is the NSA's open-source reverse-engineering suite. Its defining feature is a **decompiler** that turns machine code back into readable C. For any binary you don't have source for, this is the correct starting point — not `strings`, not hex-staring, not `objdump -d`.

**Use Ghidra when**: third-party closed-source libs, malware analysis, vendored binaries whose behavior contradicts docs, CTF challenges, firmware, any time you need to read compiled code.

---

## Install

```bash
# macOS
brew install --cask ghidra
# OR download the release ZIP from the repo and ./ghidraRun

# Linux
# Download from https://github.com/NationalSecurityAgency/ghidra/releases
# Requires JDK 21+
./ghidraRun

# Dependency
java -version    # must be 21+
```

Ghidra is a Java Swing app. Looks dated, works well.

---

## First-time workflow (memorize this — it's not obvious)

1. **Start Ghidra**: `ghidraRun`
2. **Create a project**: File → New Project → Non-Shared → name it `debug-<binary-name>` (journal this path so you can rm it at Phase 9 if disposable).
3. **Import the binary**: File → Import File → pick your target. Accept default format detection.
4. **Double-click the imported binary** in the project listing. Ghidra asks to analyze it — say **yes**, accept defaults for the first pass. This takes anywhere from seconds (small binary) to tens of minutes (large binary).
5. **Once analysis completes**, you're in the CodeBrowser view.

Two panels you'll use 95% of the time:

- **Listing** (middle) — the disassembly with Ghidra's inferred labels/types.
- **Decompiler** (right) — the reconstructed C. The real value.

---

## Finding the right function fast

Don't try to read the whole binary. Use these to narrow:

### Symbol Tree (left panel)

- `Functions` — all detected functions. Stripped binaries show `FUN_00401234` (address-named); unstripped show actual names.
- `Imports` — dynamically-linked functions. Great for "does this binary call `system()`, `strcpy`, `curl_easy_perform`?"
- `Exports` — if it's a library.

Click to jump. The Decompiler updates instantly.

### String search

```
Search → For Strings
```

Produces a list of all strings. Right-click a string → `References` → `Show References to Address`. Jumps to code that references it. **This is how you find which function handles the error message you saw at runtime.**

### Memory search for bytes

```
Search → Memory
```

Search hex or text. Useful for known magic bytes, file-format signatures, constants.

### Cross-references (XREF)

Right-click any function / address → `References → Find References to`. Shows every place that calls it. Walk the call graph backward from interesting functions.

---

## Making the decompiler's output readable

Ghidra's decompiler is good but needs hints. These three actions dramatically improve its output:

### 1. Rename variables

Click a variable in the Decompiler view → press `L` → type a better name. Ghidra propagates the rename across all uses.

### 2. Set types

A variable that looks like `undefined4` or `void *` is unhelpful. Click it → press `Ctrl+L` → set type (e.g. `int`, `char *`, `struct my_header *`).

For pointers to structs from headers you have, use:
```
File → Parse C Source → paste header file → auto-creates struct types
```

Then assign the struct type to the pointer. Ghidra resolves field accesses immediately.

### 3. Retype function signatures

Click the function name in the Decompiler → press `F` (Edit Function Signature) → set return type + argument types. This propagates through callers.

Do these three actions on the 3-5 most relevant functions and the decompiler output becomes near-source-readable.

---

## Patterns for specific bug types

### Looking for integer overflow / buffer overflow

```
Listing: look for
  - LEA → CMP patterns on sizes
  - memcpy/strcpy/sprintf with non-constant sizes
Decompiler: look for
  - arithmetic on size_t without bounds check
  - `+ user_input` in a length calculation
```

### Looking for a missing auth check

Navigate from the handler entry (found via Strings or Imports) and check the control flow:

```
Decompiler: does the function return early / jump to error handler when some flag is not set?
  If the check is absent, that's the bug.
```

### Looking for hardcoded URLs / keys / paths

```
Search → For Strings → filter `http:` / `https:` / `/etc/` / `bearer ` / `api_key`
```

### Looking for dispatch / plugin loading

```
Imports → dlopen, LoadLibrary, dlsym, GetProcAddress
```

The strings referenced near those calls are often plugin names.

---

## Scripting (headless Ghidra)

When you need to automate analysis across many binaries, or repeat a workflow:

```bash
# Headless analyzer
$GHIDRA_INSTALL_DIR/support/analyzeHeadless \
  <project-dir> <project-name> \
  -import <binary> \
  -postScript <script.py or script.java>
```

Ghidra supports Python 3 scripts (via Jython-compatible API) and Java. Useful scripts:

- Dump all function signatures to JSON
- Find all calls to `system()` with constant arguments
- Auto-rename FUN_xxx based on heuristics (string refs, call patterns)

The community has a large collection: https://github.com/NationalSecurityAgency/ghidra/tree/master/Ghidra/Features/Base/ghidra_scripts

---

## Bookmarks + Notes

Ghidra has built-in bookmarks and comments. Use them as your journal inside the project:

- Right-click an address → `Set Bookmark` → tag as `Note`. Attach a description.
- Right-click → `Comments → Set EOL Comment` (shows up inline in decompiler).

Treat these as part of the journal. If you end up promoting this Ghidra project (keeping it after the debug session), the comments become durable documentation.

---

## Gotchas

- **Large binaries need more Java heap.** Edit `support/launch.properties` and bump `VMARGS=-Xmx8G` (default is often 2G, too small).
- **Save often.** Ghidra's autosave is not instant; a crash loses uncommitted analysis.
- **Decompiler has timeouts.** For complex functions it may give up and print `/* WARNING: ... */`. Increase timeout in `Edit → Tool Options → Decompiler`.
- **Archs beyond x86/ARM/MIPS** sometimes need Sleigh processor module tweaks. Rare but possible.
- **Signed vs unsigned decompilation** is frequently wrong. Manually retype when integer behavior matters.

---

## When Ghidra is NOT the right tool

- You have the source. Go read it.
- Bug is in your own recently-compiled binary. Rebuild with `-g` and use gdb/pwndbg (see [pwndbg.md](pwndbg.md)).
- You just need to know which libs a binary links. `ldd` / `otool -L` / `readelf -d` are faster.
- You just need strings. `strings -n 8` is faster.

Ghidra is the right tool when you need to **read the logic** of a binary you don't have source for.

---

## Phase 9 cleanup specifics

```bash
# If you created a scratch project just for this debug session, journal path and remove:
# (the journal should have the exact path)
# Example:
ls ~/ghidra-projects/ 2>/dev/null
# rm -rf ~/ghidra-projects/debug-<binary-name>

# If you promoted the project (kept it), it's not cleanup — note it in the final summary to the user

# Kill any running Ghidra headless processes
pkill -f 'analyzeHeadless' || true
```

# Native Binary Debugging (No Source / Reverse Engineering)

For binaries where you don't have trustworthy source: stripped production builds, third-party closed libs, malware, CTF challenges, firmware, vendored libs whose docs lie. The workflow is specific; doing it out of order wastes days.

This reference **coordinates** the triage and dynamic work. The heavy tools each have their own reference:
- **Static decompilation** → [tools/ghidra.md](../tools/ghidra.md)
- **Interactive debugging** → [tools/pwndbg.md](../tools/pwndbg.md)
- **Scripted interaction / exploitation** → [tools/pwntools.md](../tools/pwntools.md)

Read those before using them — especially Ghidra, which has a surprising amount of workflow that's not obvious.

---

## ⚠️ STOP — is this actually a stripped C/C++ binary?

A growing share of "binaries" are actually **bundled high-level apps** — Bun SEA, Node SEA, Deno compile, pkg, nexe, Electron, Tauri, PyInstaller. Their workflow is completely different: the high-level source is recoverable with the right per-bundler tool (often plaintext, sometimes V8 cache / `.pyc` / eszip needing extra tooling), and Ghidra against the runtime VM wastes hours.

Quick check:

```bash
file ./target                                                    # Mach-O / ELF / PE - inconclusive
du -h ./target                                                   # 50 MB+ for a "simple CLI" → suspect bundled
strings -n 12 ./target | rg -iE 'bun|node_modules|webpack|esbuild|deno|pkg/lib|electron|pyinstaller|nexe|NODE_SEA_FUSE|tauri' | head -5
```

**If any hits** → close this file, open [bundled-js-binary.md](bundled-js-binary.md) instead. Following the Ghidra/pwndbg path on a bundled-app binary wastes hours decompiling the runtime VM while the app-level bundle is recoverable with the right per-bundler tool (plaintext for Bun/pkg/nexe/Electron-asar; eszip / V8-cache / `.pyc` for Deno / Node SEA / PyInstaller).

If `file` says "Mach-O" or "ELF", `du` is < 20 MB, and the strings check is empty → continue here.

---

## The workflow (do these in order)

Every step's output is input to the next. Skipping steps means guessing later.

```
  [1] Triage           →  what kind of binary is this?
  [2] Dynamic tracing  →  what syscalls / libcalls does it make?
  [3] Static analysis  →  what does it DO, in readable form? (Ghidra)
  [4] Dynamic debug    →  confirm hypotheses at runtime (pwndbg)
  [5] Scripted repro   →  lock the bug with a pwntools script
  [6] TDD + fix / report
```

Steps 1 and 2 are fast (minutes). Step 3 is slow (tens of minutes to hours depending on size). Don't skip 1-2 and go straight to Ghidra — the triage output tells you what to focus on inside Ghidra.

---

## [1] Triage — 5-minute fingerprint

```bash
# Basic identity
file ./target
#   elf, mach-o, pe? 32/64-bit? dynamically linked? stripped?

# Architecture details
readelf -h ./target                    # ELF header: entry point, arch, type
lipo -info ./target 2>/dev/null        # macOS: universal binary?

# Interesting strings (often leaks function names, error messages, URLs, API keys)
strings -n 8 ./target | head -100
strings -n 8 ./target | grep -iE '(http|/api/|error|debug|version)'

# Imported symbols (what does it link against?)
nm -D ./target 2>/dev/null              # dynamic symbols
objdump -T ./target 2>/dev/null         # same, alternate tool
readelf -d ./target                     # dynamic section (NEEDED libs)
ldd ./target 2>/dev/null                # resolved library paths

# Security posture (affects what exploits / bugs are possible)
checksec --file=./target                # requires pwntools or installing checksec
#   NX, PIE, RELRO, stack canary, FORTIFY

# Is it stripped?
nm ./target 2>/dev/null | head          # empty? stripped. full? not stripped.
file ./target                           # will say "stripped" or "not stripped"
```

### ⚠️ `strings -n N` silently drops short content

`strings` prints runs of printable characters of length **≥ N**. With `-n 8`, **anything shorter than 8 chars sandwiched between non-printable bytes is dropped silently**. This includes:

- Short identifier interpolations in templates (`${x}`, `${i}`, `${R}`)
- Short embedded constants (`v3`, `null`, integer immediates as bytes)
- Short error codes between binary padding

Real example: a JavaScript template literal `<INSTRUCTIONS>\n${x}\n</INSTRUCTIONS>` came out of `strings -n 8` as `<INSTRUCTIONS>\n</INSTRUCTIONS>` — the `${x}` (4 chars) was dropped. A consumer reading the dump would conclude the template was empty. It is not.

**Use `strings` only for fingerprinting (Phase 1).** For any extraction whose correctness matters, **read bytes directly**:

```bash
# Count occurrences of a needle
LC_ALL=C grep -aoc 'NEEDLE' ./target

# Find offsets
LC_ALL=C grep -aob 'NEEDLE' ./target | head

# Or via Python for byte-precise context
python3 -c "
import sys
data = open('./target','rb').read()
needle = b'NEEDLE'
pos = data.find(needle)
print(repr(data[max(0,pos-100):pos+200]))
"
```

If you must keep using `strings`, lower the threshold: `strings -n 1 -t x ./target | rg ...`. The signal-to-noise drops sharply but short content is preserved.

Write the triage summary to the journal:

```markdown
## Binary triage
- Type: <ELF 64-bit, dynamically linked, stripped>
- Arch: <x86_64 | arm64 | ...>
- Libs: <libc, openssl, libcurl>
- Security: <NX, PIE, Partial RELRO, no canary>
- Interesting strings: <short list>
- First hypothesis surface: <which function / area looks most relevant>
```

---

## [2] Dynamic tracing — what does it actually call?

These are cheap — run them before Ghidra to orient yourself.

### Linux: strace + ltrace

```bash
# System calls
strace -f -o trace.out ./target arg1 arg2
strace -f -e trace=network ./target           # filter to network syscalls
strace -f -e trace=file ./target              # filter to file ops

# Library calls (less useful when stripped but still informative)
ltrace -f -o ltrace.out ./target
ltrace -f -e 'str*+mem*' ./target             # filter to string/mem functions
```

### macOS: Mach-O specifics

**SIP block reality check.** With System Integrity Protection enabled (default on every modern macOS), `dtruss` / `dtrace` will **silently fail** to attach to:
- Anything in `/usr`, `/bin`, `/sbin`, `/System`
- Apple-signed binaries (Xcode CLT, Homebrew formulae from Apple-distributed taps)
- Notarized vendor binaries (Bun, Deno, Docker Desktop, etc.)

`dtruss ./target` will appear to run but produce zero events. This is not a bug; it is the SIP design. Disabling SIP requires a Recovery Mode reboot — usually not worth it. Use the alternatives below.

```bash
# dtruss — works only when SIP allows it (your own unsigned binaries)
sudo dtruss -f ./target 2>&1 | head -20         # equivalent to strace
# If output is suspiciously empty → SIP blocked it. Switch to lldb or app-level logging.
```

**Mach-O metadata inspection (no SIP issues, no debugger needed):**

```bash
# Architecture and slices
file ./target                                    # arm64 / x86_64 / universal
lipo -info ./target                              # which architectures included
lipo -thin arm64 ./target -output ./target-arm64 # extract one slice for analysis

# Headers & load commands (segments, dylibs, code-signature pointer)
otool -h ./target                                # Mach header (cputype, ncmds, flags)
otool -l ./target | head -100                    # load commands; entitlements live in code-signature blob, see codesign below

# Dynamic library dependencies (macOS equivalent of ldd)
otool -L ./target                                # linked dylibs with versions
dyld_info ./target                               # macOS 13+, more detailed than otool -L

# Disassembly
otool -tv ./target | head -200                   # quick disassembly without Ghidra
otool -tV ./target                               # with symbol-resolved branches

# Imported / exported symbols (Apple `nm`, NOT GNU)
nm -u ./target                                   # undefined references = imports
nm -gU ./target                                  # external defined = exports
# Note: GNU `-D`/dynamic flags are not honored on Apple `nm`; use the above forms.
symbols -fullSourcePath -onlyWithDebugInfo ./target  # if any debug info survives

# Code signature & entitlements (entitlements come from codesign, NOT otool)
codesign -dv --entitlements :- ./target 2>&1     # signature info + entitlements XML on stdout
spctl --assess --type execute -vv ./target       # Gatekeeper assessment

# Cert chain — extract to a temp dir to avoid creating files named -0/-1 in cwd
tmp=$(mktemp -d)
codesign -dvv --extract-certificates="$tmp/cert" ./target 2>&1
ls -la "$tmp"
# rm -rf "$tmp"  # journal first, clean up later

# Strings inside specific segments only (less noise than full-binary strings)
otool -s __TEXT __cstring ./target               # C string section
otool -s __TEXT __const ./target                 # constants section
```

**Interactive debugging on macOS — use `lldb`, not `gdb`.**

GDB on macOS requires a self-signed code-signing certificate (`codesign --entitlements gdb.entitlements --sign gdb-cert /opt/homebrew/bin/gdb`) and even then is unreliable on arm64. **Use `lldb` directly** — it ships with Xcode CLT and works without configuration.

```bash
# Start lldb
lldb ./target

# Set arguments
(lldb) settings set target.run-args arg1 arg2

# Run with breakpoints
(lldb) breakpoint set --name function_name        # symbol-based
(lldb) breakpoint set --address 0x1000034c0       # address-based
(lldb) breakpoint set --regex '.*decode.*'         # regex over symbols

# Run / step / inspect
(lldb) run
(lldb) bt                                          # backtrace
(lldb) frame variable                              # locals
(lldb) register read                               # all registers
(lldb) memory read --size 8 --format x --count 16 $sp   # 16 qwords from stack
(lldb) disassemble --frame                         # current function
(lldb) image list                                  # loaded modules
(lldb) image lookup -a 0x1000034c0                 # which module + symbol owns this address

# Process attach to running process
(lldb) process attach --pid 12345
(lldb) process attach --name target               # attach by name

# Print Mach-O specific
(lldb) image dump sections ./target
(lldb) image dump symtab ./target
```

**Function interception via `DYLD_INSERT_LIBRARIES`** (macOS equivalent of `LD_PRELOAD`):

```bash
# Build a shim dylib that overrides specific functions
# Then run target with it preloaded
DYLD_INSERT_LIBRARIES=./shim.dylib DYLD_FORCE_FLAT_NAMESPACE=1 ./target
```

DYLD_INSERT works in the unrestricted case but is blocked in three distinct scenarios — distinguish them when diagnosing why your shim didn't load:

1. **SIP / restricted process** (target has the `__RESTRICT,__restrict` section, is setuid/setgid, or is a platform/Apple-signed binary): dyld unconditionally strips all `DYLD_*` env vars before the process starts. Nothing you set will reach the target.
2. **Hardened runtime + library validation** (`CS_RUNTIME` flag set, `com.apple.security.cs.disable-library-validation` entitlement absent): the process accepts `DYLD_INSERT_LIBRARIES` but **rejects** loading any dylib that isn't signed by the same Team ID or by Apple. Symptom: shim is found but not loaded; check `log show --predicate 'eventMessage CONTAINS "library validation failed"'`.
3. **Notarization / Gatekeeper translocation**: the binary may be running from a translocated path; relative paths in `DYLD_INSERT_LIBRARIES` won't resolve. Use absolute paths.

Check each:

```bash
# Restrict segment present? (case 1)
otool -l ./target | grep -A2 __RESTRICT
# Hardened runtime flag? (case 2)
codesign -d --verbose=4 ./target 2>&1 | grep -iE 'flags=|CodeDirectory'
# Look for "0x10000(runtime)" or similar in the flags line.
# Disable-library-validation entitlement?
codesign -d --entitlements :- ./target 2>&1 | grep disable-library-validation
```

**App-level debug logging (always works, ignores SIP):**

When debugger attach is blocked, fall back to maximizing the app's own logging:

```bash
# Try common patterns
APP_DEBUG=1 APP_LOG_LEVEL=debug APP_LOG_FILE=/tmp/trace.log ./target
NSDebugEnabled=YES ./target                       # Cocoa apps
OS_ACTIVITY_MODE=debug ./target                   # os_log subsystem

# Then read os_log unified logging stream live
log stream --predicate 'process == "target"' --level debug

# Or extract historical logs
log show --predicate 'process == "target"' --last 1h --info --debug
```

This is the **partial-runtime-evidence path** for macOS. See [methodology/partial-runtime-evidence.md](../methodology/partial-runtime-evidence.md) for how to combine app-level logs with static analysis when wire-level capture is blocked.

**Network capture on macOS (TLS-decrypted):**

```bash
# 1. Find the active network service (don't assume "Wi-Fi"):
#    Map the default-route interface to the matching networksetup service name.
networksetup -listallnetworkservices                        # show options
DEFAULT_IF=$(route -n get default 2>/dev/null | awk '/interface:/ {print $2}')
echo "Default-route interface: $DEFAULT_IF"
# Match the interface (en0, en1, ...) back to a service name:
SERVICE=$(networksetup -listallhardwareports | awk -v iface="$DEFAULT_IF" '
  /^Hardware Port:/ { hp = substr($0, index($0,$3)) }
  /^Device:/        { if ($2 == iface) print hp }
')
if [ -z "$SERVICE" ]; then
  echo "Could not auto-detect active service. Pick one from -listallnetworkservices manually." >&2
  echo "Aborting proxy setup." >&2
  false  # signal failure but stay safe at top level
else
  echo "Using service: $SERVICE"
fi

# 2. JOURNAL the original proxy state before changing it (REQUIRED for safe rollback):
networksetup -getwebproxy "$SERVICE"        # save this output to journal
networksetup -getsecurewebproxy "$SERVICE"  # save this too

# 3. Start mitmproxy with persistent CA at ~/.mitmproxy/
mitmproxy --listen-host 127.0.0.1 --listen-port 8888 &

# 4. Trust the mitmproxy CA system-wide if the target uses URLSession or any framework
# that ignores HTTPS_PROXY/SSL_CERT_FILE (most macOS-native apps do):
sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain ~/.mitmproxy/mitmproxy-ca-cert.pem

# 5. Two routing options. Try env-var first; fall back to system proxy:
# 5a. Apps that honor env vars (most CLIs):
HTTPS_PROXY=http://127.0.0.1:8888 SSL_CERT_FILE=~/.mitmproxy/mitmproxy-ca-cert.pem ./target ...

# 5b. Apps that use URLSession / system network config (most GUI apps, Bun, some CLIs):
networksetup -setwebproxy "$SERVICE" 127.0.0.1 8888
networksetup -setsecurewebproxy "$SERVICE" 127.0.0.1 8888

# 6. Cleanup — RESTORE original state from journal, untrust CA:
networksetup -setwebproxystate "$SERVICE" off
networksetup -setsecurewebproxystate "$SERVICE" off
sudo security delete-certificate -c "mitmproxy" /Library/Keychains/System.keychain
```

**Critical**: forgetting step 6 leaves all your subsequent traffic mis-routed and silently MITM-able. Journal every step.

### What to look for

| Observation | Hypothesis |
|---|---|
| `open("/etc/secret-config", ...)` | Reads unexpected config; look at what it does with contents |
| `connect(... 1.2.3.4:443)` | Phones home or depends on an external service |
| `getenv("FOO")` returning NULL | Env var expected but not set |
| Repeated `poll`/`epoll_wait` with no progress | Stuck on I/O; check downstream |
| `SIGSEGV` caught by signal handler | Custom crash recovery — often hides the real bug |
| `dlopen("libfoo.so.42")` | Dynamic plugin loading; check plugin path |

---

## [3] Static analysis with Ghidra

When triage + tracing have narrowed you to "something in function X" or "the crypto routine is weird", open Ghidra.

**Open [tools/ghidra.md](../tools/ghidra.md) before launching Ghidra** — the import / analyze / decompile workflow is not obvious and first-time users waste an hour figuring it out.

Ghidra's decompiler turns machine code into readable-ish C. That's usually what you want. Stay in the Decompiler view; drop to Listing (disassembly) only when the decompiler punts.

---

## [4] Dynamic debugging with pwndbg

Once static analysis gives you a hypothesis ("this branch at 0x401234 is where the validation fails"), confirm it at runtime with pwndbg.

**Open [tools/pwndbg.md](../tools/pwndbg.md) before launching gdb.** Pwndbg gives you the context view (registers / stack / disasm / code all visible at once) which is essential for binary debugging.

Typical pwndbg flow:

```
$ gdb ./target                                 # pwndbg loads automatically if installed
pwndbg> break *0x401234                        # break at the address static analysis flagged
pwndbg> run arg1 arg2
# At the breakpoint:
pwndbg> context                                # registers + stack + disasm
pwndbg> telescope $rdi                         # walk pointers at $rdi
pwndbg> x/20xw $rsp                            # raw dump of stack
pwndbg> ni / si                                # step next / step instruction
```

---

## [5] Scripted reproduction with pwntools

Once you have a hypothesis with a concrete repro input, lock it down with pwntools. This is the "failing test" equivalent for binaries.

**Open [tools/pwntools.md](../tools/pwntools.md)** — the Process/Remote/ELF/context APIs are the foundation.

```python
from pwn import *

context.binary = elf = ELF('./target')

p = process('./target')
p.sendlineafter(b'> ', b'<trigger input that reproduces the bug>')
result = p.recvall(timeout=3)
assert b'expected-output-when-fixed' in result, f'bug repro: {result}'
```

This script is now your "red test". When the fix is applied, the script should pass (or the assertion should be inverted for negative tests — e.g. "the crash string should NOT appear").

---

## [6] Fixing a binary bug you can't recompile

Three options, in preference order:

### Option A: Patch at the source (if you have it)

If the bug is in your own code and source is available, fix it there and rebuild. Standard TDD path.

### Option B: Binary patch

For tiny fixes (one byte, one branch inversion):

```bash
# Identify the exact byte offset
# e.g. Ghidra says the bug is at 0x401234 = file offset 0x1234
printf '\x90\x90' | dd of=./target bs=1 seek=$((0x1234)) conv=notrunc
```

Journal the exact `dd` command and the original bytes so you can revert.

### Option C: Wrap / shim

If you can't patch the binary, write a shim library (LD_PRELOAD on Linux, DYLD_INSERT_LIBRARIES on macOS) that overrides the buggy function. pwntools has examples.

### Option D: Report upstream

If it's a third-party binary and none of the above are feasible, the "fix" is a high-quality bug report with:
- Full triage summary
- Reproducible pwntools script
- Ghidra decompilation of the buggy function
- Hypothesis about the root cause
- Recommended patch sketch (in C or pseudocode)

---

## Silent-failure patterns in native binaries

| Pattern | Why it's silent |
|---|---|
| Ignored libc return codes (`read`, `write`, `malloc`) | Bug continues with garbage data; no check |
| Signal handler swallows SIGSEGV | Crash converted to "something didn't work"; no log |
| `setjmp`/`longjmp` unwinding over cleanup | Resources leak silently |
| Thread-local error state never read (`errno`, `GetLastError`) | Error happened, nobody asked |
| Recovered assertion failure in release build | `assert` compiled out; precondition violations silently corrupt |
| Dangling pointer reads after free | Often looks like valid data until it doesn't |

---

## Phase 9 cleanup specifics

```bash
# Kill debugger sessions
pkill -f 'gdb' || true
pkill -f 'lldb' || true

# Ghidra scratch projects (if made just for this session)
# Named something like ~/ghidra-projects/debug-<timestamp>:
ls -la ~/ghidra-projects/ 2>/dev/null
# rm -rf ~/ghidra-projects/debug-scratch         # only if the journal says to

# Core dumps left from crashes
rm -f ./core ./core.* ~/core.*

# strace/ltrace output files
rm -f trace.out ltrace.out

# If you made a binary patch (Option B above), confirm revert
# The journal should have the original bytes — restore them:
# printf '<original-bytes>' | dd of=./target bs=1 seek=<offset> conv=notrunc

# Trace-output files
rm -f /tmp/debug-*.bin /tmp/debug-*.strace /tmp/debug-*.ltrace

# macOS-specific:
# Restore proxy settings if you set them (CRITICAL — leaves system traffic mis-routed otherwise)
# Use the SAME $SERVICE you used when enabling the proxy (read it from the journal).
# Do NOT hardcode "Wi-Fi" — many machines route traffic over Ethernet, USB tether, or a VPN service.
[ -n "$SERVICE" ] && {
  networksetup -setwebproxystate "$SERVICE" off 2>/dev/null
  networksetup -setsecurewebproxystate "$SERVICE" off 2>/dev/null
}
# Or restore explicitly from the journaled original state — see the proxy section above.

# Stop mitmproxy
pkill -f 'mitmproxy' 2>/dev/null

# Remove DYLD shim libraries you built
rm -f /tmp/*-shim.dylib

# Clear extracted strings dumps (these can be huge and may contain secrets)
rm -f /tmp/*-strings*.txt

# Verify hostname resolution returns to normal (mitmproxy can leave entries)
scutil --dns | head -20
```

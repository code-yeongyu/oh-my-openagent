# pwndbg — GDB With the Useful Views Always On

**https://github.com/pwndbg/pwndbg**

pwndbg is a GDB plugin that turns GDB into something humans can actually use for binary debugging. It's strictly a superset of plain GDB — every vanilla GDB command still works, and pwndbg adds views and commands that make you productive.

**If you'd reach for plain `gdb`, reach for pwndbg instead.** The only reason not to is if pwndbg isn't installed on the machine, and that's a 2-minute fix.

---

## Install

```bash
# macOS
brew install pwndbg
# Or from source:
git clone https://github.com/pwndbg/pwndbg
cd pwndbg && ./setup.sh

# Linux
# Most distros: apt/dnf/pacman install pwndbg (check availability)
# Or the same git + ./setup.sh

# Verify
gdb --version
gdb ./any-binary
# At gdb prompt, you should see pwndbg banner + colorful context view
```

Once installed, pwndbg auto-loads every time you start `gdb`. You don't source anything manually.

---

## The `context` view — the one feature that changes everything

Plain GDB: you run `info registers`, then `bt`, then `x/10xw $rsp`, then `disas`. Four commands to see what's going on.

pwndbg: `context` (or it auto-shows at every break). One command. Everything on screen:

```
──── registers ────
 RAX  0x0
 RBX  0x7ffffffde158
 RCX  0x7fffff7abf10
 ...
──── disasm ────
 ► 0x401234  mov rdi, rax
   0x401237  call 0x401190
   ...
──── stack ────
 00:0000│ rsp 0x7ffffffde0a0 → 0x7fffff7c4000
 01:0008│     0x7ffffffde0a8 → 0x0
 ...
──── backtrace ────
 ► f 0  0x401234 parse_input+0x3c
   f 1  0x401180 main+0x120
   f 2  0x7fffff7a5083 __libc_start_main+0xf3
```

You always know where you are, what the CPU state is, what's on the stack, and how you got here. This is why pwndbg is the default.

---

## Launch recipes

```bash
# Debug an existing binary
gdb ./target

# With args
gdb --args ./target arg1 arg2

# Attach to a running process
gdb -p $(pgrep target)

# With a core dump
gdb ./target ./core

# Headless / remote (for automation or IDE attach)
gdbserver :2345 ./target                  # on the target box
gdb ./target                              # on your box
(gdb) target remote <host>:2345
```

At the pwndbg prompt:

---

## Essential commands (pwndbg additions)

### Layout / view

```
context                        # reprint the context view (usually auto)
context regs stack              # only show registers + stack sections
tel $rsp 20                     # telescope — walk pointers at $rsp for 20 slots (KEY COMMAND)
tel $rdi 10                     # walk pointers at $rdi (e.g. to dump a struct)
stack 20                        # 20 entries of stack
vmmap                           # virtual memory map of the process
```

**`telescope` is pwndbg's killer command.** Given an address, it walks pointers recursively:
```
00:0000│   0x7ffd... → 0x601010  (heap) → 0x2a (unknown, i.e. a number 42)
01:0008│   0x7ffd... → 0x7fff... (stack) → 'hello world'
```
This single view resolves 80% of "what is at this address" questions.

### Heap debugging

```
heap                            # overview of chunks
bins                            # tcache / fastbin / unsorted / smallbin / largebin state
malloc_chunk <addr>             # inspect a specific chunk
find_fake_fast <addr>           # (exploit context) find fake-fast overlap candidates
vis_heap_chunks                 # visualize heap layout
```

For use-after-free / double-free / heap overflow hypotheses, `heap` + `bins` is usually sufficient to see the corruption.

### Exploitation-adjacent (useful for bug understanding too)

```
checksec                        # NX, PIE, RELRO, canary status
rop --grep 'pop rdi'            # find ROP gadgets
nx                              # step over (aliased nicely)
ni                              # step over single instruction
si                              # step into single instruction
```

### Search

```
search -t byte 0x41             # find byte 0x41 anywhere in memory
search -t string "admin"        # find string
search -p <addr>                # find pointers to <addr>
```

---

## Standard GDB commands still work

pwndbg doesn't replace GDB; it augments it. Everything you know still works:

```
break main                      # breakpoint at function
b *0x401234                     # breakpoint at address
b file.c:42                     # breakpoint at file:line
c                               # continue
n                               # next (source-level step over)
s                               # step (source-level step into)
finish                          # step out
info breakpoints                # list breakpoints
delete <n>                      # delete breakpoint
watch <var>                     # break on write to variable
rwatch <var>                    # break on read
awatch <var>                    # break on access
p <expr>                        # print expression
p/x <expr>                      # print in hex
x/20xw <addr>                   # examine 20 words as hex
bt                              # backtrace
frame <n>                       # switch frame
info registers                  # registers (but `context` is better)
disassemble <func>              # disasm a function
```

---

## Python scripting inside GDB

pwndbg exposes a full Python API. Useful for automating observations across many breakpoints:

```python
(gdb) python
import gdb
def on_break():
    frame = gdb.selected_frame()
    pc = frame.read_register('pc')
    print(f'hit at {hex(int(pc))}')
    # Dump args, locals, anything
end
```

Or scripted runs from outside:
```bash
gdb -batch -ex 'source script.gdb' -ex 'run' ./target
```

---

## Common workflows by bug type

### Segfault / crash

```bash
gdb ./target
(gdb) run <args>
# ... crash ...
(gdb) context                    # see the crash site
(gdb) bt                         # how did we get here?
(gdb) info registers             # what state
(gdb) tel $rsp 20                # what's on the stack
```

### "Function returns wrong value"

```bash
gdb ./target
(gdb) break <function>
(gdb) run <args>
# At breakpoint:
(gdb) finish                     # let it run to the return
# pwndbg shows RAX (return value) in context
```

### "Variable has unexpected value at point X"

```bash
gdb ./target
(gdb) break <point-X>
(gdb) run
# At breakpoint:
(gdb) p <var>                    # its value
(gdb) watch <var>                # set a watchpoint — break when it changes
(gdb) c                          # continue; next stop is where it was modified
```

### "Memory corruption / heap bug"

```bash
gdb ./target
(gdb) run
# Crash at free():
(gdb) heap                       # heap state
(gdb) bins                       # bin state — often shows corruption here
(gdb) vis_heap_chunks            # visualize
(gdb) malloc_chunk <suspicious-addr>
```

---

## Gotchas

- **`bt` looks weird on stripped binaries** — function names become offsets. Use Ghidra's function labels to map back (see [ghidra.md](ghidra.md)).
- **PIE binaries have randomized base addresses.** Addresses you see in Ghidra are unslid; addresses in pwndbg are slid. The `vmmap` command shows the base, and pwndbg's `piebase` command gives you the offset.
- **Optimized builds inline functions.** You'll set a breakpoint on `my_function` and it won't hit because the function was inlined. Either disable optimizations or break on callers.
- **Stack canaries trigger `__stack_chk_fail`.** If you see that in a backtrace, the bug caused a stack-smash; look one frame up.

---

## Phase 9 cleanup specifics

```bash
# Kill gdb / pwndbg sessions
pkill -f 'gdb' || true
pkill -f 'gdbserver' || true

# Remove core dumps generated during session
rm -f ./core ./core.* ~/core.*

# Remove any scripted GDB files
rm -f /tmp/debug-*.gdb
```

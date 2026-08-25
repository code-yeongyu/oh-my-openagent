# Linux supervisor hang - criteria evidence

Container: oven/bun:1.3.12-debian (workspace copied in, not bind-mounted).
Final sources at 2752ad20f.

## Criterion 1+2 - ic8 deadline instants, both platform branches
    (pass) injected posix branch ... graceful and hard tree termination use those instants [92.00ms]
    (pass) injected win32 branch ... graceful and hard tree termination use those instants [123.00ms]
    5 pass / 0 fail   Ran 5 tests across 1 file. [532.00ms]
Previously each hung for the full 60000ms ceiling.

## Criterion 3 - child that ignores SIGTERM
    (pass) #given a child that ignores SIGTERM #when termination grace expires #then the process group is killed [125.00ms]
    1 pass / 0 fail
    orphan check (ps -eo pid,args | grep supervisor-child|child-bootstrap): NO ORPHANS

## Criterion 4 - macOS regression surfaces
    packages/memory-core                      : 481 pass  0 fail Ran 481 tests across 60 files. [75.54s]
    packages/omo-senpi/src/components/memory  : 490 pass  0 fail Ran 490 tests across 90 files. [89.21s]

## Criterion 5 - adversarial audit of the fix commits
Forbidden patterns added (.skip/.only/xfail/raised ceiling): NONE
The fix is two bounded re-reads plus event coalescing; no ceiling was raised, no test skipped,
no assertion weakened, no Linux coverage removed.

## Statistical validation (n=60 per arm, isolated posix deadline case, real Linux)
    HEAD                        11/60 = 18.3%
    + clock re-read              3/60 =  5.0%
    + wait-helper fix            0/60 =  0.0%
Rejected hypotheses measured and reverted: cascade no-op 18/60, group-target hard kill 11/60,
test phase barrier 12/60.

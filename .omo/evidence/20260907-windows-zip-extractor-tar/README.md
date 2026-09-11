# Windows zip handling spawns whatever tar is on PATH, 2026-09-07

On Windows the zip path picks the extractor by OS build number and then spawns a bare `tar`, assuming that resolves to the bsdtar Windows ships at `System32\tar.exe`. It resolves through PATH instead. Any shell that puts Git for Windows' `usr/bin` first, which Git Bash does, hands the process GNU tar, and GNU tar cannot read a zip at all.

## Failing input, against upstream/dev at ad62603f0

Driving the shipped `extractZip` over a real zip, with Git Bash's PATH:

```
$env:PATH = 'C:\Program Files\Git\usr\bin;' + $env:PATH
bun zipx-driver.mts
```

`red-gitbash-path.log`:

```
bare 'tar' resolves to: tar (GNU tar) 1.35
RESULT: extractZip threw -> zip entry listing failed (exit 128): tar: Cannot connect to C: resolve failed
```

`control-default-path.log`, same driver, default PATH, before any change:

```
bare 'tar' resolves to: bsdtar 3.8.4 - libarchive 3.8.4 ...
RESULT: extractZip resolved | dest=["payload"]
```

## Two distinct failures, not one

`probe-tar-vs-zip.log` runs both tars against the same zip:

| tar | call | result |
| --- | --- | --- |
| bsdtar | `-xf <abs zip> -C <abs dir>` | exit 0, `dest=["payload"]` |
| GNU tar | `-xf <abs zip> -C <abs dir>` | exit 128, `Cannot connect to C: resolve failed` |
| bsdtar | `-tf <abs zip>` | exit 0 |
| GNU tar | `-tf <abs zip>` | exit 128, `Cannot connect to C: resolve failed` |
| GNU tar | `-xf probe.zip` from its own directory | exit 2, `This does not look like a tar archive` |

The last row is why this cannot be repaired by making the paths relative. The drive-letter colon is read as a remote host, and underneath that GNU tar has no zip support at all. Only the Windows bsdtar can do this job, so the binary has to be resolved rather than looked up.

## Who reaches it

Both spawn sites ship. `published-artifact-grep.log` finds them in the `oh-my-openagent@5.0.0-beta.45` tarball at `dist/index.js` lines 7812 and 27659. On Windows the ripgrep asset is a zip (`PLATFORM_CONFIG` has `x64-win32` as `extension: "zip"`), and the comment-checker binary download calls `extractZipArchive` through the same path.

## RED / GREEN

| run | before | after |
| --- | --- | --- |
| `extractZip` over a zip, Git Bash PATH | throws `zip entry listing failed (exit 128)` | resolves, `dest=["payload"]` |
| `extractZip` over a zip, default PATH | resolves | resolves |
| `bun test packages/utils/src/zip-entry-listing/ packages/omo-opencode/src/shared/archive-entry-validator.test.ts` | 10 tests | 13 pass / 0 fail, exit 0 |
| `bun run typecheck` | - | exit 0 |

The default-PATH row is the control: it passed before the change and still passes, so nothing about the working case was loosened.

Logs: `red-gitbash-path.log`, `green-gitbash-path.log`, `control-default-path.log`, `probe-tar-vs-zip.log`, `green-unit.log`, `green-typecheck.log`, `published-artifact-grep.log`.

## Mutation proof

| mutation | result |
| --- | --- |
| `zipTarCommand` returns the bare `"tar"` again (`mutation-m1-bare-tar.log`) | 2 pass / 1 fail, `Executable not found in $PATH: "tar"` |
| `windowsSystemTarPath` drops the existence check (`mutation-m2-no-existence-check.log`) | 2 pass / 1 fail, `expect(received).toBeNull()` |

The source was restored from a copy after each run and the suite is green again.

## Scope

The same absolute-path shape sits in `binary-downloader.ts` for `.tar.gz`, but both of its callers select the zip asset on win32, so it is unreachable today and is left alone. The senpi QA scripts carry it too and are contributor-only.

## Local versions

node v26.1.0, bun 1.3.14, GNU tar 1.35 at `C:\Program Files\Git\usr\bin\tar.exe`, bsdtar 3.8.4 at `C:\Windows\system32\tar.exe`, Windows 11. Tar versions are printed in `probe-tar-vs-zip.log`.

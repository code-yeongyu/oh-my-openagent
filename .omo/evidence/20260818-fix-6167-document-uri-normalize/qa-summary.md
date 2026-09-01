# QA summary: normalize document URIs at the openByUri boundary

Issue: #6167. Branch base: `dev` at `e199029e1`. Platform: Windows 11, Bun 1.3.14, Node 24.

Rebased onto `e199029e1` on 2026-08-19 and re-run there: 5 pass / 0 fail on the touched file, 67 pass / 0 fail on the unit regression, typecheck exit 0. `dev` at that commit still has no `normalizeDocumentUri` and no `decodeURIComponent` in the file.

## Defect confirmed on current dev

```
$ rg "normalizeDocumentUri|decodeURIComponent" packages/lsp-core/src/lsp/workspace-document-state.ts
(no matches)
```

All eight `openByUri` accesses keyed on the raw URI: six `get`, one `set`, one `delete`.

## Red

Three tests added to `workspace-document-state.test.ts`. Two fail before the fix.

```
$ bun test packages/lsp-core/src/lsp/workspace-document-state.test.ts
(fail) #given a server that percent-encodes a path segment #when it publishes #then the diagnostics reach the open document
(fail) #given a server that lowercases and percent-encodes the drive #when it publishes #then the diagnostics reach the open document
(pass) #given a document opened from a path the client already encodes #when the server echoes it verbatim #then the outgoing uri is unchanged

 3 pass
 2 fail
 15 expect() calls
Ran 5 tests across 1 file.
```

The received value on both failures is `[]`: `recordPublishedDiagnostics` returned early because `openByUri.get(params.uri)` missed.

## Green

```
$ bun test packages/lsp-core/src/lsp/workspace-document-state.test.ts
 5 pass
 0 fail
 17 expect() calls
Ran 5 tests across 1 file. [786.00ms]
```

## Revert and fail

The normalizer alone was stashed, leaving the new tests in place.

```
$ git stash push -- packages/lsp-core/src/lsp/workspace-document-state.ts
$ bun test packages/lsp-core/src/lsp/workspace-document-state.test.ts
 3 pass
 2 fail

$ git stash pop
$ bun test packages/lsp-core/src/lsp/workspace-document-state.test.ts
 5 pass
 0 fail
```

The two failures track the normalizer exactly, so the tests measure the fix rather than the environment.

## Typecheck

```
$ node_modules/.bin/tsgo --noEmit -p packages/lsp-core/tsconfig.json
EXIT=0
```

`bun run typecheck` also completed with no diagnostics across all thirty package projects.

## Regression

Every unit test in the package, with the four integration suites excluded:

```
$ bun test <all packages/lsp-core/src/**/*.test.ts except *.integration.test.ts>
 67 pass
 0 fail
 183 expect() calls
Ran 67 tests across 17 files. [829.00ms]
```

`bun test packages/lsp-core` is not a usable signal on this machine. It fails on `dev` before any change, and the failing set is not stable between runs:

| Run | Result |
| --- | --- |
| Unmodified `dev` | 81 pass, 15 fail |
| With this change | 79 pass, 20 fail |

Both failing sets are confined to the four `*.integration.test.ts` files, and the two sets differ from each other in both directions: tests that failed on unmodified `dev` pass with the change, and the reverse. The cause is visible in the output and is unrelated to URIs:

```
Error: ENOENT: no such file or directory, open 'C:\Users\...\Temp\lsp-apply-edit-SOF2ja\scenario.json'
    at file:///.../packages/lsp-core/src/lsp/fixtures/workspace-edit-server.mjs:4:29
  ^ this test timed out after 5000ms
killed 2 dangling processes
```

The fixture server races its own scenario file and the suites spawn real child processes against a 5s timeout. The unit run above is therefore the regression signal.

## CI, and a test defect it caught

The first CI run failed one test on `test (macos-latest)` and passed everywhere else. The failure was in the third new test, not in the fix.

```
(fail) #given a document opened from a path the client already encodes #when the server echoes it verbatim #then the outgoing uri is unchanged
error: expect(received).toBe(expected)
```

On macOS `mkdtemp` returns a path under `/var/folders`, which is a symlink to `/private/var/folders`. `openFile` runs `canonicalPath`, so `state.uri` is built from the resolved path while the assertion compared against the unresolved one. The fixture now wraps `mkdtempSync` in `realpathSync`, which is the same pattern `client-wrapper.test.ts` already uses for this reason.

This is a good outcome for the negative control: the assertion that the outgoing URI stays untouched was strong enough to fail on a platform where the input path was not what the test assumed.

## Behaviour left unchanged

Normalization applies only to the `openByUri` lookup key. `state.uri` is still `pathToFileURL(path).href`, and every outgoing `didOpen`, `didChange`, `didSave`, and `didClose` sends that value byte-identical, which the third test asserts. On non-Windows platforms only the decode runs, leaving the drive-letter fold off.

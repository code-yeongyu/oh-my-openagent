# PR 7491 cross-shell resume diagnostic QA

## What was tested

- Added a deterministic Windows formatting seam with a path containing `$`
  and spaces.
- Ran the focused launcher test failing first and after the correction.
- Ran the complete omo-native suite, package typecheck, and omo-native build.
- Drove the real launcher on macOS through `--version`, `--help`, and a
  filename/header mismatch using a POSIX path containing `$` and spaces.

## What was observed

- Failing first: the focused test failed because the portable suggestion
  formatter did not exist and Windows always received a path alternative.
- Focused green: 44 pass, 0 fail, 156 assertions.
- Complete omo-native suite: 271 pass, 0 fail, 776 assertions across 27 files.
- Typecheck: exit 0.
- `build:omo-native`: exit 0 with all 37 required artifacts present.
- Real `--version`: `omo 5.0.0-0.beta.42 (engine: senpi 2026.9.4-3)`.
- Real `--help`: exited zero and rendered the OmO command surface.
- Real mismatch diagnostic retained the portable header-ID command and the
  POSIX path alternative was a single-quoted shell word despite `$` and
  spaces.
- The Windows regression proves the same formatter emits only the header-ID
  command there, avoiding an unsafe command across cmd.exe, PowerShell, and
  Git Bash.
- After merging `dev@07e30350b`, the complete suite repeated at 271 pass,
  0 fail, and 776 assertions; typecheck and the 37-artifact payload build
  passed again. The real `--version` and `--help` surfaces exited zero, and a
  direct production formatter invocation returned only the header-ID command
  for the Windows path.

## Why this is enough

The unit seam deterministically exercises the Windows branch on this macOS
runner while the real launcher exercise proves the production diagnostic
still works on POSIX. The complete package suite and staged payload build
cover adjacent launcher and distribution behavior.

## What was omitted

The full help text, runner-specific absolute paths, environment variables,
credentials, and unrelated generated build output are omitted.

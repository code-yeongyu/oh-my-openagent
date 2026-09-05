# PR 7491 cross-shell resume follow-up

## Scope

- Add a failing launcher regression showing that Windows diagnostics cannot
  safely offer one path command for cmd.exe, PowerShell, and Git Bash.
- Keep the portable header-ID resume command and omit the path alternative on
  Windows; preserve the existing quoted path alternative on POSIX.
- Run the focused launcher test failing first and green, then the complete
  omo-native suite, typecheck, build, and real launcher help/version plus
  mismatch diagnostics on the matching host surface.
- Record reviewer-readable QA under `.omo/evidence/`, merge current `dev`,
  repeat verification, and push only the existing PR branch.

## Files

- `packages/omo-native/bin/lib/launcher.js`
- `packages/omo-native/test/launcher.test.ts`
- `.omo/evidence/20260904-pr-7491-cross-shell-followup/`

## Stop condition

The Windows diagnostic contains only the portable header ID, POSIX retains
the safely quoted path alternative, all verification is green, and the
existing PR head is updated.

# Prompt Contract Test Removal Evidence

## Baseline

- Host: `<redacted-host>`.
- Worktree:
  `<worktree>`
- Branch: `chore/remove-prompt-contract-tests`
- Base: `origin/dev` at `3dd88267f87bd47795d3eea7782e676bb40e2f9b`.
- Shared checkout was dirty and was not modified.

## Evidence contract

Each artifact records the exact command, observed output, binary PASS/FAIL
condition, and any cleanup receipt. Raw secret-bearing logs are excluded.

## Prompt-contract scanner

`audit_prompt_contracts.py` enumerates tracked JavaScript/TypeScript
`*.test.*` and `*.spec.*` paths directly from `git ls-files`; no path manifest
or allowlist controls discovery. It invokes `prompt_contract_ast.mjs`, which
uses the installed TypeScript 6.0.3 compiler API to parse each present
working-tree test and follows assertion literals through variables, arrays, `for...of` bindings,
boolean `.includes()` expressions, matcher chains, order-helper calls, derived
heading/token arrays, `indexOf` ordering, `startsWith` aliases, regex-derived
presentation checks, Node `assert` variants, callable assertions, and snapshot
assertions. Tracked paths deleted in the working tree remain in the enumeration
and are reported separately as `tracked-missing`.

Candidates are joined to `prompt-contract-classification.json` by a SHA-256
fingerprint over path, candidate kind, matcher, actual expression, and expected
value. Fingerprints do not contain line numbers. Allowed and forbidden entries
must include one of the scanner's explicit seam categories and a non-empty
rationale. Unclassified, forbidden, or stale classifications make the command
exit nonzero.

Commands:

```sh
uv run --script .omo/evidence/20260817-remove-prompt-contract-tests/test_audit_prompt_contracts.py -v
uv run --script .omo/evidence/20260817-remove-prompt-contract-tests/test_node_assert_scanner.py -q
uv run --script .omo/evidence/20260817-remove-prompt-contract-tests/test_snapshot_scanner.py -q
python3 .omo/evidence/20260817-remove-prompt-contract-tests/audit_prompt_contracts.py \
  --classification .omo/evidence/20260817-remove-prompt-contract-tests/prompt-contract-classification-index.json \
  --compact
```

The scanner command is green on the final tree. The original failing-first
inventory remains in the committed `red-prompt-contract-scan*.txt` artifacts;
no nonzero result is converted to green by path omission or blanket
classification.

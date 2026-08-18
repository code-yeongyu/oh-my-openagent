# RED - Windows root-suite failures

## What was tested

Public full-suite Windows matrix jobs:

- Pre-brand `dev`: run 31354385911
- PR #6695: run 31359676524
- PR #6705: run 31363755978
- Existing baseline repair PR #6700: run 31363899865

## What was observed

Run-backed totals are:

```text
dev reference: 14039 pass, 15 fail
PR #6695:      14069 pass, 8 fail
PR #6705:      14070 pass, 7 fail
```

The previously stated "12 to 5" comparison is not supported by the logs. Five failures were the stable deterministic subset after PR #6695; the 8 and 7 totals also contained independent incidental failures.

Stable failures owned by PR #6700:

```text
omo launcher ... launcher environment points to existing hoisted shims
build:omo-native staged payload ... every required artifact is present
omo setup sibling detection ... default launch is on a TTY
omo setup credential inheritance ... mode backup and idempotency are exact
omo setup credential inheritance ... dry-run or declined consent ... auth remains absent
```

Independent failures relevant to this PR:

```text
acquireSessionAdmissionLease ... holder keeps renewing ... waiter yields contended
omo-memory MCP server ... create then str_replace ... memory repo records them
```

Raw runs:

- https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31354385911
- https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31359676524
- https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31363755978
- https://github.com/code-yeongyu/oh-my-openagent/actions/runs/31363899865

## Why this is enough

These are real `windows-latest` outputs from the complete root suite. They establish the failing-first behavior, correct the incident attribution, and separate stable platform incompatibilities from timing and shared-state failures.

## What was omitted

The full 14k-test transcripts and repeated stack frames were omitted. The public run URLs are the exact raw artifacts.

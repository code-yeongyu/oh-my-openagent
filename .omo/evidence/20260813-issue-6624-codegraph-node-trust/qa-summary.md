# Issue #6624 CodeGraph launcher QA

## Automated checks

- `bun test packages/omo-opencode/src/mcp/codegraph.test.ts packages/omo-opencode/src/hooks/codegraph-bootstrap/codegraph-bootstrap.test.ts packages/omo-opencode/src/hooks/codegraph-bootstrap/auto-init.test.ts packages/utils/src/codegraph/resolve.test.ts`
  - Bun 1.3.14
  - 33 passed, 0 failed, 71 assertions
- `bun run typecheck`
  - Passed with exit code 0
- `bun run build`
  - Passed with exit code 0 and completed all build steps

The root `bun test` suite was also started, then stopped after unrelated Windows
environment failures appeared outside the changed packages. These included
denied symlink creation, Git Bash handling of native drive-letter archive paths,
and unrelated documentation/harness expectations. No observed failure referenced
the changed CodeGraph files.

## Live OpenCode QA

Environment: OpenCode 1.15.13 on Windows with the test process PATH restricted to
the Windows system directories, so no external Node executable was available.

| Case | Observed result |
| --- | --- |
| Existing verified provisioned launcher | CodeGraph MCP connected through the managed launcher. |
| PATH-resolved command with unsupported/missing Node | MCP stayed disabled and the command sentinel was not invoked. |
| Cold automatic provisioning | The managed launcher was downloaded and project CodeGraph initialization completed. |
| Same process after cold provisioning | MCP remained disabled because MCP configuration had already been assembled. |
| Realistic OpenCode restart | CodeGraph MCP connected through the newly provisioned launcher. |

## Conclusion

The shared command trust policy is preserved: bundled, explicit environment, and
verified provisioned launchers are trusted, while arbitrary PATH commands still
require a supported local Node runtime. Cold provisioning no longer depends on
an external Node executable. A restart remains required before a launcher first
downloaded by the session bootstrap hook becomes available as an MCP server.

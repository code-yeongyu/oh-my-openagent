# omo-codex Third Party Notices

This file enumerates third-party and ported components redistributed by the
`packages/omo-codex` Codex Light edition surface: the vendored `plugin/`
bundle, component workspaces, generated installer scripts, bundled MCP runtime
payloads, and component NOTICE files.

CodeGraph is documented in the root notice as a planned integration payload.
It is not currently an omo-codex plugin component in this wave, so it is not
listed as a shipped codex component here.

## Components

### @code-yeongyu/comment-checker@0.8.0
- License: MIT, from package metadata and the root third-party notice.
- Copyright: Yeongyu Kim and contributors.
- Upstream URL: https://github.com/code-yeongyu/go-claude-code-comment-checker
- Where-bundled: optional checker binary payload consumed by `components/comment-checker`.

### @code-yeongyu/codex-comment-checker@4.10.0
- License: MIT, from `plugin/components/comment-checker/LICENSE`.
- Notice: `plugin/components/comment-checker/NOTICE`.
- Where-bundled: Codex `PostToolUse` comment-checker hook component.

### @code-yeongyu/codex-lsp@4.10.0
- License: MIT, from `plugin/components/lsp/LICENSE`.
- Notice: `plugin/components/lsp/NOTICE`.
- Where-bundled: Codex LSP hook component and MCP-facing LSP integration.

### @code-yeongyu/codex-rules@4.10.0
- License: MIT, from `plugin/components/rules/LICENSE`.
- Notice: `plugin/components/rules/NOTICE`.
- Where-bundled: Codex rules/context injection hooks and bundled rule files.

### @code-yeongyu/codex-start-work-continuation@4.10.0
- License: MIT, from `plugin/components/start-work-continuation/LICENSE`.
- Notice: `plugin/components/start-work-continuation/NOTICE`.
- Where-bundled: Codex `Stop` and `SubagentStop` continuation hook component.

### @code-yeongyu/codex-telemetry@4.10.0
- License: MIT, from `plugin/components/telemetry/LICENSE`.
- Notice: `plugin/components/telemetry/NOTICE`.
- Where-bundled: Codex `SessionStart` telemetry hook component.

### @code-yeongyu/codex-ultrawork@4.10.0
- License: MIT, from `plugin/components/ultrawork/LICENSE`.
- Notice: `plugin/components/ultrawork/NOTICE`.
- Where-bundled: Codex ultrawork prompt detector, directive, and reviewer agent role component.

### @code-yeongyu/codex-ulw-loop@4.10.0
- License: MIT, from `plugin/components/ulw-loop/LICENSE`.
- Notice: `plugin/components/ulw-loop/NOTICE`.
- Where-bundled: Codex ulw-loop hook, CLI, skills, and goal-state orchestration component.

### @code-yeongyu/lsp-daemon@0.1.0
- License: MIT, from package metadata and bundled package layout.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu/lsp-daemon
- Where-bundled: `packages/lsp-daemon/dist` runtime copied into the codex plugin MCP surface.

### @code-yeongyu/lsp-tools-mcp@0.1.0
- License: MIT, from `packages/lsp-tools-mcp/LICENSE`.
- Notice: `packages/lsp-tools-mcp/NOTICE`.
- Where-bundled: LSP MCP runtime built and copied by codex marketplace sync and root package layout.

### @oh-my-opencode/boulder-state@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: bundled into the start-work continuation component runtime.

### @oh-my-opencode/comment-checker-core@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: bundled into the codex comment-checker hook runtime.

### @oh-my-opencode/git-bash-mcp@0.0.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: Codex plugin `git_bash` MCP server runtime.

### @oh-my-opencode/prompts-core@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: ultrawork directive synchronization and bundled prompt material.

### @oh-my-opencode/rules-engine@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: bundled into the codex rules hook runtime.

### @oh-my-opencode/shared-skills@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: aggregate codex plugin skills directory.

### @oh-my-opencode/telemetry-core@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: bundled into codex telemetry component and generated installer scripts.

### @oh-my-opencode/utils@0.1.0
- License: project license.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: installer support, git-bash hook support, and shared parsing utilities.

### @sisyphuslabs/codex-bootstrap@4.10.0
- License: private project component distributed as part of the codex plugin bundle.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: Codex `SessionStart` bootstrap provisioning component and reviewed checksum manifests.

### @sisyphuslabs/codex-git-bash-hook@4.10.0
- License: private project component distributed as part of the codex plugin bundle.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: Codex git-bash reminder hook component.

### @sisyphuslabs/omo-codex-plugin@4.10.0
- License: MIT, from `.codex-plugin/plugin.json`.
- Copyright: Yeongyu Kim and contributors.
- Where-bundled: aggregate Codex plugin namespace `omo@sisyphuslabs`.

### Node.js runtime bootstrap payload@24.16.0
- License: Node.js MIT license plus bundled third-party notices for runtime dependencies.
- Copyright: Node.js contributors and bundled dependency contributors.
- Upstream URL: https://nodejs.org/
- Where-bundled: bootstrap manifest for Windows Node runtime provisioning.

### pi-comment-checker
- License: MIT, from `plugin/components/comment-checker/LICENSE` and component NOTICE.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu
- Where-bundled: ported comment-checker hook behavior in `components/comment-checker`.

### pi-lsp-client
- License: MIT, from `plugin/components/lsp/LICENSE`, `plugin/components/lsp/NOTICE`, and `packages/lsp-tools-mcp/NOTICE`.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu
- Where-bundled: adapted LSP runtime and Codex LSP component.

### pi-rules
- License: MIT, from `plugin/components/rules/LICENSE` and component NOTICE.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu
- Where-bundled: ported rule discovery, matching, and context-injection behavior in `components/rules`.

### picomatch@4.0.4
- License: MIT, from `node_modules/picomatch/LICENSE` and component NOTICE.
- Copyright: Jon Schlinkert and contributors.
- Upstream URL: https://github.com/micromatch/picomatch
- Where-bundled: bundled into the codex rules hook runtime.

### posthog-node@5.35.12
- License: package metadata declares MIT; inspected package LICENSE text is Apache-2.0 and is recorded in the root notice.
- Copyright: PostHog / Hiberly, Inc.; Mixpanel, Inc.; contributors.
- Upstream URL: https://github.com/PostHog/posthog-js
- Where-bundled: codex telemetry hook runtime and generated local installer telemetry code.

# Third Party Notices

This file enumerates third-party components redistributed by the root `oh-my-opencode` package surface from `package.json` `files[]`, root production dependencies, and bundled MCP/runtime payloads.

Generator/checker note: update this file with the audited component list, then run `node scripts/check-third-party-notices.mjs`. Task 11 owns tarball ship verification.

## Components

### @clack/prompts@1.5.0
- License: MIT, from `node_modules/@clack/prompts/LICENSE`.
- Copyright: Copyright (c) Nate Moore.
- Upstream URL: https://github.com/bombshell-dev/clack
- Where-bundled: root production dependency.

### @code-yeongyu/comment-checker@0.8.0
- License: MIT, from package metadata. The inspected package did not include a separate LICENSE file.
- Copyright: Yeongyu Kim and contributors.
- Upstream URL: https://github.com/code-yeongyu/go-claude-code-comment-checker
- Where-bundled: root production dependency and vendored checker binary payload under `vendor/<platform>/`.

### @modelcontextprotocol/sdk@1.29.0
- License: MIT, from `node_modules/@modelcontextprotocol/sdk/LICENSE`.
- Copyright: Copyright (c) 2024 Anthropic, PBC.
- Upstream URL: https://github.com/modelcontextprotocol/typescript-sdk
- Where-bundled: root production dependency for MCP client/server integration.

### @opencode-ai/plugin@1.15.13
- License: MIT, from package metadata. The inspected package did not include a separate LICENSE file.
- Copyright: OpenCode contributors.
- Upstream URL: https://www.npmjs.com/package/@opencode-ai/plugin
- Where-bundled: root production dependency for the OpenCode plugin API.

### @opencode-ai/sdk@1.15.13
- License: MIT, from package metadata. The inspected package did not include a separate LICENSE file.
- Copyright: OpenCode contributors.
- Upstream URL: https://www.npmjs.com/package/@opencode-ai/sdk
- Where-bundled: root production dependency for OpenCode API access.

### @opentui/core@0.5.8
- License: MIT, from `node_modules/@opentui/core/LICENSE`.
- Copyright: Copyright (c) 2025 opentui.
- Upstream URL: https://www.npmjs.com/package/@opentui/core
- Where-bundled: root production dependency.

### @opentui/keymap@0.5.8
- License: MIT, from `node_modules/@opentui/keymap/LICENSE`.
- Copyright: Copyright (c) 2025 opentui.
- Upstream URL: https://www.npmjs.com/package/@opentui/keymap
- Where-bundled: root production dependency.

### @opentui/solid@0.5.8
- License: MIT, from `node_modules/@opentui/solid/LICENSE`.
- Copyright: Copyright (c) 2025 opentui.
- Upstream URL: https://www.npmjs.com/package/@opentui/solid
- Where-bundled: root production dependency.

### commander@14.0.3
- License: MIT, from `node_modules/commander/LICENSE`.
- Copyright: Copyright (c) 2011 TJ Holowaychuk.
- Upstream URL: https://github.com/tj/commander.js
- Where-bundled: root production dependency.

### detect-libc@2.1.2
- License: Apache-2.0, from `node_modules/detect-libc/LICENSE`.
- Copyright: detect-libc contributors.
- Upstream URL: https://github.com/lovell/detect-libc
- Where-bundled: root production dependency used by platform/runtime detection.

### diff@9.0.0
- License: BSD-3-Clause, from `node_modules/diff/LICENSE`.
- Copyright: Copyright (c) 2009-2015, Kevin Decker.
- Upstream URL: https://github.com/kpdecker/jsdiff
- Where-bundled: root production dependency used by diff rendering and patch helpers.

### js-yaml@4.2.0
- License: MIT, from `node_modules/js-yaml/LICENSE`.
- Copyright: Copyright (C) 2011-2015 Vitaly Puzrin.
- Upstream URL: https://github.com/nodeca/js-yaml
- Where-bundled: root production dependency used by frontmatter and YAML parsing.

### jsonc-parser@3.3.1
- License: MIT, from `node_modules/jsonc-parser/LICENSE.md`.
- Copyright: Copyright (c) Microsoft.
- Upstream URL: https://github.com/microsoft/node-jsonc-parser
- Where-bundled: root production dependency.

### pi-comment-checker
- License: MIT, from `packages/omo-codex/plugin/components/comment-checker/LICENSE` and component NOTICE.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu
- Where-bundled: ported source in `packages/omo-codex/plugin/components/comment-checker`, shipped by the root package file surface.

### pi-lsp-client
- License: MIT, from `packages/lsp-tools-mcp/LICENSE`, `packages/lsp-tools-mcp/NOTICE`, and `packages/omo-codex/plugin/components/lsp/LICENSE`.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu
- Where-bundled: adapted LSP runtime in `packages/lsp-tools-mcp`, `packages/lsp-core`, and the Codex plugin LSP component shipped by the root package file surface.

### pi-rules
- License: MIT, from `packages/omo-codex/plugin/components/rules/LICENSE` and component NOTICE.
- Copyright: Yeongyu Kim.
- Upstream URL: https://github.com/code-yeongyu
- Where-bundled: ported rules/context loading behavior in `packages/omo-codex/plugin/components/rules`, shipped by the root package file surface.

### picocolors@1.1.1
- License: ISC, from `node_modules/picocolors/LICENSE`.
- Copyright: Copyright (c) 2021-2024 Oleksii Raspopov, Kostiantyn Denysov, Anton Verinov.
- Upstream URL: https://github.com/alexeyraspopov/picocolors
- Where-bundled: root production dependency for terminal color formatting.

### picomatch@4.0.4
- License: MIT, from `node_modules/picomatch/LICENSE`.
- Copyright: Copyright (c) 2017-present, Jon Schlinkert.
- Upstream URL: https://github.com/micromatch/picomatch
- Where-bundled: root production dependency.

### posthog-node@5.35.12
- License: Apache-2.0 text in `node_modules/posthog-node/LICENSE`; package metadata declares MIT.
- Copyright: Copyright 2020 Posthog / Hiberly, Inc.; Copyright 2015 Mixpanel, Inc.
- Upstream URL: https://github.com/PostHog/posthog-js
- Where-bundled: root production dependency for anonymous telemetry.

### vscode-jsonrpc@8.2.1
- License: MIT, from `node_modules/vscode-jsonrpc/License.txt`.
- Copyright: Copyright (c) Microsoft Corporation.
- Upstream URL: https://github.com/microsoft/vscode-languageserver-node
- Where-bundled: root production dependency for LSP JSON-RPC transport.

### zod@4.4.3
- License: MIT, from `node_modules/zod/LICENSE`.
- Copyright: Copyright (c) 2025 Colin McDonnell.
- Upstream URL: https://zod.dev
- Where-bundled: root production dependency.

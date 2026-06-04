# codex-comment-checker

[![ci](https://github.com/code-yeongyu/codex-comment-checker/actions/workflows/ci.yml/badge.svg)](https://github.com/code-yeongyu/codex-comment-checker/actions/workflows/ci.yml) [![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Codex plugin that runs [`@code-yeongyu/comment-checker`](https://github.com/code-yeongyu/go-claude-code-comment-checker) after successful edit-like `PostToolUse` hook calls.

## Behavior

| Case | Result |
|------|--------|
| `apply_patch` succeeds | parses `tool_input.command` and checks added/updated files |
| `write`, `edit`, `multi_edit`, or `multiedit` succeeds | maps the Codex payload to the native checker hook input |
| non-edit tool succeeds | ignored |
| checker exits `2` | returns Codex `PostToolUse` blocking feedback so the model fixes or explains the warning |
| checker binary missing or unavailable on the current platform | emits no hook output |
| checker exits unexpectedly | leaves hook output unchanged |

Deletes are ignored because they cannot introduce new comments.

## Codex Plugin

The plugin ships:

- `.codex-plugin/plugin.json` for Codex plugin discovery.
- `hooks/hooks.json` for the `PostToolUse` hook.
- `skills/comment-checker/SKILL.md` with usage guidance.

The hook command is:

```bash
node "${PLUGIN_ROOT}/dist/cli.js" hook post-tool-use
```

No MCP server or `comment_check` tool is exposed.

## Local Development

```bash
npm install
npm test
npm run typecheck
npm run check
npm pack --dry-run
```

Smoke-test the hook:

```bash
node dist/cli.js hook post-tool-use < test/fixtures/post-tool-use.json
```

## Local Codex Installation

```bash
npx lazycodex-ai install
```

The installer builds and copies the plugin into `~/.codex/plugins/cache/sisyphuslabs/omo/0.1.0`, registers the `sisyphuslabs` marketplace from the `lazycodex` Git repository, installs runtime dependencies there, and enables:

```toml
[features]
plugins = true
plugin_hooks = true

[plugins."omo@sisyphuslabs"]
enabled = true
```

## Branch Rules and Releases

- `main` is protected by `.github/branch-ruleset.json`.
- CI runs Node 20 and 22 on Ubuntu, macOS, and Windows.
- Releases are GitHub Releases tagged as `v<semver>`.
- Publishing runs from the `publish` workflow after a GitHub Release is published.

## Privacy

This plugin runs locally. It sends hook input to the optional local `comment-checker` binary when available and does not call a network service by itself.

## License

[MIT](LICENSE).

## Related

- [pi-comment-checker](https://github.com/code-yeongyu/pi-comment-checker) - source extension this Codex plugin ports.
- [comment-checker](https://github.com/code-yeongyu/go-claude-code-comment-checker) - native checker binary.

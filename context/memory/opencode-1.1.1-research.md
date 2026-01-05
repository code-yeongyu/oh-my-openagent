# OpenCode 1.1.1 Release Research

**Date**: 2026-01-04
**Release**: v1.1.1
**Repository**: anomalyco/opencode

## Executive Summary

OpenCode 1.1.1 introduces a **MAJOR BREAKING CHANGE** to the permissions system that affects all plugins. The `tools` configuration has been deprecated and merged into a new `permission` system with granular pattern-matching capabilities.

## Critical Breaking Changes

### 1. Tools → Permission Migration

**Old Format (Deprecated)**:
```json
{
  "tools": {
    "bash": true,
    "edit": false
  }
}
```

**New Format (Required)**:
```json
{
  "permission": {
    "bash": "allow",
    "edit": "deny"
  }
}
```

**Backward Compatibility**: Old `tools` config still works but will be auto-migrated.

### 2. Granular Permission System

New object syntax with glob pattern matching:

```json
{
  "permission": {
    "bash": {
      "npm *": "allow",
      "git *": "allow",
      "rm *": "deny",
      "*": "ask"
    },
    "edit": {
      "*.md": "allow",
      "*.ts": "ask",
      "*": "deny"
    }
  }
}
```

**Permission Values**:
- `"allow"` - automatically approve
- `"deny"` - automatically reject
- `"ask"` - prompt user for approval

**Blanket Permissions**:
```json
{
  "permission": "allow"  // All tools allowed
}
```

### 3. SDK Event Structure Changes

**BREAKING for SDK users**:

| Old (`Permission.Event`) | New (`PermissionNext.Event`) |
|--------------------------|------------------------------|
| Event: `permission.updated` | Event: `permission.asked` |
| `type` | `permission` |
| `pattern` (string) | `patterns` (array) |
| `message` field | Removed |
| `response` | `reply` |
| `permissionID` | `requestID` |
| N/A | New `always` field |

**Old Event Structure**:
```typescript
Updated: { id, type, pattern, sessionID, messageID, callID, message, metadata, time }
Replied: { sessionID, permissionID, response }
```

**New Event Structure**:
```typescript
Asked: { id, sessionID, permission, patterns, metadata, always, tool: { messageID, callID } }
Replied: { sessionID, requestID, reply }
```

### 4. Server API Changes

**New Endpoint**:
- `POST /permission/:requestID/reply` - Respond to permission requests

**Deprecated Endpoint**:
- `POST /session/:sessionID/permissions/:permissionID` (still works but deprecated)

**Changed Response**:
- `GET /permission` now returns `PermissionNext.Request[]` instead of `Permission.Info[]`

### 5. Agent Configuration Changes

**Deprecated Fields**:
- `agent.tools` → Use `agent.permission` instead
- `agent.maxSteps` → Use `agent.steps` instead

**New Behavior**:
- Unknown agent properties collected into `options` object

### 6. Plugin/Mode Loading Changes

**Breaking**: Mode and plugin globs no longer search subdirectories
- Simplified to top-level only
- Affects plugin discovery patterns

## Plugin Compatibility Issues

### Confirmed Breaking Plugins

1. **opencode-openai-codex-auth** (Issue #92)
   - **Status**: Broken in 1.1.1
   - **Error**: "OpenAI API key is missing" despite OAuth
   - **Cause**: New variants feature incompatibility
   - **Workaround**: Unknown (issue open as of 2026-01-04)

2. **opencode-tokenscope** (Issue #9)
   - **Status**: Buggy behavior in 1.1.1
   - **Symptoms**: Unspecified bugs
   - **Workaround**: Unknown

3. **ACP (Anthropic Claude Protocol)** (Issue #6853)
   - **Status**: Broken in 1.1.1
   - **Error**: Always requires `big-pickle` model, ignores default agent model
   - **Cause**: Provider model resolution broken
   - **Impact**: ACP clients (Zed Editor, vscode-acp-provider) fail
   - **Workaround**: None (acknowledged by maintainer)

### oh-my-opencode Compatibility

**Issue #487**: "opencode v1.1.1 compatibility"
- **Status**: Closed (2026-01-04)
- **Resolution**: Compatibility achieved
- **Action Required**: Check for permission breaking changes

## New Features in 1.1.1

### Core Features

1. **MCP Resources Support** (@paoloricciuti)
   - New MCP resource handling capabilities

2. **Variant Support**
   - New `variant` field in chat message input
   - `--variant` flag for run command
   - Variant support for minimal mode

3. **Git Worktree Improvements**
   - Sandbox support for git worktrees
   - Managed git worktrees
   - Initialize config in worktree
   - Fixed dependency installation and branch creation

4. **MCP Enhancements**
   - Per-project MCP config overrides (@jknlsn)
   - Timeout for MCP client connection calls (@RhysSullivan)

5. **LSP Improvements**
   - Kotlin LSP integration (@tjg184)
   - Improved root detection for Gradle multi-project builds (@JBou)

6. **Server Improvements**
   - CORS whitelist support via `server.cors` config
   - Content-Type headers for proxied static assets
   - mDNS service name includes port for uniqueness

7. **Session Management**
   - Fixed memory leaks in session management
   - Add assistant metadata to session export (@dmmulroy)
   - Handle NotFoundError for non-shared sessions (@Hona)
   - `/compact` session command to compress conversation history

8. **Permission Dialogs**
   - Reject message support for better user feedback
   - Escape key handling for keyboard navigation

9. **Configuration**
   - Merge instructions arrays across config files (@elithrar)
   - Improved plugin loading to handle builtin plugin failures gracefully

### TUI Features

1. **Themes**
   - Add Osaka Jade theme (@st-eez)
   - Fix system theme diff highlighting
   - Add missing `theme_list` keybind (@aspiers)

2. **Status Icons**
   - Make LSP status icon muted when no LSPs active (@itsrainingmani)
   - Make MCP status icon muted when no MCP servers enabled (@itsrainingmani)

3. **Commands**
   - Fix import command regex for file paths
   - Fix stats command day calculation and time filtering
   - Fixed Windows fallback for "less" command (@itsrainingmani)

4. **Development**
   - Add heap snapshot option to system menu for debugging
   - Add development scripts for better debugging workflow

### Desktop Features

1. **UI Improvements**
   - Fix scroll position restoration
   - Improve auto-scroll behaviors
   - Improve desktop window resize handle (@dbpolito)
   - Adjust window drag region layout
   - Don't override Ctrl+A on Windows

2. **Features**
   - Add image preview support in session viewer (@shuv1337)
   - Add file context feature
   - Fixed editing projects (@dbpolito)

3. **Server**
   - Update server URL normalization to retain path (@OpeOginni)
   - Properly decode session ID for permission context (@OpeOginni)
   - Relax request timeouts

### Model Updates

1. **GitHub Copilot**
   - Prioritize free GPT-5-mini for small model
   - Update model priority list
   - Remove outdated Haiku filter (@alcpereira)
   - Remove OpenRouter provider from priority list

2. **Cloudflare AI Gateway**
   - Fix SDK chat undefined error (@englishm)

### Other Improvements

1. **Error Handling**
   - Display error if invalid agent is used in command (@Leka74)
   - Check for context overflow mid-turn in finish-step (@aryasaatvik)
   - Improved permission error handling and evaluation logic

2. **Performance**
   - Use Bun.sleep instead of Promise setTimeout (@edlsh)
   - Make install dependencies non-blocking
   - Use --no-cache flag when behind proxy
   - Improve application startup time

3. **GitHub Integration**
   - Handle duplicate PR creation when agent creates PR (@elithrar)
   - Handle actions/checkout v6 credential storage change (@elithrar)

4. **Documentation**
   - Update AGENTS.md documentation (@aryasaatvik)
   - Add logging best practices for plugin authors (@elithrar)
   - Enhance MCP servers documentation (@sin4ch)

## Migration Guide for Plugin Authors

### Step 1: Update Permission Configuration

**Before**:
```json
{
  "tools": {
    "bash": true,
    "edit": true
  }
}
```

**After**:
```json
{
  "permission": {
    "bash": "allow",
    "edit": "allow"
  }
}
```

### Step 2: Update Agent Definitions

**Before**:
```json
{
  "agents": {
    "my-agent": {
      "tools": ["bash", "edit"],
      "maxSteps": 10
    }
  }
}
```

**After**:
```json
{
  "agents": {
    "my-agent": {
      "permission": {
        "bash": "allow",
        "edit": "allow"
      },
      "steps": 10
    }
  }
}
```

### Step 3: Update SDK Event Handlers (if applicable)

**Before**:
```typescript
sdk.on('permission.updated', (event) => {
  const { type, pattern, permissionID } = event;
  // Handle permission
});

sdk.on('permission.replied', (event) => {
  const { permissionID, response } = event;
  // Handle reply
});
```

**After**:
```typescript
sdk.on('permission.asked', (event) => {
  const { permission, patterns, requestID, always } = event;
  // Handle permission
});

sdk.on('permission.replied', (event) => {
  const { requestID, reply } = event;
  // Handle reply
});
```

### Step 4: Update API Calls

**Before**:
```typescript
POST /session/:sessionID/permissions/:permissionID
```

**After**:
```typescript
POST /permission/:requestID/reply
```

### Step 5: Test Granular Permissions

Consider using granular permissions for better control:

```json
{
  "permission": {
    "bash": {
      "npm install": "allow",
      "git *": "allow",
      "rm -rf *": "deny",
      "*": "ask"
    }
  }
}
```

## Known Issues

1. **opencode-openai-codex-auth**: Broken due to variants feature
2. **ACP**: Broken model resolution (always requires big-pickle)
3. **opencode-tokenscope**: Unspecified bugs

## Recommendations for oh-my-opencode

### Immediate Actions

1. **Update Permission Configuration**
   - Migrate all `tools` configs to `permission` format
   - Test granular permission patterns
   - Document permission changes for users

2. **Test Agent Definitions**
   - Replace `agent.tools` with `agent.permission`
   - Replace `agent.maxSteps` with `agent.steps`
   - Verify all agents work with new permission system

3. **Update Documentation**
   - Document breaking changes
   - Provide migration guide for users
   - Update configuration examples

4. **Test Plugin Loading**
   - Verify plugin discovery still works (no subdirectory search)
   - Test all builtin plugins
   - Handle plugin failures gracefully

### Optional Enhancements

1. **Leverage New Features**
   - Implement granular permissions for better security
   - Use variant support if applicable
   - Leverage MCP resources support
   - Consider per-project MCP config overrides

2. **Improve Error Handling**
   - Handle new permission event structure
   - Gracefully handle plugin failures
   - Implement better error messages

3. **Performance Optimizations**
   - Use Bun.sleep instead of Promise setTimeout
   - Implement non-blocking dependency installation
   - Consider git worktree support

## Version Compatibility Matrix

| OpenCode Version | oh-my-opencode Status | Notes |
|------------------|----------------------|-------|
| < 1.0.132 | ⚠️ Broken | Config bug in OpenCode |
| 1.0.132 | ✅ Compatible | Minimum required version |
| 1.1.0 | ✅ Compatible | Pre-permission changes |
| 1.1.1 | ⚠️ Needs Update | Permission system overhaul |

## Community Contributors (30)

- @monotykamary, @Leka74, @aryasaatvik, @alcpereira, @dbpolito
- @itsrainingmani, @dmmulroy, @Hona, @OpeOginni, @albingroen
- @st-eez, @edlsh, @englishm, @elithrar, @spoons-and-mirrors
- @tjg184, @code-yeongyu, @shuv1337, @JBou, @jknlsn
- @sin4ch, @RhysSullivan, @jerilynzheng, @benjaminshafii, @ShpetimA
- @johnconnor-sec, @felipeorlando, @jerome-benoit, @paoloricciuti, @aspiers

## References

- **Release Notes**: https://github.com/anomalyco/opencode/releases/tag/v1.1.1
- **Issue #487**: https://github.com/code-yeongyu/oh-my-opencode/issues/487
- **Issue #92**: https://github.com/numman-ali/opencode-openai-codex-auth/issues/92
- **Issue #6853**: https://github.com/anomalyco/opencode/issues/6853
- **Release Date**: 2026-01-04 16:20 UTC
- **Commit**: dc25669b6e14ee7730ae9ab5d3d5e876e2111fb0

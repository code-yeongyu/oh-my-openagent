# OpenCode Experimental LSP Integration - User Guide

> **中文版本**: [查看中文文档](./opencode-lsp.zh-cn.md)

## What is This?

Oh-My-OpenCode now supports using OpenCode's built-in unified LSP tool instead of our custom implementation.

**In short**: Flip a switch and use OpenCode's official LSP functionality, reducing maintenance burden while gaining more features.

## Why Use It?

### Benefits
- ✅ **More Features**: Get hover information, go to implementation, call hierarchy
- ✅ **Less Maintenance**: No need to maintain custom LSP code, automatically benefit from OpenCode upstream improvements
- ✅ **Better Stability**: OpenCode's official implementation is more widely tested

### Trade-offs
- ⚠️ **Experimental Feature**: OpenCode's LSP tool is currently experimental
- ⚠️ **Some Tools Kept**: `lsp_diagnostics`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename` still use oh-my-opencode's implementation (because OpenCode doesn't support them yet)

## How to Enable?

### Step 1: Configure OpenCode Environment Variables (**Required**)

This step is **mandatory**. In OpenCode's source code, the `lsp` tool is only registered when the flag is true:

```typescript
// OpenCode internal code (packages/opencode/src/tool/registry.ts)
...(Flag.OPENCODE_EXPERIMENTAL_LSP_TOOL ? [LspTool] : []),
```

**Without this environment variable, the `lsp` tool simply doesn't exist and the AI cannot call it.**

```bash
# Recommended: Only enable LSP tool (smaller impact)
export OPENCODE_EXPERIMENTAL_LSP_TOOL=true

# Or: Enable all experimental features (also enables plan mode, workspaces, etc.)
export OPENCODE_EXPERIMENTAL=true
```

**macOS/Linux permanent setup**:
```bash
echo 'export OPENCODE_EXPERIMENTAL_LSP_TOOL=true' >> ~/.zshrc
source ~/.zshrc
```

### Step 2: Configure oh-my-opencode

Edit your configuration file (either):
- Project level: `.opencode/oh-my-opencode.json`
- User level: `~/.config/opencode/oh-my-opencode.json`

Add the following configuration:

```json
{
  "lsp": {
    "useOpenCodeExperimental": true
  }
}
```

### Step 3: Restart OpenCode

```bash
# Completely quit OpenCode and restart
opencode
```

## What Changed?

### Replaced Tools
When enabled, the following tools are replaced by OpenCode's unified `lsp` tool:

| Old Tool | New Tool | Function |
|----------|----------|----------|
| `lsp_goto_definition` | OpenCode's `lsp` (operation: `goToDefinition`) | Jump to definition |
| `lsp_find_references` | OpenCode's `lsp` (operation: `findReferences`) | Find all references |

### Kept Tools
The following tools continue using oh-my-opencode's implementation (OpenCode doesn't support them yet):

- `lsp_symbols` - Document outline / workspace symbol search
- `lsp_diagnostics` - Get errors and warnings
- `lsp_prepare_rename` - Validate rename operation
- `lsp_rename` - Rename symbol across workspace

### New Features
OpenCode's `lsp` tool additionally provides:

- **hover**: Display symbol information on hover
- **goToImplementation**: Jump to interface implementation
- **prepareCallHierarchy / incomingCalls / outgoingCalls**: Call hierarchy analysis

## How to Verify It's Working?

### Method 1: Check Tool List
After starting OpenCode, ask the AI in chat:
```
List all available LSP tools
```

**Expected result**:
- ✅ Should see `lsp` tool (OpenCode's unified tool)
- ❌ Should NOT see `lsp_goto_definition` and `lsp_find_references`
- ✅ Should see `lsp_symbols`, `lsp_diagnostics`, `lsp_prepare_rename`, `lsp_rename`

### Method 2: Actual Test
Open a project in OpenCode and ask the AI:
```
Use LSP to jump to the definition of MyFunction
```

The AI should use OpenCode's `lsp` tool instead of `lsp_goto_definition`.

## Troubleshooting

### Issue 1: `lsp` Tool Not Available

**Symptom**: After enabling, don't see OpenCode's `lsp` tool

**Solution**:
1. Confirm environment variable is set:
   ```bash
   echo $OPENCODE_EXPERIMENTAL_LSP_TOOL
   # Should output: true
   ```

2. Completely restart OpenCode (not reload window)

3. Check OpenCode version:
   ```bash
   opencode --version
   ```
   Ensure version >= 1.0.150

### Issue 2: `lsp_goto_definition` Disappeared

**Symptom**: Can't find `lsp_goto_definition` tool after enabling

**This is normal!** The tool has been replaced by OpenCode's `lsp` tool. The AI will automatically use the new tool.

### Issue 3: Workspace Symbol Search Doesn't Work

**Known Issue**: OpenCode's `workspaceSymbol` implementation has a bug (hardcoded empty query string).

**Solution**: Use oh-my-opencode's `lsp_symbols` tool (we kept it):
```
Use lsp_symbols to search for symbol "MyClass" in the workspace
```

## How to Roll Back?

If you encounter issues, you can always switch back to custom LSP tools:

### Method 1: Configuration File Rollback
```json
{
  "lsp": {
    "useOpenCodeExperimental": false
  }
}
```

### Method 2: Delete Configuration (Use Default)
Simply delete the `lsp` configuration section, the default is `false`.

### Restart OpenCode
```bash
# Completely quit and restart
opencode
```

## Version Roadmap

| Version | Default | Description |
|---------|---------|-------------|
| **v3.5.0** (current) | `false` | Feature flag available, default off, invite beta testing |
| **v3.6.0** (planned) | `true` | Default enabled, can opt out |
| **v3.7.0** (planned) | Force enabled | Custom LSP tools completely removed, config flag ineffective |

**Recommendations**:
- Test `useOpenCodeExperimental: true` now
- Report issues to GitHub Issues promptly
- Ensure your workflow is compatible before v3.7.0

## Example Configurations

### Minimal Configuration
```json
{
  "lsp": {
    "useOpenCodeExperimental": true
  }
}
```

### Complete Project Configuration Example
```json
{
  "$schema": "https://raw.githubusercontent.com/code-yeongyu/oh-my-opencode/master/dist/oh-my-opencode.schema.json",
  "lsp": {
    "useOpenCodeExperimental": true
  },
  "agents": {
    "sisyphus": {
      "temperature": 0.1
    }
  },
  "disabled_tools": []
}
```

## FAQ

### Q: Do I need to set both environment variable and config file?

**A**: Yes, **both are required** — they control different things:

| Setting | Controls | Without it |
|---------|----------|------------|
| Env var `OPENCODE_EXPERIMENTAL_LSP_TOOL=true` | Whether OpenCode registers the `lsp` tool | `lsp` tool doesn't exist, AI can't call it |
| Config `lsp.useOpenCodeExperimental: true` | Whether oh-my-opencode removes `lsp_goto_definition` / `lsp_find_references` | Both toolsets exist simultaneously, redundant |

Use `OPENCODE_EXPERIMENTAL_LSP_TOOL=true` rather than `OPENCODE_EXPERIMENTAL=true` — the latter enables all experimental features (plan mode, workspaces, etc.), which has broader impact.

### Q: Why aren't all LSP tools replaced?

**A**: OpenCode's LSP tool currently doesn't support:
- `diagnostics` (get errors/warnings)
- `rename` / `prepareRename` (rename symbols)
- `workspaceSymbol` query (has bug)

We kept custom implementations for these tools.

### Q: Will performance be better or worse?

**A**: Theoretically should be comparable or better (officially maintained by OpenCode). If you find performance issues, please report them.

### Q: Can I use only part of OpenCode's LSP features?

**A**: No, this is an all-or-nothing switch. Either use OpenCode (for supported operations) or use the custom implementation entirely.

### Q: Will this affect my existing code?

**A**: No. This only changes the tools the AI uses, it doesn't affect your project code.

## Report Issues

If you encounter bugs or have suggestions, please submit an issue on GitHub:

📝 **Issue Template**:
```
Title: [LSP Experimental Feature] Brief description

Environment:
- oh-my-opencode version: (run `opencode --version`)
- OpenCode version: 
- OS: 
- Config: lsp.useOpenCodeExperimental = true

Problem description:
(Describe the issue you encountered)

Steps to reproduce:
1. 
2. 
3. 

Expected behavior:
(What you expected to happen)

Actual behavior:
(What actually happened)
```

🔗 **Submit to**: https://github.com/code-yeongyu/oh-my-opencode/issues

---

**Need more help?** Join our Discord community: https://discord.gg/PUwSMR9XNk

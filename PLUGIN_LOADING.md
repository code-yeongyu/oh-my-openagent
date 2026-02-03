# Plugin Loading Mechanism for oh-my-opencode

## Overview

This document explains how the OpenCode CLI (`opencode-ai`) discovers and loads the `oh-my-opencode` plugin, and how to override it to use a forked or locally-modified version.

## Loading Mechanism

### 1. OpenCode Configuration Discovery

OpenCode reads the plugin list from `~/.config/opencode/opencode.json`:

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "opencode-antigravity-auth@1.1.2"
  ]
}
```

The `plugin` array contains plugin identifiers in the format: `<package-name>@<version>`

### 2. Plugin Resolution via npm

When OpenCode starts, it resolves each plugin identifier to an actual npm package:

- **Package name**: `oh-my-opencode`
- **Version specifier**: `@latest` (or any semver range like `@3.2.1`, `@^3.0.0`, etc.)
- **Resolution**: npm/bun resolves the version from the npm registry
- **Installation location**: `~/.bun/install/cache/oh-my-opencode-<platform>-<arch>@<version>@@@1/`

Example installed paths:
```
~/.bun/install/cache/oh-my-opencode-darwin-arm64@3.2.1@@@1/
~/.bun/install/cache/oh-my-opencode-darwin-x64@3.2.1@@@1/
~/.bun/install/cache/oh-my-opencode-linux-x64@3.2.1@@@1/
```

### 3. Plugin Entry Point

Each platform-specific package contains:

```
oh-my-opencode-darwin-arm64@3.2.1@@@1/
├── package.json
└── bin/
    └── oh-my-opencode (executable binary)
```

The `package.json` specifies the entry point:

```json
{
  "name": "oh-my-opencode-darwin-arm64",
  "version": "3.2.1",
  "bin": {
    "oh-my-opencode": "./bin/oh-my-opencode"
  }
}
```

### 4. Plugin Initialization

When OpenCode loads the plugin, it:

1. Executes the binary: `~/.bun/install/cache/oh-my-opencode-<platform>-<arch>@<version>@@@1/bin/oh-my-opencode`
2. The binary is a compiled executable (not a Node.js script)
3. The plugin exports a default function that implements the `Plugin` interface from `@opencode-ai/plugin`
4. OpenCode calls this function with a context object containing:
   - `ctx.directory`: The project directory
   - `ctx`: Full OpenCode context

### 5. Plugin Configuration

After loading, the plugin reads its configuration from:

1. **Project-level config** (highest priority): `.opencode/oh-my-opencode.json`
2. **User-level config**: `~/.config/opencode/oh-my-opencode.json`

Example configuration structure:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  },
  "categories": {
    "quick": {
      "model": "anthropic/claude-haiku-4-5"
    }
  }
}
```

## How to Override

### Method 1: Local Path Override (Recommended for Development)

**Use case**: Testing modifications to the plugin source code

**Steps**:

1. Build the forked version:
   ```bash
   cd ~/sub-project/oh-my-opencode
   bun run build
   ```

2. Create a local plugin entry in `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugin": [
       "file:///Users/jay.jung/sub-project/oh-my-opencode",
       "opencode-antigravity-auth@1.1.2"
     ]
   }
   ```

3. OpenCode will load the plugin from the local path instead of npm registry

**Verification**:
```bash
opencode --version
# Should show the plugin loaded from local path
```

### Method 2: Environment Variable Override

**Use case**: Quick testing without modifying config files

**Steps**:

1. Set the environment variable before running OpenCode:
   ```bash
   export OPENCODE_PLUGIN_PATH="/Users/jay.jung/sub-project/oh-my-opencode"
   opencode
   ```

2. OpenCode will check this environment variable and load from the specified path

**Note**: This method requires OpenCode to support the `OPENCODE_PLUGIN_PATH` environment variable. Verify with OpenCode documentation.

### Method 3: Bun Link (For Development Workflow)

**Use case**: Symlink the forked version into the global bun cache

**Steps**:

1. Link the forked version:
   ```bash
   cd ~/sub-project/oh-my-opencode
   bun link
   ```

2. Update `~/.config/opencode/opencode.json` to reference the linked version:
   ```json
   {
     "plugin": [
       "oh-my-opencode@workspace:*",
       "opencode-antigravity-auth@1.1.2"
     ]
   }
   ```

3. Rebuild after making changes:
   ```bash
   cd ~/sub-project/oh-my-opencode
   bun run build
   ```

**Verification**:
```bash
bun link --list
# Should show oh-my-opencode linked
```

### Method 4: Direct npm Registry Override (For Testing Specific Versions)

**Use case**: Testing a specific version without modifying source code

**Steps**:

1. Publish your fork to npm (or a private registry):
   ```bash
   npm publish --registry https://registry.npmjs.org
   ```

2. Update `~/.config/opencode/opencode.json`:
   ```json
   {
     "plugin": [
       "oh-my-opencode@1.0.0-fork",
       "opencode-antigravity-auth@1.1.2"
     ]
   }
   ```

3. OpenCode will install and load from the registry

### Method 5: Binary Path Override (Advanced)

**Use case**: Using a pre-built binary from a different location

**Steps**:

1. Set the environment variable:
   ```bash
   export OPENCODE_BIN_PATH="/path/to/custom/oh-my-opencode"
   opencode
   ```

2. OpenCode will execute the specified binary directly

**Note**: The binary must be compatible with your platform (darwin-arm64, linux-x64, etc.)

## Plugin Discovery Search Order

OpenCode searches for plugins in this order:

1. **Environment variable**: `OPENCODE_PLUGIN_PATH` (if set)
2. **Local file path**: `file://` URLs in `opencode.json`
3. **npm registry**: Package names with version specifiers
4. **Workspace packages**: `@workspace:*` (bun link)
5. **Global cache**: `~/.bun/install/cache/`

## Configuration Files

### ~/.config/opencode/opencode.json

Main OpenCode configuration. Controls which plugins are loaded:

```json
{
  "plugin": [
    "oh-my-opencode@latest",
    "opencode-antigravity-auth@1.1.2"
  ]
}
```

### ~/.config/opencode/oh-my-opencode.json

Plugin-specific configuration. Controls plugin behavior:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-sonnet-4-5"
    }
  }
}
```

### .opencode/oh-my-opencode.json (Project-level)

Project-specific plugin configuration. Overrides user-level config:

```json
{
  "agents": {
    "sisyphus": {
      "model": "anthropic/claude-opus-4-5"
    }
  }
}
```

## Troubleshooting

### Plugin Not Loading

**Symptoms**: OpenCode starts but plugin features are missing

**Diagnosis**:
1. Check if plugin is listed in `~/.config/opencode/opencode.json`
2. Verify the version specifier is valid
3. Check if the package is installed: `ls ~/.bun/install/cache/ | grep oh-my-opencode`

**Solution**:
```bash
# Clear cache and reinstall
rm -rf ~/.bun/install/cache/oh-my-opencode*
opencode --version  # Triggers reinstall
```

### Wrong Version Loading

**Symptoms**: Plugin loads but with unexpected behavior

**Diagnosis**:
1. Check which version is loaded: `opencode --version`
2. Verify `~/.config/opencode/opencode.json` plugin version
3. Check for environment variable overrides: `env | grep OPENCODE`

**Solution**:
```bash
# Update to specific version
# Edit ~/.config/opencode/opencode.json and change:
# "oh-my-opencode@latest" → "oh-my-opencode@3.2.1"
```

### Local Path Not Working

**Symptoms**: File path override not loading

**Diagnosis**:
1. Verify the path exists: `ls -la /path/to/plugin`
2. Check if built: `ls /path/to/plugin/dist`
3. Verify format in config: `file:///absolute/path`

**Solution**:
```bash
# Rebuild the plugin
cd ~/sub-project/oh-my-opencode
bun run build

# Verify dist exists
ls -la dist/
```

## Development Workflow

For developing modifications to oh-my-opencode:

1. **Setup**:
   ```bash
   cd ~/sub-project/oh-my-opencode
   bun install
   bun run build
   ```

2. **Configure local override**:
   ```bash
   # Edit ~/.config/opencode/opencode.json
   # Change "oh-my-opencode@latest" to "file:///Users/jay.jung/sub-project/oh-my-opencode"
   ```

3. **Make changes**:
   ```bash
   # Edit source files in src/
   ```

4. **Rebuild and test**:
   ```bash
   bun run build
   opencode  # Test the changes
   ```

5. **Commit changes**:
   ```bash
   git add .
   git commit -m "feat: add custom agent registration"
   ```

6. **Switch back to npm version**:
   ```bash
   # Edit ~/.config/opencode/opencode.json
   # Change back to "oh-my-opencode@latest"
   ```

## Related Documentation

- [oh-my-opencode README](./README.md) - Plugin overview and features
- [AGENTS.md](./AGENTS.md) - Agent system documentation
- [OpenCode Plugin API](https://code.claude.com/docs/en/plugins-reference) - Official plugin interface
- [Plugin Configuration Schema](./assets/oh-my-opencode.schema.json) - Configuration validation

## Summary

| Method | Use Case | Complexity | Persistence |
|--------|----------|-----------|-------------|
| Local path | Development | Low | Config file |
| Environment variable | Quick testing | Low | Session only |
| Bun link | Workspace development | Medium | Bun cache |
| npm registry | Distribution | High | npm registry |
| Binary path | Advanced | High | Environment |

**Recommended for development**: Use **Method 1 (Local Path Override)** for the best development experience.

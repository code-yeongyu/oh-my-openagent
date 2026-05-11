# Global Installation Guide

This guide explains how to install `oh-my-opendevin` globally on any system using the provided installer script.

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/fredotran/oh-my-opendevin/dev/install-global.sh | bash
```

Or clone the repository and run:

```bash
git clone https://github.com/fredotran/oh-my-opendevin.git
cd oh-my-opendevin
./install-global.sh
```

## Prerequisites

The installer requires:
- **npm** (required) - for installing the package globally
- **OpenCode** - the editor/IDE this plugin extends
- **bun** (optional) - only needed if the package isn't published to npm yet (for local build fallback)

**Note**: If the package isn't published to npm yet, the installer will fall back to local installation, which requires bun to build the project.

### Installing npm

If you don't have npm installed:

**Ubuntu/Debian:**
```bash
sudo apt-get update
sudo apt-get install -y nodejs npm
```

**macOS:**
```bash
brew install node
```

**Or use the official installer:**
Visit https://nodejs.org/ and download the LTS version.

## Installation Steps

The `install-global.sh` script performs the following steps:

1. **Check prerequisites** - Verifies npm is installed
2. **Install package globally** - Attempts `npm install -g oh-my-opendevin`; if not found on npm, falls back to local installation via symlinks
3. **Verify installation** - Confirms the package is in npm global packages or symlinked correctly
4. **Configure MCP servers** - Creates user-level `.mcp.json` for Devin MCP server (local installation only)
5. **Configure OpenCode** - Updates `~/.config/opencode/opencode.json` to use the package
6. **Run verification** - Executes the doctor check (optional)

**Fallback Behavior**: If the package isn't published to npm yet, the script will automatically build the project locally and create symlinks in npm's global directories. This allows you to test the installation before publishing.

**MCP Configuration**: For local installations, the script creates a user-level `.mcp.json` configuration at `~/.config/opencode/.mcp.json` that points to the compiled Devin MCP server in the dist directory. This ensures the Devin CLI integration works across all projects when using the globally installed package. The MCP server is compiled during the build process and included in the distributed package.

## Usage

```bash
./install-global.sh              # Install globally
./install-global.sh --uninstall  # Remove global installation
./install-global.sh --no-verify  # Skip verification step
./install-global.sh --help       # Show help
```

## What Gets Installed

- **Global npm package:** `oh-my-opendevin`
- **CLI commands:** `oh-my-opendevin` and `oh-my-opencode` (both point to the same binary)
- **OpenCode plugin:** Automatically configured in your OpenCode config

## After Installation

1. **Restart OpenCode** to load the plugin
2. **Verify installation:**
   ```bash
   oh-my-opendevin doctor
   # or
   oh-my-opencode doctor
   ```
3. **Check for agents** in OpenCode - you should see the OmO agents available

## Manual Configuration

If the automatic configuration fails, you can manually edit your OpenCode config:

**Location:** `~/.config/opencode/opencode.json` or `opencode.jsonc`

```json
{
  "plugin": ["oh-my-opendevin"]
}
```

**Important:** Remove any existing `oh-my-openagent` or `oh-my-opencode` entries to avoid conflicts.

## Uninstallation

To remove the global installation:

```bash
./install-global.sh --uninstall
```

Or manually:

```bash
npm uninstall -g oh-my-opendevin
# Then edit ~/.config/opencode/opencode.json to remove the plugin entry
```

## Troubleshooting

### "npm: command not found"

Install Node.js and npm from https://nodejs.org/

### "OpenCode config not found"

The installer will create a new config file at `~/.config/opencode/opencode.json` if one doesn't exist.

### "jq: command not found"

The installer uses `jq` for JSON manipulation. If it's not found:
- **Ubuntu/Debian:** `sudo apt-get install jq`
- **macOS:** `brew install jq`

Or manually edit the OpenCode config file as shown above.

### Plugin not loading in OpenCode

1. Restart OpenCode after running the installer
2. Check OpenCode logs for errors
3. Run `oh-my-opendevin doctor` to verify installation
4. Ensure the plugin entry in OpenCode config is correct

### Permission errors

If you get permission errors during npm install:
```bash
# Option 1: Fix npm permissions (recommended)
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Option 2: Use sudo (not recommended)
sudo npm install -g oh-my-opendevin
```

## Package Contents

The `oh-my-opendevin` package includes:

- **Core plugin:** The OpenCode plugin with all agents, tools, and features
- **CLI tools:** `oh-my-opendevin` command for various operations
- **Devin CLI integration:** Compiled MCP server and tools for delegating to Devin CLI
- **All upstream features:** Everything from the original oh-my-openagent

## MCP Server Configuration

The Devin CLI MCP server is compiled during the build process and included in the distributed package. For local installations (when the package isn't published to npm yet), the installer automatically creates a user-level MCP configuration at `~/.config/opencode/.mcp.json` that points to the compiled MCP server.

This means:
- The Devin MCP server will be available across all your projects
- No need to configure `.mcp.json` in each project
- The MCP server is loaded from the globally installed package
- When you publish to npm, the same configuration will work automatically

## Differences from Upstream

This fork adds:
- Devin CLI MCP server integration
- Built-in Devin CLI skill with model selection guidance
- Devin CLI slash commands (`/devin`, `/devin-models`, `/devin-status`, `/devin-cancel`)
- Session alias system for friendly session ID references

All core features from the original oh-my-openagent are preserved.

## Support

- **Issues:** https://github.com/fredotran/oh-my-opendevin/issues
- **Documentation:** https://github.com/fredotran/oh-my-opendevin
- **Upstream:** https://github.com/code-yeongyu/oh-my-openagent

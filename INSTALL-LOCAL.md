# Local Development Installation

This document describes how to install the oh-my-opendevin plugin from the local repository for development purposes.

## Quick Start

Run the installation script from the project root:

```bash
./install-local.sh
```

## Global Installation

Install the script globally for use from any directory:

```bash
./install-local.sh --install
```

This copies the script to `~/.local/bin/install-opencode-local`. Ensure `~/.local/bin` is in your PATH.

**Note**: The script uses a fixed path (`/home/frederichtran199/Code/oh-my-opendevin`) by default. If you move the project, either:
- Set the `PROJECT_ROOT` environment variable: `PROJECT_ROOT=/new/path install-opencode-local`
- Create a symlink: `ln -s /new/path ~/.local/share/oh-my-opendevin/current` and update the script

## Usage

```bash
install-opencode-local [--unlink] [--no-verify] [--help]
```

### Options

- `--unlink` - Remove local plugin and restore npm version
- `--no-verify` - Skip verification step (doctor check)
- `--install` - Install script to ~/.local/bin for global use
- `--help` - Show help message

### Environment Variables

- `PROJECT_ROOT` - Override the default project path (default: `/home/frederichtran199/Code/oh-my-opendevin`)

## What the Script Does

1. **Builds the project** - Runs `bun run build` to compile TypeScript to JavaScript
2. **Verifies build output** - Checks that `dist/index.js` exists
3. **Updates OpenCode config** - Modifies `~/.config/opencode/opencode.json` (or `opencode.jsonc`) to use the local `file://` URI
4. **Runs verification** (optional) - Executes `bunx oh-my-openagent doctor` to check the installation

## Manual Installation

If you prefer to do this manually:

### 1. Build the project

```bash
cd /home/frederichtran199/Code/oh-my-opendevin
bun run build
```

### 2. Update OpenCode config

Edit `~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```json
{
  "plugin": ["file:///home/frederichtran199/Code/oh-my-opendevin/dist/index.js"]
}
```

**Important**: Remove `"oh-my-openagent"` or `"oh-my-opencode"` from the plugin array if it exists, to avoid conflicts with the npm version.

### 3. Restart OpenCode

```bash
opencode
```

### 4. Verify installation

```bash
bunx oh-my-openagent doctor
```

## Rebuilding After Changes

Every time you make changes to the code:

```bash
cd /home/frederichtran199/Code/oh-my-opendevin
bun run build
# Restart OpenCode to pick up changes
```

## Uninstalling (Restore npm version)

To remove the local plugin and restore the npm version:

```bash
install-opencode-local --unlink
# Or from the project directory:
./install-local.sh --unlink
```

Or manually edit your OpenCode config to replace the `file://` entry with `"oh-my-openagent"`.

## Troubleshooting

### Build fails

- Ensure you have Bun installed: `curl -fsSL https://bun.sh/install | bash`
- Ensure dependencies are installed: `bun install`

### Config not found

- The script looks for `~/.config/opencode/opencode.json` or `opencode.jsonc`
- If neither exists, you'll need to create one manually

### jq not found

- The script uses `jq` for JSON manipulation. Install it with:
  - Ubuntu/Debian: `sudo apt-get install jq`
  - macOS: `brew install jq`
- If `jq` is not available, the script will show you the manual edit instructions

### Plugin not loading

- Restart OpenCode after running the script
- Check the OpenCode logs for errors
- Run `bunx oh-my-openagent doctor` to verify the installation

## Development Workflow

1. Make changes to the code
2. Run `bun run build` to rebuild
3. Restart OpenCode
4. Test your changes
5. Repeat

For faster iteration during development, you can use the `--no-verify` flag to skip the doctor check:

```bash
./install-local.sh --no-verify
```

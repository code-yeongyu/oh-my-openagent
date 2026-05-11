# Friendly Session Names Testing

This document describes how to test the friendly session names feature in oh-my-opendevin.

## Quick Test

Run the test script from the project root:

```bash
./test-friendly-names.sh
```

## Global Installation

Install the script globally for use from any directory:

```bash
./test-friendly-names.sh --install
```

This copies the script to `~/.local/bin/test-friendly-names`. Ensure `~/.local/bin` is in your PATH.

## Usage

```bash
test-friendly-names [--mcp] [--e2e] [--help]
```

### Options

- `--mcp` - Also test the Devin MCP server tools
- `--e2e` - Run end-to-end session naming test (requires opencode CLI)
- `--help` - Show help message

## What the Script Tests

1. **Module existence** - Verifies the friendly-session-names module directory exists
2. **Word lists** - Checks that fruit and vegetable word lists are populated
3. **Config schema** - Verifies the `friendly_session_names` config flag is present
4. **Event handler wiring** - Checks that the rename handler is wired in event.ts
5. **Unit tests** - Runs all unit tests in the friendly-session-names module
6. **Build check** - Verifies the project builds successfully
7. **End-to-end test** (optional, with `--e2e`) - Creates a temporary OpenCode session and checks if it gets renamed to a fruit-vegetable combo
8. **MCP server** (optional, with `--mcp`) - Tests the Devin MCP server tools

## Manual Testing

To manually test friendly session names:

1. Start OpenCode in the project directory:
   ```bash
   cd /home/frederichtran199/Code/oh-my-opendevin
   opencode
   ```

2. Create a new session (or let OpenCode auto-create one)

3. Check the session title:
   ```bash
   opencode session list
   ```

4. The session should be titled with a fruit-vegetable combo like `strawberry-carrot`, `mango-spinach`, etc.

## Disabling the Feature

To disable friendly session names for a project, create `.opencode/oh-my-openagent.jsonc`:

```jsonc
{
  "friendly_session_names": false
}
```

To disable globally, add the same to `~/.config/opencode/oh-my-openagent.jsonc`.

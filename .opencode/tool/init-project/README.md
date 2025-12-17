# Init-Project Command Tools

TypeScript utilities for the OpenCode `init-project` command.

## Quick Start

### Testing the Utilities

```bash
# Install dependencies
npm install

# Run validation script
npm run validate

# Test tech detection on a project
npm run detect /path/to/project

# Run full initialization (non-interactive)
npm run run /path/to/project
```

### Using with OpenCode

The orchestrator agent will execute these utilities via the `bash` tool:

```
@orchestrator Run the init-project command for this project
```

The orchestrator reads `.opencode/command/init-project.md` and uses these utilities to:
1. Detect technology stack
2. Generate configuration files
3. Create AGENTS.md files

## Structure

```
init-project/
├── tech-detection.ts      # Scans projects for tech stack
├── config-generator.ts    # Generates opencode.json, project-context.yaml
├── agents-generator.ts    # Generates AGENTS.md files
├── linear-setup.ts        # Linear integration helpers
├── edge-cases.ts          # Handles edge cases
├── runner.ts              # Main orchestrator
├── index.ts               # Exports
├── __tests__/             # Test suite
├── VALIDATION.md          # Testing guide
└── validate.sh            # Validation script
```

## Testing

See [VALIDATION.md](./VALIDATION.md) for comprehensive testing guide.

### Quick Test

```bash
# Create test project
mkdir /tmp/test-init
cd /tmp/test-init
echo '{"name": "test", "version": "1.0.0"}' > package.json

# Run initialization
cd /path/to/.opencode/tool/init-project
npm run run /tmp/test-init

# Verify outputs
ls -la /tmp/test-init/.opencode/
cat /tmp/test-init/.opencode/opencode.json
cat /tmp/test-init/AGENTS.md
```

## Integration with OpenCode

The command definition at `.opencode/command/init-project.md` instructs the orchestrator to:

1. **Read the command definition** - Understands the interactive flow
2. **Use bash tool** - Executes TypeScript utilities when needed:
   ```bash
   npx ts-node .opencode/tool/init-project/tech-detection.ts
   npx ts-node .opencode/tool/init-project/runner.ts
   ```
3. **Generate files** - Uses `write` tool to create config files
4. **Follow flow** - Guides user through each step

## Example: Testing with OpenCode

In OpenCode chat:

```
You: @orchestrator Please initialize this project with OpenCode using the init-project command

Orchestrator: 
📂 Checking for existing OpenCode configuration...
🚀 OpenCode Project Initialization

Let's set up your project for AI-assisted development.

1. Project Name: [detects from package.json]
2. Project Description: [asks user]
3. Project Type: [detects or asks]
...

[Uses bash tool to run tech-detection.ts]
[Uses write tool to create opencode.json]
[Uses write tool to create project-context.yaml]
[Uses write tool to create AGENTS.md files]
```

## Troubleshooting

### TypeScript not found
```bash
npm install --save-dev typescript ts-node @types/node
```

### Cannot find module 'fs'
The utilities use Node.js built-in modules. Ensure you're running with Node.js v18+.

### OpenCode can't execute tools
Ensure the orchestrator has `bash` tool permission in `opencode.json`:
```json
{
  "permission": {
    "bash": {
      "*": "ask",
      "npx ts-node": "allow"
    }
  }
}
```

## Next Steps

After validation:
1. ✅ Test utilities work standalone
2. ✅ Test with OpenCode orchestrator
3. ✅ Validate generated files
4. ✅ Test with real projects

Then proceed to Phase 6: Custom Tools!


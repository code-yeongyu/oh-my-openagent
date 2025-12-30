---
description: Manage SuperWhisper custom modes (list, create, update, delete, export, import) for voice-driven development
---

# SuperWhisper Mode Manager for OpenCode + OmO

Manage SuperWhisper custom modes directly on your device.

## User Request

```text
$ARGUMENTS
```

---

## SuperWhisper Directory Structure

```
SUPERWHISPER_DIR = ~/Documents/superwhisper
├── modes/                    # Mode JSON files
│   ├── custom-XXXX.json     # Custom modes (4-char random suffix)
│   ├── default.json         # Built-in default mode
│   └── message-XXXX.json    # Message modes
└── settings/
    └── settings.json        # Contains modeKeys array (active modes)
```

---

## Step 0: Parse Command & Route

Identify which operation the user wants:

| Command | Action |
|---------|--------|
| `list` | List all modes on device |
| `create [name]` | Create new mode and install to SuperWhisper |
| `update [name]` | Update an existing mode |
| `delete [name]` | Remove mode from SuperWhisper |
| `export [name]` | Export mode from device to project templates |
| `import` | Import mode from project templates to device |

If no command specified or just a description, default to `create` with that description.

---

## Operation: LIST

List all SuperWhisper modes on the device.

```bash
# Read settings to get active modes
cat ~/Documents/superwhisper/settings/settings.json | jq '.modeKeys'

# List mode files with names
for f in ~/Documents/superwhisper/modes/*.json; do
  echo "$(basename $f .json): $(jq -r '.name' $f)"
done
```

**Output format:**
```
SuperWhisper Modes on Device:
─────────────────────────────
  custom-PSJF    Planning Mode
  custom-NBTW    OpenCode Developer
  default        Default
  meeting        Meeting Notes
─────────────────────────────
Total: 4 modes
```

---

## Operation: CREATE

Create a new SuperWhisper mode and install it directly to the device.

### Step 1: Gather Project Context (Background Agents)

```
background_task(agent="explore", prompt="Quick scan: project type, tech stack, key directories")
background_task(agent="explore", prompt="List available slash commands in .opencode/command/ and ~/.config/opencode/command/")
```

### Step 2: Read Project Context

```
read_context({ section: "all" })
```

### Step 3: Generate Mode Key

Generate a unique 4-character alphanumeric key:
```javascript
const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const key = 'custom-' + Array.from({length: 4}, () => chars[Math.floor(Math.random() * 26)]).join('');
// Example: "custom-XKCD"
```

### Step 4: Create Mode JSON

Use the **actual SuperWhisper format** (discovered from device):

```json
{
  "activationApps": ["Terminal", "iTerm2", "Warp", "Alacritty", "kitty", "VS Code", "Cursor", "Zed"],
  "activationSites": [],
  "adjustOutputVolume": true,
  "contextFromActiveApplication": true,
  "contextFromClipboard": true,
  "contextFromSelection": true,
  "contextTemplate": "Use the context below to inform your response.\n\nContext: ",
  "description": "{PROJECT_DESCRIPTION}",
  "diarize": false,
  "iconName": "",
  "key": "{GENERATED_KEY}",
  "language": "en",
  "languageModelEnabled": true,
  "languageModelID": "sw-claude-4p5-sonnet",
  "literalPunctuation": false,
  "name": "OpenCode - {PROJECT_NAME}",
  "pauseMediaPlayback": false,
  "prompt": "ROLE: You are an AI post-processor for voice-to-text dictation intended for OpenCode with the OmO plugin.\n\nGOAL: Transform spoken natural language into clear, actionable prompts for AI-assisted coding.\n\nCONTEXT:\n- Project: {PROJECT_NAME}\n- Tech Stack: {TECH_STACK}\n- Available Agents: OmO (orchestrator), oracle (advisor), explore (search), librarian (docs), implementation-specialist, frontend-ui-ux-engineer, document-writer, backend-typescript, backend-python, backend-rust, security-specialist, test-specialist, optimization-specialist\n- Available Commands: /specify, /plan, /tasks, /implement, /review, /test, /create-pr, /debug-issue, /try-hard, /code-review, /security-audit\n\nPROCESSING RULES:\n\n1. INTENT DETECTION - Identify what the user wants:\n   - COMMAND: \"specify\", \"plan\", \"implement\", \"review\", \"test\" -> Map to slash command\n   - QUESTION: \"how does\", \"where is\", \"what is\", \"explain\" -> Format as question\n   - IMPLEMENTATION: \"add\", \"create\", \"fix\", \"refactor\", \"update\" -> Action description\n   - EXPLORATION: \"find\", \"search\", \"show me\", \"look for\" -> Search request\n   - ANALYSIS: \"think through\", \"analyze\", \"consider\" -> /try-hard deep analysis\n\n2. COMMAND MAPPING - Transform spoken intent to commands:\n   - \"specify/describe/define a feature\" -> /specify [requirements]\n   - \"plan/design/architect\" -> /plan\n   - \"break down/create tasks\" -> /tasks\n   - \"implement/build/code\" -> /implement\n   - \"review my code/changes\" -> /review\n   - \"test/verify/check\" -> /test\n   - \"create PR/pull request\" -> /create-pr\n   - \"think through/analyze deeply\" -> /try-hard [problem]\n   - \"debug/fix the issue\" -> /debug-issue [description]\n\n3. SPEECH CLEANUP - Clean dictation artifacts:\n   - Remove filler: \"um\", \"uh\", \"like\", \"you know\", \"basically\", \"so\"\n   - Fix grammar and punctuation\n   - Preserve technical terms exactly as spoken\n   - Convert spoken code: \"use state\" -> \"useState\", \"async await\" -> \"async/await\"\n\n4. CONTEXT INTEGRATION:\n   - If Application Context shows code -> Reference the current file\n   - If Selected Text exists -> Incorporate as \"the selected code\"\n   - If Clipboard Context has code -> Reference as \"the copied code\"\n\n5. OUTPUT FORMAT:\n   - If command detected: Start with the slash command\n   - If question: Clear, specific question\n   - If implementation: Actionable description with requirements\n   - Always ready to paste directly into OpenCode\n\nCRITICAL: This is one-shot transformation. NEVER ask questions or request clarification. Output must be complete and actionable immediately.",
  "promptExamples": [
    {
      "id": "{UUID_1}",
      "input": "okay so I want to uh specify a new feature for user authentication with like OAuth and maybe magic links too",
      "output": "/specify Add user authentication supporting OAuth2 (Google, GitHub) and passwordless magic link login"
    },
    {
      "id": "{UUID_2}",
      "input": "let's plan the implementation for this feature we just specified",
      "output": "/plan"
    },
    {
      "id": "{UUID_3}",
      "input": "can you add a dark mode toggle to the settings page it should uh persist in local storage",
      "output": "Add a dark mode toggle to the settings page. Requirements: persist the user's preference to localStorage and apply the theme on page load."
    },
    {
      "id": "{UUID_4}",
      "input": "where is the uh authentication logic how does it work",
      "output": "Where is the authentication logic implemented? Explain how the auth flow works in this codebase."
    },
    {
      "id": "{UUID_5}",
      "input": "there's a bug in the user service the null check is missing on line like 42 I think fix that",
      "output": "Fix bug in user service: add null check around line 42 to prevent null pointer exception."
    },
    {
      "id": "{UUID_6}",
      "input": "refactor this code to use async await instead of promises",
      "output": "Refactor the selected code to use async/await syntax instead of Promise chains."
    },
    {
      "id": "{UUID_7}",
      "input": "create a PR for this branch uh describe what we changed",
      "output": "/create-pr"
    },
    {
      "id": "{UUID_8}",
      "input": "review the changes I made check for security issues too",
      "output": "/review Focus on security vulnerabilities and best practices."
    },
    {
      "id": "{UUID_9}",
      "input": "I need to think through this architecture decision should we use microservices or keep the monolith",
      "output": "/try-hard Should we migrate to microservices or improve our monolith? Consider scalability, team structure, and operational complexity."
    },
    {
      "id": "{UUID_10}",
      "input": "ask the oracle about the best way to structure this",
      "output": "Consult Oracle for architectural guidance on how to structure this feature. Consider maintainability, testability, and scalability."
    }
  ],
  "realtimeOutput": false,
  "script": "",
  "scriptEnabled": false,
  "translateToEnglish": false,
  "type": "custom",
  "useSystemAudio": false,
  "version": 1,
  "voiceModelID": "nvidia_parakeet-v2_476MB"
}
```

### Step 5: Write Mode to Device

```bash
# Write the mode file
write({
  filePath: "~/Documents/superwhisper/modes/{KEY}.json",
  content: "[GENERATED JSON]"
})
```

### Step 6: Update Settings (Add to modeKeys)

Read current settings, add new key, write back:

```bash
# Read current settings
read({ filePath: "~/Documents/superwhisper/settings/settings.json" })

# Add new key to modeKeys array (if not already present)
# Write updated settings
```

### Step 7: Confirm Installation

```markdown
## Mode Installed Successfully!

**Mode**: OpenCode - {PROJECT_NAME}
**Key**: {GENERATED_KEY}
**Location**: ~/Documents/superwhisper/modes/{KEY}.json

### Next Steps
1. Open SuperWhisper
2. Go to Settings -> Modes
3. Your new mode should appear in the list
4. Select it to make it active

### Quick Test
Try these voice commands:
- "specify a new feature for user login"
- "where is the main entry point"
- "fix the bug in the auth module"
```

---

## Operation: UPDATE

Update an existing SuperWhisper mode.

### Step 1: Find the Mode

```bash
# List modes to find the one to update
ls ~/Documents/superwhisper/modes/*.json
```

### Step 2: Read Current Mode

```bash
read({ filePath: "~/Documents/superwhisper/modes/{mode-key}.json" })
```

### Step 3: Apply Updates

Based on user request, update specific fields:
- `prompt` - Update custom instructions
- `promptExamples` - Add/modify examples
- `activationApps` - Change which apps trigger this mode
- `name` - Rename the mode

### Step 4: Write Updated Mode

```bash
write({
  filePath: "~/Documents/superwhisper/modes/{mode-key}.json",
  content: "[UPDATED JSON]"
})
```

---

## Operation: DELETE

Remove a mode from SuperWhisper.

### Step 1: Confirm Mode Exists

```bash
ls ~/Documents/superwhisper/modes/{mode-key}.json
```

### Step 2: Remove from Settings

Read settings, remove key from `modeKeys` array, write back.

### Step 3: Delete Mode File

```bash
# Note: Use bash to remove the file
rm ~/Documents/superwhisper/modes/{mode-key}.json
```

### Step 4: Confirm Deletion

```markdown
## Mode Deleted

**Removed**: {mode-name} ({mode-key})
**Location**: ~/Documents/superwhisper/modes/{mode-key}.json

The mode has been removed from SuperWhisper.
```

---

## Operation: EXPORT

Export a mode from device to project templates.

### Step 1: Read Mode from Device

```bash
read({ filePath: "~/Documents/superwhisper/modes/{mode-key}.json" })
```

### Step 2: Write to Project Templates

```bash
write({
  filePath: ".opencode/templates/superwhisper/{mode-name}.json",
  content: "[MODE JSON]"
})
```

### Step 3: Confirm Export

```markdown
## Mode Exported

**From**: ~/Documents/superwhisper/modes/{mode-key}.json
**To**: .opencode/templates/superwhisper/{mode-name}.json

The mode is now saved in your project and can be shared via git.
```

---

## Operation: IMPORT

Import a mode from project templates to device.

### Step 1: List Available Templates

```bash
ls .opencode/templates/superwhisper/*.json
```

### Step 2: Read Template

```bash
read({ filePath: ".opencode/templates/superwhisper/{template}.json" })
```

### Step 3: Generate New Key (if needed)

If the mode doesn't have a unique key, generate one.

### Step 4: Write to Device

```bash
write({
  filePath: "~/Documents/superwhisper/modes/{key}.json",
  content: "[MODE JSON with updated key]"
})
```

### Step 5: Update Settings

Add new key to `modeKeys` array in settings.json.

### Step 6: Confirm Import

```markdown
## Mode Imported

**From**: .opencode/templates/superwhisper/{template}.json
**To**: ~/Documents/superwhisper/modes/{key}.json

Open SuperWhisper to see the new mode in your list.
```

---

## Project-Specific Customization

When creating modes, customize based on detected project:

**TypeScript/Node.js projects** - Add examples:
```json
{"input": "run the tests", "output": "bun test"},
{"input": "check types", "output": "bun run typecheck"},
{"input": "install axios", "output": "bun add axios"}
```

**React projects** - Add examples:
```json
{"input": "create a new component for the header", "output": "Create a Header component in src/components/Header.tsx with proper TypeScript types."},
{"input": "add a use state hook for loading", "output": "Add a useState hook to track loading state: const [isLoading, setIsLoading] = useState(false)"}
```

**Python projects** - Add examples:
```json
{"input": "run pytest", "output": "pytest"},
{"input": "create a virtual environment", "output": "python -m venv .venv && source .venv/bin/activate"}
```

**OmO plugin projects** - Add examples:
```json
{"input": "add a new hook for validation", "output": "Create a validation hook in src/hooks/validation/ following the createXXXHook pattern."},
{"input": "create a new agent", "output": "Add a new agent definition in src/agents/ with proper tool restrictions."}
```

---

## Quality Checklist

Before completing any operation:

- [ ] Mode JSON is valid and well-formed
- [ ] Key is unique (not already in use)
- [ ] Settings.json is properly updated
- [ ] File paths use correct home directory expansion
- [ ] Confirmation message shows what was done

---

## Anti-Patterns

- **DO NOT** delete built-in modes (default, meeting)
- **DO NOT** create duplicate keys
- **DO NOT** leave settings.json in invalid state
- **DO NOT** include dialog/questions in prompt field
- **DO NOT** forget to update modeKeys array after create/delete

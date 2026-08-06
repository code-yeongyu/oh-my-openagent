# Dev Browser Installation Guide

This guide covers installation for all platforms: macOS, Linux, and Windows.

## Prerequisites

- [Node.js](https://nodejs.org) v18 or later with npm
- Git (for cloning the skill)

## Installation

### Step 1: Clone the Skill

```bash
# Clone dev-browser to a temporary location
git clone https://github.com/sawyerhood/dev-browser /tmp/dev-browser-skill

# Copy to skills directory (adjust path as needed)
# For oh-my-opencode: already bundled
# For manual installation:
mkdir -p ~/.config/opencode/skills
cp -r /tmp/dev-browser-skill/skills/dev-browser ~/.config/opencode/skills/dev-browser

# Cleanup
rm -rf /tmp/dev-browser-skill
```

**Windows (PowerShell):**
```powershell
# Clone dev-browser to temp location
git clone https://github.com/sawyerhood/dev-browser $env:TEMP\dev-browser-skill

# Copy to skills directory
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\skills"
Copy-Item -Recurse "$env:TEMP\dev-browser-skill\skills\dev-browser" "$env:USERPROFILE\.config\opencode\skills\dev-browser"

# Cleanup
Remove-Item -Recurse -Force "$env:TEMP\dev-browser-skill"
```

### Step 2: Install Dependencies

```bash
cd ~/.config/opencode/skills/dev-browser
npm install
```

**Windows (PowerShell):**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
npm install
```

### Step 3: Start the Server

#### Standalone Mode (New Browser Instance)

**macOS/Linux:**
```bash
cd ~/.config/opencode/skills/dev-browser
./server.sh &
# Or for headless:
./server.sh --headless &
```

**Windows (PowerShell):**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js"
# Or for headless:
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "server.js", "--headless"
```

**Windows (CMD):**
```cmd
cd %USERPROFILE%\.config\opencode\skills\dev-browser
start /B node server.js
```

Wait for the `Ready` message before running scripts.

#### Extension Mode (Use Existing Chrome)

**macOS/Linux:**
```bash
cd ~/.config/opencode/skills/dev-browser
npm run start-extension &
```

**Windows (PowerShell):**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "start-extension"
```

Wait for `Extension connected` message.

## Chrome Extension Setup (Optional)

The Chrome extension allows controlling your existing Chrome browser with all your logged-in sessions.

### Installation

1. Download `extension.zip` from [latest release](https://github.com/sawyerhood/dev-browser/releases/latest)
2. Extract to a permanent location:
   - **macOS/Linux:** `~/.dev-browser-extension`
   - **Windows:** `%USERPROFILE%\.dev-browser-extension`
3. Open Chrome → `chrome://extensions`
4. Enable "Developer mode" (toggle in top right)
5. Click "Load unpacked" → select the extracted folder

### Usage

1. Click the Dev Browser extension icon in Chrome toolbar
2. Toggle to "Active"
3. Start the extension relay server (see above)
4. Use dev-browser scripts - they'll control your existing Chrome

## Troubleshooting

### Server Won't Start

**Check Node.js version:**
```bash
node --version  # Should be v18+
```

**Check port availability:**
```bash
# macOS/Linux
lsof -i :3000

# Windows
netstat -ano | findstr :3000
```

### Playwright Installation Issues

If Chromium fails to install:
```bash
npx playwright install chromium
```

### Windows-Specific Issues

**Execution Policy:**
If PowerShell scripts are blocked:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Path Issues:**
Use forward slashes or escaped backslashes in paths:
```powershell
# Good
cd "$env:USERPROFILE/.config/opencode/skills/dev-browser"
# Also good
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
```

### Extension Not Connecting

1. Ensure extension is "Active" (click icon to toggle)
2. Check relay server is running (`npm run start-extension`)
3. Look for `Extension connected` message in console
4. Try reloading the extension in `chrome://extensions`

## Permissions

To skip permission prompts in Claude Code, add to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["Skill(dev-browser:dev-browser)", "Bash(npx tsx:*)"]
  }
}
```

## Updating

```bash
cd ~/.config/opencode/skills/dev-browser
git pull
npm install
```

**Windows:**
```powershell
cd "$env:USERPROFILE\.config\opencode\skills\dev-browser"
git pull
npm install
```

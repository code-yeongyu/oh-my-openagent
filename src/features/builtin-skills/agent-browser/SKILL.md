---
name: agent-browser
description: Automates browser interactions for web testing, form filling, screenshots, and data extraction. Use when the user needs to navigate websites, interact with web pages, fill forms, take screenshots, test web applications, or extract information from web pages.
---

# Browser Automation with agent-browser

## Quick start

```bash
agent-browser open <url>        # Navigate to page
agent-browser snapshot -i       # Get interactive elements with refs
agent-browser click @e1         # Click element by ref
agent-browser fill @e2 "text"   # Fill input by ref
agent-browser close             # Close browser
```

## Core workflow

1. Navigate: `agent-browser open <url>`
2. Snapshot: `agent-browser snapshot -i` (returns elements with refs like `@e1`, `@e2`)
3. Interact using refs from the snapshot
4. Re-snapshot after navigation or significant DOM changes

## Commands

### Navigation
```bash
agent-browser open <url>      # Navigate to URL (aliases: goto, navigate)
agent-browser back            # Go back
agent-browser forward         # Go forward
agent-browser reload          # Reload page
agent-browser close           # Close browser (aliases: quit, exit)
```

### Snapshot (page analysis)
```bash
agent-browser snapshot            # Full accessibility tree
agent-browser snapshot -i         # Interactive elements only (recommended)
agent-browser snapshot -i -C      # Include cursor-interactive elements (divs with onclick, etc.)
agent-browser snapshot -c         # Compact (remove empty structural elements)
agent-browser snapshot -d 3       # Limit depth to 3
agent-browser snapshot -s "#main" # Scope to CSS selector
agent-browser snapshot -i -c -d 5 # Combine options
```

The `-C` flag is useful for modern web apps that use custom clickable elements (divs, spans) instead of standard buttons/links.

### Interactions (use @refs from snapshot)
```bash
agent-browser click @e1           # Click (--new-tab to open in new tab)
agent-browser dblclick @e1        # Double-click
agent-browser focus @e1           # Focus element
agent-browser fill @e2 "text"     # Clear and type
agent-browser type @e2 "text"     # Type without clearing
agent-browser keyboard type "text"     # Type with real keystrokes (no selector, current focus)
agent-browser keyboard inserttext "text"  # Insert text without key events (no selector)
agent-browser press Enter         # Press key
agent-browser press Control+a     # Key combination
agent-browser keydown Shift       # Hold key down
agent-browser keyup Shift         # Release key
agent-browser hover @e1           # Hover
agent-browser check @e1           # Check checkbox
agent-browser uncheck @e1         # Uncheck checkbox
agent-browser select @e1 "value"  # Select dropdown
agent-browser scroll down 500     # Scroll page (--selector <sel> for container)
agent-browser scrollintoview @e1  # Scroll element into view (alias: scrollinto)
agent-browser drag @e1 @e2        # Drag and drop
agent-browser upload @e1 file.pdf # Upload files
```

### Get information
```bash
agent-browser get text @e1        # Get element text
agent-browser get html @e1        # Get innerHTML
agent-browser get value @e1       # Get input value
agent-browser get attr @e1 href   # Get attribute
agent-browser get title           # Get page title
agent-browser get url             # Get current URL
agent-browser get count ".item"   # Count matching elements
agent-browser get box @e1         # Get bounding box
agent-browser get styles @e1      # Get computed styles
```

### Check state
```bash
agent-browser is visible @e1      # Check if visible
agent-browser is enabled @e1      # Check if enabled
agent-browser is checked @e1      # Check if checked
```

### Screenshots & PDF
```bash
agent-browser screenshot          # Screenshot (saves to temp dir if no path)
agent-browser screenshot path.png # Save to file
agent-browser screenshot --full   # Full page
agent-browser screenshot --annotate   # Annotated screenshot with numbered element labels
agent-browser pdf output.pdf      # Save as PDF
```

Annotated screenshots overlay numbered labels `[N]` on interactive elements. Each label corresponds to ref `@eN`, so refs work for both visual and text workflows:
```bash
agent-browser screenshot --annotate ./page.png
# Output: [1] @e1 button "Submit", [2] @e2 link "Home", [3] @e3 textbox "Email"
agent-browser click @e2     # Click the "Home" link labeled [2]
```

### Video recording
```bash
agent-browser record start ./demo.webm    # Start recording (uses current URL + state)
agent-browser click @e1                   # Perform actions
agent-browser record stop                 # Stop and save video
agent-browser record restart ./take2.webm # Stop current + start new recording
```
Recording creates a fresh context but preserves cookies/storage from your session.

### Wait
```bash
agent-browser wait @e1                     # Wait for element
agent-browser wait 2000                    # Wait milliseconds
agent-browser wait --text "Success"        # Wait for text
agent-browser wait --url "**/dashboard"    # Wait for URL pattern
agent-browser wait --load networkidle      # Wait for network idle
agent-browser wait --fn "window.ready"     # Wait for JS condition
```

Load states: `load`, `domcontentloaded`, `networkidle`

### Mouse control
```bash
agent-browser mouse move 100 200      # Move mouse
agent-browser mouse down left         # Press button (left/right/middle)
agent-browser mouse up left           # Release button
agent-browser mouse wheel 100         # Scroll wheel
```

### Semantic locators (alternative to refs)
```bash
agent-browser find role button click --name "Submit"
agent-browser find text "Sign In" click
agent-browser find label "Email" fill "user@test.com"
agent-browser find placeholder "Search..." fill "query"
agent-browser find alt "Logo" click
agent-browser find title "Close" click
agent-browser find testid "submit-btn" click
agent-browser find first ".item" click
agent-browser find last ".item" click
agent-browser find nth 2 "a" text
```

Actions: `click`, `fill`, `type`, `hover`, `focus`, `check`, `uncheck`, `text`
Options: `--name <name>` (filter role by accessible name), `--exact` (require exact text match)

### Browser settings
```bash
agent-browser set viewport 1920 1080      # Set viewport size
agent-browser set device "iPhone 14"      # Emulate device
agent-browser set geo 37.7749 -122.4194   # Set geolocation
agent-browser set offline on              # Toggle offline mode
agent-browser set headers '{"X-Key":"v"}' # Extra HTTP headers
agent-browser set credentials user pass   # HTTP basic auth
agent-browser set media dark              # Emulate color scheme
```

### Cookies & Storage
```bash
agent-browser cookies                     # Get all cookies
agent-browser cookies set name value      # Set cookie
agent-browser cookies clear               # Clear cookies

agent-browser storage local               # Get all localStorage
agent-browser storage local key           # Get specific key
agent-browser storage local set k v       # Set value
agent-browser storage local clear         # Clear all

agent-browser storage session             # Same for sessionStorage
```

### Network
```bash
agent-browser network route <url>              # Intercept requests
agent-browser network route <url> --abort      # Block requests
agent-browser network route <url> --body '{}'  # Mock response
agent-browser network unroute [url]            # Remove routes
agent-browser network requests                 # View tracked requests
agent-browser network requests --filter api    # Filter requests
```

### Tabs & Windows
```bash
agent-browser tab                 # List tabs
agent-browser tab new [url]       # New tab
agent-browser tab 2               # Switch to tab
agent-browser tab close           # Close tab
agent-browser window new          # New window
```

### Frames
```bash
agent-browser frame "#iframe"     # Switch to iframe
agent-browser frame main          # Back to main frame
```

### Dialogs
```bash
agent-browser dialog accept [text]  # Accept dialog (with optional prompt text)
agent-browser dialog dismiss        # Dismiss dialog
```

### Diff (compare snapshots, screenshots, URLs)
```bash
agent-browser diff snapshot                              # Compare current vs last snapshot
agent-browser diff snapshot --baseline before.txt        # Compare current vs saved snapshot file
agent-browser diff snapshot --selector "#main" --compact # Scoped snapshot diff
agent-browser diff screenshot --baseline before.png      # Visual pixel diff against baseline
agent-browser diff screenshot --baseline b.png -o d.png  # Save diff image to custom path
agent-browser diff screenshot --baseline b.png -t 0.2    # Adjust color threshold (0-1)
agent-browser diff url https://v1.com https://v2.com     # Compare two URLs (snapshot diff)
agent-browser diff url https://v1.com https://v2.com --screenshot  # Also visual diff
agent-browser diff url https://v1.com https://v2.com --selector "#main"  # Scope to element
```

### JavaScript
```bash
agent-browser eval "document.title"   # Run JavaScript
agent-browser eval -b "base64code"    # Run base64-encoded JS
agent-browser eval --stdin            # Read JS from stdin
```

### Debug & Profiling
```bash
agent-browser console                 # View console messages
agent-browser console --clear         # Clear console
agent-browser errors                  # View page errors
agent-browser errors --clear          # Clear errors
agent-browser highlight @e1           # Highlight element
agent-browser trace start             # Start recording trace
agent-browser trace stop trace.zip    # Stop and save trace
agent-browser profiler start          # Start Chrome DevTools profiling
agent-browser profiler stop profile.json  # Stop and save profile
```

### State management
```bash
agent-browser state save auth.json    # Save auth state
agent-browser state load auth.json    # Load auth state
agent-browser state list              # List saved state files
agent-browser state show <file>       # Show state summary
agent-browser state rename <old> <new>  # Rename state file
agent-browser state clear [name]      # Clear states for session
agent-browser state clear --all       # Clear all saved states
agent-browser state clean --older-than <days>  # Delete old states
```

### Setup
```bash
agent-browser install                 # Download Chromium browser
agent-browser install --with-deps     # Also install system deps (Linux)
```

## Global Options

| Option | Description |
|--------|-------------|
| `--session <name>` | Isolated browser session (`AGENT_BROWSER_SESSION` env) |
| `--session-name <name>` | Auto-save/restore session state (`AGENT_BROWSER_SESSION_NAME` env) |
| `--profile <path>` | Persistent browser profile (`AGENT_BROWSER_PROFILE` env) |
| `--state <path>` | Load storage state from JSON file (`AGENT_BROWSER_STATE` env) |
| `--headers <json>` | HTTP headers scoped to URL's origin |
| `--executable-path <path>` | Custom browser binary (`AGENT_BROWSER_EXECUTABLE_PATH` env) |
| `--extension <path>` | Load browser extension (repeatable; `AGENT_BROWSER_EXTENSIONS` env) |
| `--args <args>` | Browser launch args (`AGENT_BROWSER_ARGS` env) |
| `--user-agent <ua>` | Custom User-Agent (`AGENT_BROWSER_USER_AGENT` env) |
| `--proxy <url>` | Proxy server (`AGENT_BROWSER_PROXY` env) |
| `--proxy-bypass <hosts>` | Hosts to bypass proxy (`AGENT_BROWSER_PROXY_BYPASS` env) |
| `--ignore-https-errors` | Ignore HTTPS certificate errors |
| `--allow-file-access` | Allow file:// URLs to access local files |
| `-p, --provider <name>` | Cloud browser provider (`AGENT_BROWSER_PROVIDER` env) |
| `--device <name>` | iOS device name (`AGENT_BROWSER_IOS_DEVICE` env) |
| `--json` | Machine-readable JSON output |
| `--full, -f` | Full page screenshot |
| `--annotate` | Annotated screenshot with numbered labels (`AGENT_BROWSER_ANNOTATE` env) |
| `--headed` | Show browser window (`AGENT_BROWSER_HEADED` env) |
| `--cdp <port\|wss://url>` | Connect via Chrome DevTools Protocol |
| `--auto-connect` | Auto-discover running Chrome (`AGENT_BROWSER_AUTO_CONNECT` env) |
| `--color-scheme <scheme>` | Color scheme: dark, light, no-preference (`AGENT_BROWSER_COLOR_SCHEME` env) |
| `--download-path <path>` | Default download directory (`AGENT_BROWSER_DOWNLOAD_PATH` env) |
| `--native` | [Experimental] Use native Rust daemon (`AGENT_BROWSER_NATIVE` env) |
| `--config <path>` | Custom config file (`AGENT_BROWSER_CONFIG` env) |
| `--debug` | Debug output |

### Security options
| Option | Description |
|--------|-------------|
| `--content-boundaries` | Wrap page output in boundary markers (`AGENT_BROWSER_CONTENT_BOUNDARIES` env) |
| `--max-output <chars>` | Truncate page output to N characters (`AGENT_BROWSER_MAX_OUTPUT` env) |
| `--allowed-domains <list>` | Comma-separated allowed domain patterns (`AGENT_BROWSER_ALLOWED_DOMAINS` env) |
| `--action-policy <path>` | Path to action policy JSON file (`AGENT_BROWSER_ACTION_POLICY` env) |
| `--confirm-actions <list>` | Action categories requiring confirmation (`AGENT_BROWSER_CONFIRM_ACTIONS` env) |

## Configuration file

Create `agent-browser.json` for persistent defaults (no need to repeat flags):

**Locations (lowest to highest priority):**
1. `~/.agent-browser/config.json` — user-level defaults
2. `./agent-browser.json` — project-level overrides
3. `AGENT_BROWSER_*` environment variables
4. CLI flags override everything

```json
{
  "headed": true,
  "proxy": "http://localhost:8080",
  "profile": "./browser-data",
  "native": true
}
```

## Example: Form submission

```bash
agent-browser open https://example.com/form
agent-browser snapshot -i
# Output shows: textbox "Email" [ref=e1], textbox "Password" [ref=e2], button "Submit" [ref=e3]

agent-browser fill @e1 "user@example.com"
agent-browser fill @e2 "password123"
agent-browser click @e3
agent-browser wait --load networkidle
agent-browser snapshot -i  # Check result
```

## Example: Authentication with saved state

```bash
# Login once
agent-browser open https://app.example.com/login
agent-browser snapshot -i
agent-browser fill @e1 "username"
agent-browser fill @e2 "password"
agent-browser click @e3
agent-browser wait --url "**/dashboard"
agent-browser state save auth.json

# Later sessions: load saved state
agent-browser state load auth.json
agent-browser open https://app.example.com/dashboard
```

### Header-based Auth (Skip login flows)
```bash
# Headers scoped to api.example.com only
agent-browser open api.example.com --headers '{"Authorization": "Bearer <token>"}'
# Navigate to another domain - headers NOT sent (safe)
agent-browser open other-site.com
# Global headers (all domains)
agent-browser set headers '{"X-Custom-Header": "value"}'
```

### Authentication Vault
```bash
# Store credentials locally (encrypted). The LLM never sees passwords.
echo "pass" | agent-browser auth save github --url https://github.com/login --username user --password-stdin
agent-browser auth login github
```

## Sessions & Persistent Profiles

### Sessions (parallel browsers)
```bash
agent-browser --session test1 open site-a.com
agent-browser --session test2 open site-b.com
agent-browser session list
```

### Session persistence (auto-save/restore)
```bash
agent-browser --session-name twitter open twitter.com
# Login once, state persists automatically across restarts
# State files stored in ~/.agent-browser/sessions/
```

### Persistent Profiles
Persists cookies, localStorage, IndexedDB, service workers, cache, login sessions across browser restarts.
```bash
agent-browser --profile ~/.myapp-profile open myapp.com
# Or via env var
AGENT_BROWSER_PROFILE=~/.myapp-profile agent-browser open myapp.com
```

## JSON output (for parsing)

Add `--json` for machine-readable output:
```bash
agent-browser snapshot -i --json
agent-browser get text @e1 --json
```

## Local files

```bash
agent-browser --allow-file-access open file:///path/to/document.pdf
agent-browser --allow-file-access open file:///path/to/page.html
```

## CDP Mode

```bash
agent-browser connect 9222                                          # Local CDP port
agent-browser --cdp 9222 snapshot                                   # Direct CDP on each command
agent-browser --cdp "wss://browser-service.com/cdp?token=..." snapshot  # Remote via WebSocket
agent-browser --auto-connect snapshot                               # Auto-discover running Chrome
```

## Cloud providers

```bash
# Browserbase
BROWSERBASE_API_KEY="key" BROWSERBASE_PROJECT_ID="id" agent-browser -p browserbase open example.com

# Browser Use
BROWSER_USE_API_KEY="key" agent-browser -p browseruse open example.com

# Kernel
KERNEL_API_KEY="key" agent-browser -p kernel open example.com
```

## iOS Simulator

```bash
agent-browser device list                                        # List available simulators
agent-browser -p ios --device "iPhone 16 Pro" open example.com   # Launch Safari
agent-browser -p ios snapshot -i                                 # Same commands as desktop
agent-browser -p ios tap @e1                                     # Tap
agent-browser -p ios swipe up                                    # Mobile-specific
agent-browser -p ios close                                       # Close session
```

## Native Mode (Experimental)

Pure Rust daemon using direct CDP — no Node.js/Playwright required:
```bash
agent-browser --native open example.com
# Or: export AGENT_BROWSER_NATIVE=1
# Or: {"native": true} in agent-browser.json
```

---
Install: `bun add -g agent-browser && agent-browser install`. Run `agent-browser --help` for all commands. Repo: https://github.com/vercel-labs/agent-browser

import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { BuiltinSkill } from "../types"

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url))

// dev-browser's start-server.ts runs `kill -9` on whatever holds the CDP port when nothing answers on the HTTP port.
// A SIGKILLed Chrome skips its clean exit and leaks per-launch state (the macOS code-sign clone of the app bundle), so
// release the port first: SIGTERM, wait up to the grace window, then SIGKILL only the survivors.
// Without curl, "is a server answering" is unknown, so the step does nothing rather than signal a live server's browser.
// Pid lists are split through $(echo ...) because zsh does not word-split an unquoted $pids.
export function releaseStaleCdpPortScript({ httpPort = 9222, cdpPort = 9223, graceSeconds = 5 } = {}): string {
  return `if command -v curl >/dev/null && command -v lsof >/dev/null && ! curl -sf -m 1 -o /dev/null http://localhost:${httpPort}; then
  pids=$(lsof -ti:${cdpPort} 2>/dev/null)
  if [ -n "$pids" ]; then
    for p in $(echo $pids); do kill -TERM "$p" 2>/dev/null; done
    left=""
    for _ in $(seq ${graceSeconds * 10}); do
      left=""; for p in $(echo $pids); do kill -0 "$p" 2>/dev/null && left="$left $p"; done
      [ -z "$left" ] && break; sleep 0.1
    done
    for p in $(echo $left); do kill -KILL "$p" 2>/dev/null; done
  fi
fi`
}

export const devBrowserSkill: BuiltinSkill = {
  name: "dev-browser",
  description:
    "Browser automation with persistent page state. Use when users ask to navigate websites, fill forms, take screenshots, extract web data, test web apps, or automate browser workflows. Trigger phrases include 'go to [url]', 'click on', 'fill out the form', 'take a screenshot', 'scrape', 'automate', 'test the website', 'log into', or any browser interaction request.",
  template: `# Dev Browser Skill

Browser automation that maintains page state across script executions. Write small, focused scripts to accomplish tasks incrementally. Once you've proven out part of a workflow and there is repeated work to be done, you can write a script to do the repeated work in a single execution.

## Choosing Your Approach

- **Local/source-available sites**: Read the source code first to write selectors directly
- **Unknown page layouts**: Use \`getAISnapshot()\` to discover elements and \`selectSnapshotRef()\` to interact with them
- **Visual feedback**: Take screenshots to see what the user sees

## Setup

**IMPORTANT**: Before using this skill, ensure the server is running. See [references/installation.md](references/installation.md) for platform-specific setup instructions (macOS, Linux, Windows).

Two modes available. Ask the user if unclear which to use.

### Standalone Mode (Default)

Launches a new Chromium browser for fresh automation sessions.

**macOS/Linux:** run it as one block. The first part lets a browser left on the CDP port from an earlier run quit cleanly before \`server.sh\` would force-kill it.
\`\`\`bash
${releaseStaleCdpPortScript()}
./skills/dev-browser/server.sh &
\`\`\`

**Windows (PowerShell):**
\`\`\`powershell
Start-Process -NoNewWindow -FilePath "node" -ArgumentList "skills/dev-browser/server.js"
\`\`\`

Add \`--headless\` flag if user requests it. **Wait for the \`Ready\` message before running scripts.**

### Extension Mode

Connects to user's existing Chrome browser. Use this when:

- The user is already logged into sites and wants you to do things behind an authed experience that isn't local dev.
- The user asks you to use the extension

**Important**: The core flow is still the same. You create named pages inside of their browser.

**Start the relay server:**

**macOS/Linux:**
\`\`\`bash
cd skills/dev-browser && npm i && npm run start-extension &
\`\`\`

**Windows (PowerShell):**
\`\`\`powershell
cd skills/dev-browser; npm i; Start-Process -NoNewWindow -FilePath "npm" -ArgumentList "run", "start-extension"
\`\`\`

Wait for \`Waiting for extension to connect...\` followed by \`Extension connected\` in the console.

If the extension hasn't connected yet, tell the user to launch and activate it. Download link: https://github.com/SawyerHood/dev-browser/releases

## Writing Scripts

> **Run all scripts from \`skills/dev-browser/\` directory.** The \`@/\` import alias requires this directory's config.

Execute scripts inline using heredocs:

**macOS/Linux:**
\`\`\`bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("example", { viewport: { width: 1920, height: 1080 } });

await page.goto("https://example.com");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
EOF
\`\`\`

**Windows (PowerShell):**
\`\`\`powershell
cd skills/dev-browser
@"
import { connect, waitForPageLoad } from "@/client.js";

const client = await connect();
const page = await client.page("example", { viewport: { width: 1920, height: 1080 } });

await page.goto("https://example.com");
await waitForPageLoad(page);

console.log({ title: await page.title(), url: page.url() });
await client.disconnect();
"@ | npx tsx --input-type=module
\`\`\`

### Key Principles

1. **Small scripts**: Each script does ONE thing (navigate, click, fill, check)
2. **Evaluate state**: Log/return state at the end to decide next steps
3. **Descriptive page names**: Use \`"checkout"\`, \`"login"\`, not \`"main"\`
4. **Disconnect to exit**: \`await client.disconnect()\` - pages persist on server
5. **Plain JS in evaluate**: \`page.evaluate()\` runs in browser - no TypeScript syntax

## Workflow Loop

1. **Write a script** to perform one action
2. **Run it** and observe the output
3. **Evaluate** - did it work? What's the current state?
4. **Decide** - is the task complete or do we need another script?
5. **Repeat** until task is done

### No TypeScript in Browser Context

Code passed to \`page.evaluate()\` runs in the browser, which doesn't understand TypeScript:

\`\`\`typescript
// Correct: plain JavaScript
const text = await page.evaluate(() => {
  return document.body.innerText;
});

// Wrong: TypeScript syntax will fail at runtime
const text = await page.evaluate(() => {
  const el: HTMLElement = document.body; // Type annotation breaks in browser!
  return el.innerText;
});
\`\`\`

## Scraping Data

For scraping large datasets, intercept and replay network requests rather than scrolling the DOM. See [references/scraping.md](references/scraping.md) for the complete guide.

## Client API

\`\`\`typescript
const client = await connect();

// Get or create named page
const page = await client.page("name");
const pageWithSize = await client.page("name", { viewport: { width: 1920, height: 1080 } });

const pages = await client.list(); // List all page names
await client.close("name"); // Close a page
await client.disconnect(); // Disconnect (pages persist)

// ARIA Snapshot methods
const snapshot = await client.getAISnapshot("name"); // Get accessibility tree
const element = await client.selectSnapshotRef("name", "e5"); // Get element by ref
\`\`\`

## Waiting

\`\`\`typescript
import { waitForPageLoad } from "@/client.js";

await waitForPageLoad(page); // After navigation
await page.waitForSelector(".results"); // For specific elements
await page.waitForURL("**/success"); // For specific URL
\`\`\`

## Screenshots

\`\`\`typescript
await page.screenshot({ path: "tmp/screenshot.png" });
await page.screenshot({ path: "tmp/full.png", fullPage: true });
\`\`\`

## ARIA Snapshot (Element Discovery)

Use \`getAISnapshot()\` to discover page elements. Returns YAML-formatted accessibility tree:

\`\`\`yaml
- banner:
  - link "Hacker News" [ref=e1]
  - navigation:
    - link "new" [ref=e2]
- main:
  - list:
    - listitem:
      - link "Article Title" [ref=e8]
\`\`\`

**Interacting with refs:**

\`\`\`typescript
const snapshot = await client.getAISnapshot("hackernews");
console.log(snapshot); // Find the ref you need

const element = await client.selectSnapshotRef("hackernews", "e2");
await element.click();
\`\`\`

## Error Recovery

Page state persists after failures. Debug with:

\`\`\`bash
cd skills/dev-browser && npx tsx <<'EOF'
import { connect } from "@/client.js";

const client = await connect();
const page = await client.page("hackernews");

await page.screenshot({ path: "tmp/debug.png" });
console.log({
  url: page.url(),
  title: await page.title(),
  bodyText: await page.textContent("body").then((t) => t?.slice(0, 200)),
});

await client.disconnect();
EOF
\`\`\``,
  resolvedPath: join(CURRENT_DIR, "..", "dev-browser"),
}

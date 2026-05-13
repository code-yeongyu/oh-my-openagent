---
name: publish
description: "Publish oh-my-opencode to npm via GitHub Actions workflow. Argument: <patch|minor|major>. Triggers: publish, release, deploy, npm publish."
---

You are the release manager for oh-my-opencode. Execute the FULL publish workflow from start to finish.

## CRITICAL: ARGUMENT REQUIREMENT

**You MUST receive a version bump type from the user.** Valid options:
- `patch`: Bug fixes, backward-compatible (1.1.7 → 1.1.8)
- `minor`: New features, backward-compatible (1.1.7 → 1.2.0)
- `major`: Breaking changes (1.1.7 → 2.0.0)

**If the user did not provide a bump type argument, STOP IMMEDIATELY and ask:**
> "To proceed with deployment, please specify a version bump type: `patch`, `minor`, or `major`"

**DO NOT PROCEED without explicit user confirmation of bump type.**

---

## STEP 0: REGISTER TODO LIST (MANDATORY FIRST ACTION)

**Before doing ANYTHING else**, create a detailed todo list using TodoWrite:

```
[
  { "id": "confirm-bump", "content": "Confirm version bump type with user (patch/minor/major)", "status": "in_progress", "priority": "high" },
  { "id": "check-uncommitted", "content": "Check for uncommitted changes and commit if needed", "status": "pending", "priority": "high" },
  { "id": "sync-remote", "content": "Sync with remote (pull --rebase && push if unpushed commits)", "status": "pending", "priority": "high" },
  { "id": "run-workflow", "content": "Trigger GitHub Actions publish workflow", "status": "pending", "priority": "high" },
  { "id": "wait-workflow", "content": "Wait for workflow completion (poll every 30s)", "status": "pending", "priority": "high" },
  { "id": "verify-and-preview", "content": "Verify release created + preview auto-generated changelog & contributor thanks", "status": "pending", "priority": "high" },
  { "id": "draft-summary", "content": "Draft enhanced release summary (mandatory for all release types)", "status": "pending", "priority": "high" },
  { "id": "apply-summary", "content": "Prepend enhanced summary to release", "status": "pending", "priority": "high" },
  { "id": "verify-npm", "content": "Verify npm package published successfully", "status": "pending", "priority": "high" },
  { "id": "wait-platform-workflow", "content": "Wait for publish-platform workflow completion", "status": "pending", "priority": "high" },
  { "id": "verify-platform-binaries", "content": "Verify all 7 platform binary packages published", "status": "pending", "priority": "high" },
  { "id": "discord-announce", "content": "Post release announcement to Discord channel", "status": "pending", "priority": "high" },
  { "id": "final-confirmation", "content": "Final confirmation to user with links", "status": "pending", "priority": "low" }
]
```

**Mark each todo as `in_progress` when starting, `completed` when done. ONE AT A TIME.**

---

## STEP 1: CONFIRM BUMP TYPE

If bump type provided as argument, confirm with user:
> "Version bump type: `{bump}`. Proceed? (y/n)"

Wait for user confirmation before proceeding.

---

## STEP 2: CHECK UNCOMMITTED CHANGES

Run: `git status --porcelain`

- If there are uncommitted changes, warn user and ask if they want to commit first
- If clean, proceed

---

## STEP 2.5: SYNC WITH REMOTE (MANDATORY)

Check if there are unpushed commits:
```bash
git log origin/master..HEAD --oneline
```

**If there are unpushed commits, you MUST sync before triggering workflow:**
```bash
git pull --rebase && git push
```

This ensures the GitHub Actions workflow runs on the latest code including all local commits.

---

## STEP 3: TRIGGER GITHUB ACTIONS WORKFLOW

Run the publish workflow:
```bash
gh workflow run publish -f bump={bump_type}
```

Wait 3 seconds, then get the run ID:
```bash
gh run list --workflow=publish --limit=1 --json databaseId,status --jq '.[0]'
```

---

## STEP 4: WAIT FOR WORKFLOW COMPLETION

Poll workflow status every 30 seconds until completion:
```bash
gh run view {run_id} --json status,conclusion --jq '{status: .status, conclusion: .conclusion}'
```

Status flow: `queued` → `in_progress` → `completed`

**IMPORTANT: Use polling loop, NOT sleep commands.**

If conclusion is `failure`, show error and stop:
```bash
gh run view {run_id} --log-failed
```

---

## STEP 5: VERIFY RELEASE & PREVIEW AUTO-GENERATED CONTENT

Two goals: confirm the release exists, then show the user what the workflow already generated.

```bash
# Pull latest (workflow committed version bump)
git pull --rebase
NEW_VERSION=$(node -p "require('./package.json').version")

# Verify release exists on GitHub
gh release view "v${NEW_VERSION}" --json tagName,url --jq '{tag: .tagName, url: .url}'
```

**After verifying, generate a local preview of the auto-generated content:**

```bash
bun run script/generate-changelog.ts
```

<agent-instruction>
After running the preview, present the output to the user and say:

> **The following content is ALREADY included in the release automatically:**
> - Commit changelog (grouped by feat/fix/refactor)
> - Contributor thank-you messages (for non-team contributors)
>
> You do NOT need to write any of this. It's handled.
>
> **For all release types**, an enhanced summary is **required** — I'll draft one in the next step.

Wait for the user to acknowledge before proceeding.
</agent-instruction>

---

## STEP 6: DRAFT ENHANCED RELEASE SUMMARY

<decision-gate>

| Release Type | Action |
|-------------|--------|
| **patch** | MANDATORY. Draft a concise bug-fix / change summary. Do NOT proceed without one. |
| **minor** | MANDATORY. Draft a concise feature summary. Do NOT proceed without one. |
| **major** | MANDATORY. Draft a full release narrative with migration notes if applicable. Do NOT proceed without one. |

</decision-gate>

### What You're Writing (and What You're NOT)

You are writing the **headline layer** — a product announcement that sits ABOVE the auto-generated commit log. Think "release blog post", not "git log".

<rules>
- NEVER duplicate commit messages. The auto-generated section already lists every commit.
- NEVER write generic filler like "Various bug fixes and improvements" or "Several enhancements".
- ALWAYS focus on USER IMPACT: what can users DO now that they couldn't before?
- ALWAYS group by THEME or CAPABILITY, not by commit type (feat/fix/refactor).
- ALWAYS use concrete language: "You can now do X" not "Added X feature".
</rules>

<examples>
<bad title="Commit regurgitation — DO NOT do this">
## What's New
- feat(auth): add JWT refresh token rotation
- fix(auth): handle expired token edge case
- refactor(auth): extract middleware
</bad>

<good title="User-impact narrative — DO this">
## 🔐 Smarter Authentication

Token refresh is now automatic and seamless. Sessions no longer expire mid-task — the system silently rotates credentials in the background. If you've been frustrated by random logouts, this release fixes that.
</good>

<bad title="Vague filler — DO NOT do this">
## Improvements
- Various performance improvements
- Bug fixes and stability enhancements
</bad>

<good title="Specific and measurable — DO this">
## ⚡ 3x Faster Rule Parsing

Rules are now cached by file modification time. If your project has 50+ rule files, you'll notice startup is noticeably faster — we measured a 3x improvement in our test suite.
</good>
</examples>

### Drafting Process

1. **Analyze** the commit list from Step 5's preview. Identify 2-5 themes that matter to users.
2. **Write** the summary to `/tmp/release-summary-v${NEW_VERSION}.md`.
3. **Present** the draft to the user for review and approval before applying.

```bash
# Write your draft here
cat > /tmp/release-summary-v${NEW_VERSION}.md << 'SUMMARY_EOF'
{your_enhanced_summary}
SUMMARY_EOF

cat /tmp/release-summary-v${NEW_VERSION}.md
```

<agent-instruction>
After drafting, ask the user:
> "Here's the release summary I drafted. This will appear AT THE TOP of the release notes, above the auto-generated commit changelog and contributor thanks. Want me to adjust anything before applying?"

Do NOT proceed to Step 7 without user confirmation.
</agent-instruction>

---

## STEP 7: APPLY ENHANCED SUMMARY TO RELEASE

This step is MANDATORY. The enhanced summary from Step 6 must always be applied.

<architecture>
The final release note structure:

```
┌─────────────────────────────────────┐
│  Enhanced Summary (from Step 6)     │  ← You wrote this
│  - Theme-based, user-impact focused │
├─────────────────────────────────────┤
│  ---  (separator)                   │
├─────────────────────────────────────┤
│  Auto-generated Commit Changelog    │  ← Workflow wrote this
│  - feat/fix/refactor grouped        │
│  - Contributor thank-you messages   │
└─────────────────────────────────────┘
```
</architecture>

<zero-content-loss-policy>
- Fetch the existing release body FIRST
- PREPEND your summary above it
- The existing auto-generated content must remain 100% INTACT
- NOT A SINGLE CHARACTER of existing content may be removed or modified
</zero-content-loss-policy>

```bash
# 1. Fetch existing auto-generated body
EXISTING_BODY=$(gh release view "v${NEW_VERSION}" --json body --jq '.body')

# 2. Combine: enhanced summary on top, auto-generated below
{
  cat /tmp/release-summary-v${NEW_VERSION}.md
  echo ""
  echo "---"
  echo ""
  echo "$EXISTING_BODY"
} > /tmp/final-release-v${NEW_VERSION}.md

# 3. Update the release (additive only)
gh release edit "v${NEW_VERSION}" --notes-file /tmp/final-release-v${NEW_VERSION}.md

# 4. Confirm
echo "✅ Release v${NEW_VERSION} updated with enhanced summary."
gh release view "v${NEW_VERSION}" --json url --jq '.url'
```

---

## STEP 7.5: POST RELEASE NOTES TO DISCORD

After the release notes are finalized, post them to the Discord channel.

<agent-discord-instruction>
1. Ensure Discord auth is available:
```bash
agent-discord auth extract
```

2. **Read recent messages** in the channel to match the existing announcement style:
```bash
agent-discord message list 1454708427392680067 --limit 5
```

3. Post the release announcement to channel `1454708427392680067` matching the style of previous announcements. The message should follow this structure:
```
@here

🎉 **oh-my-opencode v{VERSION} — {Short Tagline}**

**Feature 1** — one-line description.

**Feature 2** — one-line description.

**Feature 3** — one-line description.

Plus {summary of remaining changes}.

📦 Install / upgrade:
`bun i -g oh-my-opencode@{VERSION}`  (or `npm`)

📝 Full release notes: {RELEASE_URL}
```

```bash
RELEASE_URL=$(gh release view "v${NEW_VERSION}" --json url --jq '.url')
agent-discord message send 1454708427392680067 "{your message following the style above}"
```

If the message fails to send, warn the user and continue — do NOT block the publish workflow on Discord errors.
</agent-discord-instruction>

---

## STEP 8: VERIFY NPM PUBLICATION

Poll npm registry until the new version appears:
```bash
npm view oh-my-opencode version
```

Compare with expected version. If not matching after 2 minutes, warn user about npm propagation delay.

---

## STEP 8.5: WAIT FOR PLATFORM WORKFLOW COMPLETION

The main publish workflow triggers a separate `publish-platform` workflow for platform-specific binaries.

1. Find the publish-platform workflow run triggered by the main workflow:
```bash
gh run list --workflow=publish-platform --limit=1 --json databaseId,status,conclusion --jq '.[0]'
```

2. Poll workflow status every 30 seconds until completion:
```bash
gh run view {platform_run_id} --json status,conclusion --jq '{status: .status, conclusion: .conclusion}'
```

**IMPORTANT: Use polling loop, NOT sleep commands.**

If conclusion is `failure`, show error logs:
```bash
gh run view {platform_run_id} --log-failed
```

---

## STEP 8.6: VERIFY PLATFORM BINARY PACKAGES

After publish-platform workflow completes, verify all 7 platform packages are published:

```bash
PLATFORMS="darwin-arm64 darwin-x64 linux-x64 linux-arm64 linux-x64-musl linux-arm64-musl windows-x64"
for PLATFORM in $PLATFORMS; do
  npm view "oh-my-opencode-${PLATFORM}" version
done
```

All 7 packages should show the same version as the main package (`${NEW_VERSION}`).

**Expected packages:**
| Package | Description |
|---------|-------------|
| `oh-my-opencode-darwin-arm64` | macOS Apple Silicon |
| `oh-my-opencode-darwin-x64` | macOS Intel |
| `oh-my-opencode-linux-x64` | Linux x64 (glibc) |
| `oh-my-opencode-linux-arm64` | Linux ARM64 (glibc) |
| `oh-my-opencode-linux-x64-musl` | Linux x64 (musl/Alpine) |
| `oh-my-opencode-linux-arm64-musl` | Linux ARM64 (musl/Alpine) |
| `oh-my-opencode-windows-x64` | Windows x64 |

If any platform package version doesn't match, warn the user and suggest checking the publish-platform workflow logs.

---

## STEP 9: FINAL CONFIRMATION

Report success to user with:
- New version number
- GitHub release URL: https://github.com/code-yeongyu/oh-my-opencode/releases/tag/v{version}
- npm package URL: https://www.npmjs.com/package/oh-my-opencode
- Platform packages status: List all 7 platform packages with their versions

---

## ERROR HANDLING

- **Workflow fails**: Show failed logs, suggest checking Actions tab
- **Release not found**: Wait and retry, may be propagation delay
- **npm not updated**: npm can take 1-5 minutes to propagate, inform user
- **Permission denied**: User may need to re-authenticate with `gh auth login`
- **Platform workflow fails**: Show logs from publish-platform workflow, check which platform failed
- **Platform package missing**: Some platforms may fail due to cross-compilation issues, suggest re-running publish-platform workflow manually

## LANGUAGE

Respond to user in English.


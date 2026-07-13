---
name: publish
description: "Publish oh-my-opencode to npm by triggering the GitHub Actions publish workflow and verifying its artifacts. Ship-only: never runs pre-publish-review or re-reviews merged code unless the user explicitly asks. Argument: <patch|minor|major>. Triggers: publish, release, deploy, npm publish."
---

You are the release manager for oh-my-opencode. Execute the FULL publish workflow from start to finish.

## CRITICAL: PUBLISH IS SHIP-ONLY — GO STRAIGHT TO THE WORKFLOW

`origin/dev` is already gated: every PR and push ran CI (test/typecheck/codex-compatibility on 3 OSes), and the publish workflow re-runs those same gates before anything is published.

- **NEVER run `/pre-publish-review`, `/review-work`, or any code re-review as part of a publish request.** Those run ONLY when the user explicitly asks for a review.
- **NEVER "fix" code, open PRs, or enter fix-and-re-audit loops during a publish.** If the workflow fails or something looks broken, report it and STOP — a publish is the wrong place to repair the tree.
- A publish request with a bump type goes from Step 0 to Step 3 (trigger) in minutes. The only human-scale work is release notes, drafted while CI runs.

## CRITICAL: FULL WORKFLOW MEANS THREE RELEASE SURFACES

Publishing is complete only after all release surfaces are verified:

| Release layer | Surface | Required proof |
|---|---|---|
| `omo pure components` | Core/MCP/shared-skill changes inside the published package payload | Release notes call out layer-specific version impact (from the workflow changelog, or `/get-unpublished-changes` when the user requested it). |
| `omo opencode` | `oh-my-opencode` and `oh-my-openagent` npm packages plus platform packages | npm versions and GitHub release exist for the selected bump. |
| `omo codex` | `lazycodex-ai`, Codex plugin metadata, and `code-yeongyu/lazycodex` marketplace release | Codex plugin metadata is stamped with the release version, `lazycodex-ai` publishes, and the LazyCodex repo release is created when the marketplace payload changed. |

The publish workflow must not be reported complete while any of `oh-my-opencode`, `oh-my-openagent`, `lazycodex-ai`, or `code-yeongyu/lazycodex` verification is unresolved.

## CRITICAL: FULL WORKFLOW MEANS DISCORD TOO

Publishing is not complete until the Discord release announcement has been attempted.

- **DO NOT stop after creating the GitHub release.**
- **DO NOT stop after drafting or applying release notes.**
- **DO NOT wait for a second user acknowledgement if the user already confirmed the publish.**
- After the release notes are finalized, immediately run Step 7.5 and post to Discord.
- If Discord posting fails after authentication/retry, report the failure clearly and continue the remaining verification steps. A skipped Discord step is a workflow failure.

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
  { "id": "discord-announce", "content": "MANDATORY: post release announcement to Discord channel immediately after release notes are finalized", "status": "pending", "priority": "high" },
  { "id": "verify-npm", "content": "Verify npm package published successfully", "status": "pending", "priority": "high" },
  { "id": "verify-lazycodex", "content": "Verify lazycodex-ai publish, Codex plugin metadata version stamp, and code-yeongyu/lazycodex release/sync", "status": "pending", "priority": "high" },
  { "id": "verify-platform-binaries", "content": "Spot-check platform binary packages on npm", "status": "pending", "priority": "high" },
  { "id": "final-confirmation", "content": "Final confirmation to user with links", "status": "pending", "priority": "low" }
]
```

**Mark each todo as `in_progress` when starting, `completed` when done. ONE AT A TIME.**

---

## STEP 1: CONFIRM BUMP TYPE

If the user already named a bump type (argument or message), that IS the confirmation — state it and continue immediately. Only ask and wait when no bump type was given.

---

## STEP 2: CHECK UNCOMMITTED CHANGES

Run: `git status --porcelain`

- If there are uncommitted changes, warn user and ask if they want to commit first
- If clean, proceed

---

## STEP 2.5: SYNC WITH REMOTE (MANDATORY)

Check if there are unpushed commits:
```bash
git log @{u}..HEAD --oneline
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

The publish run is a single workflow with sequential stages. Expected timeline (from recent real runs, ~30 min total):

| Stage (job) | What it does | Typical |
|---|---|---|
| `test` / `typecheck` / `codex-compatibility` (3 OS) | Re-runs the CI gates on the release source | 4–8 min (Windows is the long pole) |
| `prepare-release-state` | Stamps versions, opens + auto-merges the `release: vX.Y.Z` PR, waits for that PR's required CI checks | 10–15 min (dominant stage) |
| `publish-platform` (build + publish, 12 targets) | Builds and publishes both platform package families | 3–4 min |
| `publish-main` → `release` | Publishes `oh-my-opencode` / `oh-my-openagent` / `lazycodex-ai`, creates the GitHub release, syncs `code-yeongyu/lazycodex` | 4–6 min |

Poll job-level status every 30 seconds and report stage transitions to the user:
```bash
gh run view {run_id} --json status,conclusion,jobs --jq '{status, conclusion, stage: ([.jobs[] | select(.status=="in_progress") | .name] | join(", "))}'
```

**IMPORTANT: Use polling loop, NOT sleep commands.** Use the waiting time to draft the enhanced release summary (Step 6) — do not sit idle, and do not start any review activity.

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

If the user already confirmed the publish workflow and did not explicitly ask to review the generated changelog before release-note editing, treat the publish confirmation as sufficient acknowledgement and continue. Do not end the assistant turn here.
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

If the user already confirmed the publish workflow and did not explicitly request a release-note review hold, proceed to Step 7 after presenting the draft. Do not stop before Step 7.5, because the Discord announcement is mandatory.
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

After the release notes are finalized, post them to the Discord channel. This step is mandatory for every publish run.

<hard-gate>
The workflow is not complete until this step has either:
1. Sent a Discord message successfully and recorded the message ID, or
2. Failed after `agent-discordbot auth status` plus one send retry, with the Jobdori bot-token failure reported to the user.

Never skip this step because the release summary was awaiting approval. If the user already confirmed the publish, continue through Discord before stopping.
</hard-gate>

<agent-discord-instruction>
1. Use the Jobdori bot token through `agent-discordbot` for release announcements. This is the required release path; do not use the personal `agent-discord` token unless the bot path is unavailable and the user explicitly approves the fallback. Pin the bot id so release messages go out as the Jobdori bot even if the local `agent-discordbot` current bot changes.
```bash
JOBDORI_BOT_ID=1486173823354146917
agent-discordbot auth status --bot "$JOBDORI_BOT_ID"
```

2. **Read recent messages** in the channel to match the existing announcement style:
```bash
JOBDORI_BOT_ID=1486173823354146917
agent-discordbot message list 1454708427392680067 --bot "$JOBDORI_BOT_ID" --limit 5
```

3. If `agent-discordbot` is unavailable or unauthorized, stop and report that the Jobdori token path failed. Only then may a human decide whether to use `agent-discord`.

4. Post the release announcement to channel `1454708427392680067` matching the style of previous announcements. The message should follow this structure:
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
JOBDORI_BOT_ID=1486173823354146917
RELEASE_URL=$(gh release view "v${NEW_VERSION}" --json url --jq '.url')
agent-discordbot message send 1454708427392680067 "{your message following the style above}" --bot "$JOBDORI_BOT_ID"
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

## STEP 8.5: SPOT-CHECK PLATFORM BINARY PACKAGES

Platform packages are built and published by the `publish-platform` jobs INSIDE the same publish run — there is no separate workflow to wait for, and `publish-main` already refuses to publish unless matching platform binaries exist. Spot-check a representative sample:

```bash
for PKG in oh-my-opencode-darwin-arm64 oh-my-openagent-linux-x64 oh-my-opencode-windows-x64; do
  npm view "$PKG" version
done
```

Each should show `${NEW_VERSION}`. On mismatch, warn the user and point at the `publish-platform` jobs in the run — do not re-run anything yourself.

---

## STEP 9: FINAL CONFIRMATION

Report success to user with:
- New version number
- GitHub release URL: https://github.com/code-yeongyu/oh-my-opencode/releases/tag/v{version}
- npm package URL: https://www.npmjs.com/package/oh-my-opencode
- Platform packages status: spot-checked platform package versions

---

## ERROR HANDLING

- **Workflow fails**: Show failed logs, suggest checking Actions tab
- **Release not found**: Wait and retry, may be propagation delay
- **npm not updated**: npm can take 1-5 minutes to propagate, inform user
- **Permission denied**: User may need to re-authenticate with `gh auth login`
- **Platform jobs fail**: Show logs from the `publish-platform` jobs in the same run, name the failing target, and stop — `publish-main` is blocked by design until they pass

## LANGUAGE

Respond to user in English.

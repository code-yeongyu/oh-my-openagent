---
description: Publish oh-my-opencode to npm via GitHub Actions workflow
argument-hint: <patch|minor|major>
---

<command-instruction>
You are the release manager for oh-my-opencode. Execute the FULL publish workflow from start to finish.

## CRITICAL: ARGUMENT REQUIREMENT

**You MUST receive a version bump type from the user.** Valid options:
- `patch`: Bug fixes, backward-compatible (1.1.7 → 1.1.8)
- `minor`: New features, backward-compatible (1.1.7 → 1.2.0)
- `major`: Breaking changes (1.1.7 → 2.0.0)

**If the user did not provide a bump type argument, STOP IMMEDIATELY and ask:**
> "배포를 진행하려면 버전 범프 타입을 지정해주세요: `patch`, `minor`, 또는 `major`"

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
  { "id": "verify-release", "content": "Verify GitHub release was created", "status": "pending", "priority": "high" },
  { "id": "draft-release-notes", "content": "Draft enhanced release notes content", "status": "pending", "priority": "high" },
  { "id": "update-release-notes", "content": "Update GitHub release with enhanced notes", "status": "pending", "priority": "high" },
  { "id": "verify-npm", "content": "Verify npm package published successfully", "status": "pending", "priority": "high" },
  { "id": "wait-platform-workflow", "content": "Wait for publish-platform workflow completion", "status": "pending", "priority": "high" },
  { "id": "verify-platform-binaries", "content": "Verify all 7 platform binary packages published", "status": "pending", "priority": "high" },
  { "id": "final-confirmation", "content": "Final confirmation to user with links", "status": "pending", "priority": "low" }
]
```

**Mark each todo as `in_progress` when starting, `completed` when done. ONE AT A TIME.**

---

## STEP 1: CONFIRM BUMP TYPE

If bump type provided as argument, confirm with user:
> "버전 범프 타입: `{bump}`. 진행할까요? (y/n)"

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

## STEP 5: VERIFY GITHUB RELEASE

Get the new version and verify release exists:
```bash
# Get new version from package.json (workflow updates it)
git pull --rebase
NEW_VERSION=$(node -p "require('./package.json').version")
gh release view "v${NEW_VERSION}"
```

---

## STEP 6: DRAFT ENHANCED RELEASE NOTES

Analyze commits since the previous version and draft release notes following project conventions:

### For PATCH releases:
Keep simple format - just list commits:
```markdown
- {hash} {conventional commit message}
- ...
```

### For MINOR releases:
Use feature-focused format:
```markdown
## New Features

### Feature Name
- Description of what it does
- Why it matters

## Bug Fixes
- fix(scope): description

## Improvements
- refactor(scope): description
```

### For MAJOR releases:
Full changelog format:
```markdown
# v{version}

Brief description of the release.

## What's New Since v{previous}

### Breaking Changes
- Description of breaking change

### Features
- **Feature Name**: Description

### Bug Fixes
- Description

### Documentation
- Description

## Migration Guide (if applicable)
...
```

**CRITICAL: The enhanced notes must ADD to existing workflow-generated notes, not replace them.**

---

## STEP 7: UPDATE GITHUB RELEASE

**ZERO CONTENT LOSS POLICY:**
- First, fetch the existing release body with `gh release view`
- Your enhanced notes must be PREPENDED to the existing content
- **NOT A SINGLE CHARACTER of existing content may be removed or modified**
- The final release body = `{your_enhanced_notes}\n\n---\n\n{existing_body_exactly_as_is}`

```bash
# Get existing body
EXISTING_BODY=$(gh release view "v${NEW_VERSION}" --json body --jq '.body')

# Write enhanced notes to temp file (prepend to existing)
cat > /tmp/release-notes-v${NEW_VERSION}.md << 'EOF'
{your_enhanced_notes}

---

EOF

# Append existing body EXACTLY as-is (zero modifications)
echo "$EXISTING_BODY" >> /tmp/release-notes-v${NEW_VERSION}.md

# Update release
gh release edit "v${NEW_VERSION}" --notes-file /tmp/release-notes-v${NEW_VERSION}.md
```

**CRITICAL: This is ADDITIVE ONLY. You are adding your notes on top. The existing content remains 100% intact.**

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

Respond to user in Korean (한국어).

</command-instruction>

<current-context>
<published-version>
!`npm view oh-my-opencode version 2>/dev/null || echo "not published"`
</published-version>
<local-version>
!`node -p "require('./package.json').version" 2>/dev/null || echo "unknown"`
</local-version>
<git-status>
!`git status --porcelain`
</git-status>
<recent-commits>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git log "v{}"..HEAD --oneline 2>/dev/null | head -15 || echo "no commits"`
</recent-commits>
</current-context>

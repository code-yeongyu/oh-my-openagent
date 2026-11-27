---
name: github
description: "MUST USE for ANY GitHub work - instead of the gh CLI, gh api, curl to api.github.com, or a browser. Pull requests (view, create, edit, review, comment, merge, checks, diff, files), waiting for CI, issues, Actions runs and failed-job logs, workflow dispatch, releases, search, raw REST/GraphQL, and repository setup (create a repo, description, topics, README, labels, secrets, rulesets and branch protection, workflow files), through a typed Bun SDK for eval cells plus a CLI and MCP. Local commits, rebases and history belong to the `git` skill. Triggers: GitHub, PR, pull request, issue, CI, checks, Actions, workflow run, release, gh, gh pr, gh api, gh run watch, gh repo create, gh secret set, 'is CI green', 'wait for CI', 'open a PR', 'merge the PR', 'why did the workflow fail', 'comment on the issue', 'make a new repo', 'protect the branch', 'set the topics'."
---

# GitHub

Typed GitHub operations that replace `gh` subprocesses: trimmed JSON, pagination followed, failures carry a `kind`.

Replace `<skill-root>` with this skill's own directory.

```js
const { client, surface } = await import("<skill-root>/scripts/sdk.ts")
const pr = await client.pr.view({ repo: "owner/name", number: 123 })
```

## Rules

1. **PASS `repo: "owner/name"` IN EVERY EVAL-CELL CALL.** When omitted it falls back to the git origin of the process cwd, and an eval kernel's cwd is rarely the repo you mean.
2. **NEVER READ `scripts/src` TO LEARN AN OPERATION.** Its inputs are one expression away: `surface.ops.issue.list.input.json` (JSON Schema) and `.description`. Results are plain JSON, and most lists come wrapped (`{ repo, items }`, `{ repo, runs }`), so print one before indexing it.
3. **NEVER MERGE WITHOUT `matchHeadSha`.** Read `pr.view` (`mergeState`, `reviewDecision`, `headSha`) and `pr.checks`, then call `pr.merge({ matchHeadSha })`. A head that moved after you verified it then refuses with kind `conflict` instead of landing commits nobody checked.
4. **NEVER POLL CHECKS OR SLEEP FOR CI.** Use `await client.pr.wait(...)` or `run.wait(...)` for waits under about 4 minutes. A longer wait runs as a `tool.monitor` command: **READ [references/waiting.md](references/waiting.md) BEFORE ARMING ONE.**
5. **A WRITE THAT FAILS WITH `server` OR `network` MAY HAVE LANDED.** Writes are never retried for you. Read the target back (`issue.view({ comments: 3 })`, `pr.view`) before sending it again, or you post it twice.
6. **BEFORE CREATING OR CONFIGURING A REPO, READ THE REFERENCE FOR THAT STEP.** Creating one, description, topics, README, merge options, labels, secrets: [references/repo-setup.md](references/repo-setup.md). Rulesets and branch protection: [references/branch-rules.md](references/branch-rules.md). Workflow files and action pins: [references/workflows.md](references/workflows.md).
7. **CHANGE REPO SETTINGS ONLY WHERE THE TASK OWNS THE REPO.** Visibility, rulesets, secrets, Actions and merge options on a shared repo are the owner's call: read and report, write on their word.
8. **PR BODY SCREENSHOTS GO THROUGH GITHUB USER ATTACHMENTS ONLY.** Never commit temporary images, never use Releases or an external host: [references/evidence-attachments.md](references/evidence-attachments.md).

## Pull requests, issues, runs

| gh habit | Operation | What to know |
|---|---|---|
| `gh pr view` | `pr.view` | `state`, `draft`, `merged`, `mergeable`, `mergeState`, `reviewDecision`, `headSha`, `checks` (rollup), `closes`; `comments: N` adds the latest N; `body: false` trims |
| `gh pr checks` | `pr.checks` | each check has `bucket` (pass, fail, pending, skipping, cancel), `required`, `runId`; plus `counts`; `only: ["fail"]` filters |
| `gh pr checks --watch` | `pr.wait` | returns `verdict` pass, fail, timeout, no_checks or head_moved |
| `gh pr list`, `gh pr status` | `pr.list`, `pr.status` | `state: "merged"`, `author`, `label` and `search` go through search; those items have no head/base |
| `gh pr diff` | `pr.files`, `pr.diff` | read `files` first; `diff` is capped by `maxBytes` |
| `gh pr create / edit / comment / ready / close / reopen` | `pr.create` `pr.edit` `pr.comment` `pr.ready` `pr.close` | `comment.editId` replaces a comment; `ready.undo` turns it back into a draft; reopen is `edit({ state: "open" })` |
| `gh pr review / update-branch / revert / lock / unlock` | `pr.review` `pr.updateBranch` `pr.revert` `pr.lock` `pr.unlock` | `review.comments` puts comments on lines of the diff; `updateBranch.expectedHeadSha` refuses a moved head with kind `conflict` |
| review feedback (gh has no command) | `pr.reviews` `pr.replyToThread` `pr.resolveThread` `pr.dismissReview` | `reviews` returns review bodies and line threads with `resolved` and `outdated`; `unresolvedOnly: true` is the list still to handle; reply first, then resolve |
| `gh pr checkout` | `pr.checkout` | runs git in the `dir` you pass |
| `gh pr merge` | `pr.merge` | rule 3; default `method: "merge"`; `auto: true` enables auto-merge |
| `gh issue view / list / status / create / edit / comment / close / reopen` | `issue.view` `issue.list` `issue.status` `issue.create` `issue.edit` `issue.comment` `issue.close` | `list` excludes PRs and sorts by update; `close` takes `reason` and a `comment`; reopen is `edit({ state: "open" })` |
| `gh issue pin / unpin / lock / unlock / transfer / develop / delete` | `issue.pin` `issue.unpin` `issue.lock` `issue.unlock` `issue.transfer` `issue.develop` `issue.delete` | `develop` lists or creates a linked branch; `delete` cannot be undone |
| `gh run list / view` | `run.list` `run.view` | filter by `workflow`, `branch`, `sha`, `status`; `view` names the failed steps |
| `gh run view --log-failed` | `run.logs` | failed jobs only; the raw tail is runner cleanup, so pass `grep: "##\\[error\\]"` to get the cause |
| `gh run watch` | `run.wait` | returns the conclusion with failed jobs and steps |
| `gh run rerun / cancel / delete / download` | `run.rerun` `run.cancel` `run.delete` `run.download` | cancel only runs you started; `download` unpacks artifacts into `dir` |
| `gh workflow run / list / view / enable / disable` | `run.dispatch` `workflow.list` `workflow.view` `workflow.enable` `workflow.disable` | |
| `gh cache list / delete` | `cache.list` `cache.delete` | |

## Repositories and everything else

| gh habit | Operation | What to know |
|---|---|---|
| `gh repo view / list` | `repo.view` `repo.list` | |
| `gh repo create / edit / rename / archive / unarchive / fork / sync` | `repo.create` `repo.edit` `repo.rename` `repo.archive` `repo.unarchive` `repo.fork` `repo.sync` | rules 6 and 7; `create` and `fork` are API-only, with no clone or push; `edit` takes `addTopics` / `removeTopics` |
| `gh repo delete` | `repo.delete` | cannot be undone; `confirm` must equal `owner/name`; needs the `delete_repo` scope |
| `gh repo read-file / read-dir`, `gh browse -n`, `gh repo clone` | `repo.readFile` `repo.readDir` `repo.url` `repo.clone` | `clone` runs git into the `dir` you pass |
| `gh repo autolink / deploy-key / gitignore / license` | `repo.autolink.*` `repo.deployKey.*` `repo.gitignore.*` `repo.license.*` | |
| `gh ruleset list / view / check` | `ruleset.list` `ruleset.view` `ruleset.check` | plus `ruleset.create` `ruleset.edit` `ruleset.delete` and `branchProtection.view` `.set` `.delete`, which gh lacks |
| `gh release list / view` | `release.list` `release.view` | no `tag` means the latest |
| `gh release create / edit / upload / download / delete / delete-asset` | `release.create` `release.edit` `release.upload` `release.download` `release.delete` `release.deleteAsset` | `files` is a list of `{ path }` for local files |
| `gh label list / create / edit / delete / clone` | `label.*` | |
| `gh secret list / set / delete` | `secret.*` | `env`, `org` or `user` scope; the value is sealed on this machine and never returned; never type it into cell code, and on the CLI it is taken only through `--input <file|->`, never as a flag |
| `gh variable list / get / set / delete` | `variable.*` | |
| `gh gist *` | `gist.list` `gist.view` `gist.create` `gist.edit` `gist.rename` `gist.delete` `gist.clone` | |
| `gh project *` | `project.*` | addressed by `owner` and `number`; needs the `project` scope |
| `gh discussion *` | `discussion.*` | |
| `gh codespace list / view / create / edit / stop / delete` | `codespace.*` | needs the `codespace` scope |
| `gh ssh-key *`, `gh gpg-key *` | `sshKey.*` `gpgKey.*` | writes need `admin:public_key` / `admin:gpg_key` |
| `gh attestation download` | `attestation.list` | fetches attestations; it does not verify them |
| `gh search issues / prs / code / repos / commits` | `search.issues` `search.code` `search.repos` `search.commits` | `search.issues` takes `type: "pr"` or `"issue"` |
| `gh status`, `gh org list`, `gh auth status` | `status` `org.list` `auth.status` | `auth.status` shows the login, the token's scopes and where the token came from, never the token |
| `gh api`, `gh api graphql`, `gh api rate_limit` | `api.rest` `api.graphql` `api.rate` | only when no typed operation fits; `api.rest` takes `paginate` and `key` for wrapped lists |

**No operation, by design:** `gh auth login/logout/refresh/switch/setup-git/token`, `alias`, `completion`, `config`, `extension`, `repo set-default`, `skill`, `copilot`, `agent-task`, the interactive `codespace ssh/cp/code/jupyter/ports/logs/rebuild`, and the Sigstore checks (`attestation verify`, `release verify`, `release verify-asset`). Those run on the gh CLI itself.

## Errors

Every failure is a `SurfaceError` with a `kind` and a `hint`. Branch on `kind`, never on message text.

- `conflict`: not mergeable, or the head moved. Re-read `pr.view`; **DO NOT RETRY**.
- `not_found`: also what a private repo answers when the token cannot see it.
- `forbidden`: the token lacks a scope (`auth.status` lists them), or the plan does not offer the feature.
- `rate_limited`: the hint gives the reset time. Waits of 60 s or less already happen for you.
- `usage`: the input failed its schema and nothing was sent.
- `git`: a local git command that an operation ran (`pr.checkout`, `repo.clone`) exited non-zero.

## Other surfaces

- Auth needs no setup: `GH_TOKEN`, then `GITHUB_TOKEN`, then the existing gh login. With one of the two variables set, nothing here needs the gh CLI installed: `repo.clone`, `pr.checkout` and `gist.clone` hand the same token to git through the child's environment, never through argv, the remote URL or `.git/config`.
- A token kept elsewhere (a vault, a secret manager): `createClient({ token: () => Promise.resolve(value) })` from `sdk.ts` uses that provider instead, with no gh and no token variable needed, and `auth.status` reports it as `injected`. The transport calls the provider on every request, so memoize it rather than reading the vault each time.
- Shell: `bun <skill-root>/scripts/cli.ts pr checks --repo o/n --number 123`, with `--help` at any level.
- MCP: `cli.ts mcp` (stdio); `--read-only` drops every writer. `--http` serves loopback only and needs `--token-env NAME`: every request must carry that bearer token.

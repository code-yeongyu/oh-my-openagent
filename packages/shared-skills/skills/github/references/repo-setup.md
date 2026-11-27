# Setting up a repository

Creating a repo, then its description, topics, README, settings, labels and secrets. Workflows are in [workflows.md](workflows.md) and branch rules in [branch-rules.md](branch-rules.md). The tables record conventions measured across a set of working repositories on 2026-11-26; read the live state before copying a value.

## Rules

1. **CHANGE SETTINGS ONLY ON A REPO THE TASK OWNS.** On a shared repo, visibility, Actions permissions, rulesets, secrets and merge options are the owner's decision. Read them and report; change them on the owner's word.
2. **READ, APPLY, READ BACK.** `repo.view` before, the write, `repo.view` after. Report the fields that changed.
3. **NEW REPOS ARE PRIVATE.** Making one public needs the owner's word: forks and caches keep what was pushed.
4. **BRANCH RULES GO LAST.** A rule names the checks the workflows report, so the workflows run once first.
5. **A SECRET VALUE NEVER APPEARS IN CELL CODE, ARGV OR OUTPUT.** Read it from the secret store in-process and hand it straight to `secret.set`.

## Order

| Step | Operation |
|---|---|
| 1. Create | `repo.create` |
| 2. First push | git: `git remote add origin https://github.com/<owner>/<name>.git`, `git push -u origin <branch>` |
| 3. Description, homepage, topics | `repo.edit` |
| 4. README and community files | committed to the repo |
| 5. Merge options and features | `repo.edit` |
| 6. Labels | `label.clone` or `label.create` |
| 7. Secrets and variables | `secret.set`, `variable.set` |
| 8. Workflows | [workflows.md](workflows.md) |
| 9. Branch rules | [branch-rules.md](branch-rules.md) |

## Create

```js
const made = await client.repo.create({
  name: "my-tool",
  owner: "acme-labs", // omit for the authenticated user
  visibility: "private",
  description: "One sentence that says what this is",
})
```

- `repo.create` only calls the API. Cloning, adding a remote and the first push are git's job.
- A repo with no commit has no default branch. The first branch pushed becomes the default.
- `addReadme: true` makes the first commit on the account's default branch name, which is `master` on some accounts. Read `defaultBranch` from the result; never assume `main`.
- A two-branch repo (integration on `dev`, releases on `master` or `main`) points the default at the integration branch once both exist: `repo.edit({ repo, defaultBranch: "dev" })`.
- From a template: `template: "owner/name"`.
- A throwaway repo says so where the next reader looks: a dated name and a description like `Throwaway probe for a CLA workflow change. Safe to delete.` Archive it when done (`repo.archive`). `repo.delete` needs the `delete_repo` scope, which the default token does not carry.

## Description, homepage, topics

```js
await client.repo.edit({
  repo,
  description: "Tidepool: one terminal for all your machines.",
  homepage: "https://tidepool.example",
  addTopics: ["terminal", "bun", "typescript"],
  removeTopics: ["old-name"],
})
```

| Kind of repo | Description shape | Homepage | Topics |
|---|---|---|---|
| A small public tool with its own site | a bare tagline: `Encrypted notes for your agents` | the site | none |
| A public library | name, colon, tagline: `corekit: process supervision for agents` | a docs page | none |
| A public product | name, colon, tagline, then one sentence of what it does: `Tidepool: one terminal for all your machines. Every machine you own, linked through ...` | the product site | 15: `ai-agents` `coding-agents` `terminal` `e2ee` `relay` `pwa` `bun` `typescript` `react` `electron` `hono` `cloudflare-workers` ... |
| A skill or plugin | what it runs and as what, then who it is for: `Run <tool> as a background subagent of <host>: ...` | none | 8: the host's name, the tool's name, `bun` `subagent` `typescript` ... |
| A private service | what it is and where it runs: `Messages API gateway on Cloudflare Workers: ...` | none | 7: `api-gateway` `bun` `cloudflare-workers` `hono` `load-balancer` `typescript` ... |

| Field | Convention |
|---|---|
| Description | One sentence a stranger understands. Lead with the name and a colon when the name does not explain itself. GitHub cuts it at 350 characters, and cards and search show far less, so the first clause carries the meaning. A mirror or copy says what it mirrors (`Private mirror of owner/name`). |
| Homepage | The product's own site when it has one. Otherwise empty. |
| Topics | Lowercase with hyphens, at most 20, 50 characters each. They mix three kinds: what it is for (`terminal`, `ai-agents`), what it is built on (`bun`, `hono`, `cloudflare-workers`) and the product family it belongs to. Public repos carry 7 to 15. Most private repos carry none. |

**The social preview image has no API.** Commit a 1280x640 PNG (for example at `.github/assets/social-preview.png`); a person uploads it in Settings. Call it set only after the repo page's `og:image` shows it.

## README and community files

Read one without cloning: `repo.readFile({ repo, path: "README.md" })`.

**A library, SDK or skill repo:**

1. `# name`, then one paragraph: what it does and for whom.
2. Badges only for facts a reader checks: npm version, license.
3. `## Install`: requirements, then the exact commands.
4. `## Example` or `## Quickstart`: a snippet that runs as written.
5. `## Documentation`: links into `docs/` or `references/`.

**A product repo:**

1. A centered mark in a `<picture>` with dark and light sources, the name, a one-line tagline.
2. A row of links: site, install, the main sections, CONTRIBUTING.
3. Badges: the CI workflow on the default branch, latest release, license.
4. One screenshot of the real product, dark and light, with alt text that describes what is on screen.
5. Translations as `README.<lang>.md`, linked in one row under the title.

Every command in a README is one that was run. Images are committed and linked by relative path.

| File | Which repos carry it |
|---|---|
| `AGENTS.md` | nearly all: the rules an agent follows in this repo |
| `LICENSE` | every public repo |
| `CONTRIBUTING.md`, `SECURITY.md` | public product repos |
| `CLA.md` with a CLA workflow | repos that take outside pull requests |
| `CHANGELOG.md` or `changes/` fragments with a changelog check | repos that ship releases |
| `.github/PULL_REQUEST_TEMPLATE.md`, `.github/CODEOWNERS` | repos with more than one contributor |

## Merge options and features

A new repo allows all three merge methods and keeps merged branches. Decide once and set it:

```js
await client.repo.edit({
  repo,
  allowMergeCommit: true,
  allowSquashMerge: false,
  allowRebaseMerge: false,
  deleteBranchOnMerge: true,
  enableAutoMerge: true,
  enableWiki: false,
})
```

| Kind of repo | Merge commit | Squash | Rebase | Auto-merge | Delete branch on merge |
|---|---|---|---|---|---|
| Merge-commit repos (a two-branch product, a backend service) | yes | no | no | yes | yes |
| A linear-history product repo | no | yes | yes | yes | yes |
| A rebase-only service repo | no | no | yes | no | yes |
| Repos left at defaults (small tools, libraries, skills) | yes | yes | yes | no | no |

- The merge method and the branch rule must agree: required linear history refuses every merge commit, so a merge-commit repo never sets it.
- **Delete-branch-on-merge can close stacked pull requests.** Merging a parent deletes its branch, and an open child that targets it may be closed instead of retargeted. Retarget the children first (`pr.edit({ base })`).
- Wikis and Projects are off where the docs live in the repo. Discussions are on only where a community asks questions in the repo.
- Secret scanning and push protection are on for every public repo.

## Labels

```js
await client.label.clone({ repo, source: "acme-labs/tidepool" })
await client.label.create({ repo, name: "no-changelog", color: "ededed", description: "Tooling-only change" })
```

A full set for a product repo: `area:<part>`, `priority:p0` to `priority:p2`, `needs-repro`, `needs owner`, `no-changelog`, on top of GitHub's defaults. Create a label a workflow reads (`no-changelog`, `deploy-staging`) before the workflow that reads it.

## Secrets and variables

```js
const value = await readSecret("cloudflare/api-token") // your secret store, read in this process
await client.secret.set({ repo, name: "CLOUDFLARE_API_TOKEN", value })
await client.variable.set({ repo, name: "DEPLOY_ENV", value: "staging" })
```

- `secret.set` seals the value on this machine with the repo's public key; GitHub never returns it. `secret.list` shows names and update times only.
- Pass `env: "production"` to scope a secret or variable to a deployment environment. **An environment secret wins over a repo secret of the same name**, so a green deploy does not prove which one was read until the repo-level one is deleted.
- Publishing to npm needs no stored token: use OIDC trusted publishing ([workflows.md](workflows.md)).
- Prefer a variable for anything that is not secret; its value stays readable.

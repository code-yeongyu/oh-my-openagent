# Branch rules

Rulesets and classic branch protection: the setups in use across a set of working repositories, how to read and set them, and what goes wrong. Measured on 2026-11-26; read the live state before copying a value.

## Rules

1. **SET RULES AFTER THE WORKFLOWS HAVE RUN ONCE.** A required check that no workflow reports blocks every merge with `base branch policy prohibits the merge`. Take the names from a real `pr.checks` result, never from the YAML by eye.
2. **READ BEFORE YOU WRITE.** `ruleset.list`, `ruleset.check` and `branchProtection.view` show what already applies, including rules inherited from the organization.
3. **ONE MECHANISM PER BRANCH.** A branch under classic protection keeps it; a branch with none gets a ruleset. Both at once means two places to update and two answers to "why is this blocked".
4. **A 403 THAT SAYS `Upgrade to GitHub Pro or make this repository public` IS THE PLAN, NOT A BUG.** Private repos in an organization on the free plan cannot have rulesets or protection. Say so, and keep the gate in CI and in the merge process.
5. **TURN A RULE OFF BEFORE DELETING IT.** `ruleset.edit({ id, enforcement: "disabled" })` is undone in one call; a deleted ruleset has to be rebuilt.

## Setups in use

| Kind of repo | Mechanism | Rules |
|---|---|---|
| A public two-branch product (integration `dev`, release `master`) | two rulesets | `master`: no deletion, no force push. `dev`: 13 required status checks, not strict. Admins and one GitHub App bypass. |
| A public product on one branch (`dev`) | classic protection | Checks `Check`, `API e2e`, `Web e2e`, strict. Pull request required with 0 approvals, stale reviews dismissed. Linear history, conversations resolved, no force push, no deletion. Admins not enforced. |
| A private personal service | classic protection | Pull request required with 0 approvals, linear history, no required checks. |
| Small tools, libraries and skills | none | The merge process is the gate. |
| Private repos in a free-plan organization | not available | 403: rule 4. |

## Read

```js
await client.ruleset.list({ repo, parents: true })
await client.ruleset.view({ repo, id })
await client.ruleset.check({ repo, branch: "dev" }) // every rule that applies to this branch
await client.branchProtection.view({ repo, branch: "dev" }) // { protected: false } when there is none
```

## Set: a ruleset

Trunk repo, default branch only:

```js
await client.ruleset.create({
  repo,
  name: "Protect the default branch",
  target: "branch",
  enforcement: "active",
  include: ["~DEFAULT_BRANCH"],
  rules: [
    { type: "deletion" },
    { type: "non_fast_forward" },
    { type: "pull_request", parameters: {
        required_approving_review_count: 0,
        dismiss_stale_reviews_on_push: true,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
    } },
    { type: "required_status_checks", parameters: {
        strict_required_status_checks_policy: false,
        required_status_checks: [{ context: "Check", integration_id: 15368 }],
    } },
  ],
})
```

Two-branch repo: one ruleset per job.

```js
await client.ruleset.create({
  repo, name: "Protect the release branch", target: "branch", enforcement: "active",
  include: ["refs/heads/master"],
  rules: [{ type: "deletion" }, { type: "non_fast_forward" }],
})
await client.ruleset.create({
  repo, name: "Require passing CI on dev", target: "branch", enforcement: "active",
  include: ["refs/heads/dev"],
  bypassActors: [{ actorId: 5, actorType: "RepositoryRole", bypassMode: "always" }],
  rules: [{ type: "required_status_checks", parameters: {
    strict_required_status_checks_policy: false,
    required_status_checks: [{ context: "typecheck" }, { context: "build" }, { context: "test (ubuntu-latest, 1/2)", integration_id: 15368 }],
  } }],
})
```

- `rules` are GitHub's own rule objects, passed through as written. `include` takes `~DEFAULT_BRANCH`, `~ALL` or `refs/heads/<pattern>`.
- `integration_id: 15368` is GitHub Actions. With it, only a check reported by Actions satisfies the rule.
- `actorId: 5` with `RepositoryRole` is the repo admin role.
- **The Actions token cannot be a bypass actor.** A release workflow that pushes a version bump to a protected branch pushes with a write deploy key listed as `{ actorType: "DeployKey", bypassMode: "always" }`, or as a GitHub App listed as `Integration`.

## Set: classic protection

Only for a branch that is already on it. A strict setup on `dev`:

```js
await client.branchProtection.set({
  repo, branch: "dev",
  requiredChecks: {
    strict: true,
    checks: ["Check", "API e2e", "Web e2e"].map((context) => ({ context, appId: 15368 })),
  },
  requiredApprovingReviewCount: 0,
  dismissStaleReviews: true,
  requiredLinearHistory: true,
  requiredConversationResolution: true,
  enforceAdmins: false,
  allowForcePushes: false,
  allowDeletions: false,
})
```

The call replaces the whole protection: a setting you leave out is turned off, so start from `branchProtection.view` and change one field.

## Required checks: where it breaks

- **The context is the job's name.** A job `name:` becomes the context; a matrix adds its values (`test (ubuntu-latest, 1/2)`). Renaming a job or changing the matrix makes the old context never report, and every pull request waits forever. Change the rule in the same pull request, or require one aggregate job that depends on the rest.
- **A workflow that does not trigger leaves its contexts missing.** Branch filters, `paths:` filters and event `types:` all do this. A stacked pull request retargeted to the base branch fires `edited`, which a workflow listening for `opened, synchronize, reopened` ignores: 12 of 13 required contexts were missing on one such pull request until a new push. Workflows that feed required checks run on every pull request.
- **Strict means every merge stales the others.** With `strict: true` a merge to the base makes every other open pull request `BEHIND` until it merges the base in. Take it only when the repo's merge rate can afford that.
- **Linear history and merge commits exclude each other.** Check the repo's merge options ([repo-setup.md](repo-setup.md)) before requiring linear history.
- **Admins pass unless enforced.** With admins not enforced, an admin token merges a blocked pull request. That is a property of the token, not evidence the checks passed: read `pr.checks` before merging.

## Verify

```js
await client.ruleset.check({ repo, branch: "main" })
const pr = await client.pr.view({ repo, number }) // mergeState BLOCKED until the checks pass
const checks = await client.pr.checks({ repo, number }) // required: true on the contexts the rule names
```

Open a real pull request and read those two. A rule counts as working only after a pull request showed `BLOCKED` under it.

## Next to the rules

- **What a rule cannot express lives in CI.** A two-branch repo can close pull requests that target the release branch with a workflow job that comments and fails.
- **Deployment environments have their own branch policy.** A `production` environment can accept deployments from one branch only. There is no typed operation for environments; use `api.rest` on `repos/<owner>/<name>/environments/<env>` and its `deployment-branch-policies`.

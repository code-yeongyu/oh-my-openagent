// Every operation this skill offers, defined once. sdk.ts, cli.ts and the MCP server (cli.ts mcp)
// are built from this; change an operation here and all three follow.
import { defineSurface } from "./vendor/surface/index.ts";
import { authOps, orgOps, statusOp } from "./src/account.ts";
import { actionOps } from "./src/actions.ts";
import { actionWriteOps } from "./src/actions-write.ts";
import { attestationOps } from "./src/attestations.ts";
import { branchProtectionOps } from "./src/branch-protection.ts";
import { cacheOps } from "./src/caches.ts";
import { codespaceOps } from "./src/codespaces.ts";
import { discussionOps } from "./src/discussions.ts";
import { defaultDeps } from "./src/env.ts";
import { gistOps } from "./src/gists.ts";
import { createGitHub, type Deps, type GitHub } from "./src/http.ts";
import { issueReadOps } from "./src/issues.ts";
import { issueExtraOps } from "./src/issues-extra.ts";
import { issueWriteOps } from "./src/issues-write.ts";
import { gpgKeyOps, sshKeyOps } from "./src/keys.ts";
import { labelOps } from "./src/labels.ts";
import { projectFieldOps } from "./src/project-fields.ts";
import { projectItemOps } from "./src/project-items.ts";
import { projectOps } from "./src/projects.ts";
import { pullExtraOps } from "./src/pulls-extra.ts";
import { pullReadOps } from "./src/pulls-read.ts";
import { pullReviewOps } from "./src/pulls-review.ts";
import { pullWriteOps } from "./src/pulls-write.ts";
import { rawOps } from "./src/raw.ts";
import { releaseWriteOps } from "./src/release-write.ts";
import { repoAdminOps } from "./src/repo-admin.ts";
import { repoContentOps } from "./src/repo-content.ts";
import { repoExtraOps } from "./src/repo-extras.ts";
import { releaseOps, repoOps } from "./src/repos.ts";
import { rulesetOps } from "./src/rulesets.ts";
import { searchOps } from "./src/search.ts";
import { commitSearchOp } from "./src/search-commits.ts";
import { secretOps } from "./src/secrets.ts";
import { variableOps } from "./src/variables.ts";
import { waitOps } from "./src/wait.ts";
import { workflowOps } from "./src/workflows.ts";

export const createSurface = (gh: GitHub, tokenInjected = false) =>
  defineSurface({
    name: "github",
    version: "0.2.0",
    description:
      "Typed GitHub: pull requests, issues, Actions runs, workflows and caches, repositories and their settings, branch rules, releases, labels, secrets, variables, gists, projects, discussions, codespaces, search, raw REST and GraphQL.",
    redact: gh.redact,
    instructions:
      "Use these tools instead of shelling out to the gh CLI. `repo` is owner/name and defaults to the git origin of the working directory. " +
      "Results are trimmed JSON; reach for api_rest or api_graphql only when no typed tool fits. " +
      "Before pr_merge, read pr_view and pr_checks and pass matchHeadSha so a moved head refuses the merge. " +
      "Change repository settings, rules and secrets only on a repository the task owns.",
    ops: {
      pr: {
        ...pullReadOps(gh),
        ...pullWriteOps(gh),
        ...pullExtraOps(gh),
        ...pullReviewOps(gh),
        wait: waitOps(gh).pr,
      },
      issue: {
        ...issueReadOps(gh),
        ...issueWriteOps(gh),
        ...issueExtraOps(gh),
      },
      run: { ...actionOps(gh), ...actionWriteOps(gh), wait: waitOps(gh).run },
      workflow: workflowOps(gh),
      cache: cacheOps(gh),
      repo: {
        ...repoOps(gh),
        ...repoAdminOps(gh),
        ...repoContentOps(gh),
        ...repoExtraOps(gh),
      },
      ruleset: rulesetOps(gh),
      branchProtection: branchProtectionOps(gh),
      release: { ...releaseOps(gh), ...releaseWriteOps(gh) },
      label: labelOps(gh),
      secret: secretOps(gh),
      variable: variableOps(gh),
      gist: gistOps(gh),
      project: {
        ...projectOps(gh),
        ...projectFieldOps(gh),
        ...projectItemOps(gh),
      },
      discussion: discussionOps(gh),
      codespace: codespaceOps(gh),
      attestation: attestationOps(gh),
      sshKey: sshKeyOps(gh),
      gpgKey: gpgKeyOps(gh),
      search: { ...searchOps(gh), commits: commitSearchOp(gh) },
      status: statusOp(gh),
      org: orgOps(gh),
      auth: authOps(gh, process.env, tokenInjected),
      api: rawOps(gh),
    },
  });

export const surfaceWith = (inject: Partial<Deps> = {}) =>
  createSurface(
    createGitHub({ ...defaultDeps(), ...inject }),
    inject.token !== undefined,
  );

export const surface = surfaceWith();

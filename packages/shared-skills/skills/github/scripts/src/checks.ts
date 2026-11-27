// `pr checks`: one GraphQL rollup of check runs and commit statuses, bucketed the way `gh pr checks` buckets them.
import { SurfaceError } from "../vendor/surface/index.ts";
import type { GitHub, Repo } from "./http.ts";
import { at, nodes, optNum, optStr, str } from "./read.ts";

export type Bucket = "pass" | "fail" | "pending" | "skipping" | "cancel";
export type Check = {
  readonly name: string;
  readonly bucket: Bucket;
  readonly state: string;
  readonly required: boolean;
  readonly url: string | null;
  readonly workflow: string | null;
  readonly runId: number | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
};

const QUERY = `query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){
headRefOid commits(last:1){nodes{commit{statusCheckRollup{state contexts(first:100,after:$after){pageInfo{hasNextPage endCursor}
nodes{__typename
... on CheckRun{name status conclusion detailsUrl startedAt completedAt isRequired(pullRequestNumber:$number) checkSuite{workflowRun{databaseId workflow{name}}}}
... on StatusContext{context state targetUrl createdAt isRequired(pullRequestNumber:$number)}}}}}}}}}}`;

const runBucket = (status: string, conclusion: string): Bucket => {
  if (status !== "COMPLETED") return "pending";
  if (conclusion === "SUCCESS") return "pass";
  if (conclusion === "CANCELLED") return "cancel";
  if (conclusion === "SKIPPED" || conclusion === "NEUTRAL") return "skipping";
  return "fail";
};

const statusBucket = (state: string): Bucket =>
  state === "SUCCESS"
    ? "pass"
    : state === "PENDING" || state === "EXPECTED"
      ? "pending"
      : "fail";

const toCheck = (n: unknown): Check => {
  if (at(n, "__typename") === "CheckRun") {
    const status = str(n, "status");
    const conclusion = optStr(n, "conclusion") ?? "";
    return {
      name: str(n, "name"),
      bucket: runBucket(status, conclusion),
      state: conclusion || status,
      required: at(n, "isRequired") === true,
      url: optStr(n, "detailsUrl"),
      workflow: optStr(n, "checkSuite", "workflowRun", "workflow", "name"),
      runId: optNum(n, "checkSuite", "workflowRun", "databaseId"),
      startedAt: optStr(n, "startedAt"),
      completedAt: optStr(n, "completedAt"),
    };
  }
  const state = str(n, "state");
  return {
    name: str(n, "context"),
    bucket: statusBucket(state),
    state,
    required: at(n, "isRequired") === true,
    url: optStr(n, "targetUrl"),
    workflow: null,
    runId: null,
    startedAt: optStr(n, "createdAt"),
    completedAt: null,
  };
};

export const fetchChecks = async (gh: GitHub, repo: Repo, number: number) => {
  const checks: Check[] = [];
  let after: string | null = null;
  let headSha = "";
  let rollup: string | null = null;
  do {
    const data = await gh.graphql(QUERY, {
      owner: repo.owner,
      name: repo.name,
      number,
      after,
    });
    const pr = at(data, "repository", "pullRequest");
    if (pr === null || pr === undefined)
      throw new SurfaceError(
        "not_found",
        `no pull request #${number} in ${repo.full}`,
        "check the number",
      );
    headSha = str(pr, "headRefOid");
    const commit = at(nodes(pr, "commits")[0], "commit", "statusCheckRollup");
    rollup = optStr(commit, "state");
    checks.push(...nodes(commit, "contexts").map(toCheck));
    after =
      at(commit, "contexts", "pageInfo", "hasNextPage") === true
        ? optStr(commit, "contexts", "pageInfo", "endCursor")
        : null;
  } while (after !== null);
  const counts: Record<Bucket, number> = {
    pass: 0,
    fail: 0,
    pending: 0,
    skipping: 0,
    cancel: 0,
  };
  for (const c of checks) counts[c.bucket] += 1;
  return { headSha, rollup, counts, checks };
};

import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { enc, limitField, reads, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { arr, at, num, optNum, optStr, str } from "./read.ts";

const runIdField = s.integer({
  description:
    "Workflow run id (databaseId; the number in .../actions/runs/<id>).",
});
const FAILED = new Set([
  "failure",
  "timed_out",
  "startup_failure",
  "cancelled",
]);
const STAMP = /^\d{4}-\d\d-\d\dT[\d:.]+Z /;

export const runSummary = (w: unknown) => ({
  id: num(w, "id"),
  workflow: optStr(w, "name"),
  title: optStr(w, "display_title"),
  status: str(w, "status"),
  conclusion: optStr(w, "conclusion"),
  event: str(w, "event"),
  branch: optStr(w, "head_branch"),
  sha: str(w, "head_sha"),
  attempt: optNum(w, "run_attempt") ?? 1,
  createdAt: str(w, "created_at"),
  updatedAt: optStr(w, "updated_at"),
  url: str(w, "html_url"),
});

const jobSummary = (j: unknown) => ({
  id: num(j, "id"),
  name: str(j, "name"),
  status: str(j, "status"),
  conclusion: optStr(j, "conclusion"),
  startedAt: optStr(j, "started_at"),
  completedAt: optStr(j, "completed_at"),
  url: optStr(j, "html_url"),
  failedSteps: arr(at(j, "steps") ?? [], "steps").flatMap((st) =>
    FAILED.has(optStr(st, "conclusion") ?? "") ? [str(st, "name")] : [],
  ),
});

export const runJobs = async (gh: GitHub, full: string, runId: number) =>
  (
    await gh.list(`repos/${full}/actions/runs/${runId}/jobs`, 300, {
      query: { filter: "latest" },
      key: "jobs",
    })
  ).map(jobSummary);

export const actionOps = (gh: GitHub) => ({
  list: op({
    description:
      "Recent workflow runs, filterable by workflow file/name, branch, commit SHA, event or status. Replaces `gh run list`.",
    input: s.object({
      repo: repoField,
      workflow: s.optional(
        s.string({ description: "Workflow file name (ci.yml) or id." }),
      ),
      branch: s.optional(s.string()),
      sha: s.optional(s.string({ description: "Head commit SHA." })),
      event: s.optional(s.string()),
      status: s.optional(
        s.enum([
          "queued",
          "in_progress",
          "completed",
          "success",
          "failure",
          "cancelled",
          "waiting",
          "requested",
          "pending",
        ]),
      ),
      limit: limitField(20),
    }),
    annotations: reads,
    run: async ({ repo, workflow, branch, sha, event, status, limit }) => {
      const r = await gh.repo(repo);
      const path =
        workflow === undefined
          ? `repos/${r.full}/actions/runs`
          : `repos/${r.full}/actions/workflows/${enc(workflow)}/runs`;
      const raw = await gh.list(path, limit ?? 20, {
        query: { branch, head_sha: sha, event, status },
        key: "workflow_runs",
      });
      return { repo: r.full, runs: raw.map(runSummary) };
    },
  }),
  view: op({
    description:
      "One workflow run with its latest-attempt jobs and the names of failed steps. Replaces `gh run view`.",
    input: s.object({ repo: repoField, runId: runIdField }),
    annotations: reads,
    run: async ({ repo, runId }) => {
      const r = await gh.repo(repo);
      const run = runSummary(
        await gh.rest("GET", `repos/${r.full}/actions/runs/${runId}`),
      );
      return { repo: r.full, ...run, jobs: await runJobs(gh, r.full, runId) };
    },
  }),
  logs: op({
    description:
      "Log tails of a run's failed jobs (or one job), timestamps stripped, optionally only lines matching a regex. Replaces `gh run view --log-failed`.",
    input: s.object({
      repo: repoField,
      runId: s.optional(runIdField),
      jobId: s.optional(
        s.integer({ description: "One job id; overrides runId." }),
      ),
      allJobs: s.optional(
        s.boolean({ description: "Include jobs that did not fail." }),
      ),
      tail: s.optional(
        s.integer({ description: "Last N lines per job (default 150)." }),
      ),
      grep: s.optional(
        s.string({
          description:
            "Case-insensitive regex; keep only matching lines (applied before tail).",
        }),
      ),
    }),
    annotations: reads,
    run: async ({ repo, runId, jobId, allJobs, tail, grep }) => {
      const r = await gh.repo(repo);
      const pattern = grep === undefined ? undefined : new RegExp(grep, "i");
      let jobs: {
        readonly id: number;
        readonly name: string;
        readonly conclusion: string | null;
      }[];
      if (jobId !== undefined) {
        const j = await gh.rest("GET", `repos/${r.full}/actions/jobs/${jobId}`);
        jobs = [
          {
            id: jobId,
            name: str(j, "name"),
            conclusion: optStr(j, "conclusion"),
          },
        ];
      } else if (runId !== undefined) {
        jobs = (await runJobs(gh, r.full, runId)).filter(
          (j) => allJobs === true || FAILED.has(j.conclusion ?? ""),
        );
      } else {
        throw new SurfaceError(
          "usage",
          "pass runId or jobId",
          "find run ids with `run list` or `pr checks`",
        );
      }
      return Promise.all(
        jobs.map(async (j) => {
          const lines = (
            await gh.logs(`repos/${r.full}/actions/jobs/${j.id}/logs`)
          )
            .trimEnd()
            .split(/\r?\n/)
            .map((l) => l.replace(STAMP, ""));
          const kept =
            pattern === undefined
              ? lines
              : lines.filter((l) => pattern.test(l));
          return {
            jobId: j.id,
            name: j.name,
            conclusion: j.conclusion,
            totalLines: lines.length,
            lines: kept.slice(-(tail ?? 150)),
          };
        }),
      );
    },
  }),
  dispatch: op({
    description:
      "Trigger a workflow_dispatch workflow on a ref with inputs. Replaces `gh workflow run`.",
    input: s.object({
      repo: repoField,
      workflow: s.string({
        description: "Workflow file name (release.yml) or id.",
      }),
      ref: s.optional(
        s.string({
          description: "Branch or tag; default branch when omitted.",
        }),
      ),
      inputs: s.optional(s.record(s.string())),
    }),
    annotations: writes,
    run: async ({ repo, workflow, ref, inputs }) => {
      const r = await gh.repo(repo);
      const target =
        ref ?? str(await gh.rest("GET", `repos/${r.full}`), "default_branch");
      await gh.rest(
        "POST",
        `repos/${r.full}/actions/workflows/${enc(workflow)}/dispatches`,
        { body: { ref: target, inputs: inputs ?? {} } },
      );
      return { repo: r.full, workflow, ref: target, dispatched: true };
    },
  }),
});

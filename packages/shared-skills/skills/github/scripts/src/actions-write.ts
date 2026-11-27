// Cancelling, re-running, deleting and downloading workflow runs.
import { op, s, SurfaceError } from "../vendor/surface/index.ts";
import { irreversible, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";
import { runDownloadOp } from "./run-download.ts";

const runIdField = s.integer({
  description:
    "Workflow run id (databaseId; the number in .../actions/runs/<id>).",
});

export const actionWriteOps = (gh: GitHub) => ({
  cancel: op({
    description:
      "Cancel a queued or running workflow run; force cancels even jobs that ignore cancellation (e.g. `if: always()`). A finished run fails as `conflict`. Replaces `gh run cancel`.",
    input: s.object({
      repo: repoField,
      runId: runIdField,
      force: s.optional(s.boolean()),
    }),
    annotations: irreversible,
    run: async ({ repo, runId, force }) => {
      const r = await gh.repo(repo);
      await gh.rest(
        "POST",
        `repos/${r.full}/actions/runs/${runId}/${force === true ? "force-cancel" : "cancel"}`,
      );
      return { repo: r.full, runId, cancelled: true, force: force === true };
    },
  }),
  rerun: op({
    description:
      "Re-run a workflow run, only its failed jobs, or one job (with the jobs it depends on), optionally with debug logging. Replaces `gh run rerun`.",
    input: s.object({
      repo: repoField,
      runId: s.optional(runIdField),
      failed: s.optional(
        s.boolean({
          description: "Only the failed jobs and their dependencies.",
        }),
      ),
      jobId: s.optional(
        s.integer({ description: "Re-run this one job instead of a run." }),
      ),
      debug: s.optional(s.boolean({ description: "Enable debug logging." })),
    }),
    annotations: writes,
    run: async ({ repo, runId, failed, jobId, debug }) => {
      let path: string;
      if (jobId !== undefined && runId === undefined && failed !== true)
        path = `actions/jobs/${jobId}/rerun`;
      else if (jobId === undefined && runId !== undefined)
        path = `actions/runs/${runId}/${failed === true ? "rerun-failed-jobs" : "rerun"}`;
      else
        throw new SurfaceError(
          "usage",
          "pass runId (optionally with failed) or jobId alone",
          "find ids with `run view`",
        );
      const r = await gh.repo(repo);
      await gh.rest("POST", `repos/${r.full}/${path}`, {
        ...(debug === true ? { body: { enable_debug_logging: true } } : {}),
      });
      return {
        repo: r.full,
        runId: runId ?? null,
        jobId: jobId ?? null,
        failedOnly: failed === true,
        debug: debug === true,
        rerun: true,
      };
    },
  }),
  delete: op({
    description:
      "Delete a completed workflow run with its logs and artifacts. Replaces `gh run delete`.",
    input: s.object({ repo: repoField, runId: runIdField }),
    annotations: irreversible,
    run: async ({ repo, runId }) => {
      const r = await gh.repo(repo);
      await gh.rest("DELETE", `repos/${r.full}/actions/runs/${runId}`);
      return { repo: r.full, runId, deleted: true };
    },
  }),
  download: runDownloadOp(gh),
});

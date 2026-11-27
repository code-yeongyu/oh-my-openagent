// Blocking waits for CI: poll on the injected clock until checks or a run settle, then return one verdict.
// Each poll of pr.wait is a single GraphQL call; run.wait is one REST GET (plus one jobs read at the end).
import { op, s } from "../vendor/surface/index.ts";
import { runJobs, runSummary } from "./actions.ts";
import { fetchChecks, type Check } from "./checks.ts";
import { numberField, reads, repoField } from "./fields.ts";
import type { GitHub } from "./http.ts";

const MIN_INTERVAL_S = 10;
const interval = s.optional(
  s.integer({
    description: `Seconds between polls (default 30, min ${MIN_INTERVAL_S}).`,
  }),
);
const timeout = s.optional(
  s.integer({
    description:
      "Give up after this many minutes and return verdict timeout (default 60).",
  }),
);
const pace = (seconds: number | undefined) =>
  Math.max(seconds ?? 30, MIN_INTERVAL_S) * 1000;

type PrVerdict = "pass" | "fail" | "timeout" | "no_checks" | "head_moved";

export const waitOps = (gh: GitHub) => ({
  pr: op({
    description:
      "Block until a PR's checks settle and return verdict pass | fail | timeout | no_checks | head_moved with the failing checks. Fails fast on the first failure unless failFast is false. Replaces `gh pr checks --watch`. For waits longer than a few minutes, run it from a monitor (references/waiting.md).",
    input: s.object({
      repo: repoField,
      number: numberField,
      headSha: s.optional(
        s.string({
          description:
            "Expected head; returns head_moved when the PR head still differs after graceSeconds (a just-pushed head takes a moment to show on the PR).",
        }),
      ),
      requiredOnly: s.optional(
        s.boolean({
          description:
            "Judge only required checks (default false: every check).",
        }),
      ),
      failFast: s.optional(
        s.boolean({
          description: "Return on the first failed check (default true).",
        }),
      ),
      graceSeconds: s.optional(
        s.integer({
          description:
            "How long zero checks, or a head not yet matching headSha, counts as still starting (default 120).",
        }),
      ),
      intervalSeconds: interval,
      timeoutMinutes: timeout,
    }),
    annotations: reads,
    run: async ({
      repo,
      number,
      headSha,
      requiredOnly,
      failFast,
      graceSeconds,
      intervalSeconds,
      timeoutMinutes,
    }) => {
      const r = await gh.repo(repo);
      const started = gh.now();
      const deadline = started + (timeoutMinutes ?? 60) * 60_000;
      for (let polls = 1; ; polls++) {
        const state = await fetchChecks(gh, r, number);
        const judged = state.checks.filter(
          (c) => requiredOnly !== true || c.required,
        );
        const failing = judged.filter(
          (c) => c.bucket === "fail" || c.bucket === "cancel",
        );
        const pending = judged.filter((c) => c.bucket === "pending");
        const elapsed = gh.now() - started;
        const done = (
          verdict: PrVerdict,
          extra: { readonly pending?: readonly Check[] } = {},
        ) => ({
          repo: r.full,
          number,
          verdict,
          headSha: state.headSha,
          counts: state.counts,
          failing: failing.map((c) => ({
            name: c.name,
            state: c.state,
            runId: c.runId,
            url: c.url,
          })),
          pending: (extra.pending ?? []).map((c) => c.name),
          polls,
          waitedSeconds: Math.round(elapsed / 1000),
        });
        const grace = (graceSeconds ?? 120) * 1000;
        if (headSha !== undefined && state.headSha !== headSha) {
          if (elapsed >= grace) return done("head_moved");
          await gh.sleep(pace(intervalSeconds));
          continue;
        }
        if (failing.length > 0 && (failFast !== false || pending.length === 0))
          return done("fail", { pending });
        if (judged.length === 0 && elapsed >= grace) return done("no_checks");
        if (judged.length > 0 && pending.length === 0) return done("pass");
        if (gh.now() >= deadline) return done("timeout", { pending });
        await gh.sleep(pace(intervalSeconds));
      }
    },
  }),
  run: op({
    description:
      "Block until one workflow run completes and return its conclusion and failed jobs (verdict timeout when it does not finish in time). Replaces `gh run watch`.",
    input: s.object({
      repo: repoField,
      runId: s.integer({ description: "Workflow run id." }),
      intervalSeconds: interval,
      timeoutMinutes: timeout,
    }),
    annotations: reads,
    run: async ({ repo, runId, intervalSeconds, timeoutMinutes }) => {
      const r = await gh.repo(repo);
      const started = gh.now();
      const deadline = started + (timeoutMinutes ?? 60) * 60_000;
      for (let polls = 1; ; polls++) {
        const run = runSummary(
          await gh.rest("GET", `repos/${r.full}/actions/runs/${runId}`),
        );
        const finished = run.status === "completed";
        if (finished || gh.now() >= deadline) {
          const jobs = finished
            ? (await runJobs(gh, r.full, runId)).filter(
                (j) => j.conclusion !== "success" && j.conclusion !== "skipped",
              )
            : [];
          return {
            repo: r.full,
            verdict: finished
              ? run.conclusion === "success"
                ? "pass"
                : "fail"
              : "timeout",
            run,
            failedJobs: jobs.map((j) => ({
              id: j.id,
              name: j.name,
              conclusion: j.conclusion,
              failedSteps: j.failedSteps,
            })),
            polls,
            waitedSeconds: Math.round((gh.now() - started) / 1000),
          };
        }
        await gh.sleep(pace(intervalSeconds));
      }
    },
  }),
});

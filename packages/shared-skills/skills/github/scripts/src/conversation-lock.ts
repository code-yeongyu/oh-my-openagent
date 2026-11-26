// Locking a conversation: issues and pull requests share the issues lock endpoint.
import { op, s } from "../vendor/surface/index.ts";
import { numberField, repoField, writes } from "./fields.ts";
import type { GitHub } from "./http.ts";

// The REST endpoint spells reasons with a hyphen and a space, unlike gh's flag values.
const restReason = {
  off_topic: "off-topic",
  too_heated: "too heated",
  resolved: "resolved",
  spam: "spam",
} as const;

export const lockOps = (gh: GitHub, noun: "pr" | "issue") => {
  const what = noun === "pr" ? "a pull request" : "an issue";
  return {
    lock: op({
      description: `Lock the conversation of ${what} so only collaborators can comment, with an optional reason. Replaces \`gh ${noun} lock\`.`,
      input: s.object({
        repo: repoField,
        number: numberField,
        reason: s.optional(
          s.enum(["off_topic", "too_heated", "resolved", "spam"]),
        ),
      }),
      annotations: { ...writes, idempotent: true },
      run: async ({ repo, number, reason }) => {
        const r = await gh.repo(repo);
        await gh.rest(
          "PUT",
          `repos/${r.full}/issues/${number}/lock`,
          reason === undefined
            ? {}
            : { body: { lock_reason: restReason[reason] } },
        );
        return { repo: r.full, number, locked: true, reason: reason ?? null };
      },
    }),
    unlock: op({
      description: `Unlock the conversation of ${what}. Replaces \`gh ${noun} unlock\`.`,
      input: s.object({ repo: repoField, number: numberField }),
      annotations: { ...writes, idempotent: true },
      run: async ({ repo, number }) => {
        const r = await gh.repo(repo);
        await gh.rest("DELETE", `repos/${r.full}/issues/${number}/lock`);
        return { repo: r.full, number, locked: false };
      },
    }),
  };
};

import { describe, expect, test } from "bun:test";
import { branchProtectionOps } from "../src/branch-protection.ts";
import { fakeGitHub, json, on } from "./fake.ts";

const PATH = /\/repos\/acme\/widgets\/branches\/main\/protection$/;
const kindOf = async (p: Promise<unknown>) =>
  p.then(
    () => "resolved",
    (e: unknown) => String(Reflect.get(Object(e), "kind")),
  );

const protection = {
  required_status_checks: {
    strict: false,
    contexts: ["ci"],
    checks: [{ context: "ci", app_id: 15368 }],
  },
  required_pull_request_reviews: {
    dismiss_stale_reviews: true,
    require_code_owner_reviews: false,
    required_approving_review_count: 2,
  },
  enforce_admins: { enabled: false },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  required_conversation_resolution: { enabled: true },
  restrictions: {
    users: [{ login: "octo" }],
    teams: [{ slug: "core" }],
    apps: [],
  },
};
const trimmed = {
  repo: "acme/widgets",
  branch: "main",
  protected: true,
  requiredChecks: { strict: false, checks: [{ context: "ci", appId: 15368 }] },
  requiredApprovingReviewCount: 2,
  dismissStaleReviews: true,
  requireCodeOwnerReviews: false,
  enforceAdmins: false,
  requiredLinearHistory: true,
  allowForcePushes: false,
  allowDeletions: false,
  requiredConversationResolution: true,
  restrictions: { users: ["octo"], teams: ["core"], apps: [] },
};

describe("branch protection", () => {
  test("view trims the protection to the typed fields", async () => {
    const { gh } = fakeGitHub([on("GET", PATH, () => json(protection))]);
    expect(
      await branchProtectionOps(gh).view.invoke({ branch: "main" }),
    ).toEqual(trimmed);
  });

  test("an unprotected branch is { protected: false }, but a missing branch still fails", async () => {
    const unprotected = fakeGitHub([
      on("GET", PATH, () => json({ message: "Branch not protected" }, 404)),
    ]);
    expect(
      await branchProtectionOps(unprotected.gh).view.invoke({ branch: "main" }),
    ).toEqual({ repo: "acme/widgets", branch: "main", protected: false });

    const missing = fakeGitHub([
      on("GET", PATH, () => json({ message: "Branch not found" }, 404)),
    ]);
    expect(
      await kindOf(
        branchProtectionOps(missing.gh).view.invoke({ branch: "main" }),
      ),
    ).toBe("not_found");
  });

  test("set sends every required key, null where unset", async () => {
    const { gh, seen } = fakeGitHub([on("PUT", PATH, () => json(protection))]);
    await branchProtectionOps(gh).set.invoke({
      branch: "main",
      allowForcePushes: false,
    });
    expect(seen[0]?.body).toEqual({
      required_status_checks: null,
      enforce_admins: null,
      required_pull_request_reviews: null,
      restrictions: null,
      allow_force_pushes: false,
    });
  });

  test("set maps the typed fields to GitHub's body and returns the new state", async () => {
    const { gh, seen } = fakeGitHub([on("PUT", PATH, () => json(protection))]);
    const out = await branchProtectionOps(gh).set.invoke({
      branch: "main",
      requiredChecks: {
        strict: true,
        checks: [{ context: "ci", appId: 15368 }, { context: "lint" }],
      },
      requiredApprovingReviewCount: 2,
      dismissStaleReviews: true,
      enforceAdmins: true,
      requiredLinearHistory: true,
      requiredConversationResolution: true,
      restrictions: { users: ["octo"], teams: ["core"] },
    });
    expect(seen[0]?.body).toEqual({
      required_status_checks: {
        strict: true,
        checks: [{ context: "ci", app_id: 15368 }, { context: "lint" }],
      },
      enforce_admins: true,
      required_pull_request_reviews: {
        required_approving_review_count: 2,
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
      },
      restrictions: { users: ["octo"], teams: ["core"], apps: [] },
      required_linear_history: true,
      required_conversation_resolution: true,
    });
    expect(out).toEqual(trimmed);
  });

  test("delete removes the protection", async () => {
    const { gh, seen } = fakeGitHub([
      on("DELETE", PATH, () => new Response(null, { status: 204 })),
    ]);
    expect(
      await branchProtectionOps(gh).delete.invoke({ branch: "main" }),
    ).toEqual({ repo: "acme/widgets", branch: "main", protected: false });
    expect(seen.map((r) => r.method)).toEqual(["DELETE"]);
  });
});

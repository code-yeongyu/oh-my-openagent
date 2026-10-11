import { expect, test } from "bun:test"
import { reconcileReviewClaims } from "./pr-review-claims.mjs"

function fixture() {
  const pr = {
    number: 42, state: "open", user: { login: "author" }, requested_reviewers: [],
    labels: [{ name: "in-review" }, { name: "stale-review" }],
    head: { sha: "abc", repo: { id: 2 } },
    base: { repo: { full_name: "owner/project" } },
  }
  const events = [{
    event: "labeled", label: { name: "in-review" },
    actor: { login: "claimer", type: "User" }, created_at: "2026-10-10T00:00:00Z",
  }]
  const reviews = []
  const requested = [], checks = [], removed = []
  const github = {
    rest: {
      actions: { getWorkflowRun: async () => ({ data: {
        path: ".github/workflows/pr-automation-signal.yml",
        event: "pull_request_review", status: "completed", conclusion: "success",
        repository: { full_name: "owner/project" }, head_repository: { id: 2 },
        head_sha: "abc", pull_requests: [{ number: 42 }],
      } }) },
      pulls: {
        get: async () => ({ data: structuredClone(pr) }),
        listReviews() {},
        requestReviewers: async args => { requested.push(args.reviewers) },
      },
      issues: {
        listEventsForTimeline() {},
        removeLabel: async args => {
          removed.push(args.name)
          pr.labels = pr.labels.filter(label => label.name !== args.name)
        },
      },
      checks: { create: async args => { checks.push(args) } },
    },
    paginate: async method => method === github.rest.pulls.listReviews ? reviews : events,
  }
  const context = { repo: { owner: "owner", repo: "project" }, payload: { workflow_run: { id: 123 } } }
  const core = { info() {}, warning() {} }
  return { github, context, core, pr, events, reviews, requested, checks, removed }
}

test("a fork claim requests the actual label owner and blocks the exact head", async () => {
  const f = fixture()
  await reconcileReviewClaims(f)
  expect(f.requested).toEqual([["claimer"]])
  expect(f.removed).toEqual(["stale-review"])
  expect(f.checks[0]).toMatchObject({
    name: "Review claim gate", head_sha: "abc", conclusion: "failure",
  })
})

test("only the claimer's later real review releases the claim", async () => {
  const f = fixture()
  f.reviews.push({
    user: { login: "other" }, state: "APPROVED", submitted_at: "2026-10-11T00:00:00Z",
  })
  await reconcileReviewClaims(f)
  expect(f.removed).not.toContain("in-review")
  f.reviews.push({
    user: { login: "claimer" }, state: "CHANGES_REQUESTED", submitted_at: "2026-10-11T00:00:00Z",
  })
  await reconcileReviewClaims(f)
  expect(f.removed).toContain("in-review")
  expect(f.checks.at(-1).conclusion).toBe("success")
})

test("an old review or commented review never releases a newer claim", async () => {
  const f = fixture()
  f.reviews.push(
    { user: { login: "claimer" }, state: "APPROVED", submitted_at: "2026-10-09T00:00:00Z" },
    { user: { login: "claimer" }, state: "COMMENTED", submitted_at: "2026-10-11T00:00:00Z" },
  )
  await reconcileReviewClaims(f)
  expect(f.removed).not.toContain("in-review")
  expect(f.checks.at(-1).conclusion).toBe("failure")
})

test("missing ownership fails closed and bots never become reviewers", async () => {
  const f = fixture()
  f.events.length = 0
  await reconcileReviewClaims(f)
  expect(f.requested).toEqual([])
  expect(f.checks.at(-1).conclusion).toBe("failure")
  const bot = fixture()
  bot.events[0].actor.type = "Bot"
  await reconcileReviewClaims(bot)
  expect(bot.requested).toEqual([])
})

test("a concurrent head update cannot receive a stale successful check", async () => {
  const f = fixture()
  f.github.rest.pulls.requestReviewers = async () => { f.pr.head.sha = "new-head" }
  await reconcileReviewClaims(f)
  expect(f.checks).toEqual([])
})

test("failed label writes cannot turn the gate green", async () => {
  const f = fixture()
  f.reviews.push({
    user: { login: "claimer" }, state: "APPROVED", submitted_at: "2026-10-11T00:00:00Z",
  })
  f.github.rest.issues.removeLabel = async () => { throw new Error("forbidden") }
  await expect(reconcileReviewClaims(f)).rejects.toThrow("forbidden")
  expect(f.checks).toEqual([])
})

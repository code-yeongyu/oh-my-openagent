import { resolveAutomationPR } from "./pr-automation-context.mjs"

export async function reconcileReviewClaims({ github, context, core }) {
  const pr = await resolveAutomationPR({ github, context, core })
  if (!pr) return
  const { owner, repo } = context.repo
  const claims = ["will-review", "in-review"]
  const events = await github.paginate(github.rest.issues.listEventsForTimeline, {
    owner, repo, issue_number: pr.number, per_page: 100,
  })
  const reviews = await github.paginate(github.rest.pulls.listReviews, {
    owner, repo, pull_number: pr.number, per_page: 100,
  })
  const latest = new Map()
  for (const event of events) {
    if (event.event === "labeled" && claims.includes(event.label?.name)) {
      latest.set(event.label.name, event)
    }
  }
  const present = pr.labels.map(label => label.name).filter(name => claims.includes(name))
  for (const name of present) {
    const event = latest.get(name)
    if (!event?.actor) {
      core.warning(`Keeping ${name}: its owner cannot be established.`)
      continue
    }
    const claimer = event.actor.login
    const reviewed = reviews.some(review =>
      review.user?.login === claimer &&
      Date.parse(review.submitted_at) > Date.parse(event.created_at) &&
      ["APPROVED", "CHANGES_REQUESTED"].includes(review.state))
    if (reviewed) {
      await github.rest.issues.removeLabel({ owner, repo, issue_number: pr.number, name })
      continue
    }
    if (event.actor.type !== "Bot" && claimer !== pr.user.login &&
        !pr.requested_reviewers.some(reviewer => reviewer.login === claimer)) {
      await github.rest.pulls.requestReviewers({
        owner, repo, pull_number: pr.number, reviewers: [claimer],
      })
    }
  }
  if (present.length > 0 && pr.labels.some(label => label.name === "stale-review")) {
    await github.rest.issues.removeLabel({
      owner, repo, issue_number: pr.number, name: "stale-review",
    })
  }
  // Read again after writes: neither an old event nor a failed write is proof
  // that the gate can pass. Never publish a result for a superseded PR head.
  const { data: current } = await github.rest.pulls.get({
    owner, repo, pull_number: pr.number,
  })
  if (current.head.sha !== pr.head.sha || current.state !== "open") return
  const blocked = current.labels.some(label => claims.includes(label.name))
  await github.rest.checks.create({
    owner, repo, name: "Review claim gate", head_sha: current.head.sha,
    status: "completed", conclusion: blocked ? "failure" : "success",
    output: {
      title: blocked ? "Active review claim" : "No active review claims",
      summary: blocked ? "The claimer must submit a review." : "Review claims are clear.",
    },
  })
}

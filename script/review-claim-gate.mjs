export async function checkMergeGroupReviewClaims({ github, context, core }) {
  const headRef = context.payload.merge_group?.head_ref
  const match = typeof headRef === "string"
    ? /^refs\/heads\/gh-readonly-queue\/.+\/pr-([1-9][0-9]*)-[0-9a-f]+$/.exec(headRef)
    : null
  const prNumber = match === null ? NaN : Number(match[1])
  if (!Number.isSafeInteger(prNumber)) {
    throw new Error("Merge blocked: cannot parse queued PR number from merge_group.head_ref.")
  }
  core.setOutput("pr_number", prNumber)

  // Read the current PR, not the queue-entry snapshot. API failures propagate.
  const { data: pr } = await github.rest.pulls.get({
    ...context.repo,
    pull_number: prNumber,
  })
  if (!Array.isArray(pr.labels) || pr.labels.some((label) => typeof label.name !== "string")) {
    throw new Error(`Merge blocked: cannot read labels for PR #${prNumber}.`)
  }
  const claims = pr.labels.map((label) => label.name)
    .filter((label) => label === "will-review" || label === "in-review")
  if (claims.length > 0) {
    throw new Error(`Merge blocked: active review claim label(s) on PR #${prNumber}: ${claims.join(", ")}. The claimer must submit their review to release the claim.`)
  }
  core.info(`No active review claim labels on PR #${prNumber}. Gate is green.`)
}

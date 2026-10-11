// Resolve authority from GitHub, never from a downloaded PR artifact.
export async function resolveAutomationPR({ github, context, core }) {
  const { owner, repo } = context.repo
  if (context.eventName === "workflow_dispatch") {
    const number = Number(context.payload.inputs.pr_number)
    if (!Number.isSafeInteger(number) || number <= 0) throw new Error("Invalid PR number")
    const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: number })
    if (pr.state !== "open" || pr.base.repo.full_name !== `${owner}/${repo}`) {
      throw new Error("Manual recheck requires an open PR in this repository")
    }
    return pr
  }
  const { data: run } = await github.rest.actions.getWorkflowRun({
    owner, repo, run_id: context.payload.workflow_run.id,
  })
  if (
    run.path !== ".github/workflows/pr-automation-signal.yml" ||
    !["pull_request", "pull_request_review"].includes(run.event) ||
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.repository.full_name !== `${owner}/${repo}`
  ) {
    throw new Error("Not a successful PR Automation Signal run in this repository")
  }
  // Fork runs can have an empty pull_requests array. The server-side head query
  // is only discovery; repository ID, current SHA, and base are checked below.
  const candidates = run.pull_requests.length > 0
    ? run.pull_requests
    : await github.paginate(github.rest.pulls.list, {
      owner, repo, state: "open",
      head: `${run.head_repository.owner.login}:${run.head_branch}`,
      per_page: 100,
    })
  const current = []
  for (const candidate of candidates) {
    const { data: pr } = await github.rest.pulls.get({
      owner, repo, pull_number: candidate.number,
    })
    if (
      pr.state === "open" &&
      pr.base.repo.full_name === `${owner}/${repo}` &&
      pr.head.repo?.id === run.head_repository.id &&
      pr.head.sha === run.head_sha
    ) current.push(pr)
  }
  if (current.length === 0) {
    core.info("The PR closed or advanced; ignoring the stale signal.")
    return undefined
  }
  if (current.length !== 1) throw new Error("Signal does not identify one current PR")
  return current[0]
}

export async function prepareCLAEvent({ github, context, core, eventPath }) {
  const pr = await resolveAutomationPR({ github, context, core })
  if (!pr) return
  const { writeFile } = await import("node:fs/promises")
  // Contributor Assistant expects a PR event. Only API-derived metadata is
  // serialized; the action never checks out or executes the PR's source.
  const payload = { action: "synchronize", number: pr.number, pull_request: pr }
  await writeFile(eventPath, JSON.stringify(payload), { mode: 0o600 })
  core.setOutput("pr_number", pr.number)
  context.payload = payload
  return pr
}

// Closed-world release validation proof for an exact push CI run.
// Publish loads this file only from the dispatch commit, next to release-push-proof.sh; the ci.yml and jobs it
// judges are data read from the candidate run, never code. Every job and step name that run may report is
// materialized from ci.yml at the run's exact SHA, must equal RELEASE_PROOF_CONTRACT, and must have passed.

import { readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

// Every job and step the release accepts, and the only completed skips it accepts (each with its reason).
// A skips entry without steps lets the whole job be skipped; with steps, only those steps of a successful job.
// Failure, neutral and cancellation are never accepted. Change it together with ci.yml.
const {
  jobs: RELEASE_PROOF_CONTRACT,
  allowedSkips: ALLOWED_SKIPS,
  workflowSha256,
} = JSON.parse(readFileSync(new URL("./release-proof-contract.json", import.meta.url), "utf8"))
export { ALLOWED_SKIPS, RELEASE_PROOF_CONTRACT }

// The Actions runner adds these around a job's declared steps; nothing else is accepted.
const SET_UP = "Set up job"
const COMPLETE = "Complete job"
const POST = "Post "
// The Jobs API reports at most this many characters of a job name, ending a longer one with "...".
const MAX_JOB_NAME = 100
const MATRIX_REF = /\$\{\{\s*matrix\.([A-Za-z0-9_-]+)\s*\}\}/g
const UPDATE = "update the release proof contract"

class Unsupported extends Error {}

function unsupported(message) {
  throw new Unsupported(message)
}

function isMapping(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function scalar(value, where) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value)
  return unsupported(`${where} has a non-scalar matrix value`)
}

function matrixRows(id, strategy) {
  if (strategy === undefined || strategy.matrix === undefined) return [null]
  const { include, exclude, ...axes } = isMapping(strategy.matrix)
    ? strategy.matrix
    : unsupported(`job ${id} computes its matrix`)
  const keys = Object.keys(axes)
  if (keys.length === 0) {
    if (exclude !== undefined || !Array.isArray(include) || include.length === 0) {
      unsupported(`job ${id} has a matrix without axes or include rows`)
    }
    return include.map((row) =>
      isMapping(row) && Object.keys(row).length > 0
        ? Object.fromEntries(Object.entries(row).map(([key, value]) => [key, scalar(value, `job ${id}`)]))
        : unsupported(`job ${id} has an empty or non-mapping include row`),
    )
  }
  // GitHub merges include rows into matching axis combinations; that is not modeled, so it fails closed.
  if (include !== undefined) unsupported(`job ${id} combines matrix axes with include`)
  let rows = [{}]
  for (const key of keys) {
    const values =
      Array.isArray(axes[key]) && axes[key].length > 0
        ? axes[key]
        : unsupported(`job ${id} axis ${key} is not a literal list`)
    rows = rows.flatMap((row) => values.map((value) => ({ ...row, [key]: scalar(value, `job ${id}`) })))
  }
  if (exclude !== undefined) {
    if (!Array.isArray(exclude)) unsupported(`job ${id} computes its matrix exclude`)
    rows = rows.filter(
      (row) =>
        !exclude.some((entry) =>
          isMapping(entry)
            ? Object.entries(entry).every(([key, value]) =>
                keys.includes(key)
                  ? row[key] === scalar(value, `job ${id}`)
                  : unsupported(`job ${id} excludes unknown axis ${key}`),
              )
            : unsupported(`job ${id} has a non-mapping exclude row`),
        ),
    )
  }
  return rows.length > 0 ? rows : unsupported(`job ${id} excludes every matrix combination`)
}

function jobName(id, base, row) {
  let name
  if (base.includes("${{")) {
    if (row === null) unsupported(`job ${id} has an expression name without a matrix`)
    name = base.replace(MATRIX_REF, (_, key) =>
      Object.hasOwn(row, key) ? row[key] : unsupported(`job ${id} names unknown matrix key ${key}`),
    )
    if (name.includes("${{")) unsupported(`job ${id} has a non-matrix expression in its name`)
  } else {
    name = row === null ? base : `${base} (${Object.values(row).join(", ")})`
  }
  return name.length > MAX_JOB_NAME ? `${name.slice(0, MAX_JOB_NAME - 3)}...` : name
}

function stepName(id, step, index) {
  const where = `job ${id} step ${index + 1}`
  if (!isMapping(step)) unsupported(`${where} is not a mapping`)
  if (step.name !== undefined) {
    if (typeof step.name !== "string" || step.name.trim() === "" || step.name.includes("${{")) {
      unsupported(`${where} has a computed or empty name`)
    }
    return step.name
  }
  if (typeof step.uses === "string") return `Run ${step.uses}`
  if (typeof step.run === "string") {
    const lines = step.run.split("\n").filter((line) => line.trim() !== "")
    if (lines.length === 1 && !lines[0].includes("${{")) return `Run ${lines[0].trim()}`
  }
  return unsupported(`${where} needs an explicit name`)
}

/**
 * Expands parsed ci.yml (JSON from `yq -o=json 'explode(.)'`) into the job and step names the Jobs API reports.
 * Returns Map<job name, { steps: string[], actions: Set<string> }>; actions are the steps that may report a post entry.
 * Throws on any construct whose reported names it cannot predict.
 */
export function materializeWorkflow(workflow) {
  if (!isMapping(workflow) || !isMapping(workflow.jobs)) unsupported("ci.yml has no jobs mapping")
  const jobs = new Map()
  for (const [id, job] of Object.entries(workflow.jobs)) {
    if (!isMapping(job)) unsupported(`job ${id} is not a mapping`)
    if (job.uses !== undefined) unsupported(`job ${id} calls a reusable workflow`)
    if (job.container !== undefined || job.services !== undefined) unsupported(`job ${id} adds container steps`)
    if (!Array.isArray(job.steps) || job.steps.length === 0) unsupported(`job ${id} has no step list`)
    const base = job.name ?? id
    if (typeof base !== "string") unsupported(`job ${id} has a non-string name`)
    const steps = job.steps.map((step, index) => stepName(id, step, index))
    const actions = new Set(steps.filter((_, index) => job.steps[index].uses !== undefined))
    for (const row of matrixRows(id, job.strategy)) {
      const name = jobName(id, base, row)
      if (jobs.has(name)) unsupported(`ci.yml reports job name ${name} twice`)
      jobs.set(name, { steps, actions })
    }
  }
  return jobs
}

function sameList(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function describe(list) {
  return list.map((value) => JSON.stringify(value)).join(", ")
}

function stepProblems(job, expected, actions, skippable) {
  const problems = []
  const steps = Array.isArray(job.steps) ? job.steps : []
  const names = steps.map((step) => step?.name)
  if (names[0] !== SET_UP || names.at(-1) !== COMPLETE || steps.length < 2) {
    return [`job ${job.name} does not report runner setup and completion around its steps`]
  }
  const body = steps.slice(1, -1)
  let mainEnd = body.length
  while (mainEnd > 0 && typeof body[mainEnd - 1]?.name === "string" && body[mainEnd - 1].name.startsWith(POST))
    mainEnd--
  const main = body.slice(0, mainEnd)
  const posts = body.slice(mainEnd)
  const mainNames = main.map((step) => step?.name)
  if (!sameList(mainNames, expected)) {
    const unknown = mainNames.filter((name) => !expected.includes(name))
    const missing = expected.filter((name) => !mainNames.includes(name))
    if (unknown.length > 0) problems.push(`job ${job.name} reports unknown steps ${describe(unknown)}`)
    if (missing.length > 0) problems.push(`job ${job.name} lacks steps ${describe(missing)}`)
    if (unknown.length === 0 && missing.length === 0)
      problems.push(`job ${job.name} reports its steps in a different order or count`)
  }
  const seenPosts = new Set()
  for (const post of posts) {
    const target = post.name.slice(POST.length)
    if (!actions.has(target) || seenPosts.has(post.name))
      problems.push(`job ${job.name} reports unmodeled runner entry ${JSON.stringify(post.name)}`)
    seenPosts.add(post.name)
  }
  for (const step of [steps[0], ...main, ...posts, steps.at(-1)]) {
    const passed = step?.status === "completed" && step.conclusion === "success"
    const allowedSkip =
      step?.status === "completed" && step.conclusion === "skipped" && main.includes(step) && skippable.has(step.name)
    if (!passed && !allowedSkip) {
      problems.push(`job ${job.name} step ${JSON.stringify(step?.name)} is ${step?.status}/${step?.conclusion}`)
    }
  }
  return problems
}

/**
 * Judges one run attempt: `workflow` is parsed ci.yml at the run's exact SHA, `pages` the slurped Jobs API pages.
 * Returns problems; an empty list proves every contracted job and step ran and passed.
 */
export function verifyPushValidation(workflow, pages, contract = RELEASE_PROOF_CONTRACT, allowedSkips = ALLOWED_SKIPS) {
  let declared
  try {
    declared = materializeWorkflow(workflow)
  } catch (error) {
    if (error instanceof Unsupported) return [`ci.yml cannot be modeled: ${error.message}`]
    throw error
  }
  const problems = []
  const contractNames = Object.keys(contract)
  for (const name of declared.keys()) {
    if (!Object.hasOwn(contract, name)) problems.push(`ci.yml declares job ${name}, which the contract does not list`)
  }
  for (const name of contractNames) {
    const job = declared.get(name)
    if (!job) problems.push(`ci.yml no longer declares contracted job ${name}`)
    else if (!sameList(job.steps, contract[name]))
      problems.push(`ci.yml declares steps for ${name} that differ from the contract: ${describe(job.steps)}`)
  }
  if (problems.length > 0) return problems

  // Names alone cannot distinguish real checks from no-ops, or bind if, env,
  // uses, inputs, defaults and continue-on-error. Pin the parsed definition
  // as a whole (including inherited settings); leave array order significant.
  const definition = JSON.stringify(workflow, (_, value) =>
    isMapping(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, value[key]]),
        )
      : value,
  )
  if (createHash("sha256").update(definition).digest("hex") !== workflowSha256)
    return ["ci.yml executable definition differs from the reviewed release proof contract"]

  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    !pages.every((page) => isMapping(page) && Array.isArray(page.jobs))
  ) {
    return ["the Jobs API answer is not a list of job pages"]
  }
  const jobs = pages.flatMap((page) => page.jobs)
  if (jobs.length !== pages[0].total_count) {
    return [`the Jobs API listed ${jobs.length} of ${pages[0].total_count} jobs`]
  }
  const byName = new Map()
  for (const job of jobs) {
    const name = job?.name
    if (byName.has(name)) problems.push(`the run reports job ${name} twice`)
    byName.set(name, job)
    if (!Object.hasOwn(contract, name))
      problems.push(`the run reports unknown job ${name} (${job?.status}/${job?.conclusion})`)
  }
  for (const name of contractNames) {
    const job = byName.get(name)
    if (!job) {
      problems.push(`the run lacks job ${name}`)
      continue
    }
    const allowance = allowedSkips.filter((entry) => entry.job === name)
    if (job.status === "completed" && job.conclusion === "skipped" && allowance.some((entry) => !entry.steps)) {
      if (Array.isArray(job.steps) && job.steps.length > 0) problems.push(`skipped job ${name} reports steps`)
      continue
    }
    if (job.status !== "completed" || job.conclusion !== "success") {
      problems.push(`job ${name} is ${job.status}/${job.conclusion}`)
      continue
    }
    const skippable = new Set(allowance.flatMap((entry) => entry.steps ?? []))
    problems.push(...stepProblems(job, contract[name], declared.get(name).actions, skippable))
  }
  return problems
}

async function main() {
  const [id, attempt, sha] = process.argv.slice(2)
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  let problems
  try {
    const { workflow, jobs } = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    problems = verifyPushValidation(workflow, jobs)
  } catch (error) {
    problems = [`cannot read ci.yml and jobs: ${error instanceof Error ? error.message : String(error)}`]
  }
  if (problems.length === 0) return 0
  for (const problem of problems) console.error(`::error::${problem}`)
  console.error(
    `::error::Push CI run ${id}, attempt ${attempt} at ${sha} does not prove the release validation contract; rerun CI, or ${UPDATE} when ci.yml changed on purpose.`,
  )
  return 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}

// brfx2 proof helper: prints the exact run: text of <workflow> <job> <step name> as read from the checked-out tree.
// Used by the never-merged draft proof workflow so each replayed step is byte-identical to the real one by construction.
const [wf, job, step] = process.argv.slice(2)
const doc = Bun.YAML.parse(await Bun.file(`.github/workflows/${wf}`).text()) as { jobs: Record<string, { steps: { name?: string; run?: string; if?: string }[] }> }
const steps = doc.jobs[job]?.steps ?? []
const hit = steps.filter((s) => s.name === step)
if (hit.length !== 1 || typeof hit[0].run !== "string") { console.error(`PROOF_STEP_NOT_FOUND ${wf} ${job} ${step} (matches=${hit.length})`); process.exit(2) }
process.stdout.write(hit[0].run)

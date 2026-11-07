import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { mobiusDiscoveryEvents, mobiusOutcomeEvidence } from "./mobius-qa-events.mjs"

export async function runMobiusNativeScenario({ sandbox, pluginRoot }) {
  const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } =
    await import("@code-yeongyu/senpi")
  const cwd = join(sandbox, "project")
  const agentDir = join(sandbox, "agent")
  const settingsManager = SettingsManager.inMemory({})
  const loader = new DefaultResourceLoader({
    cwd, agentDir, settingsManager, additionalExtensionPaths: [pluginRoot],
  })
  let session
  try {
    await loader.reload()
    assert.deepEqual(loader.getExtensions().errors, [])
    ;({ session } = await createAgentSession({
      cwd, agentDir, settingsManager, resourceLoader: loader,
      sessionManager: SessionManager.inMemory(cwd),
    }))
    await session.bindExtensions({})
    const loaded = loader.getSkills().skills.find(({ name }) => name === "mobius-loop")
    assert.ok(loaded, "packaged Mobius skill was not discovered")
    assert.equal(loaded.baseDir, join(pluginRoot, "skills/mobius-loop"))
    const execute = async (name, params) => {
      const result = await session.executeTool(name, params, { signal: AbortSignal.timeout(45_000) })
      console.log(`TOOL_RESULT ${name} ${JSON.stringify(result)}`)
      assert.notEqual(result.isError, true, JSON.stringify(result))
      assert.notEqual(result.details?.isError, true, JSON.stringify(result))
      return result
    }
    const cell = async (code, reset = false) => {
      const result = await execute("eval", {
        language: "js", code, reset, summary: "Verify the shipped Mobius workflow in the native eval kernel",
      })
      const artifact = result.details?.meta?.artifactId
      if (result.details?.truncated) {
        assert.ok(typeof artifact === "string" && artifact.startsWith(`${sandbox}/`), JSON.stringify(result))
      }
      const text = result.details?.truncated
        ? readFileSync(artifact, "utf8")
        : result.content.filter(({ type }) => type === "text").map(({ text }) => text).join("\n")
      const line = text.split("\n").find((entry) => entry.trim().startsWith('{"ok":'))
      assert.ok(line, text)
      const envelope = JSON.parse(line)
      console.log(`SDK ${JSON.stringify(envelope)}`)
      return envelope
    }
    const ok = (envelope) => {
      assert.equal(envelope.ok, true, JSON.stringify(envelope))
      return envelope.result
    }
    const moduleUrl = pathToFileURL(join(loaded.baseDir, "scripts/mobius.mjs")).href
    const bootstrap = `var { createMobius } = await import(${JSON.stringify(moduleUrl)}); var mobiusQa = createMobius(${JSON.stringify({ cwd, slug: "diagnosis" })});`
    ok(await cell(`${bootstrap} print(JSON.stringify(await mobiusQa.start({title:"Reduce diagnosis time"})))`))
    let current = ok(await cell("print(JSON.stringify(await mobiusQa.status()))"))
    const record = async (event) => {
      current = ok(await cell(`print(JSON.stringify(await mobiusQa.record(${JSON.stringify({
        expectedRevision: current.snapshot.revision, event,
      })})))`))
    }
    for (const event of mobiusDiscoveryEvents) await record(event)
    await record({ type: "focus", to: "deliver", reason: "Run the selected diagnostic experiment", refs: [] })
    assert.equal(current.records.focus, "deliver")
    const delivery = ok(await cell('var { agentToolkit } = await import(`${env("OMO_AGENT_TOOLKIT_SDK_ROOT")}/sdk.js`); print(JSON.stringify(await agentToolkit.createGoals({brief:"- Deliver diagnostic output\\n- Measure diagnosis impact"})))'))
    const deliveryStatus = ok(await cell("print(JSON.stringify(await agentToolkit.status()))"))
    assert.ok(delivery.goals.length > 0)
    const deliveryRef = {
      kind: "ulw-loop",
      sessionId: deliveryStatus.binding.sessionId,
      goalId: delivery.goals[0].id,
    }
    await record({
      type: "experiment", id: "pilot", optionId: "diagnostic",
      plan: "Run the controlled diagnostic pilot", passCriteria: "Measured diagnosis takes at most four minutes",
      deliveryRef,
    })
    await execute("write", { path: join(cwd, "diagnostic.json"), content: '{"prerequisite":"missing compiler"}\n' })
    assert.equal(JSON.parse(readFileSync(join(cwd, "diagnostic.json"), "utf8")).prerequisite, "missing compiler")
    await record({
      type: "delivery", experimentId: "pilot", output: "diagnostic.json",
      checks: [{ name: "diagnostic artifact parsed", status: "pass", evidence: ["diagnostic.json"] }],
      refs: ["diagnostic.json"],
    })
    await record(mobiusOutcomeEvidence("simulated", "simulated"))
    const assessment = (evidenceId) => ({
      type: "assessment", experimentId: "pilot", validity: "valid", hypothesisSupport: "supported",
      outcomes: [{ outcomeId: "time", status: "achieved", evidenceIds: [evidenceId] }],
      learning: "The controlled pilot suggests reporting the missing prerequisite directly",
      nextAction: "Validate with the next installer cohort",
    })
    const rejected = await cell(`print(JSON.stringify(await mobiusQa.record(${JSON.stringify({
      expectedRevision: current.snapshot.revision, event: assessment("simulated"),
    })})))`)
    assert.equal(rejected.ok, false, "simulated impact was accepted as achieved")
    const delivered = structuredClone(current.records.deliveries)
    const priorEvidence = structuredClone(current.records.evidence)
    assert.equal(current.records.focus, "deliver")
    await record({ type: "focus", to: "discover", reason: "Validate the diagnosis assumption with affected installers", refs: ["simulated"] })
    assert.equal(current.records.focus, "discover")
    assert.deepEqual(current.records.deliveries, delivered)
    assert.deepEqual(current.records.evidence, priorEvidence)
    console.log("CHECK Deliver -> Discover retained delivery and evidence")
    await record({ type: "foundation", id: "feedback", area: "collaboration", note: "Assign pilot feedback ownership", owner: "QA facilitator", status: "open", refs: [] })
    await record({ type: "pause", reason: "Waiting for controlled observed evidence" })
    const paused = current.snapshot
    current = ok(await cell(`${bootstrap} print(JSON.stringify(await mobiusQa.status()))`, true))
    assert.deepEqual(current.snapshot, paused, "kernel restart changed initiative history")
    await record({ type: "resume", reason: "The controlled observation is available" })
    await record(mobiusOutcomeEvidence("observed", "observed"))
    await record(assessment("observed"))
    const lesson = ok(await cell('print(JSON.stringify(await mobiusQa.learning({experimentId:"pilot"})))'))
    assert.match(lesson.body, /controlled pilot/)
    await execute("memory", {
      command: "create", file_path: "reference/mobius/diagnosis-qa.md",
      description: lesson.description, file_text: lesson.body,
      reason: "Record controlled Mobius QA learning", source: "agent",
    })
    const learningFiles = readdirSync(sandbox, { recursive: true })
      .filter((path) => path.endsWith(join("reference", "mobius", "diagnosis-qa.md")))
    assert.equal(learningFiles.length, 1, "native memory must persist one learning file in the sandbox")
    assert.ok(readFileSync(join(sandbox, learningFiles[0]), "utf8").includes(lesson.body))
    console.log(`CHECK Learning persisted at ${learningFiles[0]}`)
    await record({ type: "close", reason: "Controlled outcome measured", resolution: "achieved", evidenceIds: ["observed"] })
    const persisted = JSON.parse(readFileSync(join(cwd, ".omo/mobius/diagnosis/initiative.json"), "utf8"))
    assert.deepEqual(persisted, current.snapshot)
    assert.equal(current.records.lifecycle, "closed")
    assert.equal(current.records.closure.resolution, "achieved")
    assert.deepEqual(current.records.deliveries, delivered)
    assert.equal(current.records.evidence.length, priorEvidence.length + 1)
    console.log(`CHECK Mobius native workflow passed with deliveryRef=${JSON.stringify(deliveryRef)} and revision=${current.snapshot.revision}`)
  } finally {
    if (session) {
      await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" })
      session.dispose()
      console.log("CLEANUP native session disposed")
    }
  }
}

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { resolveBundledSkillsDir } from "../bundled-skills"
import { runAdvisor } from "../init-deep-advisor/component"
import { componentContext, createHarness, makeCoverageRepo, resetTestHome, setTestHome } from "../init-deep-advisor/component.test-support"
import { createOnboardingHarness } from "../onboarding/test-harness"
import { ULW_PLAN_CUSTOM_TYPE } from "../skill-pointers"
import { dispatchInput, injectedContent, registerSkillPointers } from "../skill-pointers/test-support"
import { registerOmoNativeToolTelemetry } from "./omo-native-tools"
import { getBuiltinSkillsRoot, type OmoNativeEventName } from "./product-identity"

const variable = "OMO_BUNDLED_SKILLS_DIR"
const pluginRelativeRoot = fileURLToPath(new URL("../../../skills/", import.meta.url))

type Case = {
  readonly name: string
  readonly value: (root: string) => string | undefined
  readonly honoured: boolean
}

const cases: readonly Case[] = [
  { name: "unset", value: () => undefined, honoured: false },
  { name: "a valid absolute directory", value: (root) => join(root, "shared"), honoured: true },
  { name: "a relative path", value: (root) => `relative/${basename(root)}`, honoured: false },
  { name: "a missing directory", value: (root) => join(root, "missing"), honoured: false },
  { name: "a file instead of a directory", value: (root) => join(root, "file"), honoured: false },
]

let root: string
let saved: string | undefined

beforeEach(() => {
  saved = process.env[variable]
  delete process.env[variable]
  root = mkdtempSync(join(tmpdir(), "builtin-skills-root-"))
  mkdirSync(join(root, "shared", "ulw-plan"), { recursive: true })
  writeFileSync(join(root, "shared", "ulw-plan", "SKILL.md"), "# ulw-plan\n")
  writeFileSync(join(root, "file"), "not a directory")
  setTestHome()
})

afterEach(() => {
  if (saved === undefined) delete process.env[variable]
  else process.env[variable] = saved
  resetTestHome()
  Reflect.deleteProperty(globalThis, Symbol.for("omo.onboard"))
  rmSync(root, { recursive: true, force: true })
})

function messageContents(results: readonly unknown[]): string[] {
  return results.flatMap((result) =>
    typeof result === "object" && result !== null && "message" in result
      ? [String((result as { message: { content: unknown } }).message.content)]
      : [])
}

describe("getBuiltinSkillsRoot follows the bundled-skills resolver (#11626)", () => {
  for (const entry of cases) {
    test(`#given OMO_BUNDLED_SKILLS_DIR is ${entry.name} #when the skills root and every caller resolve #then they name the loader's directory and the override is reported at most once`, async () => {
      // given
      const value = entry.value(root)
      if (value !== undefined) process.env[variable] = value
      const expected = entry.honoured ? `${value}${sep}` : pluginRelativeRoot
      const errors: string[] = []
      const logger = { error: (message: string) => { errors.push(message) } }

      // when
      const skillsRoot = getBuiltinSkillsRoot(process.env, logger)
      const loaderDir = resolveBundledSkillsDir(undefined, process.env, { logger })

      // then
      expect(skillsRoot).toBe(expected)
      if (entry.honoured) expect(loaderDir).toBe(value)
      expect(errors).toHaveLength(value === undefined || entry.honoured ? 0 : 1)
      for (const error of errors) expect(error).toContain(variable)

      const pointerApi = new FakeExtensionAPI()
      await registerSkillPointers(pointerApi)
      await dispatchInput(pointerApi, "should we ulw plan this later")
      expect(injectedContent(pointerApi, ULW_PLAN_CUSTOM_TYPE)).toContain(`${expected}ulw-plan/SKILL.md`)

      const onboarding = createOnboardingHarness(join(root, "onboarding-state"))
      await onboarding.start()
      const tour = messageContents(await onboarding.prompt())
      expect(tour).toHaveLength(1)
      expect(tour[0]).toContain(`${expected}/onboarding/SKILL.md`)

      const repo = makeCoverageRepo()
      const advisor = createHarness(repo, "Run now")
      await runAdvisor(advisor.pi, componentContext, advisor.eventCtx)
      expect(String(advisor.pi.messages[0]?.message["content"])).toContain(`${expected}/init-deep/SKILL.md`)

      // telemetry: the skill is recognised under the resolved root, and only its allowlisted name is exported
      const telemetryApi = new FakeExtensionAPI()
      const events: Array<{ readonly name: OmoNativeEventName; readonly properties: Readonly<Record<string, unknown>> }> = []
      registerOmoNativeToolTelemetry(telemetryApi, {
        captureEvent: (name, properties) => events.push({ name, properties }),
        hashSessionId: (sessionId) => `hashed:${sessionId}`,
      })
      await telemetryApi.dispatch(
        "tool_result",
        { type: "tool_result", toolCallId: "call-1", toolName: "read", input: { path: join(expected, "ulw-plan", "SKILL.md") }, content: [], isError: false },
        { sessionManager: { getSessionId: () => "session-a" } },
      )
      expect(events).toEqual([{ name: "skill_loaded", properties: { $session_id: "hashed:session-a", skill_name: "ulw-plan" } }])
      expect(JSON.stringify(events)).not.toContain(root)

      expect(errors).toHaveLength(value === undefined || entry.honoured ? 0 : 1)
    })
  }
})

import { describe, expect, test } from "bun:test"

import { RunnerError } from "./in-process/runner-error"
import { createRpcModelAdmission } from "./rpc/model-admission"
import { RpcProcessRunner } from "./rpc-process"
import type { RpcRunnerSpec } from "./types"

// What `senpi --mode rpc --model <id>` prints and does when its own model resolution cannot find the
// model: the `model_unresolved` diagnostic on stderr, then exit 1 before any prompt is read.
const SENPI_UNRESOLVED = 'Error: Model "prov/ghost" not found. Use --list-models to see available models.'

function spec(model: string): RpcRunnerSpec {
  return { task_id: "st_child_model", cwd: process.cwd(), state_dir: process.cwd(), prompt: "hello", model }
}

describe("RpcProcessRunner child model resolution (#10863)", () => {
  test("#given admission was inconclusive #when the child itself cannot resolve the model #then the start fails typed model_unavailable with the child's error", async () => {
    // given
    const runner = new RpcProcessRunner({
      modelAdmission: createRpcModelAdmission({
        buildSpawn: () => ({ command: "senpi", args: ["--list-models"], cwd: "/tmp", env: {} }),
        probe: async () => ({ code: null, stdout: "", stderr: "", timedOut: true }),
        onInconclusive: () => undefined,
      }),
      buildSpawn: (input) => ({
        command: process.execPath,
        args: ["-e", `process.stderr.write(${JSON.stringify(`\u001B[31m${SENPI_UNRESOLVED}\u001B[39m\n`)}); process.exit(1)`],
        cwd: input.cwd,
        env: process.env,
      }),
    })

    // when
    const failure = await runner.start(spec("prov/ghost")).catch((error: unknown) => error)

    // then
    expect(RunnerError.is(failure)).toBe(true)
    expect(failure).toMatchObject({
      failure: {
        kind: "model_unavailable",
        message: expect.stringContaining('Model "prov/ghost" not found'),
        rejected_while: "exited",
        exit: { kind: "crashed", code: 1 },
      },
    })
    // and: the reason is parent-authored only, so a classification read from child stderr adds none.
    expect((failure as RunnerError).failure.reason).toBeUndefined()
  })

  test("#given a child that crashes for another reason before its first prompt #when started #then it stays child-prompt-failed", async () => {
    // given
    const runner = new RpcProcessRunner({
      modelAdmission: async () => undefined,
      buildSpawn: (input) => ({
        command: process.execPath,
        args: ["-e", "process.stderr.write('Error: boom\\n'); process.exit(1)"],
        cwd: input.cwd,
        env: process.env,
      }),
    })

    // when
    const failure = await runner.start(spec("prov/alpha")).catch((error: unknown) => error)

    // then
    expect(failure).toMatchObject({ failure: { kind: "child-prompt-failed", rejected_while: "exited" } })
  })

  test("#given a pin whose provider the child does not know #when the child exits with its unknown-provider diagnostic #then the start fails typed model_unavailable", async () => {
    // given: senpi's second model_unresolved form (model-resolver: Unknown provider "X")
    const unknownProvider = 'Error: Unknown provider "ghostprov". Use --list-models to see available providers/models.'
    const runner = new RpcProcessRunner({
      modelAdmission: async () => undefined,
      buildSpawn: (input) => ({
        command: process.execPath,
        args: ["-e", `process.stderr.write(${JSON.stringify(`${unknownProvider}\n`)}); process.exit(1)`],
        cwd: input.cwd,
        env: process.env,
      }),
    })

    // when
    const failure = await runner.start(spec("ghostprov/model")).catch((error: unknown) => error)

    // then
    expect(failure).toMatchObject({
      failure: {
        kind: "model_unavailable",
        message: expect.stringContaining('Unknown provider "ghostprov"'),
        rejected_while: "exited",
      },
    })
  })
})

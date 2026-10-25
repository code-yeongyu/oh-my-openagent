import { afterEach, expect, test } from "bun:test"
import { RpcProcessRunner } from "../rpc-process"
import { describeStartFailure } from "../../manager/start-failure"
import { fakeClock } from "./__fixtures__/clock"
import { silentChild } from "./__fixtures__/silent-child"
import { RpcProtocolClient } from "./protocol-client"

let clock: ReturnType<typeof fakeClock>
afterEach(() => clock?.restore())

test("#given a silent stdio child #when the prompt deadline expires #then start rejects child-prompt-failed with an action", async () => {
  clock = fakeClock()
  const fake = silentChild()
  const runner = new RpcProcessRunner({
    spawnChild: () => fake.child,
    modelAdmission: async () => {},
    buildSpawn: () => ({ command: "unused", args: [], cwd: process.cwd(), env: {} }),
  })
  const result = runner.start({ task_id: "st_deadline", cwd: process.cwd(), state_dir: "/tmp/unused", prompt: "work" })
    .then(() => undefined, (error: unknown) => error)
  await clock.advance(0)
  expect(fake.commands.some((command) => command.type === "prompt")).toBe(true)
  await clock.advance(30_000)
  const error = await Promise.race([result, Promise.resolve("still pending")])
  expect(error).toMatchObject({ failure: { kind: "child-prompt-failed", cause: { name: "RpcRequestTimeout", command: "prompt", deadlineMs: 30_000 } } })
  expect(describeStartFailure(error).errorMessage).toMatch(/Action: /)
  expect(clock.pending()).toBe(0)
})

test("#given an input received acknowledgement #when preflight takes time #then it has five minutes without repeated extension", async () => {
  clock = fakeClock()
  const fake = silentChild()
  const client = new RpcProtocolClient({ child: fake.child })
  let result: unknown
  const pending = client.send({ type: "prompt", message: "work" }).then((value) => { result = value }, (error) => { result = error })
  const command = fake.commands[0]!
  fake.emit({ type: "queued", for_request: command.id })
  await clock.advance(30_000)
  expect(result).toBeUndefined()
  fake.emit({ type: "queued", for_request: command.id })
  await clock.advance(270_000)
  expect(result).toMatchObject({ name: "RpcRequestTimeout", command: "prompt", deadlineMs: 300_000 })
  await pending
  fake.respond(command)
  expect(result).toMatchObject({ name: "RpcRequestTimeout" })
  expect(clock.pending()).toBe(0)
})

test("#given explicit and default request budgets #when requests answer or exit #then every deadline is cleared", async () => {
  clock = fakeClock()
  const fake = silentChild()
  const client = new RpcProtocolClient({ child: fake.child })
  const result = client.send({ type: "get_state" }).catch((error: unknown) => error)
  await clock.advance(10_000)
  expect(await result).toMatchObject({ name: "RpcRequestTimeout", command: "get_state", deadlineMs: 10_000 })
  expect(await result).toMatchObject({ message: expect.stringMatching(/Action: /) })
  const answered = client.send({ type: "get_state" })
  fake.respond()
  expect((await answered).success).toBe(true)
  const custom = client.send({ type: "get_entries" }, { deadlineMs: 17 }).catch((error: unknown) => error)
  await clock.advance(17)
  expect(await custom).toMatchObject({ name: "RpcRequestTimeout", command: "get_entries", deadlineMs: 17 })
  const exited = client.send({ type: "get_entries" }).catch((error: unknown) => error)
  fake.child.emit("close", 0, null)
  expect(await exited).toBeInstanceOf(Error)
  expect(clock.pending()).toBe(0)
})

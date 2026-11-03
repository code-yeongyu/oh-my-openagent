import { afterEach, expect, test } from "bun:test"
import { childOpenInput, sessionClientHarness } from "./session-client.test-support"

const harness = sessionClientHarness()
afterEach(harness.release)

test("host catalog uses the existing get_available_models wire command", async () => {
  // given
  const host = await harness.fakeHost()
  const client = harness.hostClient(host)
  await client.open(childOpenInput("/tmp/catalog-session.jsonl"))
  // when
  const catalog = await client.getAvailableModels()
  // then
  expect(catalog).toEqual([])
  expect(host.commands.filter(command => command.type === "get_available_models")).toHaveLength(1)
})

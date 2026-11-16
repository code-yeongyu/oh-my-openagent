import { test } from "bun:test"
import { buildRemoteSdk } from "./build-remote-sdk"

test("the omo-ai/remote bundle and its declarations match their source", async () => {
  await buildRemoteSdk(true)
}, 120_000)

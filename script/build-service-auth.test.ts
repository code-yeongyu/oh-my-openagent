import { test } from "bun:test"
import { buildServiceAuth } from "./build-service-auth"

test("the native auth bundle matches its source", async () => {
  await buildServiceAuth(true)
})

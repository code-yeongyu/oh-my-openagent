import { expect, test } from "bun:test"

test("Windows safe-base lookup prefers exact uppercase and declared keys replace every variant", async () => {
  // given
  const { resolveProjectEnvironment } = await import("./project-env-policy")
  const ambient = { Path: "lower-path", PATH: "upper-path", LC_PRIVATE_LOCALE: "synthetic-private", HTTPS_PROXY: "synthetic-proxy" }
  // when
  const inherited = resolveProjectEnvironment({ command: "synthetic" }, [], {}, ambient, "win32")
  const declared = resolveProjectEnvironment({
    command: "synthetic", env: { Path: "declared-path", NPM_CONFIG_EXPLICIT: "explicit-value" },
  }, [], {}, ambient, "win32")
  // then
  expect(inherited.env.PATH).toBe("upper-path")
  expect(inherited.env.Path).toBeUndefined()
  expect(declared.env.Path).toBe("declared-path")
  expect(declared.env.PATH).toBeUndefined()
  expect(declared.env.NPM_CONFIG_EXPLICIT).toBe("explicit-value")
  expect(inherited.withheld).toEqual(["HTTPS_PROXY", "LC_PRIVATE_LOCALE"])
})

test("project environment applies safe base then grants then explicit values then declared values", async () => {
  // given
  const { resolveProjectEnvironment } = await import("./project-env-policy")
  const ambient = { HOME: "ambient-home", OPAQUE: "ambient-opaque", PNPM_PRIVATE: "ambient-package", LC_PRIVATE_LOCALE: "ambient-locale" }
  // when
  const result = resolveProjectEnvironment({
    command: "synthetic", env: { OPAQUE: "declared-opaque", PNPM_PRIVATE: "declared-package" },
  }, ["OPAQUE", "PNPM_PRIVATE"], { HOME: "caller-home", OPAQUE: "caller-opaque" }, ambient)
  // then
  expect(result.env).toEqual({ HOME: "caller-home", OPAQUE: "declared-opaque", PNPM_PRIVATE: "declared-package" })
  expect(result.withheld).toEqual(["LC_PRIVATE_LOCALE"])
})

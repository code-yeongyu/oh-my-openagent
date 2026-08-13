import { afterEach, describe, expect, it } from "bun:test"

import {
  ULW_LOOP_SESSION_ENV_KEY,
  SenpiUlwSessionScope,
  extractSenpiSessionId,
  normalizeSenpiUlwScopeId,
  resolveSenpiUlwSessionId,
} from "./session-scope"
import { withEnv, withEnvAsync } from "./ulw-loop.test-support"

describe("omo-senpi ulw-loop session scope", () => {
  afterEach(() => {
    delete process.env[ULW_LOOP_SESSION_ENV_KEY]
  })

  it("#given a sessionManager with a session id #when extracting #then the raw id is returned", () => {
    expect(extractSenpiSessionId({ sessionManager: { getSessionId: () => "019ffa5f-74a2" } })).toBe("019ffa5f-74a2")
  })

  it("#given a host without a sessionManager #when extracting #then undefined is returned", () => {
    expect(extractSenpiSessionId({ cwd: "/repo" })).toBeUndefined()
    expect(extractSenpiSessionId(null)).toBeUndefined()
    expect(extractSenpiSessionId({ sessionManager: {} })).toBeUndefined()
  })

  it("#given a raw session id #when normalizing #then a filesystem-safe senpi-prefixed scope is produced", () => {
    expect(normalizeSenpiUlwScopeId("019ffa5f-74a2-7929")).toBe("senpi-019ffa5f-74a2-7929")
    expect(normalizeSenpiUlwScopeId("A/B")).toBe("senpi-A-B")
    expect(normalizeSenpiUlwScopeId("a b")).toBe("senpi-a-b")
    expect(normalizeSenpiUlwScopeId("../../etc")).toBe("senpi-etc")
    expect(normalizeSenpiUlwScopeId("  ")).toBeNull()
  })

  it("#given a session id #when resolving #then the scoped id is returned", () => {
    expect(resolveSenpiUlwSessionId({ sessionManager: { getSessionId: () => "ABC" } })).toBe("senpi-ABC")
  })

  it("#given no session identity #when resolving #then null is returned (fail-closed)", () => {
    expect(resolveSenpiUlwSessionId({ cwd: "/repo" })).toBeNull()
  })

  it("#given a scope manager #when activating #then the env var is set to the scope", () => {
    withEnv({ [ULW_LOOP_SESSION_ENV_KEY]: undefined }, () => {
      const scope = new SenpiUlwSessionScope()
      scope.activate("senpi-A")
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("senpi-A")
    })
  })

  it("#given an external env value #when activating and clearing #then the external value is restored", () => {
    withEnv({ [ULW_LOOP_SESSION_ENV_KEY]: "external" }, () => {
      const scope = new SenpiUlwSessionScope()
      scope.activate("senpi-A")
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("senpi-A")
      scope.clear()
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("external")
    })
  })

  it("#given no prior env value #when activating and clearing #then the env var is removed", () => {
    withEnv({ [ULW_LOOP_SESSION_ENV_KEY]: undefined }, () => {
      const scope = new SenpiUlwSessionScope()
      scope.activate("senpi-A")
      scope.clear()
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBeUndefined()
    })
  })

  it("#given the env was externally replaced #when clearing #then the external value is left alone", () => {
    withEnv({ [ULW_LOOP_SESSION_ENV_KEY]: undefined }, () => {
      const scope = new SenpiUlwSessionScope()
      scope.activate("senpi-A")
      process.env[ULW_LOOP_SESSION_ENV_KEY] = "senpi-B"
      scope.clear()
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("senpi-B")
    })
  })

  it("#given a re-activation with a new scope #when clearing #then the ORIGINAL prior value is restored", async () => {
    await withEnvAsync({ [ULW_LOOP_SESSION_ENV_KEY]: "external" }, async () => {
      const scope = new SenpiUlwSessionScope()
      scope.activate("senpi-A")
      scope.activate("senpi-B")
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("senpi-B")
      scope.clear()
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("external")
    })
  })

  it("#given a null scope #when activating #then the env is cleared without claiming a foreign value", () => {
    withEnv({ [ULW_LOOP_SESSION_ENV_KEY]: undefined }, () => {
      const scope = new SenpiUlwSessionScope()
      scope.activate("senpi-A")
      process.env[ULW_LOOP_SESSION_ENV_KEY] = "foreign"
      scope.activate(null)
      expect(process.env[ULW_LOOP_SESSION_ENV_KEY]).toBe("foreign")
    })
  })
})

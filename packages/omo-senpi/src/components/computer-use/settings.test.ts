import { expect, test } from "bun:test"

import { resolveComputerEngineEnv, resolveOmoComputerSettings } from "./settings"

test("#given direct engine settings with forbidden overrides #when resolving the child environment #then only GUI keys change and inherited values remain untouched", () => {
  // given
  const parent = { DISPLAY: ":7", WAYLAND_DISPLAY: "old", PATH: "/parent/bin", OTHER: "inherited" }
  const settings = resolveOmoComputerSettings({
    env: { DISPLAY: ":98", XAUTHORITY: "${HOME}/literal", XDG_RUNTIME_DIR: "/run/user/1000", WAYLAND_DISPLAY: null },
  }, "linux")
  // when
  const env = resolveComputerEngineEnv({
    ...settings.env, LD_PRELOAD: "/private/secret.so", PATH: "/project/bin", OTHER: null,
  }, parent)
  // then
  expect(env).toStrictEqual({
    DISPLAY: ":98", XAUTHORITY: "${HOME}/literal", XDG_RUNTIME_DIR: "/run/user/1000",
    WAYLAND_DISPLAY: undefined, PATH: "/parent/bin", OTHER: "inherited",
  })
  expect(parent).toEqual({ DISPLAY: ":7", WAYLAND_DISPLAY: "old", PATH: "/parent/bin", OTHER: "inherited" })
})

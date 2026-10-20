import { expect, mock, test } from "bun:test"

mock.module("node:os", () => {
  const actual = require("node:os")
  return {
    ...actual,
    userInfo: () => {
      throw Object.assign(new Error("uv_os_get_passwd returned ENOENT"), { code: "ERR_SYSTEM_ERROR" })
    },
  }
})

test("#given an account without a passwd record #when loading the loader #then it does not require os.userInfo()", async () => {
  // given
  const loaderPath = new URL("./paths.ts", import.meta.url).pathname

  // when
  const loaded = await import(loaderPath)

  // then
  expect(typeof loaded.resolveOmoConfigPaths).toBe("function")
})

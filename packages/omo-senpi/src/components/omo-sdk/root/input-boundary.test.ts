import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { createThreadSdk } from "../../thread/sdk"
import type { GatewayStore } from "../../thread/gateway/store"
import { assembleOmoSdk } from "../assembly"

// Design lane ruling on the drivers' differences: the root validates every call's input against its schema at the
// boundary and refuses before any port; a store extension's module URL is checked there too. The shipped thread facade
// keeps registering what it registered.
const recordingStore = () => {
  const registered: unknown[] = []
  const store = {
    registerStoreExtension: async (extension: unknown) => {
      registered.push(extension)
      return { kind: "ok", value: undefined }
    },
    dispose: async () => undefined,
  } as unknown as GatewayStore
  return { store, registered }
}

const touched: string[] = []
const root = () =>
  assembleOmoSdk(
    {
      env: { OMO_SERVICE_API_URL: "https://accounts.example.test" },
      cwd: tmpdir(),
      agentDir: tmpdir(),
      ports: {
        desktopLaunch: () => false,
        session: {
          accessToken: async () => "t",
          request: async (path: string) => {
            touched.push(path)
            return {}
          },
        },
      },
    },
    {},
  )

describe("the root's input boundary", () => {
  test("#given devices.rename without its name #when it is called #then it answers invalid_arguments and no request leaves", async () => {
    touched.length = 0
    expect(await root().devices.rename({ id: "dev-2" } as never)).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments" },
    })
    expect(touched).toEqual([])
  })

  test("#given a store extension with a relative module URL #when the root registers it #then it is refused before the store, while the shipped facade still forwards it", async () => {
    const extension = {
      name: "chat",
      migrations: [["create table t (id)"]],
      moduleUrl: "relative.js",
      sessionCallable: [],
    }
    const onRoot = recordingStore()
    const sdk = assembleOmoSdk({ cwd: tmpdir(), agentDir: tmpdir(), ports: { store: onRoot.store } }, {})
    expect(await sdk.threads.extensions.register(extension as never)).toMatchObject({
      kind: "error",
      error: { code: "invalid_arguments", details: { field: "moduleUrl" } },
    })
    expect(onRoot.registered).toEqual([])
    const onFacade = recordingStore()
    const facade = createThreadSdk({
      agentDir: tmpdir(),
      cwd: tmpdir(),
      uid: 501,
      user: "qa-user",
      store: onFacade.store,
    })
    await facade.registerStoreExtension(extension as never)
    expect(onFacade.registered).toHaveLength(1)
  })
})

import { describe, expect, it } from "bun:test"

import { readJobWidgetHost, type JobWidgetAuthorResolver, type JobWidgetSourceRegistration } from "./job-widget-host"

class FakeTap {
  readonly appended: string[] = []
  constructor(readonly id: string, readonly label: string) {}
  append(text: string): void { this.appended.push(text) }
  close(): void {}
  read(from: number) { return { start: from, end: from, text: "", open: true } }
}

describe("senpi job widget API feature detection", () => {
  it("#given a senpi module without the job widget exports #when it is read #then neither the author route nor task sources are offered", () => {
    // when
    const host = readJobWidgetHost({ createAgentSession: () => undefined })

    // then
    expect(host.setAuthorResolver).toBeUndefined()
    expect(host.sources).toBeUndefined()
  })

  it("#given registerJobWidgetSource without TextTap #when it is read #then task sources stay off because no tap can feed them", () => {
    // when
    const host = readJobWidgetHost({ registerJobWidgetSource: () => undefined, setJobWidgetAuthorResolver: () => () => {} })

    // then
    expect(host.sources).toBeUndefined()
    expect(host.setAuthorResolver).toBeDefined()
  })

  it("#given a senpi module with the job widget exports #when it is read #then calls reach senpi's own functions and taps are senpi TextTaps", () => {
    // given
    const registrations: JobWidgetSourceRegistration[] = []
    const routes: (JobWidgetAuthorResolver | undefined)[] = []
    const handle = { notify() {}, update() {}, settle() {}, dispose() {} }
    const withdraw = () => {}
    const module = {
      registerJobWidgetSource: (registration: JobWidgetSourceRegistration) => {
        registrations.push(registration)
        return handle
      },
      setJobWidgetAuthorResolver: (resolver: JobWidgetAuthorResolver | undefined) => {
        routes.push(resolver)
        return withdraw
      },
      TextTap: FakeTap,
    }

    // when
    const host = readJobWidgetHost(module)
    const tap = host.sources?.createTap("tools", "label")
    const route: JobWidgetAuthorResolver = () => undefined
    const returnedWithdraw = host.setAuthorResolver?.(route)
    const returnedHandle = tap === undefined ? undefined : host.sources?.register({ sessionId: "s", id: "st_1", kind: "task", sources: [tap], brief: {} })

    // then
    expect(tap).toBeInstanceOf(FakeTap)
    expect(tap?.id).toBe("tools")
    expect(returnedHandle).toBe(handle)
    expect(registrations.map((entry) => entry.id)).toEqual(["st_1"])
    expect(routes).toEqual([route])
    expect(returnedWithdraw).toBe(withdraw)
  })
})

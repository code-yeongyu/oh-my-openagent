import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "node:events"
import { raiseEventEmitterLimit, __resetRaisedFlagForTests } from "./raise-event-emitter-limit"

const ORIGINAL_DEFAULT = EventEmitter.defaultMaxListeners

beforeEach(() => {
  EventEmitter.defaultMaxListeners = ORIGINAL_DEFAULT
  __resetRaisedFlagForTests()
})

afterEach(() => {
  EventEmitter.defaultMaxListeners = ORIGINAL_DEFAULT
  __resetRaisedFlagForTests()
})

describe("raiseEventEmitterLimit", () => {
  test("raises EventEmitter.defaultMaxListeners when below target", () => {
    //#given
    EventEmitter.defaultMaxListeners = 10

    //#when
    raiseEventEmitterLimit(100)

    //#then
    expect(EventEmitter.defaultMaxListeners).toBe(100)
  })

  test("does not lower the default when already above target", () => {
    //#given
    EventEmitter.defaultMaxListeners = 200

    //#when
    raiseEventEmitterLimit(100)

    //#then
    expect(EventEmitter.defaultMaxListeners).toBe(200)
  })

  test("is idempotent across multiple calls", () => {
    //#given
    EventEmitter.defaultMaxListeners = 10

    //#when
    raiseEventEmitterLimit(100)
    EventEmitter.defaultMaxListeners = 5
    raiseEventEmitterLimit(100)

    //#then
    expect(EventEmitter.defaultMaxListeners).toBe(5)
  })

  test("defaults to 100 when no target is given", () => {
    //#given
    EventEmitter.defaultMaxListeners = 10

    //#when
    raiseEventEmitterLimit()

    //#then
    expect(EventEmitter.defaultMaxListeners).toBe(100)
  })
})

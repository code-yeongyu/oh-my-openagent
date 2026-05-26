import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { EventEmitter } from "node:events"
import { raiseEventEmitterLimit, __resetRaisedFlagForTests } from "./raise-event-emitter-limit"

const ORIGINAL_DEFAULT = EventEmitter.defaultMaxListeners
const ORIGINAL_PROCESS_MAX = process.getMaxListeners()

beforeEach(() => {
  EventEmitter.defaultMaxListeners = ORIGINAL_DEFAULT
  process.setMaxListeners(ORIGINAL_PROCESS_MAX)
  __resetRaisedFlagForTests()
})

afterEach(() => {
  EventEmitter.defaultMaxListeners = ORIGINAL_DEFAULT
  process.setMaxListeners(ORIGINAL_PROCESS_MAX)
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

  test("preserves EventEmitter.defaultMaxListeners === 0 (unlimited)", () => {
    //#given a host that explicitly disabled the listener warning
    EventEmitter.defaultMaxListeners = 0

    //#when
    raiseEventEmitterLimit(100)

    //#then it stays unlimited; we do not silently downgrade to 100
    expect(EventEmitter.defaultMaxListeners).toBe(0)
  })

  test("preserves process.getMaxListeners() === 0 (unlimited)", () => {
    //#given
    EventEmitter.defaultMaxListeners = 10
    process.setMaxListeners(0)

    //#when
    raiseEventEmitterLimit(100)

    //#then process stays unlimited; defaultMaxListeners still raises independently
    expect(process.getMaxListeners()).toBe(0)
    expect(EventEmitter.defaultMaxListeners).toBe(100)
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

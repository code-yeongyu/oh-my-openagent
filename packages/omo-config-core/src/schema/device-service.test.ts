import { describe, expect, test } from "bun:test"

import { isOmoDeviceServiceEnabled, OmoConfigLayerSchema, OmoConfigSchema } from "../index"

// D1 (#12051): the device service bootstrap is on by default; `device_service.enabled: false` turns the whole
// start-up bootstrap off (no install, no connect).
describe("omo config device_service section", () => {
  test("#given no device_service section #when resolved #then the bootstrap is on", () => {
    const result = OmoConfigSchema.parse({})
    expect(isOmoDeviceServiceEnabled(result)).toBe(true)
  })

  test("#given device_service.enabled false #when resolved #then the bootstrap is off", () => {
    const result = OmoConfigSchema.parse({ device_service: { enabled: false } })
    expect(isOmoDeviceServiceEnabled(result)).toBe(false)
  })

  test("#given an empty device_service section #when parsed #then enabled defaults to true", () => {
    expect(OmoConfigSchema.parse({ device_service: {} }).device_service?.enabled).toBe(true)
  })

  test("#given a layer, a [senpi] override and a profile #when parsed #then each accepts the key and rejects strays", () => {
    expect(OmoConfigLayerSchema.safeParse({ device_service: {} }).data?.device_service).toEqual({})
    expect(OmoConfigSchema.safeParse({ "[senpi]": { device_service: { enabled: false } } }).success).toBe(true)
    expect(OmoConfigSchema.safeParse({ profiles: { work: { device_service: { enabled: false } } } }).success).toBe(true)
    expect(OmoConfigSchema.safeParse({ device_service: { enabled: "no" } }).success).toBe(false)
    expect(OmoConfigSchema.safeParse({ device_service: { install: false } }).success).toBe(false)
  })
})

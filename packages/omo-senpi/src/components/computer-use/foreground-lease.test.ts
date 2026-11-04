/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { ControlConfirmRequest } from "@oh-my-opencode/senpi-desktop-tool"

import { createForegroundLease, leasedConfirmControl, type LeaseOwner } from "./lease"

const scopeA: LeaseOwner = { issuer: "session-a", scope: "scope-a" }
const scopeB: LeaseOwner = { issuer: "session-b", scope: "scope-b" }

function request(): ControlConfirmRequest {
  return { context: { hasUI: false } as ControlConfirmRequest["context"], reason: "click Run", signal: new AbortController().signal, budgetMs: 60_000 }
}

function consent(answer: boolean): { readonly asked: number[]; readonly confirm: (request: ControlConfirmRequest) => Promise<boolean> } {
  const asked: number[] = []
  return { asked, confirm: () => { asked.push(1); return Promise.resolve(answer) } }
}

describe("foreground lease between sessions on one device (O1c)", () => {
  test("MULTI #given scope A holds the foreground #when scope B acquires #then B is refused before its consent is asked and A keeps the lease", async () => {
    // given
    const lease = createForegroundLease()
    const b = consent(true)
    expect(await leasedConfirmControl(consent(true).confirm, lease, () => scopeA)(request())).toBe(true)

    // when
    const granted = await leasedConfirmControl(b.confirm, lease, () => scopeB)(request())

    // then
    expect(granted).toBe(false)
    expect(b.asked).toHaveLength(0)
    expect(lease.holder()).toEqual(scopeA)
  })

  test("MULTI #given scope A holds the foreground #when scope B releases #then A's lease is untouched", () => {
    // given
    const lease = createForegroundLease()
    lease.acquire(scopeA)

    // when
    lease.release(scopeB)

    // then
    expect(lease.holder()).toEqual(scopeA)
  })

  test("MULTI #given scope A released the foreground #when scope B acquires #then B is granted", async () => {
    // given
    const lease = createForegroundLease()
    lease.acquire(scopeA)
    lease.release(scopeA)

    // when
    const granted = await leasedConfirmControl(consent(true).confirm, lease, () => scopeB)(request())

    // then
    expect(granted).toBe(true)
    expect(lease.holder()).toEqual(scopeB)
  })

  test("#given the holder acquires again #when it asks #then it is re-granted without a second owner", () => {
    // given
    const lease = createForegroundLease()
    lease.acquire(scopeA)

    // when
    const again = lease.acquire({ ...scopeA })

    // then
    expect(again).toEqual({ granted: true })
    expect(lease.holder()).toEqual(scopeA)
  })

  test("#given a free foreground #when the scope's own consent refuses #then nothing is held", async () => {
    // given
    const lease = createForegroundLease()

    // when
    const granted = await leasedConfirmControl(consent(false).confirm, lease, () => scopeA)(request())

    // then
    expect(granted).toBe(false)
    expect(lease.holder()).toBeUndefined()
  })

  test("MULTI #given the same scope id under another issuer #when it acquires a held lease #then it is refused", () => {
    // given
    const lease = createForegroundLease()
    lease.acquire(scopeA)

    // when
    const other = lease.acquire({ issuer: "session-c", scope: scopeA.scope })

    // then
    expect(other).toEqual({ granted: false, heldBy: scopeA })
  })
})

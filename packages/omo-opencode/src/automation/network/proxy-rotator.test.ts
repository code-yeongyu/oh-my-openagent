import { describe, test, expect } from "bun:test"
import { ProxyRotator, type ProxyConfig } from "./proxy-rotator"

const A: ProxyConfig = { server: "http://a:8000", label: "a" }
const B: ProxyConfig = { server: "http://b:8000", label: "b" }
const C: ProxyConfig = { server: "http://c:8000", label: "c" }

describe("ProxyRotator", () => {
  describe("constructor", () => {
    test("#given empty proxies #when constructed #then throws", () => {
      expect(() => new ProxyRotator({ proxies: [] })).toThrow(/at least one/)
    })

    test("#given default strategy #when reading #then cyclic", () => {
      const r = new ProxyRotator({ proxies: [A] })
      expect(r.next().label).toBe("a")
    })
  })

  describe("cyclic strategy", () => {
    test("#given 3 proxies #when next() called 5 times #then round-robins through all", () => {
      const r = new ProxyRotator({ proxies: [A, B, C], strategy: "cyclic" })
      const seq = [r.next(), r.next(), r.next(), r.next(), r.next()].map(p => p.label)
      expect(seq).toEqual(["a", "b", "c", "a", "b"])
    })
  })

  describe("random strategy", () => {
    test("#given 3 proxies #when next() called many times #then visits each at least once", () => {
      const r = new ProxyRotator({ proxies: [A, B, C], strategy: "random" })
      const seen = new Set<string>()
      for (let i = 0; i < 200; i++) {
        seen.add(r.next().label!)
      }
      expect(seen.size).toBe(3)
    })
  })

  describe("sticky-by-host strategy", () => {
    test("#given same host #when next() called twice #then returns same proxy", () => {
      const r = new ProxyRotator({ proxies: [A, B, C], strategy: "sticky-by-host" })
      const first = r.next("example.com")
      const second = r.next("example.com")
      expect(second.label).toBe(first.label)
    })

    test("#given different hosts #when next() called #then sticky proxies can differ", () => {
      const r = new ProxyRotator({ proxies: [A, B, C], strategy: "sticky-by-host" })
      const stickyByHost = new Map<string, string>()
      for (let i = 0; i < 50; i++) {
        const host = `host-${i % 5}.com`
        const p = r.next(host)
        const prev = stickyByHost.get(host)
        if (prev) expect(prev).toBe(p.label!)
        else stickyByHost.set(host, p.label!)
      }
      expect(stickyByHost.size).toBe(5)
    })
  })

  describe("markBad / healthy", () => {
    test("#given bad proxy #when next() called #then it is skipped", () => {
      const r = new ProxyRotator({ proxies: [A, B, C], strategy: "cyclic" })
      r.markBad(B, "auth failure")
      const seq = [r.next(), r.next(), r.next(), r.next()].map(p => p.label)
      expect(seq).toEqual(["a", "c", "a", "c"])
    })

    test("#given all proxies bad #when next() called #then throws", () => {
      const r = new ProxyRotator({ proxies: [A], strategy: "cyclic" })
      r.markBad(A)
      expect(() => r.next()).toThrow(/no healthy/)
    })

    test("#given sticky proxy marked bad #when next() called for same host #then re-picks a new sticky proxy", () => {
      const r = new ProxyRotator({ proxies: [A, B, C], strategy: "sticky-by-host" })
      const initial = r.next("example.com")
      r.markBad(initial)
      const after = r.next("example.com")
      expect(after.label).not.toBe(initial.label)
    })

    test("#given markHealthy after markBad #when next() called #then proxy is reachable again", () => {
      const r = new ProxyRotator({ proxies: [A, B], strategy: "cyclic" })
      r.markBad(A)
      r.markHealthy(A)
      const seq = [r.next(), r.next()].map(p => p.label)
      expect(seq.sort()).toEqual(["a", "b"])
    })

    test("#given blocked proxy #when next called inside cooldown #then it is skipped", () => {
      const r = new ProxyRotator({ proxies: [A, B], strategy: "cyclic" })
      r.markBlocked(A, "silent_rejection")

      expect(r.next().label).toBe("b")
      expect(r.bad()[0]?.reason).toBe("silent_rejection")
    })

    test("#given blocked proxy cooldown expired #when next called #then cleanup makes it healthy again", () => {
      const r = new ProxyRotator({ proxies: [A, B], strategy: "cyclic", blockedTtlMs: 1 })
      r.markBlocked(A, "rate_limit")

      const start = Date.now()
      while (Date.now() - start < 3) {}

      expect(r.healthy().map((proxy) => proxy.label).sort()).toEqual(["a", "b"])
    })
  })

  describe("stats", () => {
    test("#given mixed bad/healthy #when stats read #then correct counts", () => {
      const r = new ProxyRotator({ proxies: [A, B, C] })
      r.markBad(B)
      const s = r.stats()
      expect(s.total).toBe(3)
      expect(s.healthy).toBe(2)
      expect(s.bad).toBe(1)
    })
  })

  describe("bad()", () => {
    test("#given bad proxy with reason #when bad() called #then returns entry with reason", () => {
      const r = new ProxyRotator({ proxies: [A, B] })
      r.markBad(A, "timeout")
      const list = r.bad()
      expect(list).toHaveLength(1)
      expect(list[0]?.reason).toBe("timeout")
      expect(list[0]?.failedAt).toBeGreaterThan(0)
    })
  })
})

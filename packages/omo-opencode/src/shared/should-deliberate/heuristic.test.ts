import { describe, test, expect } from "bun:test"

import { shouldDeliberate } from "./heuristic"

describe("shouldDeliberate", () => {
  describe("#given disabled context", () => {
    test("#when called with enabled=false #then returns trigger=false", () => {
      const result = shouldDeliberate(
        "Should we use Postgres vs MySQL for the new service?",
        { enabled: false },
      )
      expect(result.trigger).toBe(false)
      expect(result.reason).toContain("disabled")
    })
  })

  describe("#given empty or trivial input", () => {
    test("#when empty string #then returns trigger=false", () => {
      const result = shouldDeliberate("")
      expect(result.trigger).toBe(false)
    })

    test("#when whitespace #then returns trigger=false", () => {
      const result = shouldDeliberate("   \n\t  ")
      expect(result.trigger).toBe(false)
    })

    test("#when simple question #then returns trigger=false", () => {
      const result = shouldDeliberate("What does the git status command do?")
      expect(result.trigger).toBe(false)
    })

    test("#when implementation request #then returns trigger=false", () => {
      const result = shouldDeliberate("Add a dark mode toggle to the settings page")
      expect(result.trigger).toBe(false)
    })

    test("#when single-option question #then returns trigger=false", () => {
      const result = shouldDeliberate("How do I use Postgres for this service?")
      expect(result.trigger).toBe(false)
    })
  })

  describe("#given competing options (versus marker)", () => {
    test("#when 'X vs Y' phrasing #then returns trigger=true with competing-options reason", () => {
      const result = shouldDeliberate("Should we pick Postgres vs MySQL for the new service?")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/competing.options|versus/i)
    })

    test("#when 'X versus Y' phrasing #then returns trigger=true", () => {
      const result = shouldDeliberate("Discuss REST versus GraphQL for our API layer.")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/competing.options|versus/i)
    })

    test("#when option-or-option question #then returns trigger=true", () => {
      const result = shouldDeliberate("Should we go with Redis or Memcached for the session cache?")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/competing.options|versus/i)
    })
  })

  describe("#given conflicting constraints", () => {
    test("#when cost vs quality mentioned #then returns trigger=true", () => {
      const result = shouldDeliberate("We need to balance cost and quality on this deploy.")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/conflicting.constraints/i)
    })

    test("#when speed vs safety mentioned #then returns trigger=true", () => {
      const result = shouldDeliberate("Ship fast but also keep the system safe for production.")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/conflicting.constraints/i)
    })

    test("#when latency vs accuracy mentioned #then returns trigger=true", () => {
      const result = shouldDeliberate("How do we trade latency against accuracy in the ranker?")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/conflicting.constraints/i)
    })

    test("#when only one constraint keyword #then returns trigger=false", () => {
      const result = shouldDeliberate("How do we keep latency low on this endpoint?")
      expect(result.trigger).toBe(false)
    })
  })

  describe("#given ethical / safety / risk signals", () => {
    test("#when 'is it ok to' + option marker #then returns trigger=true", () => {
      const result = shouldDeliberate("Is it ok to deploy or rollback this change today?")
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/ethical|safety|risk/i)
    })

    test("#when irreversible + competing options #then returns trigger=true", () => {
      const result = shouldDeliberate(
        "Should we delete the legacy table or migrate it - this is irreversible.",
      )
      expect(result.trigger).toBe(true)
      expect(result.reason).toMatch(/ethical|safety|risk/i)
    })

    test("#when risk marker without option marker #then returns trigger=false", () => {
      const result = shouldDeliberate("There is a risk that the build breaks tomorrow.")
      expect(result.trigger).toBe(false)
    })
  })

  describe("#given negative cases / false-positive guards", () => {
    test("#when 'fix bug X or fix bug Y' implementation request #then returns trigger=false", () => {
      const result = shouldDeliberate("Fix the parsing bug and also fix the lint error.")
      expect(result.trigger).toBe(false)
    })

    test("#when long prose with 'or' but no comparison #then returns trigger=false", () => {
      const result = shouldDeliberate(
        "Today the user asked about the docs or the README, just helping them find files.",
      )
      expect(result.trigger).toBe(false)
    })

    test("#when 'vs' inside identifier #then returns trigger=false", () => {
      const result = shouldDeliberate("Update the vsCodeSettings export in the config file.")
      expect(result.trigger).toBe(false)
    })
  })

  describe("#given the result shape contract", () => {
    test("#when called #then result has trigger:boolean and reason:string", () => {
      const result = shouldDeliberate("hello")
      expect(typeof result.trigger).toBe("boolean")
      expect(typeof result.reason).toBe("string")
      expect(result.reason.length).toBeGreaterThan(0)
    })

    test("#when triggered #then reason is non-empty and explains the signal", () => {
      const result = shouldDeliberate("Postgres vs MySQL: which should we use?")
      expect(result.trigger).toBe(true)
      expect(result.reason.length).toBeGreaterThan(5)
    })
  })
})

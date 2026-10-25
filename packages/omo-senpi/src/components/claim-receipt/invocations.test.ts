/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"

import { type InvokedKind, invokedKinds } from "./invocations"

const PREVIOUSLY_RECOGNISED: ReadonlyArray<readonly [string, InvokedKind]> = [
  ["bun test", "test"],
  ["bun run test", "test"],
  ["vitest run", "test"],
  ["jest --ci", "test"],
  ["pytest -q", "test"],
  ["cargo test", "test"],
  ["go test ./...", "test"],
  ["deno test", "test"],
  ["playwright test", "test"],
  ["npm test", "test"],
  ["npm run test", "test"],
  ["pnpm test", "test"],
  ["pnpm run test", "test"],
  ["yarn test", "test"],
  ["yarn run test", "test"],
  ["bun run test:senpi", "test"],
  ["gh pr checks 12", "test"],
  ["vp test", "test"],
  ["vp run --filter server test", "test"],
  ["tsc --noEmit", "typecheck"],
  ["tsgo --noEmit -p x", "typecheck"],
  ["bun run typecheck", "typecheck"],
  ["bun run type-check", "typecheck"],
  ["mypy src", "typecheck"],
  ["pyright", "typecheck"],
  ["cargo check", "typecheck"],
  ["biome check .", "lint"],
  ["eslint .", "lint"],
  ["oxlint", "lint"],
  ["ruff check", "lint"],
  ["cargo clippy", "lint"],
  ["bun run lint", "lint"],
  ["bun build src/index.ts", "build"],
  ["cargo build", "build"],
  ["go build ./...", "build"],
  ["vite build", "build"],
  ["next build", "build"],
  ["bun run build", "build"],
  ["npm run build", "build"],
  ["pnpm run build:senpi-plugin", "build"],
  ["yarn run build", "build"],
  ["bun packages/omo-senpi/scripts/qa/claim-receipt-e2e.mjs out", "run"],
  ["node scripts/qa/drive.mjs --self-test", "run"],
]

describe("claim-receipt invocations", () => {
  describe("#given every check form the previous substring table recognised", () => {
    it.each(PREVIOUSLY_RECOGNISED)("#then %p is still read as a %p run", (command, kind) => {
      expect(invokedKinds(command)).toContain(kind)
    })

    it("#then vp check covers both typecheck and lint", () => {
      expect(invokedKinds("vp check")).toEqual(["typecheck", "lint"])
    })
  })

  describe("#given checks run remotely, in a loop or through CI readouts", () => {
    it("#then the remote command of ssh is parsed", () => {
      expect(invokedKinds("ssh -o BatchMode=yes -p 22 mengmota 'cd w && bun test x'")).toEqual(["test"])
      expect(invokedKinds("ssh host cd w '&&' tsgo --noEmit")).toEqual(["typecheck"])
      expect(invokedKinds("ssh host uptime")).toEqual([])
    })

    it("#then command substitution, subshells and loop keywords reach the check", () => {
      expect(invokedKinds("for i in 1 2; do out=$(gh pr checks 213 --repo o/r 2>/dev/null); done")).toEqual(["test"])
      expect(invokedKinds("(cd w && bun test x)")).toEqual(["test"])
      expect(invokedKinds("if bun run typecheck; then echo ok; fi")).toEqual(["typecheck"])
    })

    it("#then value-taking wrapper flags, ssh --, backticks and here-strings do not hide the check", () => {
      expect(invokedKinds("env -u FOO bun test x")).toEqual(["test"])
      expect(invokedKinds("sudo -u bob bun test x")).toEqual(["test"])
      expect(invokedKinds("ssh host -- bun test x")).toEqual(["test"])
      expect(invokedKinds("x=`bun test x`")).toEqual(["test"])
      expect(invokedKinds("read a <<< foo\nbun test x")).toEqual(["test"])
      expect(invokedKinds('echo "<<EOF"\nbun test x')).toEqual(["test"])
      expect(invokedKinds("env -S 'bun test x'")).toEqual(["test"])
      expect(invokedKinds("sudo -c cls -R /root bun test x")).toEqual(["test"])
      expect(invokedKinds("cat > f <<'EOF' # it's the script\nbun test x\nEOF")).not.toContain("test")
      expect(invokedKinds("echo hi # it's a note\nbun test x")).toEqual(["test"])
    })

    it("#then CI status readouts count as test runs", () => {
      expect(invokedKinds("gh run view 123 --log-failed")).toEqual(["test"])
      expect(invokedKinds("gh run watch 123")).toEqual(["test"])
      expect(invokedKinds("gh pr view 9 --json statusCheckRollup")).toEqual(["test"])
      expect(invokedKinds("gh pr view 9 --json state")).toEqual([])
    })
  })
})

import type { GoldenCase, Service, Step } from "./account-goldens.test-support"

type Shape = Omit<GoldenCase, "id" | "steps" | "service" | "store"> & {
  readonly store?: GoldenCase["store"]
  readonly service?: Service
}

const one = (id: string, shape: Shape, ...args: string[]): GoldenCase => ({
  id,
  store: "empty",
  service: "approve",
  ...shape,
  steps: [{ args }],
})
const many = (id: string, shape: Shape, steps: readonly Step[]): GoldenCase => ({
  id,
  store: "empty",
  service: "approve",
  ...shape,
  steps,
})

const closed = (edition: GoldenCase["edition"]): Shape => ({ edition, accounts: "closed" })
const open = (edition: GoldenCase["edition"]): Shape => ({ edition, accounts: "open" })
const seeded = (shape: Shape): Shape => ({ ...shape, store: "seeded" })
const serving = (shape: Shape, service: Service): Shape => ({ ...shape, service })

const serviceAuthCases = (edition: GoldenCase["edition"]): GoldenCase[] => [
  one(`${edition}/closed/whoami/empty`, closed(edition), "whoami"),
  one(`${edition}/closed/whoami/seeded`, seeded(closed(edition)), "whoami"),
  one(`${edition}/closed/whoami/seeded-account-read-fails`, serving(seeded(closed(edition)), "me-fails"), "whoami"),
  one(`${edition}/closed/whoami/api`, seeded(closed(edition)), "whoami", "--api", "<api>"),
  one(`${edition}/closed/whoami/operand`, closed(edition), "whoami", "extra"),
  one(`${edition}/closed/whoami/help`, closed(edition), "whoami", "--help"),
  one(`${edition}/closed/logout/empty`, closed(edition), "logout"),
  one(`${edition}/closed/logout/seeded`, seeded(closed(edition)), "logout"),
  one(`${edition}/closed/logout/api`, seeded(closed(edition)), "logout", "--api", "<api>"),
  one(`${edition}/closed/logout/operand`, closed(edition), "logout", "extra"),
  one(`${edition}/closed/logout/help`, closed(edition), "logout", "--help"),
  one(`${edition}/closed/login/approve`, closed(edition), "login"),
  one(`${edition}/closed/login/device`, closed(edition), "login", "--device"),
  one(`${edition}/closed/login/no-browser`, closed(edition), "login", "--no-browser"),
  one(`${edition}/closed/login/replace`, closed(edition), "login", "--replace"),
  one(`${edition}/closed/login/double-dash`, closed(edition), "login", "--"),
  one(`${edition}/closed/login/device-api`, closed(edition), "login", "--device", "--api", "<api>"),
  one(`${edition}/closed/login/api`, closed(edition), "login", "--api", "<api>"),
  one(`${edition}/closed/login/accounts`, closed(edition), "login", "--accounts", "<api>"),
  one(`${edition}/closed/login/operand`, closed(edition), "login", "extra"),
  one(`${edition}/closed/login/help`, closed(edition), "login", "--help"),
  one(`${edition}/closed/login/denied`, serving(closed(edition), "deny"), "login"),
  one(`${edition}/closed/login/expired`, serving(closed(edition), "expire"), "login"),
  one(`${edition}/closed/login/machine-exists`, serving(closed(edition), "machine-exists"), "login", "--replace"),
  one(`${edition}/closed/login/unreachable`, serving(closed(edition), "unreachable"), "login"),
  one(`${edition}/closed/login/already-signed-in`, seeded(closed(edition)), "login"),
  one(`${edition}/closed/login/account-read-fails`, serving(closed(edition), "me-fails"), "login"),
  one(`${edition}/open/login/browser`, open(edition), "login"),
  one(`${edition}/open/login/browser-denied`, serving(open(edition), "deny"), "login"),
  one(`${edition}/open/login/no-browser`, open(edition), "login", "--no-browser"),
  one(`${edition}/open/login/device`, open(edition), "login", "--device"),
  one(`${edition}/open/login/device-replace`, open(edition), "login", "--device", "--replace"),
  one(`${edition}/open/login/api-accounts`, open(edition), "login", "--api", "<api>", "--accounts", "<api>"),
  one(`${edition}/open/login/already-signed-in`, seeded(open(edition)), "login"),
  one(`${edition}/open/whoami/seeded`, seeded(open(edition)), "whoami", "--api", "<api>"),
  one(`${edition}/open/logout/seeded`, seeded(open(edition)), "logout", "--api", "<api>"),
]

const native = closed("native")

const accountCases: GoldenCase[] = [
  one("native/account/usage", native, "account"),
  one("native/account/show/empty", native, "account", "show"),
  one("native/account/show/seeded", seeded(native), "account", "show"),
  one("native/account/show/account", seeded(native), "account", "show", "--account", "acc-golden"),
  one("native/account/show/account-missing", seeded(native), "account", "show", "--account"),
  many("native/account/show/after-logout", seeded(native), [{ args: ["logout"] }, { args: ["account", "show"] }]),
  one("native/account/sign-in/check", native, "account", "sign-in", "--check"),
  one("native/account/sign-in/approve", native, "account", "sign-in"),
  many("native/account/sign-in/stdin", native, [
    { args: ["account", "sign-in", "--stdin"], stdin: '{"deviceName":"Named Golden","replace":true}\n' },
  ]),
  many("native/account/sign-in/stdin-empty", native, [{ args: ["account", "sign-in", "--stdin"], stdin: "\n" }]),
  many("native/account/sign-in/stdin-invalid", native, [
    { args: ["account", "sign-in", "--stdin"], stdin: '{"deviceName":"x","extra":1}\n' },
  ]),
  one("native/account/sign-in/unknown-flag", native, "account", "sign-in", "--bogus"),
  one("native/account/sign-in/denied", serving(native, "deny"), "account", "sign-in"),
  one("native/account/sign-in/expired", serving(native, "expire"), "account", "sign-in"),
  one("native/account/sign-in/machine-exists", serving(native, "machine-exists"), "account", "sign-in"),
  one("native/account/sign-in/unreachable", serving(native, "unreachable"), "account", "sign-in"),
  one("native/account/sign-in/already-signed-in", seeded(native), "account", "sign-in"),
  one("native/account/forget/empty", native, "account", "forget"),
  one("native/account/forget/seeded", seeded(native), "account", "forget"),
  one("native/account/forget/this-device", seeded(native), "account", "forget", "--device", "seeded-device"),
  one("native/account/forget/other-device", seeded(native), "account", "forget", "--device", "other-device"),
  one("native/account/forget/device-missing", seeded(native), "account", "forget", "--device"),
  one("native/account/forget/unknown-flag", seeded(native), "account", "forget", "--bogus"),
  one("native/account/store/status", native, "account", "store", "status"),
  one("native/account/store/enable", seeded(native), "account", "store", "enable"),
  one("native/account/store/enable-helper-missing", { ...native, helper: "missing" }, "account", "store", "enable"),
  one("native/account/store/disable-absent", native, "account", "store", "disable"),
  many("native/account/store/enable-then-disable", seeded(native), [
    { args: ["account", "store", "enable"] },
    { args: ["account", "store", "status"] },
    { args: ["account", "store", "disable"] },
  ]),
  many("native/account/store/enable-then-discard", seeded(native), [
    { args: ["account", "store", "enable"] },
    { args: ["account", "store", "disable", "--discard"] },
  ]),
  one("native/account/store/unknown", native, "account", "store", "bogus"),
  one("native/account/store/status-extra", native, "account", "store", "status", "extra"),
]

export const GOLDEN_CASES: readonly GoldenCase[] = [
  ...serviceAuthCases("native"),
  ...serviceAuthCases("opencode"),
  ...accountCases,
]

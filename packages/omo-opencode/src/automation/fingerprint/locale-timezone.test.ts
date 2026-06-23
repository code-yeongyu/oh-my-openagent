import { describe, expect, test } from "bun:test"
import { localeToTimezone, timezoneToLocale, getKnownLocales } from "./locale-timezone"

describe("localeToTimezone", () => {
  test("#given en-US #when looked up #then returns America/New_York", () => {
    expect(localeToTimezone("en-US")).toBe("America/New_York")
  })

  test("#given it-IT #when looked up #then returns Europe/Rome", () => {
    expect(localeToTimezone("it-IT")).toBe("Europe/Rome")
  })

  test("#given ja-JP #when looked up #then returns Asia/Tokyo", () => {
    expect(localeToTimezone("ja-JP")).toBe("Asia/Tokyo")
  })

  test("#given unknown locale #when looked up #then returns undefined", () => {
    expect(localeToTimezone("xx-YY")).toBeUndefined()
  })
})

describe("timezoneToLocale", () => {
  test("#given Europe/London #when looked up #then returns en-GB", () => {
    expect(timezoneToLocale("Europe/London")).toBe("en-GB")
  })

  test("#given America/Sao_Paulo #when looked up #then returns pt-BR", () => {
    expect(timezoneToLocale("America/Sao_Paulo")).toBe("pt-BR")
  })

  test("#given unknown timezone #when looked up #then returns undefined", () => {
    expect(timezoneToLocale("Mars/Olympus_Mons")).toBeUndefined()
  })
})

describe("getKnownLocales", () => {
  test("#given map #when listed #then has at least 20 locales", () => {
    expect(getKnownLocales().length).toBeGreaterThanOrEqual(20)
  })
})

import { describe, expect, test } from "bun:test"

import { MEMBER_IDENTITY_ENV, isTeamMemberProcess } from "./identity"

describe("isTeamMemberProcess", () => {
  test("#given an env carrying the member identity #when checked #then it reports a member process", () => {
    // given
    const env = { [MEMBER_IDENTITY_ENV]: "3a80dbd1-3fd2-4e86-b110-596e645b6bd4::a1-incumbents" }

    // when
    const result = isTeamMemberProcess(env)

    // then
    expect(result).toBe(true)
  })

  test("#given an env without the member identity #when checked #then it reports a non-member process", () => {
    // given
    const env = {}

    // when
    const result = isTeamMemberProcess(env)

    // then
    expect(result).toBe(false)
  })

  test("#given an empty member identity #when checked #then it reports a non-member process", () => {
    // given
    const env = { [MEMBER_IDENTITY_ENV]: "" }

    // when
    const result = isTeamMemberProcess(env)

    // then
    expect(result).toBe(false)
  })
})

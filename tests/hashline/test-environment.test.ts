import { expect, test } from "bun:test"
import { parseHashlineTestEnvironment } from "./test-environment"

const TEST_BASE_URL = "https://hashline-test.invalid/v1"
const TEST_API_KEY = "hashline-test-only-key"

test("#given no base URL #when parsing the test environment #then it is rejected", async () => {
  expect(() => parseHashlineTestEnvironment({ HASHLINE_TEST_API_KEY: TEST_API_KEY })).toThrow(
    "HASHLINE_TEST_BASE_URL",
  )
})

test("#given no API key #when parsing the test environment #then it is rejected", async () => {
  expect(() => parseHashlineTestEnvironment({ HASHLINE_TEST_BASE_URL: TEST_BASE_URL })).toThrow(
    "HASHLINE_TEST_API_KEY",
  )
})

test("#given a non-HTTP URL #when parsing the test environment #then it is rejected", async () => {
  expect(() =>
    parseHashlineTestEnvironment({
      HASHLINE_TEST_BASE_URL: "ftp://hashline-test.invalid/v1",
      HASHLINE_TEST_API_KEY: TEST_API_KEY,
    }),
  ).toThrow("HTTP or HTTPS")
})

test("#given a blank API key #when parsing the test environment #then it is rejected", async () => {
  expect(() =>
    parseHashlineTestEnvironment({
      HASHLINE_TEST_BASE_URL: TEST_BASE_URL,
      HASHLINE_TEST_API_KEY: "   ",
    }),
  ).toThrow("must not be blank")
})

test("#given explicit valid values #when parsing the test environment #then they are preserved", async () => {
  expect(
    parseHashlineTestEnvironment({
      HASHLINE_TEST_BASE_URL: TEST_BASE_URL,
      HASHLINE_TEST_API_KEY: TEST_API_KEY,
    }),
  ).toEqual({ baseURL: TEST_BASE_URL, apiKey: TEST_API_KEY })
})

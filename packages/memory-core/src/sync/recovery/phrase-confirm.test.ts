import { expect, test } from "bun:test"
import { confirmationMatches, confirmationPositions, generateRecoveryPhrase, TypedPhrase } from "./phrase.ts"

test("#given random draws including values in the biased tail #when positions are chosen #then they are 3 distinct sorted positions within 1-24 and tail draws are rejected", () => {
  const tail = 0xffff_fff0
  const draws = [tail, 5, tail, 5, 47, 0]
  expect(confirmationPositions(3, (bytes) => void (bytes[0] = draws.shift() ?? tail))).toEqual([1, 6, 24])
  expect(draws).toEqual([])
})

test("#given a fixed test phrase #when the typed check is compared #then only the words at the asked positions, normalised, in order, match", () => {
  const phrase = generateRecoveryPhrase((bytes) => void bytes.fill(0))
  const words = phrase.reveal()
  const asked = [1, 12, 24]
  const right = asked.map((position) => words[position - 1] ?? "")
  expect(confirmationMatches(phrase, asked, new TypedPhrase(`  ${right.join("   ").toUpperCase()} `))).toBe(true)
  expect(confirmationMatches(phrase, asked, new TypedPhrase([...right].reverse().join(" ")))).toBe(false)
  expect(confirmationMatches(phrase, asked, new TypedPhrase(right.slice(0, 2).join(" ")))).toBe(false)
})

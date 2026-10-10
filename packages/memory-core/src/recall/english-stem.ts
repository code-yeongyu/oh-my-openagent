// Light English suffix folding for the recall BM25 index, applied identically to note and query
// tokens so "rollbacks", "deploys", "deployment" and "rotated" meet "rollback", "deploy" and
// "rotation" in one term. It is a Porter step-1-lite, not a real stemmer: the folded forms only need
// to agree with each other, not to be words. Only plain lowercase ASCII words longer than three
// letters are folded; CJK runs and bigrams, digits and mixed tokens pass through untouched.

const ASCII_WORD = /^[a-z]+$/
const VOWEL = /[aeiouy]/
// A doubled final consonant left by a stripped suffix ("running", "stopped") folds to one; l, s and z
// stay doubled because "killing" and "passed" keep them in the base word.
const DOUBLED_CONSONANT = /([^aeiouylsz])\1$/

function stripPlural(word: string): string {
  if (word.endsWith("sses")) return word.slice(0, -2)
  if (word.endsWith("ies") && word.length > 4) return `${word.slice(0, -3)}y`
  if (/(?:ch|sh|x|z|ss)es$/.test(word)) return word.slice(0, -2)
  if (word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

function stripSuffix(word: string, suffix: "ing" | "ed" | "ly"): string | undefined {
  if (!word.endsWith(suffix)) return undefined
  const stem = word.slice(0, -suffix.length)
  if (stem.length < 3 || !VOWEL.test(stem)) return undefined
  return DOUBLED_CONSONANT.test(stem) ? stem.slice(0, -1) : stem
}

function stripDerivational(word: string): string {
  if (word.endsWith("ment") && word.length - 4 >= 4) return word.slice(0, -4)
  const adverb = stripSuffix(word, "ly")
  if (adverb !== undefined) return adverb
  if (/[ts]ion$/.test(word) && word.length - 3 >= 3) return word.slice(0, -3)
  return word
}

export function stemEnglishToken(token: string): string {
  if (token.length <= 3 || !ASCII_WORD.test(token)) return token
  let word = stripPlural(token)
  word = stripSuffix(word, "ing") ?? stripSuffix(word, "ed") ?? word
  word = stripDerivational(word)
  return word.length > 3 && word.endsWith("e") ? word.slice(0, -1) : word
}

import { stripQuotedSpans } from "../skill-pointers/strip-quoted-regions"

export type ClaimKind = "test" | "typecheck" | "lint" | "build" | "run" | "exists" | "done"
export type ClaimStrength = "asserted" | "hedged"

export interface Claim {
  readonly kind: ClaimKind
  readonly strength: ClaimStrength
  readonly admitted: boolean
  readonly reported: boolean
  readonly sentence: string
  readonly rule: string
}

interface ClaimRule {
  readonly id: string
  readonly kind: ClaimKind
  readonly pattern: RegExp
}

// Patterns run over text whose code, quotes and relayed reports are already masked to NUL, so `[^.\n\0]`
// keeps a match inside one visible clause. Korean never uses `\b`: it does not fire after Hangul.
const CLAIM_RULES: readonly ClaimRule[] = [
  { id: "test.zero-fail", kind: "test", pattern: /(?<![0-9])0\s*(?:failed|failures?|fail)\b/i },
  { id: "test.ko-zero-fail", kind: "test", pattern: /실패\s*:?\s*0(?![0-9])/ },
  { id: "test.n-of-n", kind: "test", pattern: /(?<![\w.])(\d+)\s*\/\s*\1\s*(?:pass(?:ed|ing|es)?|통과)/i },
  { id: "test.count-passed", kind: "test", pattern: /(?<![\w.])[1-9]\d*\s+pass(?:ed|ing)?\b/i },
  { id: "test.tests-pass", kind: "test", pattern: /\btests?\b[^.\n\0]{0,30}?\b(?:pass(?:es|ed|ing)?|(?:are|is|stays?) green)\b/i },
  { id: "test.suite-pass", kind: "test", pattern: /\b(?:suite|ci|checks)\b[^.\n\0]{0,20}?\b(?:pass(?:es|ed)?|green|succeed(?:s|ed)?)\b/i },
  { id: "test.should-pass", kind: "test", pattern: /\b(?:should|will|would)\s+(?:now\s+|still\s+|all\s+)?pass\b/i },
  { id: "test.ko-tests", kind: "test", pattern: /테스트[^.\n\0]{0,15}통과/ },
  { id: "test.ko-all", kind: "test", pattern: /(?:모두|전부|다)\s*통과/ },
  { id: "test.ko-passed", kind: "test", pattern: /통과(?:했|합니다|해요|함|됐|된다|될|할)/ },
  { id: "test.ko-count", kind: "test", pattern: /(?<![0-9])[1-9]\d*\s*(?:개|건)?\s*통과/ },
  { id: "typecheck.clean", kind: "typecheck", pattern: /\b(?:typecheck(?:s|ing)?|type ?check(?:s|ing)?|tsc|tsgo|types)\b[^.\n\0]{0,20}?\b(?:pass(?:es|ed)?|clean|green|succeed(?:s|ed)?|ok)\b/i },
  { id: "typecheck.no-errors", kind: "typecheck", pattern: /\bno (?:type|ts|typescript) errors?\b/i },
  { id: "typecheck.ko", kind: "typecheck", pattern: /타입\s*(?:체크|검사)[^.\n\0]{0,12}(?:통과|성공|깨끗)|타입\s*(?:에러|오류)\s*(?:없|0)/ },
  { id: "lint.clean", kind: "lint", pattern: /\blint(?:er|ing)?\b[^.\n\0]{0,20}?\b(?:pass(?:es|ed)?|clean|green)\b|린트[^.\n\0]{0,12}(?:통과|성공|깨끗)/i },
  { id: "build.ok", kind: "build", pattern: /\bbuilds?\b[^.\n\0]{0,15}?\b(?:pass(?:es|ed)?|succeed(?:s|ed)?|green|works|ok)\b/i },
  { id: "build.ko", kind: "build", pattern: /빌드[^.\n\0]{0,12}(?:성공|통과|됩니다|됐|돼요)/ },
  { id: "run.works", kind: "run", pattern: /\b(?:works|is working|runs) (?:as expected|correctly|end to end|fine)\b|(?:정상(?:적으로)?|잘)\s*(?:동작|작동)/i },
  { id: "exists.already", kind: "exists", pattern: /\balready\s+(?:exists?|implemented|in place|supported|wired up|present)\b/i },
  { id: "exists.ko", kind: "exists", pattern: /이미\s*(?:있|존재|구현(?:되어|돼|됐|되었|했|해)|되어|돼|지원(?:되|돼|해|합)|반영(?:되|돼|됐|했)|들어)/ },
  { id: "done.leading", kind: "done", pattern: /^(?:done|completed|finished|fixed|implemented|verified|confirmed|all set)\b/i },
  { id: "done.ko-leading", kind: "done", pattern: /^(?:완료|끝|구현 완료|수정 완료|확인 완료)/ },
  { id: "done.ko", kind: "done", pattern: /완료(?:했|됐|되었|입니다|됨)|끝났(?:어요|습니다|다)/ },
]

const NONZERO_FAILURES = /(?<![0-9])[1-9]\d*\s*(?:failed|failures?|fail)\b|실패\s*:?\s*[1-9]|(?<![0-9])[1-9]\d*\s*(?:건|개)?\s*실패/i
const EN_NEGATION = /\b(?:not|never|cannot|no longer)\b|n't\b/i
const EN_FAILURE_AFTER = /\b(?:fail(?:s|ed|ing|ures?)?|broken|red)\b/i
const KO_NEGATION =
  /않|못|아니|(?:^|\s)안\s|미(?:통과|완료|구현|검증|반영)|불통과|실패(?:하|했|해|함|입니다|예요|중)|(?:에러|오류)가\s*(?:나|발생)/
const EN_ADMISSION =
  /\b(?:not (?:yet )?(?:been )?(?:run|ran|verified|tested|checked|executed)|(?:haven't|have not|hasn't|has not|didn't|did not|couldn't|could not)\s+(?:yet\s+)?(?:run|verify|test|check|execute|re-?run)|untested|unverified|without (?:running|testing|verifying))\b/i
const KO_ADMISSION =
  /아직\s*(?:안|못)|안\s*(?:돌렸|돌려|돌림|해\s*봤|실행)|못\s*(?:돌렸|돌려|돌림|해\s*봤|실행)|돌리지\s*(?:않|못)|실행(?:하지|은)?\s*(?:않|못|안)|미검증|미확인|(?:검증|확인)(?:하지|은|도)?\s*(?:전|안|못)|(?:검증|확인)되지\s*않/
const HEDGE =
  /\b(?:should|would|ought to|expected to|likely|probably|presumably|i think|i believe|i assume|might)\b|거예요|겁니다|거야|것\s*같|거\s*같|듯|아마|예상|(?:할|될|일)\s*(?:거|것)/i
const HANDOFF_LINE = /^(?:Ask|Now|Next|wanted):/i
const CONDITIONAL = /\b(?:if|once|when|whenever|whether|until|unless|as soon as|as each)\b|(?:하|되|으|이|라)면(?=[\s,.]|$)|(?:할|될)\s*때/i
const REPORTED_RESULT =
  /(?<![\w.])\d+\s*(?:\/\s*\d+|pass(?:ed|ing)?|tests?|fail(?:ed|ures?)?)\b|(?<![\w.])\d+\s+(?:of\s+\d+|(?:[A-Za-z-]+\s+){1,2}tests?)\b|(?<![\w.])\d+\s*(?:\uAC1C|\uAC74)|\bexit(?:s|ed)?\s*(?:code\s*)?0\b|\b[A-Z_]*EXIT=0\b/i
const EXTRA_QUOTES = /\u2018[^\u2019\n]*\u2019|[\u300C\u300E][^\u300D\u300F\n]*[\u300D\u300F]/g
const LEADING_MARKER = /^[\s\0]*(?:[-*\u2022]|\d+[.)]|[\u2705\u2714\u2611]\uFE0F?)?\s*/

interface Span {
  readonly start: number
  readonly end: number
}

function maskSpan(region: string): string {
  return region.replace(/[^\r\n]/g, "\0")
}

export function maskQuotedProse(text: string): string {
  return stripQuotedSpans(text).replace(EXTRA_QUOTES, maskSpan)
}

export function splitSentences(masked: string): Span[] {
  const spans: Span[] = []
  let start = 0
  for (let index = 0; index <= masked.length; index += 1) {
    const char = masked[index]
    const atEnd = index === masked.length
    const terminal = char !== undefined && /[.!?\u3002]/.test(char) && (index + 1 === masked.length || /\s/.test(masked[index + 1] ?? ""))
    if (!atEnd && char !== "\n" && !terminal) continue
    const end = terminal ? index + 1 : index
    if (masked.slice(start, end).replace(/[\s\0]/g, "") !== "") spans.push({ start, end })
    start = end
  }
  return spans
}

function blank(text: string, start: number, end: number): string {
  return text.slice(0, start) + " ".repeat(end - start) + text.slice(end)
}

function findClaim(sentence: string): { rule: ClaimRule; index: number; length: number } | undefined {
  const lead = LEADING_MARKER.exec(sentence)?.[0].length ?? 0
  const body = sentence.slice(lead).trimEnd()
  if (HANDOFF_LINE.test(body)) return undefined
  const testsExcluded = NONZERO_FAILURES.test(body)
  for (const rule of CLAIM_RULES) {
    if (testsExcluded && rule.kind === "test") continue
    const match = rule.pattern.exec(body)
    if (match !== null) return { rule, index: lead + match.index, length: match[0].length }
  }
  return undefined
}

const SELF_NEGATING_RULES: ReadonlySet<string> = new Set(["test.zero-fail", "test.ko-zero-fail", "typecheck.no-errors", "typecheck.ko"])

function isNegated(sentence: string, ruleId: string, claimStart: number, claimEnd: number): boolean {
  const rest = SELF_NEGATING_RULES.has(ruleId) ? blank(sentence, claimStart, claimEnd) : sentence
  if (EN_NEGATION.test(rest) || KO_NEGATION.test(rest)) return true
  return EN_FAILURE_AFTER.test(rest.slice(claimEnd))
}

function isAdmission(text: string): boolean {
  return EN_ADMISSION.test(text) || KO_ADMISSION.test(text)
}

export function classifyClaims(text: string): Claim[] {
  const masked = maskQuotedProse(text)
  const spans = splitSentences(masked)
  const claims: Claim[] = []
  spans.forEach((span, position) => {
    const sentence = masked.slice(span.start, span.end)
    const found = findClaim(sentence)
    if (found === undefined || CONDITIONAL.test(sentence)) return
    const neighbours = spans.slice(Math.max(0, position - 1), position + 2).map((s) => masked.slice(s.start, s.end)).join(" ")
    const admitted = isAdmission(neighbours)
    if (!admitted && isNegated(sentence, found.rule.id, found.index, found.index + found.length)) return
    claims.push({
      kind: found.rule.kind,
      strength: HEDGE.test(sentence) ? "hedged" : "asserted",
      admitted,
      reported: REPORTED_RESULT.test(sentence),
      sentence: text.slice(span.start, span.end).trim(),
      rule: found.rule.id,
    })
  })
  return claims
}

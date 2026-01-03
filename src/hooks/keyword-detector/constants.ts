export const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
export const INLINE_CODE_PATTERN = /`[^`]+`/g

export const KEYWORD_DETECTORS: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /(ultrawork|ulw)/i,
    message: `<ultrawork-mode>

## TODO IS YOUR LIFELINE (NON-NEGOTIABLE)

**USE TodoWrite OBSESSIVELY. This is the #1 most important tool.**

### TODO Rules
1. **BEFORE any action**: Create TODOs FIRST. Break down into atomic, granular steps.
2. **Be excessively detailed**: 10 small TODOs > 3 vague TODOs. Err on the side of too many.
3. **Real-time updates**: Mark \`in_progress\` before starting, \`completed\` IMMEDIATELY after. NEVER batch.
4. **One at a time**: Only ONE TODO should be \`in_progress\` at any moment.
5. **Sub-tasks**: Complex TODO? Break it into sub-TODOs. Keep granularity high.
6. **Questions too**: User asks a question? TODO: "Answer with evidence: [question]"

### Example TODO Granularity
BAD: "Implement user auth"
GOOD:
- "Read existing auth patterns in codebase"
- "Create auth schema types"  
- "Implement login endpoint"
- "Implement token validation middleware"
- "Add auth tests - login success case"
- "Add auth tests - login failure case"
- "Verify LSP diagnostics clean"

**YOUR WORK IS INVISIBLE WITHOUT TODOs. USE THEM.**

## TDD WORKFLOW (MANDATORY when tests exist)

Check for test infrastructure FIRST. If exists, follow strictly:

1. **RED**: Write failing test FIRST → \`bun test\` must FAIL
2. **GREEN**: Write MINIMAL code to pass → \`bun test\` must PASS
3. **REFACTOR**: Clean up, tests stay green → \`bun test\` still PASS
4. **REPEAT**: Next test case, loop until complete

**NEVER write implementation before test. NEVER delete failing tests.**

## AGENT DEPLOYMENT

Fire available agents in PARALLEL via background tasks. Use explore/librarian agents liberally (multiple concurrent if needed).

## EVIDENCE-BASED ANSWERS

- Every claim: code snippet + file path + line number
- No "I think..." - find and SHOW actual code
- Local search fails? → librarian for external sources
- **NEVER acceptable**: "I couldn't find it"

## ZERO TOLERANCE FOR SHORTCUTS (RIGOROUS & HONEST EXECUTION)

**CORE PRINCIPLE**: Execute user's ORIGINAL INTENT with maximum rigor. No shortcuts. No compromises. No matter how large the task.

### ABSOLUTE PROHIBITIONS
| Violation | Why It's Forbidden |
|-----------|-------------------|
| **Mocking/Stubbing** | Never use mocks, stubs, or fake implementations unless explicitly requested. Real implementation only. |
| **Scope Reduction** | Never make "demo", "skeleton", "simplified", "basic", "minimal" versions. Deliver FULL implementation. |
| **Partial Completion** | Never stop at 60-80% saying "you can extend this...", "as an exercise...", "you can add...". Finish 100%. |
| **Lazy Placeholders** | Never use "// TODO", "...", "etc.", "and so on" in actual code. Complete everything. |
| **Assumed Shortcuts** | Never skip requirements deemed "optional" or "can be added later". All requirements are mandatory. |
| **Test Deletion** | Never delete or skip failing tests. Fix the code, not the tests. |
| **Evidence-Free Claims** | Never say "I think...", "probably...", "should work...". Show actual code/output. |

### RIGOROUS EXECUTION MANDATE
1. **Parse Original Intent**: What did the user ACTUALLY want? Not what's convenient. The REAL, COMPLETE request.
2. **No Task Too Large**: If the task requires 100 files, modify 100 files. If it needs 1000 lines, write 1000 lines. Size is irrelevant.
3. **Honest Assessment**: If you cannot complete something, say so BEFORE starting. Don't fake completion.
4. **Evidence-Based Verification**: Every claim backed by code snippets, file paths, line numbers, and actual outputs.
5. **Complete Verification**: Re-read original request after completion. Check EVERY requirement was met.

### FAILURE RECOVERY
If you realize you've taken shortcuts:
1. STOP immediately
2. Identify what you skipped/faked
3. Create TODOs for ALL remaining work
4. Execute to TRUE completion - not "good enough"

**THE USER ASKED FOR X. DELIVER EXACTLY X. COMPLETELY. HONESTLY. NO MATTER THE SIZE.**

## SUCCESS = All TODOs Done + All Requirements Met + Evidence Provided

</ultrawork-mode>

---

`,
  },
  // SEARCH: EN/KO/JP/CN/VN
  {
    pattern:
      /\b(search|find|locate|lookup|look\s*up|explore|discover|scan|grep|query|browse|detect|trace|seek|track|pinpoint|hunt)\b|where\s+is|show\s+me|list\s+all|검색|찾아|탐색|조회|스캔|서치|뒤져|찾기|어디|추적|탐지|찾아봐|찾아내|보여줘|목록|検索|探して|見つけて|サーチ|探索|スキャン|どこ|発見|捜索|見つけ出す|一覧|搜索|查找|寻找|查询|检索|定位|扫描|发现|在哪里|找出来|列出|tìm kiếm|tra cứu|định vị|quét|phát hiện|truy tìm|tìm ra|ở đâu|liệt kê/i,
    message: `[search-mode]
MAXIMIZE SEARCH EFFORT. Launch multiple background agents IN PARALLEL:
- explore agents (codebase patterns, file structures, ast-grep)
- librarian agents (remote repos, official docs, GitHub examples)
Plus direct tools: Grep, ripgrep (rg), ast-grep (sg)
NEVER stop at first result - be exhaustive.`,
  },
  // ANALYZE: EN/KO/JP/CN/VN
  {
    pattern:
      /\b(analyze|analyse|investigate|examine|research|study|deep[\s-]?dive|inspect|audit|evaluate|assess|review|diagnose|scrutinize|dissect|debug|comprehend|interpret|breakdown|understand)\b|why\s+is|how\s+does|how\s+to|분석|조사|파악|연구|검토|진단|이해|설명|원인|이유|뜯어봐|따져봐|평가|해석|디버깅|디버그|어떻게|왜|살펴|分析|調査|解析|検討|研究|診断|理解|説明|検証|精査|究明|デバッグ|なぜ|どう|仕組み|调查|检查|剖析|深入|诊断|解释|调试|为什么|原理|搞清楚|弄明白|phân tích|điều tra|nghiên cứu|kiểm tra|xem xét|chẩn đoán|giải thích|tìm hiểu|gỡ lỗi|tại sao/i,
    message: `[analyze-mode]
ANALYSIS MODE. Gather context before diving deep:

CONTEXT GATHERING (parallel):
- 1-2 explore agents (codebase patterns, implementations)
- 1-2 librarian agents (if external library involved)
- Direct tools: Grep, AST-grep, LSP for targeted searches

IF COMPLEX (architecture, multi-system, debugging after 2+ failures):
- Consult oracle for strategic guidance

SYNTHESIZE findings before proceeding.`,
  },
]

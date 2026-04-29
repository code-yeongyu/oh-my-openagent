---
name: github-triage
description: "이슈와 PR 모두를 위한 읽기 전용 GitHub 트리아지. 1 항목 = 1 백그라운드 작업 (category: quick). 모든 오픈 항목을 분석하고 /tmp/{datetime}/에 증거 기반 리포트를 작성. 모든 주장은 GitHub permalink를 증거로 요구. GitHub에서 어떤 액션도 절대 취하지 않음 - 댓글 없음, 머지 없음, 클로즈 없음, 라벨 없음. 리포트만. 트리거: 'triage', 'triage issues', 'triage PRs', 'github triage'."
---

# GitHub Triage - 읽기 전용 분석기

<role>
읽기 전용 GitHub 트리아지 오케스트레이터. 오픈 이슈/PR을 가져와 분류하고, 항목당 1개의 백그라운드 `quick` 서브에이전트를 스폰. 각 서브에이전트는 분석하고 리포트 파일을 작성. GitHub 변경(mutation) 제로.
</role>

## 아키텍처

**1 ISSUE/PR = 1 `task_create` = 1 `quick` 서브에이전트 (백그라운드). 예외 없음.**

| 규칙 | 값 |
|------|-------|
| Category | `quick` |
| Execution | `run_in_background=true` |
| Parallelism | 모든 항목 동시 |
| Tracking | 항목당 `task_create` |
| Output | `/tmp/{YYYYMMDD-HHmmss}/issue-{N}.md` 또는 `pr-{N}.md` |

---

## 무액션 정책 (절대)

<zero_action>
서브에이전트는 GitHub 상태를 작성하거나 변경하는 어떠한 명령도 절대 실행해서는 안 된다.

**금지** (전체 목록은 아님):
`gh issue comment`, `gh issue close`, `gh issue edit`, `gh pr comment`, `gh pr merge`, `gh pr review`, `gh pr edit`, `gh api -X POST`, `gh api -X PUT`, `gh api -X PATCH`, `gh api -X DELETE`

**허용**:
- `gh issue view`, `gh pr view`, `gh api` (GET만) - GitHub 데이터 읽기
- `Grep`, `Read`, `Glob` - 코드베이스 읽기
- `Write` - `/tmp/`에만 리포트 파일 작성
- `git log`, `git show`, `git blame` - git 히스토리 읽기 (수정 커밋 찾기용)

**어떠한 GitHub 변경 = 치명적 위반.**
</zero_action>

---

## 증거 규칙 (필수)

<evidence>
**리포트의 모든 사실 주장은 증거로 GitHub permalink를 포함해야 한다.**

permalink는 특정 커밋의 특정 라인/범위를 가리키는 URL이다. 예:
`https://github.com/{owner}/{repo}/blob/{commit_sha}/{path}#L{start}-L{end}`

### permalink 생성 방법

1. Grep/Read로 관련 파일과 라인 찾기.
2. 현재 커밋 SHA 가져오기: `git rev-parse HEAD`
3. 구성: `https://github.com/{REPO}/blob/{SHA}/{filepath}#L{line}` (또는 범위는 `#L{start}-L{end}`)

### 규칙

- **permalink 없음 = 주장 없음.** permalink로 뒷받침할 수 없는 진술이라면 대신 "No evidence found"라고 명시.
- permalink 없는 주장은 명시적으로 `[UNVERIFIED]`로 표시되며 가치가 없다.
- `main`/`master`/`dev` 브랜치 permalink는 허용되지 않음 - 커밋 SHA만 사용.
- 버그 분석: 문제 코드의 permalink. 수정 검증: 수정 커밋 diff의 permalink.
</evidence>

---

## Phase 0: 셋업

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPORT_DIR="/tmp/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORT_DIR"
COMMIT_SHA=$(git rev-parse HEAD)
```

`REPO`, `REPORT_DIR`, `COMMIT_SHA`를 모든 서브에이전트에 전달.

---

---

## Phase 1: 모든 오픈 항목 가져오기 (수정됨)

**중요:** `body`와 `comments` 필드는 jq 파싱을 깨뜨리는 제어 문자를 포함할 수 있다. 먼저 기본 메타데이터를 가져온 다음 서브에이전트에서 항목별로 전체 세부 사항을 가져온다.

```bash
# Step 1: 기본 메타데이터 가져오기 (JSON 파싱 문제를 피하기 위해 body/comments 없이)
ISSUES_LIST=$(gh issue list --repo $REPO --state open --limit 500 \
  --json number,title,labels,author,createdAt)
ISSUE_COUNT=$(echo "$ISSUES_LIST" | jq length)

# 필요 시 페이지네이션
if [ "$ISSUE_COUNT" -eq 500 ]; then
  LAST_DATE=$(echo "$ISSUES_LIST" | jq -r '.[-1].createdAt')
  while true; do
    PAGE=$(gh issue list --repo $REPO --state open --limit 500 \
      --search "created:<$LAST_DATE" \
      --json number,title,labels,author,createdAt)
    PAGE_COUNT=$(echo "$PAGE" | jq length)
    [ "$PAGE_COUNT" -eq 0 ] && break
    ISSUES_LIST=$(echo "$ISSUES_LIST" "$PAGE" | jq -s '.[0] + .[1] | unique_by(.number)')
    ISSUE_COUNT=$(echo "$ISSUES_LIST" | jq length)
    [ "$PAGE_COUNT" -lt 500 ] && break
    LAST_DATE=$(echo "$PAGE" | jq -r '.[-1].createdAt')
  done
fi

# PR도 동일
PRS_LIST=$(gh pr list --repo $REPO --state open --limit 500 \
  --json number,title,labels,author,headRefName,baseRefName,isDraft,createdAt)
PR_COUNT=$(echo "$PRS_LIST" | jq length)

if [ "$PR_COUNT" -eq 500 ]; then
  LAST_DATE=$(echo "$PRS_LIST" | jq -r '.[-1].createdAt')
  while true; do
    PAGE=$(gh pr list --repo $REPO --state open --limit 500 \
      --search "created:<$LAST_DATE" \
      --json number,title,labels,author,headRefName,baseRefName,isDraft,createdAt)
    PAGE_COUNT=$(echo "$PAGE" | jq length)
    [ "$PAGE_COUNT" -eq 0 ] && break
    PRS_LIST=$(echo "$PRS_LIST" "$PAGE" | jq -s '.[0] + .[1] | unique_by(.number)')
    PR_COUNT=$(echo "$PRS_LIST" | jq length)
    [ "$PAGE_COUNT" -lt 500 ] && break
    LAST_DATE=$(echo "$PAGE" | jq -r '.[-1].createdAt')
  done
fi

echo "Total issues: $ISSUE_COUNT, Total PRs: $PR_COUNT"
```

**대규모 저장소 처리:**
총 항목이 50을 초과하면 모든 항목을 처리해야 한다. 위의 페이지네이션 코드를 사용하여 모든 오픈 이슈와 PR을 가져온다.
**절대** 50개로 샘플링하거나 제한하지 말 것 - 전체 백로그를 처리.

예: 오픈 이슈가 500개면 서브에이전트 500개 스폰. 오픈 PR이 1000개면 서브에이전트 1000개 스폰.

**참고:** 백그라운드 작업 시스템이 초과 작업을 자동으로 큐에 넣음.


---

## Phase 2: 분류

| 타입 | 감지 |
|------|-----------|
| `ISSUE_QUESTION` | `[Question]`, `[Discussion]`, `?`, "how to" / "why does" / "is it possible" |
| `ISSUE_BUG` | `[Bug]`, `Bug:`, 오류 메시지, 스택 트레이스, 예상치 못한 동작 |
| `ISSUE_FEATURE` | `[Feature]`, `[RFE]`, `[Enhancement]`, `Feature Request`, `Proposal` |
| `ISSUE_OTHER` | 그 외 모든 것 |
| `PR_BUGFIX` | 제목이 `fix`로 시작, 브랜치에 `fix/`/`bugfix/` 포함, 라벨 `bug` |
| `PR_OTHER` | 그 외 모든 것 |

---

## Phase 3: 서브에이전트 스폰 (개별 도구 호출)

**중요: 개별 `task_create` 도구 호출을 사용해 작업을 하나씩 생성. 절대 배치하거나 스크립트화하지 말 것.**

각 항목에 대해 다음 단계를 순차적으로 실행:

### Step 3.1: 작업 레코드 생성
```typescript
task_create(
  subject="Triage: #{number} {title}",
  description="GitHub {issue|PR} triage analysis - {type}",
  metadata={"type": "{ISSUE_QUESTION|ISSUE_BUG|ISSUE_FEATURE|ISSUE_OTHER|PR_BUGFIX|PR_OTHER}", "number": {number}}
)
```

### Step 3.2: 분석 서브에이전트 스폰 (백그라운드)
```typescript
task(
  category="quick",
  run_in_background=true,
  load_skills=[],
  prompt=SUBAGENT_PROMPT
)
```

**서브에이전트 절대 규칙:**
- **분석만** - GitHub에서 액션 절대 금지 (댓글, 머지, 클로즈 없음)
- **읽기 전용** - 코드/GitHub 데이터 읽기에만 도구 사용
- **리포트만 작성** - 출력은 Write 도구를 통해 `{REPORT_DIR}/{issue|pr}-{number}.md`로
- **증거 필수** - 모든 주장에 GitHub permalink 증거

```
For each item:
  1. task_create(subject="Triage: #{number} {title}")
  2. task(category="quick", run_in_background=true, load_skills=[], prompt=SUBAGENT_PROMPT)
  3. 매핑 저장: item_number -> { task_id, background_task_id }
```

---

## 서브에이전트 프롬프트

### 공통 서두 (모든 서브에이전트 프롬프트에 포함)

```
CONTEXT:
- Repository: {REPO}
- Report directory: {REPORT_DIR}
- Current commit SHA: {COMMIT_SHA}

PERMALINK FORMAT:
모든 사실 주장은 permalink 포함 필수: https://github.com/{REPO}/blob/{COMMIT_SHA}/{filepath}#L{start}-L{end}
permalink 없음 = 주장 없음. 검증 불가능한 주장은 [UNVERIFIED]로 표시.
필요 시 현재 SHA: git rev-parse HEAD

절대 규칙 (어느 것이든 위반 = 치명적 실패):
- gh issue comment, gh issue close, gh issue edit 절대 실행 금지
- gh pr comment, gh pr merge, gh pr review, gh pr edit 절대 실행 금지
- -X POST, -X PUT, -X PATCH, -X DELETE를 사용한 어떠한 gh 명령도 절대 실행 금지
- git checkout, git fetch, git pull, git switch, git worktree 절대 실행 금지
- 유일한 쓰기 가능 출력: Write 도구를 통한 {REPORT_DIR}/{issue|pr}-{number}.md
```


---

### ISSUE_QUESTION

```
You are analyzing issue #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK:
1. 질문 이해.
2. 답을 위해 코드베이스 검색 (Grep, Read).
3. 모든 발견에 대해 permalink 구성: https://github.com/{REPO}/blob/{COMMIT_SHA}/{path}#L{N}
4. {REPORT_DIR}/issue-{number}.md에 리포트 작성

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** Question | **Author:** {author} | **Created:** {createdAt}

## Question
[1-2 문장 요약]

## Findings
[각 발견을 permalink 증거와 함께. 예:]
- 설정은 [`src/config/loader.ts#L42-L58`](https://github.com/{REPO}/blob/{SHA}/src/config/loader.ts#L42-L58)에서 파싱됨

## Suggested Answer
[코드 참조와 permalink가 포함된 답변 초안]

## Confidence: [HIGH | MEDIUM | LOW]
[이유. LOW인 경우: 무엇이 누락되었는지]

## Recommended Action
[메인테이너가 무엇을 해야 하는지]

---
REMEMBER: permalink 없음 = 주장 없음. 모든 코드 참조는 permalink 필요.
```

---

### ISSUE_BUG

```
You are analyzing bug report #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK:
1. 이해: 예상 동작, 실제 동작, 재현 단계.
2. 관련 코드를 코드베이스에서 검색. 로직 추적.
3. 판정 결정: CONFIRMED_BUG, NOT_A_BUG, ALREADY_FIXED 또는 UNCLEAR.
4. ALREADY_FIXED인 경우: git log/git blame으로 수정 커밋 찾기. 커밋 SHA와 변경 내용 포함.
5. 모든 발견에 대해 permalink 구성.
6. {REPORT_DIR}/issue-{number}.md에 리포트 작성

"ALREADY_FIXED" 커밋 찾기:
- `git log --all --oneline -- {file}`로 관련 파일의 최근 변경 찾기
- `git log --all --grep="fix" --grep="{keyword}" --all-match --oneline`로 커밋 메시지 검색
- `git blame {file}`로 누가 마지막으로 관련 라인을 변경했는지 찾기
- `git show {commit_sha}`로 수정 검증
- 커밋 permalink 구성: https://github.com/{REPO}/commit/{fix_commit_sha}

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** Bug Report | **Author:** {author} | **Created:** {createdAt}

## Bug Summary
**Expected:** [사용자가 기대하는 것]
**Actual:** [실제로 일어나는 것]
**Reproduction:** [제공된 경우 단계]

## Verdict: [CONFIRMED_BUG | NOT_A_BUG | ALREADY_FIXED | UNCLEAR]

## Analysis

### Evidence
[각 증거를 permalink와 함께. permalink 없음 = [UNVERIFIED] 표시]

### Root Cause (CONFIRMED_BUG인 경우)
[어느 파일, 어느 함수, 무엇이 잘못되는지]
- 문제 코드: [`{path}#L{N}`](permalink)

### Why Not A Bug (NOT_A_BUG인 경우)
[현재 동작이 올바르다는 permalink가 포함된 엄밀한 증명]

### Fix Details (ALREADY_FIXED인 경우)
- **Fixed in commit:** [`{short_sha}`](https://github.com/{REPO}/commit/{full_sha})
- **Fixed date:** {date}
- **What changed:** [diff permalink가 포함된 설명]
- **Fixed by:** {author}

### Blockers (UNCLEAR인 경우)
[결정을 막는 것, 다음에 조사할 것]

## Severity: [LOW | MEDIUM | HIGH | CRITICAL]

## Affected Files
[permalink 포함 목록]

## Suggested Fix (CONFIRMED_BUG인 경우)
[구체적 접근: "{file}#L{N}에서 X를 Y로 변경, 이유는 Z"]

## Recommended Action
[메인테이너가 무엇을 해야 하는지]

---
CRITICAL: permalink 없는 주장은 가치가 없다. 증거를 찾을 수 없으면, 검증되지 않은 주장을 하기보다 명시적으로 그렇다고 말하라.
```

---

### ISSUE_FEATURE

```
You are analyzing feature request #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK:
1. 요청 이해.
2. 기존 (부분/전체) 구현을 코드베이스에서 검색.
3. 실현 가능성 평가.
4. {REPORT_DIR}/issue-{number}.md에 리포트 작성

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** Feature Request | **Author:** {author} | **Created:** {createdAt}

## Request Summary
[사용자가 원하는 것]

## Existing Implementation: [YES_FULLY | YES_PARTIALLY | NO]
[존재하는 경우: 어디에, 구현 permalink와 함께]

## Feasibility: [EASY | MODERATE | HARD | ARCHITECTURAL_CHANGE]

## Relevant Files
[permalink 포함]

## Implementation Notes
[접근, 함정, 의존성]

## Recommended Action
[메인테이너가 무엇을 해야 하는지]
```

---

### ISSUE_OTHER

```
You are analyzing issue #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK: 평가하고 {REPORT_DIR}/issue-{number}.md에 리포트 작성

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** [QUESTION | BUG | FEATURE | DISCUSSION | META | STALE]
**Author:** {author} | **Created:** {createdAt}

## Summary
[1-2 문장]

## Needs Attention: [YES | NO]
## Suggested Label: [있으면]
## Recommended Action: [메인테이너가 해야 할 것]
```

---

### PR_BUGFIX

```
You are reviewing PR #{number} for {REPO}.

ITEM:
- PR #{number}: {title}
- Author: {author}
- Base: {baseRefName} <- Head: {headRefName}
- Draft: {isDraft} | Mergeable: {mergeable}
- Review: {reviewDecision} | CI: {statusCheckRollup_summary}
- Body: {body}

TASK:
1. PR 세부 가져오기 (읽기 전용): gh pr view {number} --repo {REPO} --json files,reviews,comments,statusCheckRollup,reviewDecision
2. diff 읽기: gh api repos/{REPO}/pulls/{number}/files
3. 수정 정확성 검증을 위해 코드베이스 검색.
4. {REPORT_DIR}/pr-{number}.md에 리포트 작성

REPORT FORMAT (write this as the file content):

# PR #{number}: {title}
**Type:** Bugfix | **Author:** {author}
**Base:** {baseRefName} <- {headRefName} | **Draft:** {isDraft}

## Fix Summary
[어떤 버그, 어떻게 수정 - 변경된 코드의 permalink 포함]

## Code Review

### Correctness
[수정이 정확한가? 근본 원인이 다뤄졌는가? permalink가 포함된 증거]

### Side Effects
[위험한 변경, breaking 변경 - 있으면 permalink 포함]

### Code Quality
[스타일, 패턴, 테스트 커버리지]

## Merge Readiness

| Check | Status |
|-------|--------|
| CI | [PASS / FAIL / PENDING] |
| Review | [APPROVED / CHANGES_REQUESTED / PENDING / NONE] |
| Mergeable | [YES / NO / CONFLICTED] |
| Draft | [YES / NO] |
| Correctness | [VERIFIED / CONCERNS / UNCLEAR] |
| Risk | [NONE / LOW / MEDIUM / HIGH] |

## Files Changed
[간단한 설명과 함께 목록]

## Recommended Action: [MERGE | REQUEST_CHANGES | NEEDS_REVIEW | WAIT]
[증거가 포함된 추론]

---
NEVER merge. NEVER comment. NEVER review. 파일 작성만.
```

---

### PR_OTHER

```
You are reviewing PR #{number} for {REPO}.

ITEM:
- PR #{number}: {title}
- Author: {author}
- Base: {baseRefName} <- Head: {headRefName}
- Draft: {isDraft} | Mergeable: {mergeable}
- Review: {reviewDecision} | CI: {statusCheckRollup_summary}
- Body: {body}

TASK:
1. PR 세부 가져오기 (읽기 전용): gh pr view {number} --repo {REPO} --json files,reviews,comments,statusCheckRollup,reviewDecision
2. diff 읽기: gh api repos/{REPO}/pulls/{number}/files
3. {REPORT_DIR}/pr-{number}.md에 리포트 작성

REPORT FORMAT (write this as the file content):

# PR #{number}: {title}
**Type:** [FEATURE | REFACTOR | DOCS | CHORE | TEST | OTHER]
**Author:** {author}
**Base:** {baseRefName} <- {headRefName} | **Draft:** {isDraft}

## Summary
[주요 변경의 permalink가 포함된 2-3 문장]

## Status

| Check | Status |
|-------|--------|
| CI | [PASS / FAIL / PENDING] |
| Review | [APPROVED / CHANGES_REQUESTED / PENDING / NONE] |
| Mergeable | [YES / NO / CONFLICTED] |
| Risk | [LOW / MEDIUM / HIGH] |
| Alignment | [YES / NO / UNCLEAR] |

## Files Changed
[개수 및 주요 파일]

## Blockers
[있으면]

## Recommended Action: [MERGE | REQUEST_CHANGES | NEEDS_REVIEW | CLOSE | WAIT]
[추론]

---
NEVER merge. NEVER comment. NEVER review. 파일 작성만.
```

---

## Phase 4: 수집 & 업데이트

작업당 `background_output()` 폴링. 각 완료 시:
1. 리포트 파싱.
2. `task_update(id=task_id, status="completed", description=REPORT_SUMMARY)`
3. 사용자에게 즉시 스트리밍.

---

## Phase 5: 최종 요약

`{REPORT_DIR}/SUMMARY.md`에 작성하고 사용자에게 표시:

```markdown
# GitHub Triage Report - {REPO}

**Date:** {date} | **Commit:** {COMMIT_SHA}
**Items Processed:** {total}
**Report Directory:** {REPORT_DIR}

## Issues ({issue_count})
| Category | Count |
|----------|-------|
| Bug Confirmed | {n} |
| Bug Already Fixed | {n} |
| Not A Bug | {n} |
| Needs Investigation | {n} |
| Question Analyzed | {n} |
| Feature Assessed | {n} |
| Other | {n} |

## PRs ({pr_count})
| Category | Count |
|----------|-------|
| Bugfix Reviewed | {n} |
| Other PR Reviewed | {n} |

## Items Requiring Attention
[각 항목: 번호, 제목, 판정, 1줄 요약, 리포트 파일 링크]

## Report Files
[경로가 포함된 모든 생성 파일]
```

---

## 안티 패턴

| 위반 | 심각도 |
|-----------|----------|
| 어떠한 GitHub 변경 (comment/close/merge/review/label/edit) | **CRITICAL** |
| permalink 없는 주장 | **CRITICAL** |
| `quick` 외 다른 카테고리 사용 | CRITICAL |
| 여러 항목을 하나의 작업으로 배치 | CRITICAL |
| `run_in_background=false` | CRITICAL |
| PR 브랜치에 `git checkout` | CRITICAL |
| 코드베이스 증거 없이 추측 | HIGH |
| `{REPORT_DIR}`에 리포트 작성하지 않음 | HIGH |
| permalink에서 커밋 SHA 대신 브랜치 이름 사용 | HIGH |

---
description: GitHub Actions 워크플로를 통해 oh-my-opencode를 npm에 배포
argument-hint: <patch|minor|major>
---

<command-instruction>
당신은 oh-my-opencode의 릴리스 매니저입니다. 시작부터 끝까지 전체 publish 워크플로를 수행하세요.

## 중요: 인자 요구 사항

**반드시 사용자로부터 버전 범프 타입을 받아야 합니다.** 유효한 옵션:
- `patch`: 버그 수정, 하위 호환 (1.1.7 → 1.1.8)
- `minor`: 새 기능, 하위 호환 (1.1.7 → 1.2.0)
- `major`: Breaking 변경 (1.1.7 → 2.0.0)

**사용자가 범프 타입 인자를 제공하지 않은 경우, 즉시 중단하고 질문:**
> "To proceed with deployment, please specify a version bump type: `patch`, `minor`, or `major`"

**범프 타입에 대한 사용자의 명시적 확인 없이 진행 금지.**

---

## STEP 0: 할 일 목록 등록 (필수 첫 액션)

**다른 어떤 것을 하기 전에**, TodoWrite를 사용하여 상세한 할 일 목록을 생성하세요:

```
[
  { "id": "confirm-bump", "content": "Confirm version bump type with user (patch/minor/major)", "status": "in_progress", "priority": "high" },
  { "id": "check-uncommitted", "content": "Check for uncommitted changes and commit if needed", "status": "pending", "priority": "high" },
  { "id": "sync-remote", "content": "Sync with remote (pull --rebase && push if unpushed commits)", "status": "pending", "priority": "high" },
  { "id": "run-workflow", "content": "Trigger GitHub Actions publish workflow", "status": "pending", "priority": "high" },
  { "id": "wait-workflow", "content": "Wait for workflow completion (poll every 30s)", "status": "pending", "priority": "high" },
  { "id": "verify-and-preview", "content": "Verify release created + preview auto-generated changelog & contributor thanks", "status": "pending", "priority": "high" },
  { "id": "draft-summary", "content": "Draft enhanced release summary (mandatory for minor/major, optional for patch — ask user)", "status": "pending", "priority": "high" },
  { "id": "apply-summary", "content": "Prepend enhanced summary to release (if user opted in)", "status": "pending", "priority": "high" },
  { "id": "verify-npm", "content": "Verify npm package published successfully", "status": "pending", "priority": "high" },
  { "id": "wait-platform-workflow", "content": "Wait for publish-platform workflow completion", "status": "pending", "priority": "high" },
  { "id": "verify-platform-binaries", "content": "Verify all 7 platform binary packages published", "status": "pending", "priority": "high" },
  { "id": "final-confirmation", "content": "Final confirmation to user with links", "status": "pending", "priority": "low" }
]
```

**시작 시 각 todo를 `in_progress`, 완료 시 `completed`로 표시. 한 번에 하나씩.**

---

## STEP 1: 범프 타입 확인

범프 타입이 인자로 제공된 경우, 사용자에게 확인:
> "Version bump type: `{bump}`. Proceed? (y/n)"

진행 전에 사용자 확인을 기다린다.

---

## STEP 2: 커밋되지 않은 변경 사항 확인

실행: `git status --porcelain`

- 커밋되지 않은 변경 사항이 있으면 사용자에게 경고하고 먼저 커밋할지 질문
- 깨끗하면 진행

---

## STEP 2.5: 원격과 동기화 (필수)

푸시되지 않은 커밋이 있는지 확인:
```bash
git log origin/master..HEAD --oneline
```

**푸시되지 않은 커밋이 있으면, 워크플로 트리거 전에 반드시 동기화:**
```bash
git pull --rebase && git push
```

이는 GitHub Actions 워크플로가 모든 로컬 커밋을 포함한 최신 코드에서 실행되도록 보장한다.

---

## STEP 3: GitHub Actions 워크플로 트리거

publish 워크플로 실행:
```bash
gh workflow run publish -f bump={bump_type}
```

3초 대기 후, run ID 가져오기:
```bash
gh run list --workflow=publish --limit=1 --json databaseId,status --jq '.[0]'
```

---

## STEP 4: 워크플로 완료 대기

완료될 때까지 30초마다 워크플로 상태 폴링:
```bash
gh run view {run_id} --json status,conclusion --jq '{status: .status, conclusion: .conclusion}'
```

상태 흐름: `queued` → `in_progress` → `completed`

**중요: sleep 명령이 아닌 폴링 루프 사용.**

conclusion이 `failure`이면 오류 표시 후 중단:
```bash
gh run view {run_id} --log-failed
```

---

## STEP 5: 릴리스 검증 & 자동 생성된 콘텐츠 미리보기

두 가지 목표: 릴리스 존재 확인, 그 후 워크플로가 이미 생성한 내용을 사용자에게 표시.

```bash
# 최신 풀 (워크플로가 버전 범프를 커밋함)
git pull --rebase
NEW_VERSION=$(node -p "require('./package.json').version")

# GitHub에서 릴리스 존재 검증
gh release view "v${NEW_VERSION}" --json tagName,url --jq '{tag: .tagName, url: .url}'
```

**검증 후, 자동 생성된 콘텐츠의 로컬 미리보기 생성:**

```bash
bun run script/generate-changelog.ts
```

<agent-instruction>
미리보기 실행 후, 출력을 사용자에게 제시하고 다음과 같이 말하세요:

> **다음 콘텐츠는 릴리스에 자동으로 이미 포함되어 있습니다:**
> - 커밋 changelog (feat/fix/refactor로 그룹화)
> - 컨트리뷰터 감사 메시지 (팀 외 컨트리뷰터용)
>
> 이 중 어느 것도 작성할 필요가 없습니다. 자동 처리됩니다.
>
> **patch 릴리스의 경우**, 이는 보통 그 자체로 충분합니다. 그러나 강조할 만한 주목할 버그 수정이나 변경이 있다면, 향상된 요약을 추가할 수 있습니다.
> **minor/major 릴리스의 경우**, 향상된 요약은 **필수** — 다음 단계에서 초안을 작성합니다.

진행 전에 사용자가 인지할 때까지 대기.
</agent-instruction>

---

## STEP 6: 향상된 릴리스 요약 초안 작성

<decision-gate>

| 릴리스 타입 | 액션 |
|-------------|--------|
| **patch** | 사용자에게 질문: "Would you like me to draft an enhanced summary highlighting the key bug fixes / changes? Or is the auto-generated changelog sufficient?" 사용자가 거절 → Step 8로 스킵. 사용자가 수락 → 아래에 간결한 버그 수정 / 변경 요약 초안 작성. |
| **minor** | 필수. 간결한 기능 요약 초안 작성. 없이 진행 금지. |
| **major** | 필수. 해당 시 마이그레이션 노트를 포함한 전체 릴리스 내러티브 초안 작성. 없이 진행 금지. |

</decision-gate>

### 작성 대상 (그리고 작성하지 말 것)

당신이 작성하는 것은 **헤드라인 레이어** — 자동 생성 커밋 로그 위에 위치하는 제품 발표문이다. "git log"가 아닌 "릴리스 블로그 포스트"라고 생각하라.

<rules>
- 커밋 메시지를 절대 중복하지 말 것. 자동 생성 섹션이 이미 모든 커밋을 나열한다.
- "Various bug fixes and improvements" 또는 "Several enhancements" 같은 일반적인 필러를 절대 작성하지 말 것.
- 항상 사용자 영향에 집중: 사용자가 이전에 할 수 없었던 무엇을 이제 할 수 있는가?
- 항상 커밋 타입(feat/fix/refactor)이 아닌 테마 또는 능력별로 그룹화.
- 항상 구체적인 언어 사용: "Added X feature"가 아닌 "You can now do X".
</rules>

<examples>
<bad title="커밋 반복 — 하지 말 것">
## What's New
- feat(auth): add JWT refresh token rotation
- fix(auth): handle expired token edge case
- refactor(auth): extract middleware
</bad>

<good title="사용자 영향 내러티브 — 이렇게 할 것">
## 🔐 Smarter Authentication

Token refresh is now automatic and seamless. Sessions no longer expire mid-task — the system silently rotates credentials in the background. If you've been frustrated by random logouts, this release fixes that.
</good>

<bad title="모호한 필러 — 하지 말 것">
## Improvements
- Various performance improvements
- Bug fixes and stability enhancements
</bad>

<good title="구체적이고 측정 가능 — 이렇게 할 것">
## ⚡ 3x Faster Rule Parsing

Rules are now cached by file modification time. If your project has 50+ rule files, you'll notice startup is noticeably faster — we measured a 3x improvement in our test suite.
</good>
</examples>

### 초안 작성 프로세스

1. Step 5의 미리보기에서 커밋 목록을 **분석**. 사용자에게 중요한 2-5개 테마 식별.
2. `/tmp/release-summary-v${NEW_VERSION}.md`에 요약을 **작성**.
3. 적용 전에 검토 및 승인을 위해 사용자에게 초안 **제시**.

```bash
# 여기에 초안 작성
cat > /tmp/release-summary-v${NEW_VERSION}.md << 'SUMMARY_EOF'
{your_enhanced_summary}
SUMMARY_EOF

cat /tmp/release-summary-v${NEW_VERSION}.md
```

<agent-instruction>
초안 작성 후, 사용자에게 질문:
> "Here's the release summary I drafted. This will appear AT THE TOP of the release notes, above the auto-generated commit changelog and contributor thanks. Want me to adjust anything before applying?"

사용자 확인 없이 Step 7 진행 금지.
</agent-instruction>

---

## STEP 7: 향상된 요약을 릴리스에 적용

**사용자가 Step 6에서 향상된 요약을 거부한 경우에만 이 단계 스킵** — Step 8로 직접 진행.

<architecture>
최종 릴리스 노트 구조:

```
┌─────────────────────────────────────┐
│  Enhanced Summary (from Step 6)     │  ← 당신이 작성
│  - Theme-based, user-impact focused │
├─────────────────────────────────────┤
│  ---  (separator)                   │
├─────────────────────────────────────┤
│  Auto-generated Commit Changelog    │  ← 워크플로가 작성
│  - feat/fix/refactor grouped        │
│  - Contributor thank-you messages   │
└─────────────────────────────────────┘
```
</architecture>

<zero-content-loss-policy>
- 먼저 기존 릴리스 본문을 가져옴
- 그 위에 요약을 덧붙임
- 기존 자동 생성 콘텐츠는 100% 그대로 유지되어야 함
- 기존 콘텐츠의 단 한 글자도 제거하거나 수정해서는 안 됨
</zero-content-loss-policy>

```bash
# 1. 기존 자동 생성 본문 가져오기
EXISTING_BODY=$(gh release view "v${NEW_VERSION}" --json body --jq '.body')

# 2. 결합: 향상된 요약 위, 자동 생성 아래
{
  cat /tmp/release-summary-v${NEW_VERSION}.md
  echo ""
  echo "---"
  echo ""
  echo "$EXISTING_BODY"
} > /tmp/final-release-v${NEW_VERSION}.md

# 3. 릴리스 업데이트 (추가만)
gh release edit "v${NEW_VERSION}" --notes-file /tmp/final-release-v${NEW_VERSION}.md

# 4. 확인
echo "✅ Release v${NEW_VERSION} updated with enhanced summary."
gh release view "v${NEW_VERSION}" --json url --jq '.url'
```

---

## STEP 8: npm 배포 검증

새 버전이 나타날 때까지 npm 레지스트리 폴링:
```bash
npm view oh-my-opencode version
```

예상 버전과 비교. 2분 후에도 일치하지 않으면 npm 전파 지연에 대해 사용자에게 경고.

---

## STEP 8.5: 플랫폼 워크플로 완료 대기

메인 publish 워크플로는 플랫폼별 바이너리를 위한 별도의 `publish-platform` 워크플로를 트리거한다.

1. 메인 워크플로에 의해 트리거된 publish-platform 워크플로 실행 찾기:
```bash
gh run list --workflow=publish-platform --limit=1 --json databaseId,status,conclusion --jq '.[0]'
```

2. 완료될 때까지 30초마다 워크플로 상태 폴링:
```bash
gh run view {platform_run_id} --json status,conclusion --jq '{status: .status, conclusion: .conclusion}'
```

**중요: sleep 명령이 아닌 폴링 루프 사용.**

conclusion이 `failure`이면 오류 로그 표시:
```bash
gh run view {platform_run_id} --log-failed
```

---

## STEP 8.6: 플랫폼 바이너리 패키지 검증

publish-platform 워크플로 완료 후, 7개의 모든 플랫폼 패키지가 배포되었는지 검증:

```bash
PLATFORMS="darwin-arm64 darwin-x64 linux-x64 linux-arm64 linux-x64-musl linux-arm64-musl windows-x64"
for PLATFORM in $PLATFORMS; do
  npm view "oh-my-opencode-${PLATFORM}" version
done
```

7개 패키지 모두 메인 패키지(`${NEW_VERSION}`)와 동일한 버전을 표시해야 한다.

**예상 패키지:**
| 패키지 | 설명 |
|---------|-------------|
| `oh-my-opencode-darwin-arm64` | macOS Apple Silicon |
| `oh-my-opencode-darwin-x64` | macOS Intel |
| `oh-my-opencode-linux-x64` | Linux x64 (glibc) |
| `oh-my-opencode-linux-arm64` | Linux ARM64 (glibc) |
| `oh-my-opencode-linux-x64-musl` | Linux x64 (musl/Alpine) |
| `oh-my-opencode-linux-arm64-musl` | Linux ARM64 (musl/Alpine) |
| `oh-my-opencode-windows-x64` | Windows x64 |

플랫폼 패키지 버전이 일치하지 않으면, 사용자에게 경고하고 publish-platform 워크플로 로그 확인을 제안.

---

## STEP 9: 최종 확인

다음을 사용자에게 보고:
- 새 버전 번호
- GitHub 릴리스 URL: https://github.com/code-yeongyu/oh-my-opencode/releases/tag/v{version}
- npm 패키지 URL: https://www.npmjs.com/package/oh-my-opencode
- 플랫폼 패키지 상태: 7개 플랫폼 패키지와 버전 모두 나열

---

## 오류 처리

- **워크플로 실패**: 실패 로그 표시, Actions 탭 확인 제안
- **릴리스를 찾을 수 없음**: 대기 후 재시도, 전파 지연일 수 있음
- **npm 미업데이트**: npm 전파에 1-5분 소요 가능, 사용자에게 알림
- **권한 거부**: 사용자가 `gh auth login`으로 재인증 필요할 수 있음
- **플랫폼 워크플로 실패**: publish-platform 워크플로 로그 표시, 어느 플랫폼이 실패했는지 확인
- **플랫폼 패키지 누락**: 일부 플랫폼은 크로스 컴파일 문제로 실패할 수 있음, publish-platform 워크플로를 수동으로 재실행 제안

## 언어

사용자에게 영어로 응답.

</command-instruction>

<current-context>
<published-version>
!`npm view oh-my-opencode version 2>/dev/null || echo "not published"`
</published-version>
<local-version>
!`node -p "require('./package.json').version" 2>/dev/null || echo "unknown"`
</local-version>
<git-status>
!`git status --porcelain`
</git-status>
<recent-commits>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git log "v{}"..HEAD --oneline 2>/dev/null | head -15 || echo "no commits"`
</recent-commits>
</current-context>

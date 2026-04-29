---
name: work-with-pr
description: "전체 PR 라이프사이클: git worktree → 구현 → 원자적 커밋 → PR 생성 → 검증 루프 (CI + review-work + Cubic 승인) → 머지. 모든 게이트가 통과하고 PR이 머지될 때까지 반복. 머지 후 worktree 자동 정리. 구현 작업이 PR로 도달해야 할 때마다 사용. 트리거: 'create a PR', 'implement and PR', 'work on this and make a PR', 'implement issue', 'land this as a PR', 'work-with-pr', 'PR workflow', 'implement end to end'. 사용자가 'implement X'라고만 말해도 컨텍스트가 PR 전달을 암시하면."
---

# Work With PR — 전체 PR 라이프사이클

격리된 워크트리 셋업부터 구현, PR 생성, PR이 머지될 때까지의 무한 검증 루프까지 완전한 PR 라이프사이클을 실행하고 있다. 루프에는 세 게이트가 있다 — CI, review-work, Cubic — 그리고 세 가지가 동시에 통과할 때까지 수정과 푸시를 계속한다.

<architecture>

```
Phase 0: Setup         → 형제 디렉터리에 브랜치 + 워크트리
Phase 1: Implement     → 작업 수행, 원자적 커밋
Phase 2: PR Creation   → 푸시, dev를 타겟으로 PR 생성
Phase 3: Verify Loop   → 모든 게이트가 통과할 때까지 무한 반복:
  ├─ Gate A: CI         → gh pr checks (bun test, typecheck, build)
  ├─ Gate B: review-work → 5-에이전트 병렬 리뷰
  └─ Gate C: Cubic      → cubic-dev-ai[bot] "No issues found"
Phase 4: Merge         → 스쿼시 머지, 워크트리 정리
```

</architecture>

---

## Phase 0: 셋업

사용자의 메인 작업 디렉터리가 깨끗하게 유지되도록 격리된 워크트리 생성. 사용자에게 커밋되지 않은 작업이 있을 수 있고, 브랜치를 체크아웃하면 그것이 파괴되기 때문에 중요하다.

<setup>

### 1. 저장소 컨텍스트 해석

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPO_NAME=$(basename "$PWD")
BASE_BRANCH="dev"  # CI는 master로의 PR을 차단
```

### 2. 브랜치 생성

사용자가 브랜치 이름을 제공하면 그것을 사용. 그렇지 않으면 작업에서 파생:

```bash
# 자동 생성: feature/short-description 또는 fix/short-description
BRANCH_NAME="feature/$(echo "$TASK_SUMMARY" | tr '[:upper:] ' '[:lower:]-' | head -c 50)"
git fetch origin "$BASE_BRANCH"
git branch "$BRANCH_NAME" "origin/$BASE_BRANCH"
```

### 3. 워크트리 생성

워크트리를 저장소 내부가 아닌 형제로 배치 — git 중첩 저장소 문제를 피하고 작업 트리를 깨끗하게 유지.

```bash
WORKTREE_PATH="../${REPO_NAME}-wt/${BRANCH_NAME}"
mkdir -p "$(dirname "$WORKTREE_PATH")"
git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
```

### 4. 작업 컨텍스트 설정

이후 모든 작업은 워크트리 내부에서 일어남. 필요 시 의존성 설치:

```bash
cd "$WORKTREE_PATH"
# bun 프로젝트인 경우:
[ -f "bun.lock" ] && bun install
```

</setup>

---

## Phase 1: 구현

워크트리 내부에서 실제 구현 작업 수행. 이 스킬을 사용하는 에이전트가 직접 작업 수행 — 구현 자체에는 서브에이전트 위임 없음.

**범위 규율**: 버그 수정의 경우 최소로 유지. 버그를 수정하고, 그것을 위한 테스트를 추가하고, 끝. 주변 코드를 리팩토링하거나 설정 옵션을 추가하거나 깨지지 않은 것을 "개선"하지 말 것. 검증 루프가 회귀를 잡을 것이다 — 프로세스를 신뢰하라.

<implementation>

### 커밋 전략

git-master 스킬의 원자적 커밋 원칙 사용. 원자적 커밋의 이유: CI가 한 변경에서 실패하면, 모든 것을 되돌리지 않고도 분리하여 수정할 수 있다.

```
3+ 파일 변경  → 최소 2+ 커밋
5+ 파일 변경  → 최소 3+ 커밋
10+ 파일 변경 → 최소 5+ 커밋
```

각 커밋은 구현과 그 테스트를 짝지어야 한다. 커밋 시 `git-master` 스킬 로드:

```
task(category="quick", load_skills=["git-master"], prompt="Commit the changes atomically following git-master conventions. Repository is at {WORKTREE_PATH}.")
```

### 푸시 전 로컬 검증

푸시 전에 CI가 실행할 동일한 검사 실행. 로컬에서 실패를 잡으면 전체 CI 라운드트립(~3-5분)을 절약한다:

```bash
bun run typecheck
bun test
bun run build
```

푸시 전에 실패를 수정. 각 수정-커밋 사이클은 원자적이어야 한다.

</implementation>

---

## Phase 2: PR 생성

<pr_creation>

### 푸시 및 PR 생성

```bash
git push -u origin "$BRANCH_NAME"
```

프로젝트의 템플릿 구조를 사용하여 PR 생성:

```bash
gh pr create \
  --base "$BASE_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "$PR_TITLE" \
  --body "$(cat <<'EOF'
## Summary
[1-3 sentences describing what this PR does and why]

## Changes
[Bullet list of key changes]

## Testing
- `bun run typecheck` ✅
- `bun test` ✅
- `bun run build` ✅

## Related Issues
[Link to issue if applicable]
EOF
)"
```

PR 번호 캡처:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
```

</pr_creation>

---

## Phase 3: 검증 루프

이것이 스킬의 핵심이다. 세 게이트 모두 PR이 준비되려면 통과해야 한다. 루프는 반복 한도 없음 — 완료될 때까지 계속. 게이트 순서는 의도적이다: CI는 가장 저렴/빠르고, review-work는 가장 철저하며, Cubic은 외부적이고 비동기이다.

<verify_loop>

```
while true:
  1. CI 대기              → Gate A
  2. CI 실패 시          → 로그 읽기, 수정, 커밋, 푸시, 계속
  3. review-work 실행      → Gate B
  4. 리뷰 실패 시      → 차단 이슈 수정, 커밋, 푸시, 계속
  5. Cubic 확인          → Gate C
  6. Cubic에 이슈 있으면   → 이슈 수정, 커밋, 푸시, 계속
  7. 셋 다 통과       → break
```

### Gate A: CI 검사

CI는 가장 빠른 피드백 루프. 완료를 기다린 다음 결과를 파싱.

```bash
# 검사가 시작될 때까지 대기 (GitHub은 푸시 후 잠시 필요)
# 그런 다음 완료 감시
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

**실패 시**: 무엇이 깨졌는지 이해하기 위해 실패한 실행 로그 가져오기:

```bash
# 실패한 실행 찾기
RUN_ID=$(gh run list --branch "$BRANCH_NAME" --status failure --json databaseId --jq '.[0].databaseId')

# 실패한 작업 로그 가져오기
gh run view "$RUN_ID" --log-failed
```

로그 읽기, 이슈 수정, 원자적 커밋, 푸시, 루프 재진입.

### Gate B: review-work

review-work 스킬은 5개의 병렬 서브에이전트(목표 검증, QA, 코드 품질, 보안, 컨텍스트 마이닝)를 발사한다. 5개 모두 통과해야 한다.

CI 통과 후 review-work 호출 — 빌드되지 않는 코드를 리뷰할 의미가 없다:

```
task(
  category="unspecified-high",
  load_skills=["review-work"],
  run_in_background=false,
  description="Post-implementation review of PR changes",
  prompt="Review the implementation work on branch {BRANCH_NAME}. The worktree is at {WORKTREE_PATH}. Goal: {ORIGINAL_GOAL}. Constraints: {CONSTRAINTS}. Run command: bun run dev (or as appropriate)."
)
```

**실패 시**: review-work는 특정 파일과 라인 번호로 차단 이슈 보고. 각 차단 이슈 수정, 커밋, 푸시, Gate A에서 루프 재진입 (코드가 변경되었으므로 CI를 다시 실행해야 함).

### Gate C: Cubic 승인

Cubic (`cubic-dev-ai[bot]`)은 PR에 댓글을 다는 자동 리뷰 봇. GitHub의 APPROVED 리뷰 상태를 사용하지 않음 — 대신 이슈 수와 신뢰도 점수가 포함된 댓글을 게시.

**승인 신호**: 최신 Cubic 댓글에 `**No issues found**`와 신뢰도 `**5/5**` 포함.

**이슈 신호**: 댓글에 파일 수준 세부 정보가 포함된 이슈 나열.

```bash
# 최신 Cubic 리뷰 가져오기
CUBIC_REVIEW=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
  --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .body')

# 승인 여부 확인
if echo "$CUBIC_REVIEW" | grep -q "No issues found"; then
  echo "Cubic: APPROVED"
else
  echo "Cubic: ISSUES FOUND"
  echo "$CUBIC_REVIEW"
fi
```

**이슈 발생 시**: Cubic의 리뷰 본문은 구조화된 이슈 설명을 포함. 파싱하고, 어느 것이 유효한지 (일부는 false positive일 수 있음) 결정하고, 유효한 것을 수정, 커밋, 푸시, Gate A에서 재진입.

Cubic 리뷰는 PR 업데이트 시 자동으로 트리거됨. 수정 푸시 후, 다시 확인하기 전에 새 리뷰가 나타날 때까지 대기. 조건부 루프와 함께 `gh api` 폴링 사용:

```bash
# 푸시 후 새 Cubic 리뷰 대기
PUSH_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
while true; do
  LATEST_REVIEW_TIME=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
    --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .submitted_at')
  if [[ "$LATEST_REVIEW_TIME" > "$PUSH_TIME" ]]; then
    break
  fi
  # gh api 호출 자체를 지연 메커니즘으로 사용 — 각 호출에 ~1-2초
  # 더 긴 대기는: timeout 30 gh pr checks "$PR_NUMBER" --watch 2>/dev/null || true
done
```

### 반복 규율

루프의 각 반복:
1. 실패한 게이트가 식별한 이슈만 수정
2. 원자적 커밋 (커밋당 하나의 논리적 수정)
3. 푸시
4. Gate A에서 재진입 (코드 변경 → 전체 재검증)

수정 반복 중 관련 없는 코드를 "개선"하려는 유혹을 피할 것. 수정 루프의 범위 확장은 디버깅을 어렵게 하고 새로운 실패를 유발할 수 있다.

</verify_loop>

---

## Phase 4: 머지 & 정리

세 게이트 모두 통과 후:

<merge_cleanup>

### PR 머지

```bash
# 깨끗한 히스토리를 위한 스쿼시 머지
gh pr merge "$PR_NUMBER" --squash --delete-branch
```

### .sisyphus 상태를 메인 레포로 동기화

워크트리를 제거하기 전에 `.sisyphus/` 상태를 다시 복사. `.sisyphus/`가 gitignore되면, 워크트리 실행 중 그곳에 작성된 파일은 커밋되거나 머지되지 않음 — 워크트리 제거 시 손실됨.

```bash
# 워크트리에서 메인 레포로 .sisyphus 상태 동기화 (작업 상태, 계획, 노트패드 보존)
if [ -d "$WORKTREE_PATH/.sisyphus" ]; then
  mkdir -p "$ORIGINAL_DIR/.sisyphus"
  cp -r "$WORKTREE_PATH/.sisyphus/"* "$ORIGINAL_DIR/.sisyphus/" 2>/dev/null || true
fi
```

### 워크트리 정리

워크트리는 목적을 달성함 — 디스크 비대화를 피하기 위해 제거:

```bash
cd "$ORIGINAL_DIR"  # 원래 작업 디렉터리로 복귀
git worktree remove "$WORKTREE_PATH"
# 오래된 워크트리 참조 정리
git worktree prune
```

### 완료 보고

무슨 일이 일어났는지 요약:

```
## PR Merged ✅

- **PR**: #{PR_NUMBER} — {PR_TITLE}
- **Branch**: {BRANCH_NAME} → {BASE_BRANCH}
- **Iterations**: {N} verification loops
- **Gates passed**: CI ✅ | review-work ✅ | Cubic ✅
- **Worktree**: cleaned up
```

</merge_cleanup>

---

## 실패 복구

<failure_recovery>

복구 불가능한 오류(예: 베이스 브랜치와의 머지 충돌, 인프라 실패)를 만났을 때:

1. **워크트리를 삭제하지 말 것** — 사용자가 검사하거나 수동으로 계속하길 원할 수 있음
2. 무엇이 일어났는지, 무엇을 시도했는지, 상황이 어디에 있는지 보고
3. 사용자가 재개할 수 있도록 워크트리 경로 포함

머지 충돌의 경우:

```bash
cd "$WORKTREE_PATH"
git fetch origin "$BASE_BRANCH"
git rebase "origin/$BASE_BRANCH"
# 충돌 해결, 그런 다음 루프 계속
```

</failure_recovery>

---

## 안티 패턴

| 위반 | 왜 실패하는가 | 심각도 |
|-----------|-------------|----------|
| 격리된 워크트리 대신 메인 워크트리에서 작업 | 사용자의 작업 디렉터리 오염, 커밋되지 않은 작업 파괴 가능 | CRITICAL |
| dev/master에 직접 푸시 | 리뷰를 완전히 우회 | CRITICAL |
| 코드 변경 후 CI 게이트 스킵 | review-work와 Cubic이 오래된 코드에서 통과할 수 있음 | CRITICAL |
| 검증 루프 중 관련 없는 코드 수정 | 범위 확장이 새 실패 유발 | HIGH |
| 실패 시 워크트리 삭제 | 사용자가 검사/재개 능력 손실 | HIGH |
| 정당한 이유 없이 Cubic false positive 무시 | Cubic 이슈는 평가되어야 하지 맹목적으로 무시되면 안 됨 | MEDIUM |
| 거대한 단일 커밋 | 실패 분리가 어렵고, git-master 원칙 위반 | MEDIUM |
| 푸시 전 로컬 검사 미실행 | 명백한 실패에 CI 시간 낭비 | MEDIUM |

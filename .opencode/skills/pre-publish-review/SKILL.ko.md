---
name: pre-publish-review
description: "핵폭탄급 16-에이전트 사전 배포 릴리스 게이트. /get-unpublished-changes를 실행해 마지막 npm 릴리스 이후 모든 변경을 감지하고, 변경별 깊은 분석을 위해 ultrabrain 에이전트 최대 10개를 스폰하며, 종합 리뷰를 위해 /review-work(5 에이전트)를 호출하고, 전체 릴리스 종합을 위해 oracle 1개를 호출. 매번 npm publish 전에 사용. 트리거: 'pre-publish review', 'review before publish', 'release review', 'pre-release review', 'ready to publish?', 'can I publish?', 'pre-publish', 'safe to publish', 'publishing review', 'pre-publish check'."
---

# Pre-Publish Review — 16-에이전트 릴리스 게이트

npm 배포 전 3-레이어 리뷰. 모든 레이어가 다른 각도를 커버 — 함께라면 단일 리뷰어가 잡을 수 없는 것을 잡는다.

| 레이어 | 에이전트 | 타입 | 무엇을 검사 |
|-------|--------|------|-----------------|
| 변경별 심층 분석 | 최대 10 | ultrabrain | 각 논리적 변경 그룹 개별 — 정확성, 엣지 케이스, 패턴 준수 |
| 종합 리뷰 | 5 | review-work | 목표 준수, QA 실행, 코드 품질, 보안, 전체 변경셋에 걸친 컨텍스트 마이닝 |
| 릴리스 종합 | 1 | oracle | 전체 릴리스 준비도, 버전 범프, breaking 변경, 배포 위험 |

---

## Phase 0: 배포되지 않은 변경 감지

`/get-unpublished-changes`를 먼저 실행. 이는 무엇이 변경되었는지에 대한 단일 진실 소스다.

```
skill(name="get-unpublished-changes")
```

이 명령은 자동으로:
- 배포된 npm 버전 vs 로컬 버전 감지
- 마지막 릴리스 이후 모든 커밋 나열
- (커밋 메시지가 아닌) 실제 diff를 읽어 진짜 변경을 기술
- 타입(feat/fix/refactor/docs)과 범위로 그룹화
- breaking 변경 식별
- 버전 범프 권장 (patch/minor/major)

**전체 출력을 저장** — Phase 1 그룹화와 모든 에이전트 프롬프트에 직접 공급된다.

그런 다음 에이전트 프롬프트에 필요한 원시 데이터 캡처:

```bash
# 버전 추출 (이미 /get-unpublished-changes 출력에 있음)
PUBLISHED=$(npm view oh-my-opencode version 2>/dev/null || echo "not published")
LOCAL=$(node -p "require('./package.json').version" 2>/dev/null || echo "unknown")

# 에이전트용 원시 데이터 (diff, 파일 목록)
COMMITS=$(git log "v${PUBLISHED}"..HEAD --oneline 2>/dev/null || echo "no commits")
COMMIT_COUNT=$(echo "$COMMITS" | wc -l | tr -d ' ')
DIFF_STAT=$(git diff "v${PUBLISHED}"..HEAD --stat 2>/dev/null || echo "no diff")
CHANGED_FILES=$(git diff --name-only "v${PUBLISHED}"..HEAD 2>/dev/null || echo "none")
FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
```

`PUBLISHED`가 "not published"이면, 첫 릴리스다 — 대신 전체 git 히스토리 사용.
---

## Phase 1: 변경을 그룹으로 파싱

`/get-unpublished-changes` 출력을 시작점으로 사용 — 이미 범위와 타입으로 그룹화되어 있다.

**그룹화 전략:**
1. 이미 feat/fix/refactor/docs와 범위로 분류된 `/get-unpublished-changes` 분석에서 시작
2. **모듈/영역별**로 더 분할 — 같은 모듈이나 피처 영역을 건드리는 변경은 함께 묶임
3. **최대 10그룹** 목표. 커밋이 10개 미만이면, 각 커밋이 자체 그룹. 논리 영역이 10개 초과면, 가장 작은 그룹들을 병합.
4. 각 그룹에 대해 추출:
   - **그룹 이름**: 짧은 설명 라벨 (예: "agent-model-resolution", "hook-system-refactor")
   - **커밋**: 커밋 해시와 메시지 목록
   - **파일**: 이 그룹에서 변경된 파일
   - **diff**: 전체 diff의 관련 부분 (`git diff v${PUBLISHED}..HEAD -- {group files}`)

---

## Phase 2: 모든 에이전트 스폰

단일 턴에서 모든 에이전트 발사. 모든 에이전트가 `run_in_background=true` 사용. 순차 발사 없음.

### Layer 1: Ultrabrain 변경별 분석 (최대 10)

각 변경 그룹에 대해 ultrabrain 에이전트 하나 스폰. 각 에이전트는 전체 변경셋이 아닌 자신의 diff 부분만 받는다.

```
task(
  category="ultrabrain",
  run_in_background=true,
  load_skills=[],
  description="Deep analysis: {GROUP_NAME}",
  prompt="""
<review_type>PER-CHANGE DEEP ANALYSIS</review_type>
<change_group>{GROUP_NAME}</change_group>

<project>oh-my-opencode (npm package)</project>
<published_version>{PUBLISHED}</published_version>
<target_version>{LOCAL}</target_version>

<commits>
{GROUP_COMMITS — 이 그룹의 각 커밋의 해시와 메시지}
</commits>

<changed_files>
{GROUP_FILES — 이 그룹에서 변경된 파일}
</changed_files>

<diff>
{GROUP_DIFF — 이 그룹 파일의 diff만}
</diff>

<file_contents>
{이 그룹에서 변경된 각 파일의 전체 내용을 읽고 포함}
</file_contents>

You are reviewing a specific subset of changes heading into an npm release. Focus exclusively on THIS change group. Other groups are reviewed by parallel agents.

ANALYSIS CHECKLIST:

1. **Intent Clarity**: What is this change trying to do? Is the intent clear from the code and commit messages? If you have to guess, that's a finding.

2. **Correctness**: Trace through the logic for 3+ scenarios. Does the code actually do what it claims? Off-by-one errors, null handling, async edge cases, resource cleanup.

3. **Breaking Changes**: Does this change alter any public API, config format, CLI behavior, or hook contract? If yes, is it backward compatible? Would existing users be surprised?

4. **Pattern Adherence**: Does the new code follow the established patterns visible in the existing file contents? New patterns where old ones exist = finding.

5. **Edge Cases**: What inputs or conditions would break this? Empty arrays, undefined values, concurrent calls, very large inputs, missing config fields.

6. **Error Handling**: Are errors properly caught and propagated? No empty catch blocks? No swallowed promises?

7. **Type Safety**: Any `as any`, `@ts-ignore`, `@ts-expect-error`? Loose typing where strict is possible?

8. **Test Coverage**: Are the behavioral changes covered by tests? Are the tests meaningful or just coverage padding?

9. **Side Effects**: Could this change break something in a different module? Check imports and exports — who depends on what changed?

10. **Release Risk**: On a scale of SAFE / CAUTION / RISKY — how confident are you this change won't cause issues in production?

OUTPUT FORMAT:
<group_name>{GROUP_NAME}</group_name>
<verdict>PASS or FAIL</verdict>
<risk>SAFE / CAUTION / RISKY</risk>
<summary>2-3 sentence assessment of this change group</summary>
<has_breaking_changes>YES or NO</has_breaking_changes>
<breaking_change_details>If YES, describe what breaks and for whom</breaking_change_details>
<findings>
  For each finding:
  - [CRITICAL/MAJOR/MINOR] Category: Description
  - File: path (line range)
  - Evidence: specific code reference
  - Suggestion: how to fix
</findings>
<blocking_issues>Issues that MUST be fixed before publish. Empty if PASS.</blocking_issues>
""")
```

### Layer 2: /review-work를 통한 종합 리뷰 (5 에이전트)

`/review-work` 스킬을 로드하는 서브에이전트 스폰. review-work 스킬은 내부적으로 5개의 병렬 에이전트(Oracle (목표 검증), unspecified-high (QA 실행), Oracle (코드 품질), Oracle (보안), unspecified-high (컨텍스트 마이닝))를 발사한다. 리뷰가 통과하려면 5개 모두 통과해야 한다.

```
task(
  category="unspecified-high",
  run_in_background=true,
  load_skills=["review-work"],
  description="Run /review-work on all unpublished changes",
  prompt="""
Run /review-work on the unpublished changes between v{PUBLISHED} and HEAD.

GOAL: Review all changes heading into npm publish of oh-my-opencode. These changes span {COMMIT_COUNT} commits across {FILE_COUNT} files.

CONSTRAINTS:
- This is a plugin published to npm — public API stability matters
- TypeScript strict mode, Bun runtime
- No `as any`, `@ts-ignore`, `@ts-expect-error`
- Factory pattern (createXXX) for tools, hooks, agents
- kebab-case files, barrel exports, no catch-all files

BACKGROUND: Pre-publish review of oh-my-opencode, an OpenCode plugin with 1268 TypeScript files, 160k LOC. Changes since v{PUBLISHED} are about to be published.

The diff base is: git diff v{PUBLISHED}..HEAD

Follow the /review-work skill flow exactly — launch all 5 review agents and collect results. Do NOT skip any of the 5 agents.
""")
```

### Layer 3: Oracle 릴리스 종합 (1 에이전트)

oracle은 전체 그림 — 모든 커밋, 전체 diff stat, 변경된 파일 목록 — 을 받는다. 최종 릴리스 준비도 평가를 제공한다.

```
task(
  subagent_type="oracle",
  run_in_background=true,
  load_skills=[],
  description="Oracle: overall release synthesis and version bump recommendation",
  prompt="""
<review_type>RELEASE SYNTHESIS — OVERALL ASSESSMENT</review_type>

<project>oh-my-opencode (npm package)</project>
<published_version>{PUBLISHED}</published_version>
<local_version>{LOCAL}</local_version>

<all_commits>
{ALL COMMITS since published version — 해시, 메시지, 작성자, 날짜}
</all_commits>

<diff_stat>
{DIFF_STAT — 변경된 파일, 추가, 삭제}
</diff_stat>

<changed_files>
{CHANGED_FILES — 수정된 파일 경로의 전체 목록}
</changed_files>

<full_diff>
{FULL_DIFF — 배포된 버전과 HEAD 간의 전체 git diff}
</full_diff>

<file_contents>
{핵심 변경 파일의 전체 내용을 읽고 포함 — 공개 API 표면, 설정 스키마, 에이전트 정의, 훅 등록, 도구 등록에 집중}
</file_contents>

You are the final gate before an npm publish. 10 ultrabrain agents are reviewing individual changes and 5 review-work agents are doing holistic review. Your job is the bird's-eye view that those focused reviews might miss.

SYNTHESIS CHECKLIST:

1. **Release Coherence**: Do these changes tell a coherent story? Or is this a grab-bag of unrelated changes that should be split into multiple releases?

2. **Version Bump**: Based on semver:
   - PATCH: Bug fixes only, no behavior changes
   - MINOR: New features, backward-compatible changes
   - MAJOR: Breaking changes to public API, config format, or behavior
   Recommend the correct bump with specific justification.

3. **Breaking Changes Audit**: Exhaustively list every change that could break existing users. Check:
   - Config schema changes (new required fields, removed fields, renamed fields)
   - Agent behavior changes (different prompts, different model routing)
   - Hook contract changes (new parameters, removed hooks, renamed hooks)
   - Tool interface changes (new required params, different return types)
   - CLI changes (new commands, changed flags, different output)
   - Skill format changes (SKILL.md schema changes)

4. **Migration Requirements**: If there are breaking changes, what migration steps do users need? Is there auto-migration in place?

5. **Dependency Changes**: New dependencies added? Dependencies removed? Version bumps? Any supply chain risk?

6. **Changelog Draft**: Write a draft changelog entry grouped by:
   - feat: New features
   - fix: Bug fixes
   - refactor: Internal changes (no user impact)
   - breaking: Breaking changes with migration instructions
   - docs: Documentation changes

7. **Deployment Risk Assessment**:
   - SAFE: Routine changes, well-tested, low risk
   - CAUTION: Significant changes but manageable risk
   - RISKY: Large surface area changes, insufficient testing, or breaking changes without migration
   - BLOCK: Critical issues found, do NOT publish

8. **Post-Publish Monitoring**: What should be monitored after publish? Error rates, specific features, user feedback channels.

OUTPUT FORMAT:
<verdict>SAFE / CAUTION / RISKY / BLOCK</verdict>
<recommended_version_bump>PATCH / MINOR / MAJOR</recommended_version_bump>
<version_bump_justification>Why this bump level</version_bump_justification>
<release_coherence>Assessment of whether changes belong in one release</release_coherence>
<breaking_changes>
  Exhaustive list, or "None" if none.
  For each:
  - What changed
  - Who is affected
  - Migration steps
</breaking_changes>
<changelog_draft>
  Ready-to-use changelog entry
</changelog_draft>
<deployment_risk>
  Overall risk assessment with specific concerns
</deployment_risk>
<monitoring_recommendations>
  What to watch after publish
</monitoring_recommendations>
<blocking_issues>Issues that MUST be fixed before publish. Empty if SAFE.</blocking_issues>
""")
```

---

## Phase 3: 결과 수집

에이전트가 완료되면 (시스템 알림), `background_output(task_id="...")`를 통해 수집.

완료 추적 표:

| # | 에이전트 | 타입 | 상태 | 판정 |
|---|-------|------|--------|---------|
| 1-10 | Ultrabrain: {group_name} | ultrabrain | pending | — |
| 11 | Review-Work Coordinator | unspecified-high | pending | — |
| 12 | Release Synthesis Oracle | oracle | pending | — |

모든 에이전트가 완료될 때까지 최종 리포트를 전달하지 말 것.

---

## Phase 4: 최종 판정

<verdict_logic>

다음의 경우 **BLOCK**:
- Oracle 판정이 BLOCK
- 어떤 ultrabrain이 CRITICAL 차단 이슈 발견
- review-work가 어떤 메인 에이전트에서 실패

다음의 경우 **RISKY**:
- Oracle 판정이 RISKY
- 여러 ultrabrain이 CAUTION 또는 FAIL 반환
- review-work는 통과했지만 중요한 발견 있음

다음의 경우 **CAUTION**:
- Oracle 판정이 CAUTION
- 일부 ultrabrain이 사소한 문제 표시
- review-work 깔끔히 통과

다음의 경우 **SAFE**:
- Oracle 판정이 SAFE
- 모든 ultrabrain 통과
- review-work 통과

</verdict_logic>

최종 리포트 컴파일:

```markdown
# Pre-Publish Review — oh-my-opencode

## Release: v{PUBLISHED} -> v{LOCAL}
**Commits:** {COMMIT_COUNT} | **Files Changed:** {FILE_COUNT} | **Agents:** {AGENT_COUNT}

---

## 전체 판정: SAFE / CAUTION / RISKY / BLOCK

## 권장 버전 범프: PATCH / MINOR / MAJOR
{Oracle의 정당화}

---

## 변경별 분석 (Ultrabrains)

| # | 변경 그룹 | 판정 | 위험 | Breaking? | 차단 이슈 |
|---|-------------|---------|------|-----------|-----------------|
| 1 | {name} | PASS/FAIL | SAFE/CAUTION/RISKY | YES/NO | {count or "none"} |
| ... | ... | ... | ... | ... | ... |

### 변경별 분석에서 차단 이슈
{모든 ultrabrain에서 집계 — 중복 제거}

---

## 종합 리뷰 (Review-Work)

| # | 리뷰 영역 | 판정 | 신뢰도 |
|---|------------|---------|------------|
| 1 | Goal & Constraint Verification | PASS/FAIL | HIGH/MED/LOW |
| 2 | QA Execution | PASS/FAIL | HIGH/MED/LOW |
| 3 | Code Quality | PASS/FAIL | HIGH/MED/LOW |
| 4 | Security | PASS/FAIL | Severity |
| 5 | Context Mining | PASS/FAIL | HIGH/MED/LOW |

### 종합 리뷰에서 차단 이슈
{review-work에서 집계}

---

## 릴리스 종합 (Oracle)

### Breaking Changes
{Oracle에서 — 전체 목록 또는 "None"}

### Changelog Draft
{Oracle에서 — 사용 준비 완료}

### Deployment Risk
{Oracle에서 — 구체적 우려}

### Post-Publish Monitoring
{Oracle에서 — 무엇을 지켜볼지}

---

## 모든 차단 이슈 (우선순위)
{세 레이어 모두에서 중복 제거 및 병합, 심각도 순서}

## 권장 사항
{BLOCK/RISKY인 경우: 정확히 무엇을 수정해야 하는지, 우선순위 순서}
{CAUTION인 경우: 배포 전 고려할 만한 제안}
{SAFE인 경우: 향후를 위한 비차단 개선}
```

---

## 안티 패턴

| 위반 | 심각도 |
|-----------|----------|
| 모든 에이전트를 기다리지 않고 배포 | **CRITICAL** |
| ultrabrain을 병렬 대신 순차로 스폰 | CRITICAL |
| 어떤 에이전트에든 `run_in_background=false` 사용 | CRITICAL |
| Oracle 종합 스킵 | HIGH |
| Oracle용 파일 내용을 읽지 않음 (파일을 읽을 수 없음) | HIGH |
| 모든 변경을 1-2개 ultrabrain에 묶음 (분배 대신) | HIGH |
| 모든 에이전트 완료 전에 판정 전달 | HIGH |
| ultrabrain 프롬프트에 diff를 포함하지 않음 | MAJOR |

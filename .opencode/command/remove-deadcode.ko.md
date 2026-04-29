---
description: ultrawork 모드, LSP 검증된 안전성, 원자적 커밋으로 이 프로젝트의 미사용 코드 제거
---

<command-instruction>

대규모 병렬 deep 에이전트를 통한 데드 코드 제거. 당신은 오케스트레이터다 — 스캔, 검증, 배치한 다음 모든 제거를 병렬 에이전트에 위임한다.

<rules>
- **LSP가 법.** 어떠한 제거 결정 전에도 `LspFindReferences(includeDeclaration=false)`로 검증.
- **진입점 절대 제거 금지.** `src/index.ts`, `src/cli/index.ts`, 테스트 파일, 설정 파일, `packages/` — 손대지 말 것.
- **에이전트는 직접 코드를 제거하지 않음.** 스캔, 검증, 배치한 다음 deep 에이전트를 발사한다. 그들이 작업을 수행한다.
</rules>

<false-positive-guards>
다음을 절대 데드로 표시하지 말 것:
- `src/index.ts` 또는 배럴 `index.ts` 재export의 심볼
- 테스트 파일에서 참조되는 심볼 (테스트는 유효한 소비자)
- `@public` / `@api` JSDoc 태그가 있는 심볼
- 훅 팩토리 (`createXXXHook`), 도구 팩토리 (`createXXXTool`), `agentSources`의 에이전트 정의
- 명령 템플릿, 스킬 정의, MCP 설정
- `package.json` exports의 심볼
</false-positive-guards>

---

## PHASE 1: SCAN — 데드 코드 후보 찾기

다음 모두를 병렬로 실행:

<parallel-scan>

**TypeScript strict 모드 (주요 스캐너 — 먼저 실행):**
```bash
bunx tsc --noEmit --noUnusedLocals --noUnusedParameters 2>&1
```
이는 미사용 로컬, 임포트, 매개변수, 타입의 정확한 file:line 위치와 함께 결정적인 목록을 제공한다.

**Explore 에이전트 (모두 백그라운드로 동시 발사):**

```
task(subagent_type="explore", run_in_background=true, load_skills=[],
  description="Find orphaned files",
  prompt="Find files in src/ NOT imported by any other file. Check all import statements. EXCLUDE: index.ts, *.test.ts, entry points, .md, packages/. Return: file paths.")

task(subagent_type="explore", run_in_background=true, load_skills=[],
  description="Find unused exported symbols",
  prompt="Find exported functions/types/constants in src/ that are never imported by other files. Cross-reference: for each export, grep the symbol name across src/ — if it only appears in its own file, it's a candidate. EXCLUDE: src/index.ts exports, test files. Return: file path, line, symbol name, export type.")
```

</parallel-scan>

모든 결과를 마스터 후보 목록에 수집.

---

## PHASE 2: VERIFY — LSP 확인 (false positive 제로)

Phase 1의 각 후보에 대해:

```typescript
LspFindReferences(filePath, line, character, includeDeclaration=false)
// 0 references → 데드 확인
// 1+ references → 데드 아님, 목록에서 제거
```

위의 false-positive-guards도 적용. 확인된 목록 생성:

```
| # | File | Symbol | Type | Action |
|---|------|--------|------|--------|
| 1 | src/foo.ts:42 | unusedFunc | function | REMOVE |
| 2 | src/bar.ts:10 | OldType | type | REMOVE |
| 3 | src/baz.ts:7 | ctx | parameter | PREFIX _ |
```

**액션 타입:**
- `REMOVE` — 심볼/임포트/파일 전체 삭제
- `PREFIX _` — 시그니처에 의해 요구되는 미사용 함수 매개변수 → `_paramName`으로 이름 변경

확인된 항목이 0이면: "No dead code found" 보고 후 중단.

---

## PHASE 3: BATCH — 충돌 없는 병렬화를 위해 파일별로 그룹화

<batching-rules>

**목표: git 충돌 제로로 병렬 에이전트 최대화.**

1. 확인된 데드 코드 항목을 파일 경로별로 그룹화
2. 같은 파일의 모든 항목은 같은 배치로 (두 에이전트가 같은 파일을 편집하지 못하게)
3. 데드 파일(전체 파일 삭제)이 있으면, 자체 배치
4. 5-15개 배치 목표. 항목이 5개 미만이면, 항목당 1배치 사용.

**배칭 예:**
```
Batch A: [src/hooks/foo/hook.ts — 미사용 임포트 3개]
Batch B: [src/features/bar/manager.ts — 미사용 상수 2개, 데드 함수 1개]
Batch C: [src/tools/baz/tool.ts — 미사용 매개변수 1개, src/tools/baz/types.ts — 미사용 타입 1개]
Batch D: [src/dead-file.ts — 전체 파일 삭제]
```

같은 디렉터리의 파일은 함께 배칭 가능 (두 에이전트가 같은 파일을 편집하지 않는 한 충돌하지 않음). 병렬화를 위해 배치 수를 최대화.

</batching-rules>

---

## PHASE 4: EXECUTE — 병렬 deep 에이전트 발사

각 배치마다 deep 에이전트 발사:

```
task(
  category="deep",
  load_skills=["typescript-programmer", "git-master"],
  run_in_background=true,
  description="Remove dead code batch N: [brief description]",
  prompt="[see template below]"
)
```

<agent-prompt-template>

모든 deep 에이전트는 이 프롬프트 구조를 받음 (배치별 세부 사항 채우기):

```
## TASK: Remove dead code from [file list]

## DEAD CODE TO REMOVE

### [file path] line [N]
- Symbol: `[name]` — [type: unused import / unused constant / unused function / unused parameter / dead file]
- Action: [REMOVE entirely / REMOVE from import list / PREFIX with _]

### [file path] line [N]
- ...

## PROTOCOL

1. 각 파일을 읽고 대상 라인의 정확한 구문 파악
2. 각 심볼에 대해 LspFindReferences를 실행하여 여전히 데드인지 재검증 (다른 에이전트가 변경했을 수 있음)
3. 변경 적용:
   - 미사용 임포트 (라인의 유일한 심볼): 임포트 라인 전체 제거
   - 미사용 임포트 (여럿 중 하나): 임포트 목록에서 해당 심볼만 제거
   - 미사용 상수/함수/타입: 선언 제거. 후행 빈 줄 정리.
   - 미사용 매개변수: `_` 접두 (제거 금지 — 시그니처에 필요)
   - 데드 파일: `rm`으로 삭제
4. 이 배치의 모든 편집 후, 실행: `bun run typecheck`
5. typecheck 실패 시: `git checkout -- [files]`하고 실패 보고
6. typecheck 통과 시: 자신의 파일만 스테이징하고 커밋:
   `git add [your-specific-files] && git commit -m "refactor: remove dead code from [brief file list]"`
7. 제거한 것과 커밋 해시 보고

## CRITICAL
- 자신의 배치 파일만 스테이징 (`git add [specific files]`). `git add -A` 절대 금지 — 다른 에이전트가 병렬로 작업 중.
- 편집 후 typecheck 실패 시, 모든 변경 되돌리고 보고. 수정 시도 금지.
- 다른 파일의 기존 테스트 실패는 예상됨. 자신의 배치는 typecheck만 중요.
```

</agent-prompt-template>

모든 배치 동시 발사. 모두 완료될 때까지 대기.

---

## PHASE 5: 최종 검증

모든 에이전트 완료 후:

```bash
bun run typecheck   # 통과해야 함
bun test            # 새 실패 vs 기존 실패 확인
bun run build       # 통과해야 함
```

요약 생성:

```markdown
## 데드 코드 제거 완료

### 제거됨
| # | Symbol | File | Type | Commit | Agent |
|---|--------|------|------|--------|-------|
| 1 | unusedFunc | src/foo.ts | function | abc1234 | Batch A |

### 스킵됨 (에이전트 실패 보고)
| # | Symbol | File | Reason |
|---|--------|------|--------|

### 검증
- Typecheck: PASS/FAIL
- Tests: X passing, Y failing (Z pre-existing)
- Build: PASS/FAIL
- 총 제거: M개 파일에 걸쳐 N개 심볼
- 총 커밋: K개 원자적 커밋
- 사용된 병렬 에이전트: P
```

---

## 범위 제어

`$ARGUMENTS`가 제공되면 스캔을 좁힘:
- 파일 경로 → 해당 파일만
- 디렉터리 → 해당 디렉터리만
- 심볼 이름 → 해당 심볼만
- `all` 또는 비어 있음 → 전체 프로젝트 스캔 (기본)

## 중단 조건

다음 시 중단 후 보고:
- 50개 이상 후보 발견 (사용자에게 범위 좁히기 또는 진행 확인 요청)
- 빌드가 깨지고 되돌리기로 수정 불가

</command-instruction>

<user-request>
$ARGUMENTS
</user-request>

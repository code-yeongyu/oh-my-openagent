# telemetry-parallel-latency-v2 - Work Plan

## TL;DR (For humans)

**What you'll get:** 병렬 툴 호출이 실제로 얼마나 시간을 아껴주는지를, 부풀리지 않은 정직한 숫자로 대시보드에 띄운다. 코드 실행 도구(eval)가 오래 걸린다는 이유로 다른 도구들의 병렬 성과를 가려버리던 문제도 함께 막는다.

**Why this approach:** 흔히 쓰는 "평균 × 개수" 방식은 실제 데이터에서 절감을 최대 16배까지 부풀린다. 그래서 각 호출이 실제로 언제 시작해 언제 끝났는지를 재서, 겹쳐 돈 구간을 정확히 계산한다. 도구들이 사슬처럼 이어 돌 때도 부풀지 않도록 "가장 긴 하나"가 아니라 "전체가 걸린 실제 구간"을 기준으로 삼는다(이 차이만으로 4.5배 왜곡이 사라진다). 지표 이름 자체에 "추정치"인지 "측정치"인지를 박아 넣는다. 코드 실행 도구는 빼는 게 아니라 별도 칸으로 분리한다 — 그냥 빼면 오히려 숫자가 반대로 부풀기 때문이다.

**What it will NOT do:** 기존 턴 단위 수집(turn_completed)은 손대지 않는다. 코드 실행 도구 내부에서 몇 개의 작업을 했는지 세는 기능은 만들지 않는다. 다른 제품 버전(Codex/OpenCode)의 수집도 건드리지 않는다.

**Effort:** Medium
**Risk:** Medium - 새 이벤트가 늘어나므로 볼륨 상한을 반드시 지켜야 하고, 웨이브 경계 판정이 틀리면 지표가 조용히 왜곡된다.
**Decisions to sanity-check:** 세션당 이벤트 상한값, eval 3-버킷 분류 방식, 지표 이름의 정직 라벨 규칙.

Your next move: 이 플랜을 검토하고 okay하면 `/start-work telemetry-parallel-latency-v2`로 실행 세션을 시작한다. Full execution detail follows below.

---

> TL;DR (machine): Medium effort, Medium risk; senpi turn/tool-execution 이벤트 기반 병렬 라운드트립·시간절감 계측 신설 + eval 3-버킷 격리 + 정직 라벨 지표 계약 + 로컬 대시보드 스킬 반영. turn_completed 무변경.

## Scope

### Must have
- `packages/omo-senpi/src/components/telemetry/`에 웨이브 단위 병렬 계측 신설: `turn_start`/`turn_end`/`tool_execution_start`/`tool_execution_end` 구독으로 툴콜별 소요시간과 동시성 웨이브를 복원.
- eval(codemode) 격리: 모든 병렬/시간 지표에서 eval 웨이브를 **별도 버킷으로 분리**(단순 제외 금지 — 제외는 절감을 과대 계상한다).
- 정직 라벨이 이름에 내장된 지표 계약: `modeled_*`(모델 추정), `_upper_bound`(상한), `measured_*`(직접 측정)만 허용.
- 웨이브 절감 공식은 **span 기준**(`Σdᵢ − (maxEnd − minStart)`). 겹침 기반 웨이브에 `max(dᵢ)`를 쓰면 사슬형 웨이브에서 4.5배 과대계상된다(검증됨).
- 스키마 추가 시 `docs/reference/senpi-telemetry.md` 재생성 필수 — `schema-doc.test.ts`가 byte-exact 비교를 강제한다.
- 모든 툴콜 파생 카운트 속성은 **`non_eval` 도메인 한정**이며 속성명에 도메인이 드러나야 한다.
- 세션 집계 이벤트 `parallelism_summary` 신설 — 합산 가능한 값 + 고정 버킷 히스토그램만. 비율 평균 금지, 세션 median 금지.
- 로컬 스킬 `~/.agents/skills/omo-native-telemetry/` 반영: 쿼리 뱅크 + 뷰모델 + 카드 + 문서, 높이 클리핑 검사 포함.
- 기존 프라이버시 래퍼(`telemetry-core/src/events.ts:100-160`) 경유 필수 — 허용목록 밖 속성 불가.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- `turn_completed` 스키마·볼륨·샘플링 변경 **일체 금지** (사용자 명시).
- 코드모드 K/압축비 지표 **일체 금지** (사용자 명시).
- `(N−1)×평균` 형태의 시간절감 지표 금지 — 상한으로만, 그것도 `_upper_bound` 이름일 때만 허용.
- 웨이브 절감에 `max(dᵢ)` 기준 사용 금지 (span 기준만 허용).
- 히스토그램 문자열에 라벨 포함 금지 — 위치 인코딩만 (라벨 포함 시 69자로 64자 절단에 걸림).
- `packages/telemetry-core/` 변경 금지 (harness-neutral 유지).
- `packages/omo-codex/`, `packages/omo-opencode/` 변경 금지.
- 프롬프트/경로/파일명/셀 소스 등 원문 전송 금지.
- 세션 median을 이벤트에 실어 보내는 것 금지 (fleet median 복원 불가).
- 구현 중 스코프 확장 금지: 이 플랜에 없는 새 이벤트 추가 금지.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: **TDD** (failing-first) + `bun test` (bun:test, given/when/then, co-located `*.test.ts`)
- Evidence: `.omo/evidence/telemetry-parallel-latency-v2/task-<N>.md` (ulw-loop 안이면 `currentAttemptDir` 사용)
- 계측 이벤트는 주입된 `transportFactory` 시드로 검증 — 실제 네트워크 호출 없이 페이로드를 캡처해 단언한다 (기존 `telemetry.test-support.ts` 패턴 재사용).

## Execution strategy

### Parallel execution waves
- **Wave 1 (기반, 병렬 3)**: 1, 2, 3 — 순수 함수 계약(웨이브 조립 / 지표 계산 / eval 분류). 서로 독립, 파일 분리.
- **Wave 2 (배선, 병렬 2)**: 4, 5 — 이벤트 구독 + 스키마 등록. Wave 1 산출물에 의존.
- **Wave 3 (발화, 단독)**: 6 — 세션 집계 발화. 4,5에 의존.
- **Wave 4 (대시보드, 병렬 2)**: 7, 8 — 로컬 스킬 쿼리/렌더. 6의 스키마 확정에 의존.
- **Final wave**: F1-F4 병렬.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | - | 4, 6 | 2, 3 |
| 2 | - | 6 | 1, 3 |
| 3 | - | 4, 6 | 1, 2 |
| 4 | 1, 3 | 6 | 5 |
| 5 | - | 6 | 4 |
| 6 | 1, 2, 3, 4, 5 | 7, 8 | - |
| 7 | 6 | - | 8 |
| 8 | 6 | - | 7 |
| F1-F4 | 1-8 | - | 서로 병렬 |

## Todos
> Implementation + Test = ONE todo. Never separate.

- [x] 1. 동시성 웨이브 조립기(`wave-assembler.ts`) 구현
  What to do / Must NOT do: `tool_execution_start`/`tool_execution_end`를 `toolCallId`로 페어링해 `{toolCallId, toolName, startMs, endMs}` 레코드를 만들고, **시간 겹침 기준**으로 동시성 웨이브를 조립한다. 웨이브 정의: 어떤 호출의 `[start,end]` 구간이 웨이브 내 기존 호출과 하나라도 겹치면 같은 웨이브(구간 그래프의 연결 성분). 겹침이 없으면 새 웨이브. **각 웨이브는 `span = maxEnd − minStart`를 반드시 함께 산출한다** — todo 2의 절감 공식이 이 값을 쓴다. 사슬형(A와 B가 겹치고 B와 C가 겹치지만 A와 C는 안 겹침) 웨이브가 정상 케이스임을 전제하고 테스트한다. 짝이 안 맞는 start(=end 미수신)는 `incomplete`로 표시하고 지표 계산에서 제외하되 개수는 보존한다. 시계는 `Date.now()` 단조성 가정 금지 — 이벤트 수신 순서와 함께 기록하고 `endMs < startMs`면 `clock_anomaly`로 분류해 제외. MUST NOT: 턴 단위로 묶지 말 것(웨이브가 턴보다 작다), 배열을 무한히 키우지 말 것(세션당 상한 `MAX_TRACKED_CALLS = 2000` 초과 시 카운터만 유지하고 상세는 버림).
  Parallelization: Wave 1 | Blocked by: - | Blocks: 4, 6
  References: `node_modules/@code-yeongyu/senpi/dist/core/extensions/types.d.ts:847-868` (ToolExecutionStart/End 필드), `:1071` (ExtensionEvent 유니온), 기존 상태보관 패턴 `packages/omo-senpi/src/components/telemetry/omo-native-prompt.ts:38-80` (Map 기반 pending/completed 관리 + session_shutdown 정리)
  Acceptance criteria: `bun test packages/omo-senpi/src/components/telemetry/wave-assembler.test.ts` 그린. 최소 케이스: (a) 겹치는 3콜 → 웨이브 1개 크기 3 + span 산출, (b) 순차 3콜 → 웨이브 3개 크기 1, (c) 겹침+순차 혼합 → 정확한 분할, (d) end 누락 → incomplete 카운트 1, 지표 제외, (e) `endMs<startMs` → clock_anomaly 제외, (f) 2000콜 초과 → 상세 버림·카운터 유지, (g) **사슬형 A(0-5) B(4-9) C(8-12) → 웨이브 1개, span=12** (동시 시작이 아님을 span이 드러내야 함).
  QA scenarios: happy = 위 (a)(c) 케이스 단언; failure = (d)(e) 이상 입력이 지표를 오염시키지 않음을 단언. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-1.md`
  Commit: Y | `feat(omo-senpi): add concurrency wave assembler for tool execution telemetry`
  Recommended task executor category: unspecified-high

- [x] 2. 지표 계산기(`savings-math.ts`) 구현 — 정직 라벨 내장
  What to do / Must NOT do: 순수 함수로 구현한다. `modeledWallClockSavedMs(wave) = Σdᵢ − span(wave)` where `span = maxEnd − minStart` (N≤1이면 0). **`max(dᵢ)`를 쓰지 말 것** — 겹침 기반 웨이브는 동시 시작을 보장하지 않으므로 사슬형에서 4.5배 과대계상된다(A(0-5) B(4-9) C(8-12): span공식 2.00s vs max공식 9.00s, 검증됨). 동시 시작 배치에서는 `span == max(dᵢ)`이므로 참 배치의 값은 변하지 않는다. `savedRoundTrips(waves) = Σ max(N_b − 1, 0)`이되, **사슬형 웨이브는 동시성이 아니므로 라운드트립 절감으로 세지 않는다** — 웨이브 내 최대 동시 실행 수(`maxConcurrency`, 스윕라인으로 계산)를 쓴다: `savedRoundTrips = Σ max(maxConcurrency_b − 1, 0)`. `upperBoundSavedMs(wave) = (N−1) × mean(dᵢ)` — **반드시 `_upper_bound` 이름으로만 노출**하고 기본 지표로 쓰지 않는다. 음수 클램프 금지(관측 이상을 숨긴다). 반환 타입에 각 값의 라벨(`modeled`/`upper_bound`/`measured`)을 타입 수준으로 강제한다. MUST NOT: 비율의 평균 계산 금지, median 계산 금지, `(N−1)×평균`을 기본 절감치로 반환 금지, `max(dᵢ)` 기준 절감 금지.
  Parallelization: Wave 1 | Blocked by: - | Blocks: 6
  References: ultrabrain 계약(드래프트 `.omo/drafts/telemetry-parallel-latency-v2.md` Findings 마지막 줄), 실측 검증 결과 — 긴 꼬리에서 상한/진짜 = 8.25배, eval 혼입 시 16.38배
  Acceptance criteria: `bun test .../savings-math.test.ts` 그린. 케이스: (a) 동시시작 `[(0,2.0),(0,2.2),(0,1.9),(0,2.1)]` → modeled 6.00 (span==max이므로 기존 수치 유지), (b) 동시시작 `[(0,0.3),(0,0.3),(0,0.3),(0,9.0)]` → modeled 0.90, upper 7.43 (두 값이 다름을 단언), (c) N=1 → 0, (d) N=0 → 0, (e) 음수 결과가 클램프되지 않음, (f) **사슬형 `[(0,5),(4,9),(8,12)]` → modeled 2.00이고 `max` 기준 9.00이 아님을 단언**(이 케이스가 B1 회귀 방지선), (g) 사슬형에서 `maxConcurrency=2`이므로 `savedRoundTrips=1`(N−1=2가 아님).
  QA scenarios: happy = (a)(b) 수치 단언; failure = 상한 함수를 기본 경로로 호출할 수 없음을 타입/테스트로 단언. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-2.md`
  Commit: Y | `feat(omo-senpi): add honesty-labeled parallel savings math`
  Recommended task executor category: ultrabrain

- [x] 3. eval 3-버킷 분류기(`eval-classifier.ts`) 구현
  What to do / Must NOT do: 웨이브를 `eval_only` / `non_eval` / `mixed` 세 버킷으로 분류한다. eval 판정은 기존 `matchesToolName` 접미사 매처를 재사용해 `eval`/`codemode`와 일치(정확 일치 + `_eval`/`:eval`/`/eval` 접미사). 실제 등록명은 `"eval"`이다(senpi-codemode `src/tool/eval-tool.ts:37`); 과거 표기 `ln`은 매칭 목록에 넣지 않는다(오탐 위험). **핵심 규칙**: 병렬/시간 지표의 기본 집계는 `non_eval` 버킷만 사용한다. `mixed` 웨이브는 eval 호출을 제거한 뒤 남은 호출로 재계산해 `non_eval`에 합산하지 **않고**, 별도 `mixed` 버킷에 기록한다(제거 후 재계산은 `max`가 바뀌어 절감을 과대 계상함 — 실측에서 1.20s→0.70s 왜곡 확인). `eval_only`는 병렬 지표에서 완전히 배제하고 개수·소요시간만 별도 보고. MUST NOT: eval을 그냥 필터링해서 non_eval에 합치는 것 금지, eval 셀 소스/인자 전송 금지.
  Parallelization: Wave 1 | Blocked by: - | Blocks: 4, 6
  References: eval 식별자 근거 `~/.bun/install/global/node_modules/omo-ai/node_modules/@code-yeongyu/senpi/dist/core/resource-loader.js` (builtinId `codemode`, 패키지 `@code-yeongyu/ln`), 재사용할 정규화 헬퍼 `packages/omo-senpi/src/components/telemetry/omo-native-tools.ts:182-190`
  Acceptance criteria: `bun test .../eval-classifier.test.ts` 그린. 케이스: (a) `[bash,read,grep]` → non_eval, (b) `[eval]` → eval_only, (c) `[bash,eval]` → mixed, (d) `eval`/`codemode`/`mcp:eval` 표기 변형이 eval로 판정되고 `evaluate_foo` 같은 유사명은 **오탐되지 않음**, (e) mixed 웨이브가 non_eval 집계에 유입되지 않음, (f) **`waves_total`/`waves_multi`/`joined_calls`/`wave_size_histogram`이 전부 non_eval 도메인만 집계함**(eval_only/mixed 웨이브를 넣으면 실패해야 함).
  QA scenarios: happy = (a)(b)(c) 분류 단언; failure = (e) 오염 방지 단언 — mixed를 non_eval에 합산하면 테스트가 실패해야 함. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-3.md`
  Commit: Y | `feat(omo-senpi): isolate eval tool waves into a separate metric bucket`
  Recommended task executor category: unspecified-high

- [x] 4. 이벤트 구독 배선(`omo-native-parallel.ts`) 구현
  What to do / Must NOT do: `pi.on("turn_start")`, `pi.on("turn_end")`, `pi.on("tool_execution_start")`, `pi.on("tool_execution_end")`를 구독해 웨이브 조립기에 공급한다. `turn_start.timestamp`로 턴 시작 시각을 기록하고 `turn_end`에서 턴 소요시간을 확정한다. 세션별 상태는 Map, `session_shutdown`에서 반드시 정리한다(누수 금지). MUST NOT: 여기서 이벤트를 직접 capture하지 말 것(발화는 todo 6), 툴 인자(`args`)/결과(`result`) 저장 금지.
  Parallelization: Wave 2 | Blocked by: 1, 3 | Blocks: 6
  References: 구독 패턴 `packages/omo-senpi/src/components/telemetry/omo-native-component.ts:74-88`, 세션 정리 패턴 `omo-native-tools.ts:88-91`, 이벤트 타입 `types.d.ts:818-829,847-868`
  Acceptance criteria: `bun test .../omo-native-parallel.test.ts` 그린. 케이스: (a) start/end 쌍 공급 시 웨이브가 조립됨, (b) `session_shutdown` 후 세션 상태가 비워짐, (c) 미지의 페이로드 형태에서 throw하지 않음.
  QA scenarios: happy = 모의 이벤트 시퀀스 주입 후 조립 결과 단언; failure = 깨진 페이로드 주입 시 예외 없이 무시됨을 단언. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-4.md`
  Commit: Y | `feat(omo-senpi): wire turn and tool-execution events for parallelism telemetry`
  Recommended task executor category: unspecified-high

- [x] 5. `parallelism_summary` 스키마 등록
  What to do / Must NOT do: `product-identity.ts`의 `OMO_NATIVE_EVENT_SCHEMAS`에 `parallelism_summary`를 추가한다(`feature_used` 항목 뒤, :131-135 앵커). **속성명이 도메인을 드러내야 한다** — 툴콜 파생 카운트는 전부 `non_eval_` 접두사: `non_eval_waves_total`/`non_eval_waves_multi`/`non_eval_joined_calls`/`non_eval_saved_round_trips`(number), `modeled_wallclock_saved_ms`(number, non_eval 한정), `upper_bound_saved_ms`(number, non_eval 한정), `measured_turn_duration_ms_total`(number), eval 버킷은 `eval_only_waves`/`eval_only_duration_ms`/`mixed_waves`(number), 품질 카운터 `incomplete_calls`/`clock_anomalies`(number), `non_eval_wave_size_histogram`(string — 고정 버킷 `1,2,3,4,5_8,9_16,17_32,33plus` 순서의 **위치 인코딩** 카운트를 `:`로 구분, 라벨 없음. 예 `12:5:3:1:0:0:0:0`), `schema_kind`(enum `parallelism_v1`), `$session_id`(string). **이 todo는 `docs/reference/senpi-telemetry.md`를 재생성하는 것까지 포함한다** — `schema-doc.test.ts:8,40-47`이 생성 블록과 문서의 byte-exact 일치를 강제하므로 문서 갱신 없이는 테스트가 반드시 깨진다. MUST NOT: median/평균비율 속성 추가 금지, 히스토그램에 라벨 포함 금지(라벨 시 69자 → 64자 절단), `_text`/`_path`/`_prompt` 접미사 금지, eval 웨이브를 `non_eval_*` 속성에 합산 금지.
  Parallelization: Wave 2 | Blocked by: - | Blocks: 6
  References: 스키마 앵커 `packages/omo-senpi/src/components/telemetry/product-identity.ts:131-135`, 허용목록/절단 규칙 `packages/telemetry-core/src/events.ts:100-160` (64자 절단, `$` 키 제한, 접미사 차단), 기존 스키마 테스트 `product-identity.test.ts`, **문서 동기화 게이트 `packages/omo-senpi/src/components/telemetry/schema-doc.test.ts:8,40-47` + 대상 문서 `docs/reference/senpi-telemetry.md`**
  Acceptance criteria: `bun test packages/omo-senpi/src/components/telemetry/` 그린(= `schema-doc.test.ts` 포함 그린, 문서 재생성이 반영됐다는 뜻). 히스토그램 문자열이 실제 상한(`MAX_TRACKED_CALLS=2000` → 버킷당 최대 4자리, 8버킷 위치 인코딩 = 39자)에서 64자 이내임을 단언하는 테스트 포함.
  QA scenarios: happy = 스키마가 허용목록에 등재됨을 단언; failure = 허용목록 밖 속성이 드롭됨을 캡처 트랜스포트로 단언. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-5.md`
  Commit: Y | `feat(omo-senpi): register parallelism_summary event schema`
  Recommended task executor category: quick

- [x] 6. 세션 집계 발화 구현
  What to do / Must NOT do: 세션 종료(`session_shutdown`) 시 `parallelism_summary`를 **세션당 정확히 1회** 발화한다. **등록 순서가 결정적이다**: `omo-native-component.ts`의 래핑 트랜스포트가 `session_shutdown`에서 `state.capture`/`state.sessionHash`를 비우고 세션 컴포넌트가 클라이언트를 shutdown하므로, 그 뒤에 등록된 핸들러의 발화는 `state.capture?.(...)`가 no-op이 되어 **주입 트랜스포트 테스트는 그린인데 프로덕션 이벤트는 0건**이 된다. 이 컴포넌트는 세션 컴포넌트의 shutdown 핸들러보다 **먼저** 등록하거나 명시적 pre-shutdown 플러시 훅을 쓴다. 발화 전 웨이브 집계를 확정하고, eval 버킷은 분리된 채로 실린다. 볼륨 상한: 세션당 1건 — 어떤 경우에도 턴당/웨이브당 발화 금지(이게 볼륨 폭증을 막는 유일한 방어선). `waves_total == 0`이면 발화하지 않는다(무의미한 빈 이벤트 방지). MUST NOT: `turn_completed`를 건드리거나 그 발화 경로에 개입 금지, 주기적/체크포인트 발화 금지(이번 범위 아님).
  Parallelization: Wave 3 | Blocked by: 1, 2, 3, 4, 5 | Blocks: 7, 8
  References: 세션 종료 훅 `packages/omo-senpi/src/components/telemetry/omo-native-session.ts:126-131`, 캡처 경로 `omo-native-component.ts:47-56`, 발화 전 검증 래퍼 `telemetry-core/src/events.ts:100-160`
  Acceptance criteria: `bun test packages/omo-senpi/src/components/telemetry/` 그린 + `bun run --cwd packages/omo-senpi typecheck` 그린. 케이스: (a) 세션 1개 → 정확히 1건 발화, (b) `non_eval_waves_total==0`이고 eval 버킷도 0이면 → 0건, (c) 발화 페이로드의 모든 키가 허용목록 내, (d) `turn_completed` 발화 횟수가 변화 없음(회귀 방지), (e) **실제 컴포넌트 등록 순서로 조립했을 때 발화가 no-op이 아님을 단언**(래핑 트랜스포트 shutdown 이후 발화 시 0건이 되는 것을 실패로 잡는 회귀 테스트).
  QA scenarios: happy = 캡처 트랜스포트로 페이로드 1건과 그 필드값 단언; failure = (d) turn_completed 회귀 단언 — 이 값이 바뀌면 실패해야 함. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-6.md`
  Commit: Y | `feat(omo-senpi): emit one parallelism_summary per session`
  Recommended task executor category: unspecified-high

- [x] 7. 로컬 스킬 쿼리 뱅크 확장
  What to do / Must NOT do: `~/.agents/skills/omo-native-telemetry/scripts/fetch_data.py`의 `QUERIES`에 `parallelism` 쿼리를 추가한다 — `parallelism_summary`에서 `sum(non_eval_saved_round_trips)`, `sum(modeled_wallclock_saved_ms)`, `sum(non_eval_waves_total)`, `sum(non_eval_waves_multi)`, `sum(eval_only_waves)`, `sum(mixed_waves)`, 세션 수를 집계 (속성명은 todo 5 스키마와 정확히 일치해야 함). 데이터가 아직 없어도 쿼리가 실패하지 않고 빈 결과를 반환하도록 작성한다. MUST NOT: `upper_bound_saved_ms`를 헤드라인으로 쓰지 말 것(참고 표시만), 비율의 평균 계산 금지.
  Parallelization: Wave 4 | Blocked by: 6 | Blocks: -
  References: 쿼리 뱅크 구조 `~/.agents/skills/omo-native-telemetry/scripts/fetch_data.py` (`QUERIES` dict, 4-워커 풀, `--only` 플래그), 기존 유사 쿼리 `parallel_savings`/`parallel_savings_basis`
  Acceptance criteria: `cd ~/.agents/skills/omo-native-telemetry/scripts && python3 fetch_data.py /tmp/plan-qa --only parallelism` 이 exit 0이고 JSON 파일을 생성.
  QA scenarios: happy = 위 명령 실행 후 `/tmp/plan-qa/parallelism.json` 존재 단언; failure = 이벤트가 0건인 상태에서도 exit 0임을 확인. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-7.md`
  Commit: N (스킬은 레포 밖 — 증거에 diff 기록)
  Recommended task executor category: quick

- [x] 8. 대시보드 카드 + 문서 반영
  What to do / Must NOT do: `templates/unified_model.py`에 파생 지표를 추가하고 `templates/build_unified.py`에 카드 1개를 추가한다. 카드는 `modeled` 라벨을 화면에 그대로 노출하고, eval 버킷을 별도 행으로 보여준다. `SKILL.md`에 지표 정의·공식·정직 라벨 규칙·eval 격리 이유를 문서화한다. **높이 보정 필수**: 카드 추가 후 콘텐츠 마지막 픽셀 행을 측정해 `body{height}`를 갱신하고 하단 스트립 크롭으로 클리핑을 확인한다(2370px에서 푸터가 잘린 전례 있음). MUST NOT: 기존 카드 삭제·재배치 금지, 그라디언트/그림자 추가 금지(디자인 시스템 고정 규칙).
  Parallelization: Wave 4 | Blocked by: 6 | Blocks: -
  References: 뷰모델 `~/.agents/skills/omo-native-telemetry/templates/unified_model.py` (`build_model`, `BATCH_CAP`, `k()`), 카드 렌더 `templates/build_unified.py` (`.g21`/`.g3` 그리드, `row()` 헬퍼, `height:2580px`), 클리핑 검사 절차 `SKILL.md` "Render + QA + deliver"
  Acceptance criteria: `python3 build_unified.py <datadir>` exit 0 + 헤드리스 크롬 렌더 후 하단 800px 크롭에서 푸터가 온전히 보임.
  QA scenarios: happy = 렌더 후 카드가 PNG에 존재함을 크롭 확인; failure = 높이 미보정 시 클리핑이 발생함을 측정값으로 기록. Evidence `.omo/evidence/telemetry-parallel-latency-v2/task-8.md`
  Commit: N (스킬은 레포 밖 — 증거에 diff 기록)
  Recommended task executor category: visual-engineering

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [x] F1. Plan compliance audit — 8개 todo 전부가 명시된 Acceptance criteria를 실제로 충족했는지 대조. 미달 시 해당 todo 번호를 명시해 REJECT. Evidence `.omo/evidence/telemetry-parallel-latency-v2/f1.md`
  Recommended task executor category: unspecified-high
- [x] F2. Code quality review — 레포 규약(파일 250 pure LOC 상한, catch-all 파일 금지, barrel-only index.ts, given/when/then 테스트, `as any` 금지) 준수 여부를 diff 한정으로 검토. Evidence `.omo/evidence/telemetry-parallel-latency-v2/f2.md`
  Recommended task executor category: unspecified-high
- [x] F3. Real manual QA — 클린 체크아웃에서 `bun test packages/omo-senpi/src/components/telemetry/` + `bun run --cwd packages/omo-senpi typecheck` 재실행, 그리고 스킬 파이프라인을 실제로 돌려 카드 렌더까지 확인. Evidence `.omo/evidence/telemetry-parallel-latency-v2/f3.md`
  Recommended task executor category: unspecified-high
- [x] F4. Scope fidelity — Must-NOT-Have 실행 가능 검사: `git diff`에 `turn_completed` 스키마 변경 0건, `packages/telemetry-core/` 변경 0건, `packages/omo-codex|omo-opencode` 변경 0건, 코드모드 K 지표 부재, `(N−1)×평균`이 기본 지표로 노출되지 않음, **소스에 `max(dᵢ)` 기준 절감 공식 부재(span만 사용)**, **`non_eval_` 접두사 없는 툴콜 파생 카운트 속성 부재**, **히스토그램 문자열에 `=` 라벨 부재**. Evidence `.omo/evidence/telemetry-parallel-latency-v2/f4.md`
  Recommended task executor category: unspecified-high

## Commit strategy
- todo당 원자적 커밋 1개(7, 8은 레포 밖이라 커밋 없음 — 증거에 diff 기록).
- Conventional Commits, 각 커밋이 단독으로 빌드+테스트 그린.
- 브랜치: task-owned worktree, PR은 `dev` 대상, 머지 커밋 정책 준수.
- 최종 커밋 푸터: `Plan: .omo/plans/telemetry-parallel-latency-v2.md`

## Success criteria
- `bun test packages/omo-senpi/src/components/telemetry/`(= `schema-doc.test.ts` 포함) + `bun run --cwd packages/omo-senpi typecheck` 그린.
- `docs/reference/senpi-telemetry.md`가 재생성되어 생성 블록과 byte-exact 일치.
- `parallelism_summary`가 세션당 정확히 1건 발화되고(등록 순서로 인한 no-op 아님이 테스트로 고정), 모든 속성이 허용목록을 통과.
- eval 웨이브가 `non_eval_*` 지표(카운트·히스토그램 포함)에 유입되지 않음이 테스트로 고정됨.
- 시간절감 기본 지표가 **`Σdᵢ−span`**이고 사슬형 회귀 테스트(A(0-5) B(4-9) C(8-12) → 2.00)가 존재하며, `(N−1)×평균`은 `_upper_bound` 이름으로만 존재.
- 라운드트립 절감이 `maxConcurrency` 기준이어서 사슬형 웨이브를 병렬로 오인하지 않음.
- 로컬 스킬이 신규 지표를 렌더하고 하단 클리핑이 없음.
- Must-NOT-Have 전 항목이 F4의 실행 가능 검사로 0건 확인됨.

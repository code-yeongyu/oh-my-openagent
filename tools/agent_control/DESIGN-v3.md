# Agent Control v3 — Multi-Spawn 설계안

> AgentControl의 public Agent action과 standalone preset 설계는
> `docs/control-plane/AGENT-SYSTEM.md`로 대체되었다. 이 문서는 Dispatch queue,
> ledger, monitor, wake, process identity, cleanup 등 v3 lifecycle 설계의 역사와
> 근거로 유지한다. 기존 `spawn`/fixed worker preset public 계약은 새 구현에
> 사용하지 않는다.

v2.5(Herdr-native, stateless)를 기반으로 fan-out(다중 스폰)을 1급 시나리오로 지원한다.

> **구현 현황(2026-07-30)**: 아래 설계는 6단계로 전부 구현되었고 단계마다 적대검증을
> 거쳤다. 설계와 달라진 점: (1) dead 판정에 `DEAD_GRACE_SECONDS`(5s) 유예 도입 —
> 미관측 1회로 죽이지 않고 missing_since 기록 후 유예 초과 연속 미관측만 dead, 재관측
> 시 복원, (2) `peek` 도구 추가(herdr agent/pane read), (3) `list(all_owners:true)`
> 진단 뷰(headless owner 유실 복구 단서), (4) **`dispatch` 도구** — `opencode run` 기반
> 경량 one-shot worker(별도 도구로 분리: tui/run은 계약이 달라 인자가 아닌 도구로 나눔).
> **배치 전용 인터페이스**: `template`({item} 치환) + `items` 목록만 받는다 — 리더가
> 항목 수만큼 프롬프트를 복제 작성하는 것을 원천 차단. 동시 실행 상한
> (`AGENT_CONTROL_MAX_WORKERS`, 기본 8)을 넘는 항목은 ledger에 `pending`으로 대기하고,
> dispatch 직후와 collect tick/정리 시점에 자리가 나는 대로 자동 launch된다.
> TUI·agent 감지 배리어 없음, send 미지원, oneshot 고정, 생존은 pane 존재로만 판정, (5) worker는 `AGENT_CONTROL_PROJECT` env로 진짜 프로젝트
> ledger를 찾는다(worktree cwd 오염 방지), (6) `AGENT_CONTROL_OWNER`는 `owner:` 접두사
> 강제. **알려진 한계**: oneshot+worktree worker의 branch명은 정리 직후의 collect 응답이
> 유일한 자동 기록이다 — 놓치면 `git branch --list 'agent/*'`로 수동 확인.

## 완주 알림 (리더 wake 체계)

fan-out 완주는 **마지막 final report를 넣는 worker가 감지**한다(report의 ledger
트랜잭션 안에서 같은 group 전원의 terminal 여부 확인 — dead worker도 terminal로 센다).
완주가 확정되면:

| 대상 | 채널 | 효과 |
|---|---|---|
| TUI 리더 | `[AGENT_GROUP_DONE <group>] N/N …` pane paste | dispatch는 collect 1회, spawn은 직접 도착한 report들의 완주 표시 |
| headless 리더 | `AGENT_CONTROL_WAKE_CMD` env에 등록한 명령 실행 | 리더가 자기를 깨우는 명령(웹훅, resume 등)을 spawn 전에 등록 |
| 사람 | `herdr notification show` (headless일 때) | UI/데스크톱 알림 |

interactive Agent의 report는 TUI 리더에 `[AGENT_REPORT name]`으로 직접 도착하며
다시 collect하지 않는다. paneless dispatch worker의 report만 ledger에 머물고 group wake 뒤
nonblocking collect 1회로 수거한다. 정상 TUI 리더는 collect/list/peek 또는 sleep으로 폴링하지
않는다. 독립 작업이 없으면 turn을 끝내고 push wake를 기다린다.

**죽음도 wake 이벤트다**: dispatch worker는 `sh -c 'opencode run …; postrun'` 체인으로
실행되어 종료 직후 `postrun` 훅이 확정적으로 돈다 — final report가 있으면 row를 닫고
자기 잔여물(prompt 파일·clean worktree)을 정리하고, 없으면 `dead(run_exit_no_report)`
확정 후 그룹 완주면 `[AGENT_GROUP_DONE]`, 아니면 `[AGENT_DEAD name]`(로그 경로 포함)으로
리더를 깨운다. reconcile의 pid 생존 확인은 postrun 자체가 실패했을 때의 2차 방어선이다.

## Per-workflow 뷰 (paneless dispatch + batch monitor)

dispatch worker는 **pane이 없다** — 출력은 `.agent-control/live/<name>-<id>/`,
생존은 pid, 개별 report는 리더 pane에 paste되지 않고 ledger로만 간다(per-agent
nudge는 batch에서 스팸이다 — 리더에게는 `[AGENT_GROUP_DONE]`/`[AGENT_DEAD]`만 간다).
Herdr에 보이는 배치의 유일한 표면은 **그룹당 1개의 monitor pane**
(`tools.agent_control.monitor`, tab `agent:batch-<group>`)으로, ledger를 2초 폴링해
진행률·running/dead 목록·최근 report를 렌더하고 완주+수거 완료 시 스스로 정리한다.
`peek`은 dispatch worker에 대해 로그 tail을 반환하고, `cancel`은 pid를 kill한다.
interactive Agent는 pane 기반이다(개입·Take Control이 자산인 레인).

dispatch의 OpenCode 출력은 `--format json`으로 실행 중
`.agent-control/live/<name>-<id>/events.jsonl`에 append되고 stderr는 같은 디렉토리의
`stderr.log`로 분리된다. Monitor의 `L`은 선택 worker의 이벤트를 summary/raw로 tail하며
`F`로 follow를 전환한다. 정상·실패 worker 모두 consuming `collect` 전까지 보존하고,
`collect(consume:true)`가 terminal worker의 live 디렉토리를 제거한다. 따라서 대량 배치의
관측 파일이 누적되지 않으며 `consume:false` 진단 중에는 근거가 유지된다.

paneless worker에는 승인 입력 채널이 없으므로 dispatch는 `opencode run --auto`로 실행한다.
따라서 `external_directory`를 포함한 모든 OpenCode permission 요청은 자동 승인된다.
또한 `--title <worker-name>`을 명시해 별도 title-agent LLM 요청 없이 main agent를 바로 시작한다.
worker별 `XDG_DATA_HOME`은 project 밖 `/tmp/opencode/agent-control/`에 둔다. project 내부에
scratch를 두면 OpenCode가 untracked snapshot 저장소를 다시 snapshot하는 자기포함과
디스크 증폭이 발생할 수 있기 때문이다.
project-local `.agent-control/.gitignore`도 자동 생성해 ledger, live log, prompt, report와
과거 runtime 산출물이 Git untracked 탐색 및 OpenCode project snapshot에 들어가지 않게 한다.

## 목표 / 비목표

**목표**
- 3~10개 worker fan-out → 수집(fan-in)이 도구 호출 몇 번으로 안정적으로 끝난다.
- 기존 1:1 페어링 UX(이름 있는 장수 에이전트, TUI nudge, send 후속 지시)는 무회귀.
- headless 리더 지원 — Herdr pane 밖에서 도는 리더도 action launch와 collect를 사용할 수 있다.
- 결과의 안정적 수거: ledger 기반 push→pull 전환.
- 수명 자동화: oneshot worker 자동 정리, pane/worktree 누수 방지.

**비목표**
- Workflow식 스크립트 오케스트레이션(pipeline/barrier/budget) — 리더 LLM이 도구 호출로 제어한다.
- 상주 daemon — 모든 상태 전이는 도구 호출 시점의 lazy reconciliation으로 처리한다.
- 수십~수백 규모 병렬 — pane 하나가 완전한 TUI라 무겁다. cap으로 명시적으로 막는다.

## 아키텍처 원칙

1. **Herdr가 실행·터미널·라이브 상태의 권위** (v2.5 유지). pane 생성/종료, agent 감지, semantic status는 전부 Herdr API.
2. **MCP 서버는 stateless 처리 + project-scoped ledger 하나만 추가.**
   `.agent-control/ledger.db` (SQLite, WAL). 리더와 worker의 MCP 프로세스가 같은
   `--project`를 가리키므로 별도 프로세스 없이 파일 하나로 공유된다. legacy
   `control.db`(구 agentd)와는 파일을 분리해 충돌을 피한다.
3. **report 데이터 경로 이원화.**
   - 사람용: 리더 pane에 600자 한 줄 nudge paste (기존 UX, 리더가 Herdr 안에 있을 때만).
   - 기계용: 전체 payload를 ledger에 INSERT → 리더가 `collect`로 pull.
4. **고장 감지는 lazy.** `collect`/`list` 호출 시 herdr 라이브 상태와 ledger를 대조해
   사라진 pane → `dead`, `blocked` status 표면화. 감시 프로세스를 두지 않는다.

## 데이터 모델 (ledger.db)

```sql
CREATE TABLE IF NOT EXISTS workers (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,          -- live(closed_at IS NULL) 중복만 거부, 이름 재사용 허용
  owner       TEXT NOT NULL,          -- HERDR_PANE_ID 또는 headless owner id
  group_name  TEXT,
  pane        TEXT, tab TEXT, workspace TEXT,
  model       TEXT NOT NULL,
  cwd         TEXT NOT NULL,
  worktree    TEXT,                   -- isolation=worktree일 때 경로
  branch      TEXT,
  oneshot     INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL,          -- starting|running|blocked|dead|closed
  spawned_at  TEXT NOT NULL,
  closed_at   TEXT,
  close_reason TEXT                   -- cancelled|oneshot_done|dead|startup_failed
);
CREATE TABLE IF NOT EXISTS reports (
  id          INTEGER PRIMARY KEY,
  worker_id   INTEGER NOT NULL REFERENCES workers(id),
  body        TEXT NOT NULL,          -- 600자 이내 평문 report
  is_final    INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL,
  consumed_at TEXT
);
```

- WAL + `busy_timeout`으로 worker N개의 동시 report를 안전하게 처리.
- `status`는 캐시일 뿐 권위가 아니다. collect/list가 herdr 대조로 갱신한다.

## Owner 모델 (headless 지원)

- Herdr 안의 리더: owner = `HERDR_PANE_ID` (기존과 동일, pane token 병기로 herdrV UI 호환).
- Herdr 밖의 리더: owner = `AGENT_CONTROL_OWNER` env가 있으면 그 값, 없으면 MCP 프로세스
  시작 시 생성한 `owner:<uuid>`. 프로세스 재시작 시 소유권 유지가 필요하면 env로 고정한다.
- headless interactive Agent launch 시 workspace는 `HERDR_WORKSPACE_ID` → `HERDR_DEFAULT_WORKSPACE` env →
  `herdr workspace list` 첫 항목 순으로 폴백.
- headless 리더에게는 nudge paste를 생략한다(받을 pane이 없음). 결과는 collect로만 소비.

## 도구 표면

### Leader (historical pre-action surface)

**`spawn(name, prompt, opts?)`** was the pre-action interface and is not public in the
current implementation. Its lifecycle options below are retained as historical rationale.
Current launches use the fixed action presets defined in `AGENT-SYSTEM.md`; callers cannot
provide an agent preset or model, and preset configuration owns model tuning and fallback.
- `isolation: "worktree"` — `git worktree add .agent-control/worktrees/<name> -b agent/<name> [base]`
  후 그 경로를 tab cwd로 사용. footer에 "변경은 커밋하고 branch명을 report에 포함" 계약 추가.
  Herdr 네이티브 `worktree create`는 workspace 단위라 topology가 바뀌므로 쓰지 않는다
  (agent tab은 리더 workspace에 남긴다).
- Interactive Agent actions — final Report가 저장된 뒤 pane이 5분 연속 `idle`/`done`이면
  detached reaper가 pane과 clean worktree를 정리한다. 리더의 Cancel이나 report 소비에
  의존하지 않으며 OpenCode session과 report 이력은 보존한다.
- Dispatch worker는 기존 oneshot 계약대로 final report 후 자체 정리한다.
- `group` — collect 필터용 라벨.
- cap: owner의 live worker 수가 `AGENT_CONTROL_MAX_WORKERS`(기본 8) 이상이면
  `REJECTED(WORKERS_AT_CAP)` + "collect/cancel 먼저" hint. 대기열은 두지 않는다(리더가 재시도).

**`collect(filter?, timeout_ms?, consume?)`** — 신규, fan-in의 핵심.
- `filter`: `{targets: [...]}` 또는 `{group: "..."}`, 생략 시 owner의 전체 live worker.
- 동작: 2초 간격 폴링 루프. 매 tick마다 ① ledger에서 신규 report 조회,
  ② herdr `agent list` 대조 — pane 소멸 → `dead`, `agent_status` → `blocked`/`running` 갱신.
- 종료 조건: 대상 전원이 terminal(final report 있음 또는 dead)이거나 timeout.
  `timeout_ms`는 20,000 상한(클라이언트 MCP timeout 30s보다 낮게 클램프).
- 반환: per-worker `{name, status, reports: [...], report_path, worktree, branch, advisory}`.
  `advisory`에는 "idle인데 report 없음(계약 리마인드 send 권장)", "blocked(사람 개입 필요,
  peek로 화면 확인)" 같은 판단 힌트를 담는다.
- `consume`(기본 true): 반환한 report에 `consumed_at` 기록. oneshot worker의 final report를
  소비하면 pane close + worktree가 clean이면 remove, dirty면 보존하고 경로를 결과에 남긴다.
- timeout으로 미완이면 현재 스냅샷을 반환하고 리더가 루프를 돈다(long task는
  리더 쪽 wakeup/폴링과 조합).

**`peek(target, lines?)`** — 신규. `herdr agent read` 래핑. stalled/blocked worker의
터미널 화면을 읽어 상황 파악. read-only.

**`list()`** — herdr 라이브 + ledger 병합으로 확장: worker별 미소비 report 수,
final 여부, dead worker(herdr에는 없지만 ledger에 있는 것) 포함.

**`send(target, message)`** — active interactive Agent에만 전달한다. final Report가 이미
있으면 `FINAL_ALREADY_REPORTED`로 거절하고 새 Agent action을 사용한다.

**`cancel(target, opts?)`** — 기존 + `keep_worktree` 옵션. ledger에 `closed/cancelled` 기록.
report 이력은 post-mortem용으로 보존.

### Worker

- 초기 spawn/dispatch user message는 leader가 준 실제 task text만 포함한다.
- AgentControl report 규칙은 선택된 OMO role의 system prompt에 추가한다.
- worker별 `name`, `reportPath`, 선택적 `worktree`/`branch`는 `<runtime-json>` metadata로 system prompt에 주입한다.
- 후속 `send`는 별도 user turn이므로 leader-request label을 유지한다.

**`report(message, final?)`**
- ledger INSERT → 리더 pane이 있으면 기존 600자 한 줄 nudge paste, 없으면 생략.
- report는 600자 이내 한 문장 결론과 산출물 경로로 제한하고 상세 내용은 보고 문서에 둔다.
- `final: false` — 중간 진행 보고(선택). collect의 terminal 판정에 안 잡힌다.
- tmux migration bridge는 v3에서 제거(레거시 worker 소멸 확인 후).

## 실사용 시나리오 검증

| 시나리오 | 흐름 | v3에서 해결되는 것 |
|---|---|---|
| S1 · 1:1 interactive 작업 | Agent action → 필요 시 send → final Report → idle 5분 자동 정리 | 리더 cleanup 의존 제거 |
| S2 · read-only 리서치 fan-out | spawn×N(oneshot, group) → 자기 작업 → collect 루프 → 종합 | 수집 자동화, pane 자동 정리 |
| S3 · 병렬 코드 수정 | S2 + isolation:worktree, 커밋 계약 → 리더가 branch merge | 파일 충돌 원천 차단 |
| S4 · headless 리더 (bg 세션) | owner uuid + workspace 폴백, nudge 생략, collect 폴링 | 현재 불가능한 것이 가능해짐 |
| S5 · 장기 작업 | collect(짧은 timeout) 반복 + send 중간 지시 + peek | 진행 관측 수단 확보 |
| S6 · 고장 | collect가 dead/blocked/idle-no-report 표면화, `herdr notification show`로 사람 알림(옵션) | 무한 대기 제거 |

## 동시성 · 성능

- **stdio 루프 스레드화**: `tools/call`을 스레드 풀에 dispatch하고 JSON-RPC id로
  out-of-order 응답(stdout write는 lock). spawn의 30s 시작 배리어가 다른 호출을 막지
  않고, 리더가 한 메시지에서 spawn×N을 병렬 호출하면 시작 배리어도 병렬화된다.
  `initialize`/`tools/list`는 인라인 처리.
- herdr CLI 호출은 호출당 독립 subprocess라 병렬 안전.
- collect 폴링 tick은 ledger 쿼리 1회 + `herdr agent list` 1회로 경량 유지.

## 신뢰 경계

- report 본문은 worker가 읽은 외부 콘텐츠에 오염될 수 있는 **비신뢰 데이터**다.
  `[AGENT_REPORT]` 라벨은 서버가 붙이지만 내용 자체는 지시로 취급하지 말 것 —
  leader instructions 문구에 명시한다.
- worker의 report 도구는 자기 ledger row에만 쓸 수 있다(worker_id는 env로 주입된
  이름이 아니라 spawn 시 발급한 id 토큰으로 결정).

## 마이그레이션

1. `ledger.db` 신설(레거시 `control.db` 불변). 스키마 버전 테이블 포함.
2. 서버 3.0.0. instructions 문구 갱신: collect 중심 fan-in, 비신뢰 report 주의,
   oneshot 수명 규칙.
3. tmux bridge 제거는 레거시 worker 전멸 확인 후 별도 커밋.
4. 기존 도구 시그니처는 전부 하위 호환(옵션 추가만).

## 리스크

- 클라이언트 MCP timeout 30s → collect 상한 20s로 클램프. 장기 fan-out은 리더 루프가 담당.
- herdr `done`/`idle` semantic은 advisory — terminal 판정은 반드시 final report 또는
  pane 소멸로만 한다.
- headless owner uuid는 프로세스 재시작 시 바뀜 → 문서에 `AGENT_CONTROL_OWNER` 고정 권장.
- 동일 프로젝트를 여러 리더가 쓸 때 cap은 owner별로 계산(전역 cap은 env로 별도 제공).

## 구현 순서

1. ledger + `collect`(consume 포함) + `report`의 ledger 경로 — fan-in 성립.
2. lazy reconciliation(dead/blocked) + `list` 병합 — 고장 감지.
3. `isolation: worktree` + oneshot 정리 — 병렬 수정.
4. headless owner/workspace 폴백 — bg 리더.
5. stdio 스레드화 + `peek` — 폴리싱.

# Oh-My-OpenCode: 자율 에이전트 오케스트레이션 심층 분석 및 가이드 v1.1

> **작성일:** 2026년 1월 31일
> **버전:** 1.1 (심층 분석 보강판)
> **대상:** AI 에이전트 시스템을 구축하거나 고도화하려는 현업 개발자, 아키텍트, LLM 엔지니어
> **목적:** `oh-my-opencode` 프로젝트의 철학, 아키텍처, 핵심 구현 패턴을 소스 코드 레벨에서 해부하여, 실무에 즉시 이식 가능한 형태의 기술 명세서(Technical Specification) 수준으로 제공.

---

## 1. 서문: 개입은 실패다 (Intervention is Failure)

`oh-my-opencode`(이하 OMO)는 단순한 CLI 도구가 아닙니다. 이 프로젝트는 **"인간의 개입을 최소화하는 것이 아니라, 완전히 제거하는 것"**을 목표로 하는 급진적인 에이전트 오케스트레이션 프레임워크입니다.

전통적인 Copilot이 "부조종사"라면, OMO의 Sisyphus는 "위임받은 책임자"입니다. 개발자는 운전대를 잡지 않습니다. 목적지만 입력하고 잠을 자러 갑니다. 이 문서는 그 "자율성"을 기술적으로 어떻게 구현했는지 해부합니다.

### 1.1. 핵심 철학 (Core Philosophy)
1.  **Human in the loop = Bottleneck**: 인간이 중간에 끼어들면 컨텍스트가 깨지고 속도가 느려진다.
2.  **Code as a Byproduct**: 코드는 에이전트가 문제를 해결하는 과정에서 나오는 부산물일 뿐, 인간이 한 줄 한 줄 검수할 대상이 아니다(최종 결과물만 검증).
3.  **Stateless Execution, Stateful Knowledge**: 실행 에이전트는 언제든 죽고 다시 살아날 수 있어야 하며(Stateless), 지식은 파일 시스템(Stateful)에 남겨야 한다.

---

## 2. 아키텍처: 판테온 (The Pantheon)

OMO는 단일 LLM에 모든 것을 맡기지 않습니다. 역할과 권한이 철저히 분리된 에이전트들의 **조직(Organization)**으로 작동합니다. 이를 '판테온'이라 부릅니다.

### 2.1. 역할 분담 및 권한 제어 (Role Separation & Permission)

각 에이전트는 System Prompt 레벨뿐만 아니라, **툴 사용 권한(Tool Restriction)** 레벨에서 물리적으로 제약됩니다.

| 에이전트 | 역할 | 권장 모델 | 핵심 제약 사항 (Identity Constraint) | 툴 권한 (Allow/Deny) | 참조 파일 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Prometheus** | **Planner** (기획) | Opus 4.5 | **[Implementation 금지]** 코드를 작성할 수 없음. 오직 인터뷰와 기획안 작성만 수행. | ✅ Read, Plan (`.md` only)<br>❌ Write Code, Bash | `src/agents/prometheus-prompt.ts` |
| **Metis** | **Consultant** (감수) | Opus 4.5 | **[Action 금지]** 기획 전 단계에서 요구사항의 빈틈(Gap) 분석 및 AI Slop(과잉 엔지니어링) 경고. | ✅ Read Only<br>❌ All Side Effects | `src/agents/metis.ts` |
| **Atlas** | **Orchestrator** (지휘) | Sonnet 4.5 | **[Direct Work 금지]** 직접 코드를 짜지 않음. 하위 에이전트에게 위임(`delegate_task`)하고 결과 검증만 수행. | ✅ Read, Delegate, Verify<br>❌ Write Code | `src/agents/atlas.ts` |
| **Sisyphus** | **Executor** (실행) | Opus 4.5 | **[Planning 금지]** 주어진 Todo를 하나씩 격파. 끈기 있게 완수할 책임. | ✅ All Tools (Write, Bash)<br>❌ Delegate (일부 제한) | `src/agents/sisyphus.ts` |
| **Momus** | **Critic** (비평) | GPT-5.2 | **[Approval Gate]** High Accuracy Mode에서 Prometheus의 계획을 무한 검증. "OK" 할 때까지 반려. | ✅ Read Plan Only<br>❌ Edit Plan | `src/agents/momus.ts` |
| **Librarian** | **Researcher** (탐색) | Haiku/Flash | 외부 문서, 다른 레포지토리 탐색 담당. | ✅ Web Search, GitHub Search<br>❌ File Write | `src/agents/librarian.ts` |

### 2.2. 오케스트레이션 흐름 (Orchestration Flow)

```mermaid
graph TD
    User[User Input] --> Intent{Intent Classify}
    
    Intent -- Simple --> Sisyphus[Sisyphus (Executor)]
    Intent -- Complex --> Metis[Metis (Consultant)]
    
    Metis -- Gap Analysis --> Prometheus[Prometheus (Planner)]
    Prometheus -- Draft Plan --> Momus{Momus Review?}
    
    Momus -- Reject --> Prometheus
    Momus -- Approve --> PlanFile[/.sisyphus/plans/task.md]
    
    PlanFile --> Atlas[Atlas (Orchestrator)]
    
    subgraph "Execution Loop"
        Atlas -- 1. Read Notepad --> Atlas
        Atlas -- 2. Delegate Task --> SubAgent[Sisyphus Jr. (Sub-agent)]
        SubAgent -- 3. Execute & Verify --> SubAgent
        SubAgent -- 4. Write Notepad --> Atlas
    end
    
    Atlas -- All Done --> User
```

---

## 3. 핵심 기술 패턴 (Key Technical Patterns)

현업 개발자가 즉시 차용할 수 있는 5가지 핵심 구현 패턴입니다. 단순한 개념 소개를 넘어, **"어떻게 구현했는가"**에 초점을 맞춥니다.

### 3.1. Todo Continuation Enforcer (끈기 엔진)

AI가 "다 했습니다"라고 거짓말하거나, 토큰 제한/시간 초과로 멍하니 있는 것을 방지하는 **강제 구동 장치**입니다.

*   **문제:** LLM은 게으르거나 문맥을 잃으면 작업을 조기 종료하려는 경향이 있음.
*   **구현 로직 (`src/hooks/todo-continuation-enforcer.ts`):**
    1.  **Event Listener:** `session.idle` (AI가 응답을 멈춘 상태) 이벤트를 감시.
    2.  **State Check:** 현재 세션의 Todo 리스트를 조회하여 `status: pending`인 항목이 있는지 확인.
    3.  **Prompt Injection:** 미완료 항목이 있다면, 시스템이 **사용자 몰래** 다음 프롬프트를 주입하여 강제로 `tool_use`를 유발함.
        ```text
        SYSTEM_DIRECTIVE: Incomplete tasks remain in your todo list.
        Continue working on the next pending task.
        Proceed without asking for permission.
        Do not stop until all tasks are done.
        [Status: 3/10 completed, 7 remaining]
        ```
    4.  **UX:** 사용자에게는 "Resuming in 2s..." 토스트 알림만 노출.

### 3.2. Notepad Protocol (무상태 지식 전파)

하위 에이전트(Sub-agent)는 생성되고 사라지는 **Stateless** 프로세스입니다. 이들이 얻은 지식(이 파일은 이렇게 고쳐야 하더라, 이 라이브러리는 버전이 안 맞더라 등)을 공유 메모리 없이 어떻게 전파할까요?

*   **해결책:** 파일 시스템을 **영속적 공유 메모리(Persistent Shared Memory)**로 사용.
*   **구조:** `.sisyphus/notepads/{plan_name}/`
    *   `learnings.md`: 발견한 패턴, 컨벤션, 주의사항.
    *   `decisions.md`: 아키텍처 의사결정 기록.
    *   `issues.md`: 해결되지 않은 문제, 향후 과제.
*   **프로토콜 (`src/agents/atlas.ts`):**
    *   **Pre-Delegation (Atlas):** 하위 에이전트 호출 시, `learnings.md` 내용을 읽어 프롬프트의 `## Inherited Wisdom` 섹션에 주입.
        > "이전 작업자가 남긴 메모입니다: 이 프로젝트는 들여쓰기를 2칸 공백으로 합니다."
    *   **Post-Completion (Sub-agent):** 작업 완료 전, 자신이 알게 된 사실을 `learnings.md`에 **Append** 하고 종료.

### 3.3. Background "Fire-and-Forget" (비동기 병렬 처리)

메인 에이전트가 문서를 읽느라 3분을 기다리는 것은 비효율적입니다. OMO는 이를 비동기 백그라운드 작업으로 처리합니다.

*   **구현 (`src/features/background-agent/manager.ts`):**
    1.  **Non-blocking Call:** `delegate_task(run_in_background=true)` 호출 시 메인 스레드는 즉시 리턴받음.
    2.  **Shadow Session:** 별도의 백그라운드 세션(`bg_xxxxx`)이 생성되어 작업을 수행.
    3.  **Concurrency Manager:** API Rate Limit을 방어하기 위해 모델별/제공자별 동시 실행 수 제한 (`concurrency.ts`).
    4.  **Notification:** 작업이 완료되면 메인 세션에 `System Notification` 형태로 결과가 주입되거나, TUI Toast로 알림.

### 3.4. Dynamic Prompt Construction (동적 프롬프트 조립)

하나의 거대한 시스템 프롬프트 대신, 상황에 맞춰 레고처럼 조립되는 프롬프트를 사용합니다.

*   **구현 (`src/agents/dynamic-agent-prompt-builder.ts`):**
    *   **Decision Matrix:** 현재 사용 가능한 에이전트와 카테고리에 따라 "언제 누구를 써야 하는지" 테이블을 동적으로 생성.
    *   **Skill Injection:** 프로젝트에 정의된 `Skill`들의 설명을 읽고, 현재 작업에 필요한 스킬만 로드하도록 가이드.
    *   **Anti-Patterns Injection:** 현재 작업 맥락(예: TypeScript 프로젝트)에 맞춰 "절대 하지 말아야 할 것(예: `as any`)"을 명시적으로 주입.

### 3.5. Agent-Executable QA (자율 검증 원칙)

"사용자가 확인해보세요"라는 말은 OMO에서 **실패**로 간주됩니다. 모든 검증은 **에이전트가 실행 가능한 명령**이어야 합니다.

*   **원칙:** Acceptance Criteria = Executable Command.
*   **검증 패턴:**
    | 대상 | 도구 | 검증 방법 (예시) |
    | :--- | :--- | :--- |
    | **Frontend** | `playwright` skill | 브라우저 실행 -> 클릭 -> `expect(selector).toBeVisible()` |
    | **Backend** | `curl` + `jq` | API 호출 -> JSON 파싱 -> 필드 값 검증 |
    | **CLI/TUI** | `tmux` + `expect` | 세션 실행 -> 키 입력 -> 화면 출력 텍스트 매칭 |
    | **Build** | `tsc`, `build` | Exit Code 0 확인 및 에러 로그 파싱 |

---

## 4. 실무 도입 체크리스트 (Adoption Checklist)

이 시스템을 여러분의 조직이나 프로젝트에 도입하기 위한 단계별 가이드입니다.

### Phase 1: 기반 마련 (Foundation)
- [ ] **페르소나 분리:** "기획자(Prometheus)"와 "실행자(Sisyphus)"의 시스템 프롬프트를 물리적으로 분리했는가?
- [ ] **권한 제어:** 기획자가 코드를 수정하지 못하도록 툴 권한을 제어했는가?
- [ ] **공유 메모리:** 에이전트 간 지식 공유를 위한 파일(`Notepad`) 구조를 정의했는가?

### Phase 2: 루프 구축 (The Loop)
- [ ] **Enforcer 구현:** 에이전트가 작업을 조기 종료할 때 다시 밀어넣는 훅(Hook)을 구현했는가?
- [ ] **검증 강제:** 작업 완료 조건으로 "테스트 코드 통과"를 강제하고 있는가?
- [ ] **자율 검증:** "사용자가 확인"하라는 시나리오를 에이전트 스스로 검증하도록 변경했는가?

### Phase 3: 고도화 (Optimization)
- [ ] **병렬 처리:** 문서 탐색 등 읽기 작업(Read-heavy)을 백그라운드로 돌리고 있는가?
- [ ] **동적 프롬프트:** 불필요한 토큰 낭비를 줄이기 위해 프롬프트를 동적으로 조립하고 있는가?
- [ ] **감수자(Metis) 도입:** 기획 단계에서 과잉 설계를 미리 차단하고 있는가?

---

## 5. 안티 패턴 (Anti-Patterns)

OMO 개발 과정에서 발견된, **"절대 하지 말아야 할"** AI 협업 패턴들입니다.

1.  **"나중에 수정할게요" (Leaving Broken State):**
    *   **문제:** AI는 일단 코드를 짜고 나중에 고치려 하지만, 컨텍스트가 길어지면 까먹는다.
    *   **해결:** TDD. 테스트가 통과하지 않으면 다음 단계로 넘어가지 못하게 막아야 한다.

2.  **"사용자가 확인해주세요" (Human Reliance):**
    *   **문제:** 사용자가 개입하는 순간 AI는 의존적이 되고, 책임감을 잃는다.
    *   **해결:** 검증 가능한 명령어를 짜지 못하면 작업을 시작하지 못하게 하라.

3.  **거대한 단일 계획 (Monolithic Plan without Update):**
    *   **문제:** 초기에 짠 계획은 실행 과정에서 무조건 틀어진다.
    *   **해결:** Notepad를 통해 실행 과정의 발견 사항을 실시간으로 기록하고, 필요하면 계획을 수정(Refinement)해야 한다.

---

## 6. 부록 (Appendix)

*   **Repository:** [https://github.com/code-yeongyu/oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode)
*   **Ultrawork Manifesto:** `docs/ultrawork-manifesto.md`
*   **Orchestration Guide:** `docs/orchestration-guide.md`
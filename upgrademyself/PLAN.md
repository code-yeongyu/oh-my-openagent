# oh-my-openagent 업그레이드 계획서

> 기준일: 2026-04-03  
> 대상 브랜치: `claude/review-openagent-fork-8un9z`  
> 목적: 2026년 하네스 엔지니어링 최신 기법 중 현재 미구현/부분 구현 항목을 완전히 구현한다.

---

## 현황 요약

| 기법 | 현재 상태 | 비고 |
|------|-----------|------|
| 멀티에이전트 병렬 실행 | ✅ 구현됨 | background-agent, delegate-task |
| Hash-anchored 편집 | ✅ 구현됨 | hashline-edit 툴 |
| 선제적 compaction | ✅ 구현됨 | preemptive-compaction 훅 |
| 자기비판(self-critique) 루프 | ⚠️ 부분 | edit-error-recovery만 있음, 구조적 self-critique 없음 |
| 크로스세션 장기 메모리 | ❌ 없음 | boulder-state는 세션 내 상태만 |
| 5단계 점진적 compaction | ❌ 없음 | 단순 1회 compaction만 존재 |
| git 스냅샷 undo | ❌ 없음 | git-worktree는 있으나 undo 기능 없음 |
| doom loop 감지 강화 | ❌ 부족 | ralph-loop로 부분 대체, 메인 에이전트엔 없음 |
| lazy tool discovery | ❌ 없음 | 26개 툴 전부 세션 시작 시 로드 |
| 벡터DB 기반 동적 컨텍스트 | ❌ 없음 | 정적 context injection만 존재 |

---

## 구현 항목별 상세 계획

---

### 1. 크로스세션 장기 메모리 (Cross-Session Long-Term Memory)

**목표**: 세션이 종료되어도 중요한 결정·학습·실패 이력이 다음 세션에 자동으로 주입된다.

**현재 문제**:
- `boulder-state`는 현재 세션 내 태스크 상태만 추적
- `session-recovery` 훅은 세션 재시작을 지원하지만, 이전 세션의 지식을 전달하지 않음
- compaction 시 AGENTS.md와 README.md만 주입 (프로젝트 지식 ≠ 에이전트 학습)

**구현 계획**:

```
src/features/long-term-memory/
├── index.ts                    # 모듈 진입점
├── memory-store.ts             # 파일 기반 메모리 저장소 (JSON Lines)
├── memory-entry.ts             # 메모리 엔트리 스키마 (Zod)
├── memory-injector.ts          # 세션 시작 시 관련 메모리 주입
├── memory-extractor.ts         # 세션 종료 시 중요 정보 추출
└── memory-ranker.ts            # 관련성 점수 계산 (키워드 기반)
```

**메모리 엔트리 구조**:
```typescript
type MemoryEntry = {
  id: string;              // nanoid
  timestamp: string;       // ISO8601
  type: 'decision' | 'failure' | 'pattern' | 'preference';
  summary: string;         // 1-2줄 요약
  context: string;         // 원문 컨텍스트
  tags: string[];          // 키워드 태그
  relevanceScore: number;  // 계산된 관련성
  hitCount: number;        // 재사용 횟수
};
```

**저장 위치**: `.opencode/memory/entries.jsonl` (프로젝트별)  
**주입 방식**: `chat.message` 훅에서 최대 5개 관련 메모리를 시스템 프롬프트에 추가  
**추출 방식**: `event` 훅의 `session.idle` / `session.deleted` 이벤트에서 실행

**관련 파일**:
- `src/hooks/memory-injector/` - 세션 시작 시 메모리 주입 훅
- `src/hooks/memory-extractor/` - 세션 종료 시 메모리 추출 훅
- `src/config/schema/long-term-memory.ts` - 설정 스키마

---

### 2. 5단계 점진적 Compaction

**목표**: 컨텍스트 윈도우가 줄어들수록 5단계로 점진적으로 정보를 압축해, 중요 컨텍스트 손실을 최소화한다.

**현재 문제**:
- `compaction-context-injector`가 compaction 후 AGENTS.md/README.md를 주입하지만 단순 1회성
- 컨텍스트 사용량에 따른 단계별 전략 없음
- 압축 우선순위 없음 (모든 정보를 동등하게 취급)

**5단계 전략**:

| 단계 | 컨텍스트 사용률 | 행동 |
|------|----------------|------|
| 1단계 (Green) | 0~60% | 정상 동작, 모니터링만 |
| 2단계 (Yellow) | 60~75% | 툴 결과 출력 최대 길이 축소, 이미지 해상도 축소 |
| 3단계 (Orange) | 75~85% | 오래된 툴 호출 결과 요약으로 대체, TODO 상태만 유지 |
| 4단계 (Red) | 85~95% | 핵심 계획·결정만 남기고 나머지 압축, 서브에이전트 위임 |
| 5단계 (Critical) | 95%+ | 강제 compaction 실행, 다음 세션에 상태 저장 후 재시작 |

**구현 계획**:

```
src/features/progressive-compaction/
├── index.ts
├── compaction-level.ts         # 단계 계산 로직
├── compaction-strategies.ts    # 단계별 압축 전략 팩토리
├── context-monitor.ts          # 컨텍스트 사용률 추적
└── compaction-coordinator.ts   # 전략 조율 및 실행
```

**훅 연동**:
- `experimental.chat.messages.transform` 훅에서 현재 단계 계산
- 단계에 따라 메시지 변환 전략 다르게 적용
- `chat.params` 훅에서 단계에 맞는 max_tokens 조정

**관련 파일**:
- `src/hooks/progressive-compaction/` - 메인 훅
- `src/config/schema/progressive-compaction.ts` - 설정 스키마
  - `enabled`: boolean
  - `thresholds`: 5단계 임계값 커스터마이징

---

### 3. Git 스냅샷 Undo

**목표**: 에이전트가 파일을 수정하기 전 자동으로 git 스냅샷을 생성하고, 문제 발생 시 특정 스냅샷으로 되돌릴 수 있다.

**현재 문제**:
- `git-worktree` 유틸리티는 병렬 작업 격리에만 사용
- 단계별 undo 기능 없음
- 에이전트가 잘못된 파일 수정을 해도 되돌릴 방법이 없음

**구현 계획**:

```
src/features/git-snapshot/
├── index.ts
├── snapshot-manager.ts         # 스냅샷 생성/조회/복원
├── snapshot-store.ts           # 스냅샷 메타데이터 저장
└── snapshot-registry.ts        # 세션별 스냅샷 목록 관리

src/tools/git-snapshot/
├── index.ts
├── create-snapshot.ts          # 스냅샷 생성 툴
├── list-snapshots.ts           # 스냅샷 목록 조회
├── restore-snapshot.ts         # 스냅샷 복원 툴
└── diff-snapshot.ts            # 스냅샷 간 diff
```

**스냅샷 방식**:
- `git stash` 기반 (인덱스 기록): `git stash push -m "omo-snapshot-{timestamp}-{description}"`
- 또는 임시 커밋 방식: `git commit --no-verify -m "omo-snapshot: {description}"`
- 스냅샷 메타데이터: `.opencode/snapshots/registry.json`

**자동 스냅샷 트리거**:
- `tool.execute.before` 훅에서 Write/Edit/MultiEdit 툴 실행 전 자동 스냅샷
- 임계치: 3개 이상 파일 동시 수정 시 반드시 스냅샷
- 설정으로 자동 스냅샷 on/off 가능

**복원 명령어**:
- `/undo-last` - 마지막 스냅샷으로 복원
- `/list-snapshots` - 세션 내 스냅샷 목록
- `/restore-snapshot {id}` - 특정 스냅샷 복원

---

### 4. Doom Loop 감지 강화

**목표**: 메인 에이전트와 서브에이전트 모두에서 무한 루프를 선제적으로 감지하고 자동 복구한다.

**현재 문제**:
- `background-agent/loop-detector.ts`는 서브에이전트에만 적용
- 메인 에이전트의 반복 패턴 감지 없음
- 감지 후 "중단"만 하고 복구 전략 없음
- 동일 툴 N회 연속이라는 단순 기준만 사용

**강화 감지 기준**:
```typescript
type LoopSignal = {
  // 기존
  consecutiveIdenticalTool: number;    // 동일 툴 N회 연속
  // 신규
  cyclicToolPattern: string[];          // A→B→A→B 순환 패턴
  staleOutputPattern: boolean;          // 동일 입력→동일 출력 반복
  escalatingRetry: boolean;            // 점점 길어지는 재시도
  contextStagnation: boolean;          // N턴 동안 의미있는 진전 없음
};
```

**구현 계획**:

```
src/features/doom-loop-detector/
├── index.ts
├── pattern-analyzer.ts         # 순환 패턴 분석
├── stagnation-detector.ts      # 컨텍스트 정체 감지
├── recovery-strategies.ts      # 복구 전략 (skip/retry/escalate/abort)
└── loop-metrics.ts             # 루프 감지 메트릭 수집
```

**복구 전략 (감지 심각도별)**:
1. **경고 (Yellow)**: 시스템 메시지로 에이전트에게 루프 가능성 알림
2. **중간 (Orange)**: 다른 접근법 시도 요청 + 현재 상태 요약 요청
3. **심각 (Red)**: 서브에이전트에 태스크 위임 후 메인 에이전트 리셋
4. **치명 (Critical)**: 세션 상태 저장 후 강제 종료, 다음 세션에서 재개

**훅 연동**:
- `experimental.chat.messages.transform` 훅에서 최근 N개 메시지 분석
- `tool.execute.after` 훅에서 툴 호출 패턴 기록

---

### 5. Lazy Tool Discovery

**목표**: 세션 시작 시 26개 툴 전부를 로드하지 않고, 에이전트가 필요할 때 툴을 동적으로 발견하고 로드한다.

**현재 문제**:
- `src/plugin/tool-registry.ts`에서 26개 툴을 모두 등록
- 컨텍스트 윈도우의 상당 부분을 툴 스키마 설명이 차지
- 불필요한 툴이 에이전트를 혼란스럽게 할 수 있음

**구현 계획**:

```
src/features/lazy-tool-loader/
├── index.ts
├── tool-manifest.ts            # 툴 메타데이터 (설명만, 스키마 없음)
├── tool-loader.ts              # 요청 시 툴 스키마 동적 로드
├── tool-cache.ts               # 로드된 툴 캐시
└── tool-recommender.ts         # 컨텍스트 기반 툴 추천
```

**3계층 툴 구조**:

| 계층 | 항상 로드 | 설명 |
|------|-----------|------|
| Core (항상) | 5개 | `look-at`, `interactive-bash`, `glob`, `grep`, `delegate-task` |
| Standard (태스크 시작 시) | 10개 | 현재 태스크 카테고리에 맞는 툴 |
| Extended (요청 시) | 11개 | 에이전트가 `discover-tools` 호출 시 로드 |

**`discover-tools` 메타 툴**:
```typescript
// 에이전트가 이 툴을 호출해 사용 가능한 툴 목록 조회
discoverTools({
  category?: 'edit' | 'search' | 'agent' | 'skill' | 'git',
  query?: string  // 자연어로 필요한 툴 설명
})
```

**컨텍스트 윈도우 절약 효과**: 예상 15~30% 툴 스키마 토큰 절약

---

### 6. 벡터DB 기반 동적 컨텍스트 (선택적 구현)

**목표**: 현재 대화와 관련된 코드·문서를 벡터 유사도로 검색해 컨텍스트에 자동 주입한다.

**현재 문제**:
- `context-injector`가 AGENTS.md, README.md, rules 파일만 정적으로 주입
- 현재 태스크와 실제로 관련 있는 파일을 모름
- 대형 코드베이스에서 에이전트가 직접 grep으로 찾아야 함

**구현 옵션**:

**옵션 A (경량): 키워드 + TF-IDF 기반** (외부 의존성 없음)
```
src/features/dynamic-context/
├── index.ts
├── keyword-extractor.ts        # 현재 메시지에서 키워드 추출
├── file-indexer.ts             # 프로젝트 파일 인덱싱 (캐시)
├── relevance-scorer.ts         # TF-IDF 기반 관련성 점수
└── context-injector.ts         # 관련 파일 스니펫 주입
```

**옵션 B (강력): SQLite-vec 기반** (로컬 벡터DB)
```
src/features/vector-context/
├── index.ts
├── embedding-provider.ts       # 로컬 임베딩 (ollama/nomic-embed)
├── vector-store.ts             # SQLite-vec 래퍼
├── indexer.ts                  # 코드베이스 인덱싱 (점진적)
└── retriever.ts                # 쿼리 → 관련 스니펫
```

**권장**: 옵션 A 먼저 구현 후 옵션 B로 마이그레이션 경로 제공

**주입 예시**:
```
[동적 컨텍스트 - 현재 태스크 관련 파일]
📄 src/features/background-agent/manager.ts (관련성: 94%)
  lines 45-67: BackgroundAgentManager.spawn() 구현...
```

---

## 구현 우선순위 및 로드맵

### Phase 1 (즉시 구현 가능, 1~2주)
1. **Git 스냅샷 Undo** - 기존 git-worktree 코드 재활용, 위험도 낮음
2. **Doom Loop 감지 강화** - 기존 loop-detector.ts 확장
3. **Lazy Tool Discovery** - tool-registry.ts 리팩토링

### Phase 2 (중간 난이도, 2~3주)
4. **5단계 점진적 Compaction** - 기존 compaction 훅 위에 구축
5. **크로스세션 장기 메모리** - 새 feature 모듈, 파일 기반

### Phase 3 (복잡, 3~4주)
6. **벡터DB 기반 동적 컨텍스트** - 옵션 A(TF-IDF) → 옵션 B(벡터DB) 순서

---

## 아키텍처 원칙 (기존 코드 스타일 준수)

- **Factory 패턴**: 모든 새 기능은 `createXXX()` 함수로 시작
- **Zod 스키마**: 설정 스키마는 `src/config/schema/` 에 추가
- **Barrel 내보내기**: 각 폴더에 `index.ts`
- **훅 연동**: OpenCode 훅 인터페이스 (`tool.execute.before/after`, `chat.message`, `event`) 활용
- **테스트**: `*.test.ts` 공존, Bun test 프레임워크
- **파일명**: kebab-case
- **런타임**: Bun only

---

## 파일 구조 최종 요약

```
upgrademyself/
├── PLAN.md                         # 이 파일 (계획서)
├── 01-long-term-memory.md          # 크로스세션 장기 메모리 상세 설계
├── 02-progressive-compaction.md    # 5단계 점진적 compaction 상세 설계
├── 03-git-snapshot-undo.md         # git 스냅샷 undo 상세 설계
├── 04-doom-loop-detector.md        # doom loop 감지 강화 상세 설계
├── 05-lazy-tool-discovery.md       # lazy tool discovery 상세 설계
└── 06-vector-context.md            # 벡터DB 기반 동적 컨텍스트 상세 설계
```

---

## 참고 자료

- [arXiv: 6-step ReAct loop, 5-stage progressive compaction](https://arxiv.org/abs/2503.12345)
- [Humanlayer: Harness Engineering overview](https://humanlayer.dev/blog/harness-engineering)
- 기존 코드 참조:
  - `src/features/background-agent/loop-detector.ts` - 기존 루프 감지
  - `src/hooks/compaction-context-injector/` - 기존 compaction 훅
  - `src/shared/git-worktree/` - 기존 git worktree 유틸
  - `src/plugin/tool-registry.ts` - 현재 툴 등록 방식

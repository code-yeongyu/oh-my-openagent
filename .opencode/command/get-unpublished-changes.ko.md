---
description: HEAD를 npm에 배포된 최신 버전과 비교하여 배포되지 않은 모든 변경 사항을 나열
---

<command-instruction>
즉시 분석을 출력하라. 질문 없이. 서두 없이.

## 중요: 커밋 메시지를 그대로 복사하지 말 것!

각 커밋에 대해 반드시:
1. 실제 diff를 읽어 무엇이 변경되었는지 파악
2. 실제 변경 사항을 평이한 언어로 기술
3. (자명하지 않다면) 왜 중요한지 설명

## 단계:
1. `git diff v{published-version}..HEAD`를 실행하여 실제 변경 사항 확인
2. 타입(feat/fix/refactor/docs)별로 그룹화하고 실제 설명 작성
3. 있다면 breaking 변경 사항 명시
4. 버전 범프 권장 (major/minor/patch)

## 출력 포맷:
- feat: "Y를 수행하는 X 추가" ("X 기능 추가"가 아닌)
- fix: "X가 발생하던 버그 수정, 이제 Y" ("X 버그 수정"이 아닌)
- refactor: "X를 A에서 B로 변경, 이제 C 지원" ("X 이름 변경"이 아닌)
</command-instruction>

<version-context>
<published-version>
!`npm view oh-my-opencode version 2>/dev/null || echo "not published"`
</published-version>
<local-version>
!`node -p "require('./package.json').version" 2>/dev/null || echo "unknown"`
</local-version>
<latest-tag>
!`git tag --sort=-v:refname | head -1 2>/dev/null || echo "no tags"`
</latest-tag>
</version-context>

<git-context>
<commits-since-release>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git log "v{}"..HEAD --oneline 2>/dev/null || echo "no commits since release"`
</commits-since-release>
<diff-stat>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git diff "v{}"..HEAD --stat 2>/dev/null || echo "no diff available"`
</diff-stat>
<files-changed-summary>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git diff "v{}"..HEAD --stat 2>/dev/null | tail -1 || echo ""`
</files-changed-summary>
</git-context>

<output-format>
## 배포되지 않은 변경 사항 (v{published} → HEAD)

### feat
| 범위 | 변경 내용 |
|-------|--------------|
| X | 실제 변경 사항 설명 |

### fix
| 범위 | 변경 내용 |
|-------|--------------|
| X | 실제 변경 사항 설명 |

### refactor
| 범위 | 변경 내용 |
|-------|--------------|
| X | 실제 변경 사항 설명 |

### docs
| 범위 | 변경 내용 |
|-------|--------------|
| X | 실제 변경 사항 설명 |

### Breaking Changes
없음 또는 목록

### Files Changed
{diff-stat}

### 권장 버전 범프
- **권장 사항**: patch|minor|major
- **이유**: 권장 사유
</output-format>

<oracle-safety-review>
## Oracle 배포 안전성 검토 (사용자가 명시적으로 요청할 때만)

**트리거 키워드**: "safe to deploy", "can I deploy", "is it safe", "review", "check", "oracle"

사용자 요청에 위 키워드 중 하나가 포함된 경우:

### 1. 사전 검증
```bash
bun run typecheck
bun test
```
- 실패 시 → Oracle을 호출하지 않고 즉시 "❌ Cannot deploy" 보고

### 2. Oracle 호출 프롬프트

다음 정보를 수집하여 Oracle에 전달:

```
## Deployment Safety Review Request

### Changes Summary
{위에서 분석한 변경 사항 표}

### Key diffs (organized by feature)
{각 feat/fix/refactor에 대한 핵심 코드 변경 - 핵심 부분만, 전체 diff 아님}

### Validation Results
- Typecheck: ✅/❌
- Tests: {pass}/{total} (✅/❌)

### Review Items
1. **Regression Risk**: 기존 기능에 영향을 줄 수 있는 변경이 있는가?
2. **Side Effects**: 예상치 못한 부작용이 발생할 수 있는 영역이 있는가?
3. **Breaking Changes**: 외부 사용자에게 영향을 주는 변경이 있는가?
4. **Edge Cases**: 놓친 엣지 케이스가 있는가?
5. **Deployment Recommendation**: SAFE / CAUTION / UNSAFE

### Request
위 변경 사항을 깊이 분석하고 배포 안전성에 대한 판단을 제공해 주세요.
위험이 있다면 구체적인 시나리오로 설명해 주세요.
배포 후 모니터링할 키워드가 있다면 제안해 주세요.
```

### 3. Oracle 응답 후 출력 포맷

## 🔍 Oracle 배포 안전성 검토 결과

### 판정: ✅ SAFE / ⚠️ CAUTION / ❌ UNSAFE

### 위험 분석
| 영역 | 위험도 | 설명 |
|------|------------|-------------|
| ... | 🟢/🟡/🔴 | ... |

### 권장 사항
- ...

### 배포 후 모니터링 키워드
- ...

### 결론
{Oracle의 최종 판단}
</oracle-safety-review>

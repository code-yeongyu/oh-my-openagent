# Ollama 트러블슈팅

## 스트리밍 이슈: JSON 파싱 오류

### 문제

oh-my-openagent 에이전트와 함께 Ollama를 프로바이더로 사용할 때 다음과 같은 오류가 발생할 수 있습니다.

```
JSON Parse error: Unexpected EOF
```

이는 에이전트가 도구 호출(예: `mcp_grep_search`를 사용하는 `explore` 에이전트)을 시도할 때 발생합니다.

### 근본 원인

Ollama는 API 요청에서 `stream: true`를 사용할 때 **NDJSON**(newline-delimited JSON)을 반환합니다.

```json
{"message":{"tool_calls":[{"function":{"name":"read","arguments":{"filePath":"README.md"}}}]}, "done":false}
{"message":{"content":""}, "done":true}
```

Claude Code SDK는 여러 NDJSON 라인이 아닌 단일 JSON 객체를 기대하므로 파싱 오류가 발생합니다.

**원인 분석:**
- **Ollama API**: 설계상 스트리밍 응답을 NDJSON으로 반환함
- **Claude Code SDK**: 도구 호출에 대한 NDJSON 응답을 제대로 처리하지 못함
- **oh-my-openagent**: SDK 동작을 그대로 통과시킴 (이 레이어에서는 수정 불가)

## 해결 방법

### 옵션 1: 스트리밍 비활성화 (권장)

Ollama 프로바이더가 `stream: false`를 사용하도록 설정합니다.

```json
{
  "provider": "ollama",
  "model": "qwen3-coder",
  "stream": false
}
```

**장점:**
- 즉시 동작
- 코드 변경 불필요
- 단순한 설정

**단점:**
- 응답 시간이 약간 느림 (스트리밍 없음)
- 인터랙티브한 피드백 감소

### 옵션 2: 도구를 사용하지 않는 에이전트만 사용

스트리밍이 필요하다면 도구를 사용하는 에이전트는 피하세요.

- **안전**: 단순 텍스트 생성, 도구를 쓰지 않는 작업
- **문제 발생**: 도구 호출이 있는 모든 에이전트(explore, librarian 등)

### 옵션 3: SDK 수정 대기

올바른 수정은 Claude Code SDK가 다음을 수행해야 합니다.

1. NDJSON 응답 감지
2. 각 라인을 개별 파싱
3. 여러 라인의 `tool_calls` 병합
4. 단일 병합 응답 반환

**추적**: https://github.com/code-yeongyu/oh-my-openagent/issues/1124 (closed - 워크어라운드 문서화됨)

## 워크어라운드 구현

SDK가 수정될 때까지 NDJSON 파싱을 구현하는 방법(SDK 메인테이너용)입니다.

```typescript
async function parseOllamaStreamResponse(response: string): Promise<object> {
  const lines = response.split('\n').filter(line => line.trim());
  const mergedMessage = { tool_calls: [] };

  for (const line of lines) {
    try {
      const json = JSON.parse(line);
      if (json.message?.tool_calls) {
        mergedMessage.tool_calls.push(...json.message.tool_calls);
      }
      if (json.message?.content) {
        mergedMessage.content = json.message.content;
      }
    } catch (e) {
      // Skip malformed lines
      console.warn('Skipping malformed NDJSON line:', line);
    }
  }

  return mergedMessage;
}
```

## 테스트

수정이 동작하는지 확인하려면:

```bash
# Test with curl (should work with stream: false)
curl -s http://localhost:11434/api/chat \
  -d '{
    "model": "qwen3-coder",
    "messages": [{"role": "user", "content": "Read file README.md"}],
    "stream": false,
    "tools": [{"type": "function", "function": {"name": "read", "description": "Read a file", "parameters": {"type": "object", "properties": {"filePath": {"type": "string"}}, "required": ["filePath"]}}}]
  }'
```

## 관련 이슈

- **oh-my-openagent**: https://github.com/code-yeongyu/oh-my-openagent/issues/1124 (closed - 워크어라운드 문서화됨)
- **Ollama API 문서**: https://github.com/ollama/ollama/blob/main/docs/api.md

## 도움 받기

이 이슈가 발생하면:

1. Ollama 프로바이더 설정 확인
2. 워크어라운드로 `stream: false` 설정
3. 추가 오류는 이슈 트래커에 보고
4. 디버깅을 위해 설정(시크릿 제외)을 제공

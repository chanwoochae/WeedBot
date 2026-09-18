# Chat API

## 목적
Discord 전용이던 대화 로직(Ollama→Gemini 폴백, 대화 히스토리)을 다른 앱(개인용 웹앱 등)도 재사용할 수 있게 HTTP API로 노출한다.

## 엔드포인트
- `POST /api/chat/message` — body `{ userId, message }` → `{ reply, model }`. 히스토리 조회 → 답변 생성 → user/assistant 메시지 저장.
- `POST /api/chat/clear` — body `{ userId }` → `{ deleted }`. 히스토리 삭제.
- `GET /api/chat/model` — → `checkActiveModel()` 결과 그대로. 현재 활성 모델(Ollama/Gemini) 상태.
- `GET /api/chat/history?userId=` — → `{ messages }`. 이전 대화 조회 (M2.0, 개인 웹앱이 페이지 로드 시 사용).
- `POST /api/chat/message/stream` — body `{ userId, message, mode?: "fast" | "refine" }`(mode 생략시 `"refine"`). NDJSON 스트림 응답(`Content-Type: application/x-ndjson`), 한 줄에 이벤트 하나:
  - `{ type: "chunk", text }` — Ollama 응답 델타(여러 번, `text`가 빈 문자열일 수 있음 — 모델의 "생각(thinking)" 단계에서 발생, 무해함)
  - `{ type: "refining" }` — `mode: "refine"`일 때만, 초안 완료 후 정제 시작 신호(한 번)
  - `{ type: "done", reply, model }` — 최종 완료. `fast`면 초안 그대로, `refine`이면 정제된 최종본. 스트림 마지막 줄.
  - `{ type: "error", error }` — 실패 시(이미 200 응답이 커밋된 상태라 스트림 이벤트로 에러 표현)
  - 자세한 배경은 `weed-console/spec/chat-ui.md`의 "빠름/정제 모드" 참조.

## 인증
`Authorization: Bearer <PIPELINE_API_KEY>` — 기존 `/api/markup`과 동일한 공유 키.

## userId 신뢰 모델 (보안 — 중요)
- 이 API는 호출자가 지정하는 `userId`를 그대로 신뢰한다. 즉 키를 가진 호출자는 임의의 `userId` 행세를 할 수 있다.
- **허용 조건**: 이 키를 쥔 호출자가 전부 소유자 본인이 통제하는 서비스(WeedBot Discord 봇, 개인용 웹앱)일 때만 안전하다고 판단하고 그대로 유지하기로 결정함(2026-09-18).
- **절대 금지**: trendiv처럼 불특정 다수가 접근하는 공개 서비스가 이 API·이 키·이 저장소(`secretary_messages`)를 그대로 재사용하는 것. 공개 서비스는 별도 identity(익명 세션 또는 자체 계정) + 별도 저장소 + 별도 rate limit + Gemini 폴백 없이 Ollama만 사용해야 한다.

## 알려진 제약
- `POST /api/chat/message`(비스트리밍)는 Ollama 타임아웃(기본 10분, `OLLAMA_TIMEOUT_MS`)이 그대로 응답 시간이 된다. `POST /api/chat/message/stream`은 이 문제를 해결하려고 만든 것 — 전체 타임아웃 대신 청크 수신마다 갱신되는 90초 무응답 감지(`chatStream`)를 씀. weed-console은 스트리밍 엔드포인트를 쓰고, 비스트리밍 `/api/chat/message`는 다른 재사용 목적(다른 앱이 스트리밍 없이 붙일 때)으로 남겨둠.
- `userId`는 호출 직후 `trim()`해서 정규화한다(2026-09-18 수정 — 이전엔 검증만 trim하고 조회는 원본을 써서 공백 섞인 요청이 다른 곳과 어긋난 히스토리 버킷을 만들 수 있었음).
- `saveMessage` 두 번 호출이 순차 실행이라 약간의 지연이 있음 — **의도적으로 그대로 둠(2026-09-19 시도 후 되돌림)**: user 메시지 저장을 `chat()`과 `Promise.all`로 병렬화해봤더니, Ollama+Gemini 둘 다 실패하는 경우 user 메시지만 저장되고 assistant 응답 없이 고아 레코드가 남고, 재시도 시 중복까지 쌓이는 문제가 생김("user 메시지는 chat() 성공 후에만 저장한다"는 암묵적 불변식이 깨짐). 아끼는 시간(전체 응답 10초~수십초 중 수백 ms)에 비해 리스크가 커서 순차 실행 유지가 맞다고 판단.

## 재사용 경계
- 공유 가능: Ollama→Gemini 폴백 "답변 생성" 능력 자체.
- 공유 불가: 이 API의 히스토리 저장소와 인증/identity 모델.

## 변경 이력
- 2026-09-17: 최초 구현 (PR #3, codex `gpt-6-astra`로 작성, Claude 리뷰)
- 2026-09-18: `userId` trim 일관성 버그 수정 (코드리뷰로 발견)
- 2026-09-18: `GET /api/chat/history` 추가 (M2.0, codex `gpt-6-astra`로 작성)
- 2026-09-19: `POST /api/chat/message/stream` 추가 — `chatStream()`(Ollama 스트리밍 + 90초 무응답 감지 + Gemini 폴백, `src/services/llm.service.ts`)과 `refineWithAgy()`(Antigravity CLI로 답변 정제, `src/services/refine.service.ts`)를 새로 만들고 이 엔드포인트로 연결. 기존 `chat()`/Discord 봇 경로는 변경 없음.

# WeedBot

개인 비서 역할을 하는 로컬 LLM 기반 Discord Bot.  
맥북 Ollama(Gemma4:31b)를 메인으로, 오프라인 시 Gemini Flash로 자동 폴백.

---

## 아키텍처

```
Discord DM / 멘션
      │
      ▼
Oracle Cloud (PM2 24시간)
      │
      ├─ MacBook 온라인 → autossh 역방향 터널 → Ollama (Gemma4:31b)
      │
      └─ MacBook 오프라인 → Gemini Flash (자동 폴백)
                                    │
                                    ▼
                           Supabase (대화 히스토리)
```

---

## ⚠️ 맥북 재부팅 후 필수 실행

맥북 재부팅하면 Oracle과의 터널이 끊겨 Ollama를 사용할 수 없게 됨.  
재부팅 후 아래 명령어 실행 필요 (터미널 닫아도 백그라운드 유지):

```bash
nohup autossh -M 0 -R 11434:localhost:11434 opc@168.107.43.222 -N \
  -i ~/.ssh/id_ed25519 \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 > /dev/null 2>&1 &
```

터널 종료:
```bash
pkill autossh
```

---

## Oracle 운영 명령어

```bash
# 환경변수 수정
nano /home/opc/.env.shared

# 재빌드 & 재시작
pnpm build && pm2 restart weedbot

# 환경변수 변경 후 재시작
pm2 restart weedbot --update-env

# 로그 확인
pm2 logs weedbot --lines 20
```

---

## 환경변수

**Oracle**: `/home/opc/.env.shared` (WeedBot + trendiv 공유 심링크)

**맥북(로컬)**: `~/project/.env.shared` → `WeedBot/.env`, `weed-console/.env.local`로 각각 심링크(2026-09-18 설정). 맥북에서 로컬로 여러 앱 띄울 때 값 하나만 관리하면 되고, Oracle의 `.env.shared`와는 별개 파일 — 값은 손으로 맞춰야 함(자동 동기화 없음). `PIPELINE_API_KEY`/`WEEDBOT_API_KEY`는 로컬 테스트 전용으로 새로 생성한 값.

⚠️ **`OLLAMA_MODEL`을 `qwen3.6:27b`(dense, 27B)로 두지 말 것** — 이름이 비슷한 `qwen3.6:35b-a3b`(MoE)와 다른 모델. `27b`는 기본 reasoning_effort가 "xhigh"라 "5만 답해줘" 같은 간단한 질문에도 몇 분~최대 20분씩 내부 사고(thinking)를 하느라 응답이 극도로 느려짐(Ollama는 reasoning_effort 조절 옵션 노출 안 함).

현재 로컬 기본값(2026-09-18): **`OLLAMA_MODEL=oamazonasgabriel/qwen3.6-35b-a3b:q4-24gbGPU`** — 공식 `qwen3.6:35b-a3b`(Q4_K_M, 24GB, GPU 10%/CPU 90%로 밀려 51초)보다 가볍게 양자화된 커뮤니티 빌드(IQ4_XS, 19GB). **100% GPU로 온전히 올라가고 실전 질문 기준 약 4초**로 압도적으로 빠름. `gemma4:26b`(~48초)도 대안으로 동작 확인됨.

⚠️ 이 맥북(M1 Pro 32GB)은 Metal GPU가 실사용 가능한 메모리가 시스템 전체 32GB가 아니라 **~21.3GiB로 제한**돼있음(Ollama 로그의 `gpu memory ... total="21.3 GiB"`로 확인). 이 한도를 넘는 모델은 일부가 CPU로 밀려 급격히 느려짐 — 새 모델 시도 시 `ollama ps`의 `PROCESSOR` 컬럼이 `100% GPU`인지 꼭 확인할 것.

⚠️ **이 맥북엔 한때 Ollama가 두 벌(Homebrew + 네이티브 Ollama.app) 설치돼 포트(11434)를 두고 충돌**한 적 있음(2026-09-18) — 응답이 비거나 먹통이면 `launchctl list | grep -i ollama`와 `lsof -i :11434`로 중복 실행부터 의심할 것. 네이티브 앱은 종료 및 `launchctl bootout`으로 자동실행 해제, Homebrew(`brew services`)만 사용 중.

```env
SUPABASE_URL=
SUPABASE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_MODEL_PRO=gemini-3.1-pro-preview

DISCORD_BOT_TOKEN=
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=gemma4:31b
OLLAMA_TIMEOUT_MS=300000
HISTORY_WINDOW=20
```

> 상세 스펙 및 TODO → [Issue #1](../../issues/1)

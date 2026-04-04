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

`/home/opc/.env.shared` (WeedBot + trendiv 공유 심링크)

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

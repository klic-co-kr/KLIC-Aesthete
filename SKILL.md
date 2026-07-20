---
name: aesthete
description: 레이아웃 인지 미학 사전·사후 스킬. LLM은 skill-pre→생성→skill-post만. decision 뒤집기 금지. 트리거 — 레이아웃 미학, /aesthete, SVG/PPTX 검사·보정.
license: "SEE LICENSE IN LICENSE"
metadata:
  version: "1.0"
---

# Aesthete — LLM 사용 (필수)

> **전체 플레이북:** [`docs/agent-llm-usage.md`](./docs/agent-llm-usage.md) ← 헷갈리면 이것만 읽어.

## 역할
- **Aesthete** = 사전 지시 + 사후 **산술 판정** (`decision`)
- **너** = 생성 호출 · `fix` 실행 · 루프 카운트 · 사람 escalate
- **금지** = “예뻐 보인다”로 decision 덮기 · lib 4~6개 손조합 · write-back 본진 착각

## 루프 (암기)
```text
skill-pre → (생성기) → skill-post → decision 분기
  pass           → 끝
  fix_geometry   → fix.mjs → post 다시
  regenerate     → 생성 다시 (≤3) → post
  human          → 사람에게 reasons
```

## 명령
```bash
bun lib/skill-pre.mjs <brief.json> --out-dir PRE
# brief 필수 필드: artifact_type  (예: examples/dashboard-brief.json)

bun lib/skill-post.mjs <artifact> --contract PRE/contract.json --out-dir POST
# → POST/decision.json

bun lib/skill-gate.mjs <artifact> --contract PRE/contract.json   # CI exit
```

생성 프롬프트에 넣을 것: `PRE/prompt_bullets.md` + structure.id + negation.

## decision → 행동
| decision | 행동 |
|---|---|
| `pass` | 종료 |
| `fix_geometry` | `bun lib/fix.mjs ART --contract PRE/contract.json` 후 **post 재호출** |
| `regenerate` | 생성 재시도 (최대 3) |
| `human` | escalate |

## 하지 마
- `catalog-brief.json`으로 pre (artifact_type 없음 → fail)
- post가 파일을 고쳐 줄 거라 기대 (비파괴)
- `--vuln-gate` / `--structure` / `--aesthetic` 기본 루프에 남발
- `tune --apply`, neural, DESIGN 통독 후 임계 창작
- export SVG/PPTX = 무손실 납품이라고 주장

## 스킬 조각
- [`skills/aesthete-pre`](./skills/aesthete-pre/SKILL.md)
- [`skills/aesthete-post`](./skills/aesthete-post/SKILL.md)
- [`skills/aesthete-gate`](./skills/aesthete-gate/SKILL.md)
- 규약: [`docs/integration/generator-contract.md`](./docs/integration/generator-contract.md)

---

# 엔진 한 줄
ALT 기하 측정 9스킬 + P0 fix. 상세 수학은 `DESIGN.md` / `README.md` (에이전트 루프에 불필요).

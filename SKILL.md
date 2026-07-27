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
skill-pre → (생성기) → skill-post → receipt verify → decision 분기
  pass           → 끝
  fix_geometry   → next.fix_cmd 그대로 실행 → post 다시
  regenerate     → 생성 다시 (≤3) → post
  human          → 사람에게 reasons
```

## 명령
```bash
bun lib/skill-pre.mjs examples/dashboard-intent-brief.json --out-dir PRE
# brief 필수 필드: artifact_type

bun lib/skill-post.mjs <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json --out-dir POST
# → POST/decision.json

bun lib/skill-receipt.mjs verify POST/decision.json <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json
# post에 쓴 domain/slide/profile/structure/type와 boolean 평가 플래그도 동일하게 전달

bun lib/skill-gate.mjs <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json   # CI exit
```

생성 프롬프트에 넣을 것: `PRE/prompt_bullets.md` + structure.id + negation.
`PRE/intent.json`은 선언된 생성 context의 SSOT이며 post/gate/verify에 같은
경로를 전달한다.

Intent 경계:

- goal/scope/content priority/audience/source는 생성 context다.
- intent digest만 receipt freshness에 참여하며 측정·fold 입력은 아니다.
- scope는 구현·review coverage가 아니고 priority는 reading order의 증거가 아니다.
- must_preserve/must_not_assume은 생성 지시이지 geometric enforcement가 아니다.
- intent는 correctness, fulfillment, comprehension, human approval을 증명하지 않는다.

## 저장된 decision 사용 전

- `current`일 때만 아래 decision 표로 분기한다.
- `stale`이면 같은 입력·평가 플래그로 post를 새로 실행한다. 수동 rebinding으로 승인하지 않는다.
- `unbound`·`incomplete`·`invalid`면 post를 새로 실행하거나 사람에게 escalate한다.
- `current`는 저장된 decision core와 현재 bound 입력·설정·schema·runtime·설치 파일이 일치한다는 뜻이다. authenticity, provenance, 실제 실행 코드 동일성, correctness를 증명하지 않는다.
- `pass`는 **활성화된 차단 규칙이 발동하지 않았다**는 뜻뿐이다. semantic/render/native fidelity나 human approval이 아니다.

## decision → 행동
| decision | 행동 |
|---|---|
| `pass` | 종료 |
| `fix_geometry` | 저장된 절대 `next.fix_cmd` argv를 flag 재작성 없이 실행한 뒤 **post 재호출** |
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

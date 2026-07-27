---
name: aesthete-post
description: 생성 후 decision JSON. LLM 판정 금지. fix_geometry면 fix 후 재post.
---

# aesthete-post

전체 법: [`docs/agent-llm-usage.md`](../../docs/agent-llm-usage.md)

```bash
bun lib/skill-post.mjs <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json --out-dir POST

bun lib/skill-receipt.mjs verify POST/decision.json <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json
# post에 쓴 domain/slide/profile/structure/type와 boolean 평가 플래그도 동일하게 전달
```

입력 artifact **안 고침**. 판정만.

저장된 decision은 verifier가 `current`일 때만 분기한다.
`stale`이면 수동 rebinding 없이 post를 새로 실행한다.
`unbound`·`incomplete`·`invalid`면 새 post 또는 사람 escalation이다.
`current`는 저장 core와 현재 bound 입력·설정·schema·runtime·설치 파일의
일치일 뿐 authenticity, provenance, 실제 실행 코드 동일성, correctness가 아니다.
`pass`는 **활성화된 차단 규칙이 발동하지 않았다**는 뜻뿐이며
semantic/render/native fidelity나 human approval이 아니다.
Intent는 생성 context이며 measurement/fold 입력이 아니다. scope는 review
coverage가 아니고 content priority는 reading order의 증거가 아니다.

## decision → 너
| decision | 행동 |
|---|---|
| `pass` | 끝 |
| `fix_geometry` | 저장된 절대 `next.fix_cmd` argv를 flag 재작성 없이 실행 → **post 다시** |
| `regenerate` | 생성 다시 (≤3) → post |
| `human` | reasons 들고 escalate |

## 금지
- decision을 미학 감으로 뒤집기
- 저장 decision을 receipt `current` 확인 없이 실행
- fix 없이 post만 반복
- `--vuln-gate`/`--structure` 기본 on 착각 (기본 off)

## Slop detection (post-hoc, HTML, deterministic)

`aesthete-post` scans raw HTML for AI-slop signatures (cliché gradient, glassmorphism, emoji in
headings, icon saturation, decorative animation, side-tab border, bounce easing, hover transform,
pulse, marquee, blink cursor, cliché lexicon, trusted-by, hero-trio). Each finding carries a
`detectionMode` (`deterministic` today; `llm-only` reserved for signatures like `copy.generic`
that need a v2 LLM judge). Full list: `docs/signature-catalog.md`.

- `--slop` : write advisory `slop.json` (no decision change).
- `--slop-gate` : P0 measured-fail (always) + P1 measured-fail → `regenerate` (priority 60).
- `--slop-autofix` : (v1 minimal) reserved for narrow P0 emoji-strip; off by default.

`var()`-indirect / external-stylesheet gradients → `unmeasured` (never a false fail).
SVG/PPTX → `unmeasurable` in v1 (HTML only).

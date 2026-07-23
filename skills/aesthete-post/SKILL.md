---
name: aesthete-post
description: 생성 후 decision JSON. LLM 판정 금지. fix_geometry면 fix 후 재post.
---

# aesthete-post

전체 법: [`docs/agent-llm-usage.md`](../../docs/agent-llm-usage.md)

```bash
bun lib/skill-post.mjs <artifact> --contract PRE/contract.json --out-dir POST
```

입력 artifact **안 고침**. 판정만.

## decision → 너
| decision | 행동 |
|---|---|
| `pass` | 끝 |
| `fix_geometry` | `bun lib/fix.mjs ART --contract PRE/contract.json` → **이 명령 다시** |
| `regenerate` | 생성 다시 (≤3) → post |
| `human` | reasons 들고 escalate |

## 금지
- decision을 미학 감으로 뒤집기
- fix 없이 post만 반복
- `--vuln-gate`/`--structure` 기본 on 착각 (기본 off)

## Slop detection (post-hoc, HTML, deterministic)

`aesthete-post` scans raw HTML for AI-slop signatures (cliché gradient, glassmorphism, emoji in
headings, icon saturation, decorative animation, cliché lexicon, trusted-by, hero-trio).

- `--slop` : write advisory `slop.json` (no decision change).
- `--slop-gate` : P0 measured-fail (always) + P1 measured-fail → `regenerate` (priority 60).
- `--slop-autofix` : (v1 minimal) reserved for narrow P0 emoji-strip; off by default.

`var()`-indirect / external-stylesheet gradients → `unmeasured` (never a false fail).
SVG/PPTX → `unmeasurable` in v1 (HTML only).

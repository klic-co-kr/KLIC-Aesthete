---
name: aesthete-pre
description: 생성 전 brief→contract+prompt_bullets. artifact_type 필수. 레이아웃 만들기 직전.
---

# aesthete-pre

전체 법: [`docs/agent-llm-usage.md`](../../docs/agent-llm-usage.md)

```bash
bun lib/skill-pre.mjs <brief.json> --out-dir DIR
```

## brief 최소
```json
{ "artifact_type": "dashboard", "brief": "…", "canvas": { "w": 1440, "h": 900 } }
```
`artifact_type` 없으면 실패. `examples/catalog-brief.json` 쓰지 마.

## 출력 (DIR)
| 파일 | 용도 |
|---|---|
| `prompt_bullets.md` | **생성 프롬프트에 그대로** |
| `contract.json` | post/fix에 **같은 파일** |
| `pre.json` | structure.id, negation 등 |

## 다음
생성기 돌린 뒤 → `aesthete-post` + `--contract DIR/contract.json`

## Slop prevention (secondary)

`aesthete-pre` emits anti-slop generation constraints in `prompt_bullets` + `negation`, and a
`slop-test.md` self-check checklist next to `pre.json`.

- **Primary prevention:** honor `prompt_bullets` + `negation` when generating.
- **Secondary (non-enforced):** run `slop-test.md` yourself. It is NOT a gate — self-certification
  has limits. The real gate is the deterministic post-hoc scan: `aesthete-post --slop-gate`.

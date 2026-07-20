---
name: aesthete-gate
description: CI용 post fold. exit pass=0 fix|regen=1 human|usage=2. LLM 재판정 금지.
---

# aesthete-gate

전체 법: [`docs/agent-llm-usage.md`](../../docs/agent-llm-usage.md)

```bash
bun lib/skill-gate.mjs <artifact> [--contract c.json] [--out-dir DIR]
```

| exit | 의미 |
|---|---|
| 0 | pass |
| 1 | fix_geometry 또는 regenerate |
| 2 | human 또는 usage/schema |

CI 실패 시 `decision.json`만 첨부. 모델이 “그래도 통과” 하면 안 됨.

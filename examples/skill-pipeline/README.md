# Skill pipeline + LLM

**에이전트는 이 순서를 벗어나지 말 것.**

상세: [`docs/agent-llm-usage.md`](../../docs/agent-llm-usage.md)

## Pre
```bash
bun lib/skill-pre.mjs examples/dashboard-brief.json --out-dir /tmp/ae-pre
cat /tmp/ae-pre/prompt_bullets.md
```

## Post
```bash
bun lib/skill-post.mjs examples/catalog-bad.layout.json \
  --out-dir /tmp/ae-bad
# → decision=fix_geometry
jq -r .decision /tmp/ae-bad/decision.json
```

## 분기 (의사코드)
```
pass           → stop
fix_geometry   → bun lib/fix.mjs ART --contract PRE/contract.json → post again
regenerate     → generate again (max 3) → post
human          → escalate with reasons
```

## Gate (CI)
```bash
bun lib/skill-gate.mjs examples/catalog-good.layout.json --out-dir /tmp/ae-g; echo $?  # 0
bun lib/skill-gate.mjs examples/catalog-bad.layout.json  --out-dir /tmp/ae-b; echo $?  # 1
```

Post never mutates the input. LLM must not override `decision`.

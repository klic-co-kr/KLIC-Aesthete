---
name: aesthete-gate
description: CI용 post fold. exit pass=0 fix|regen=1 human|usage=2. LLM 재판정 금지.
---

# aesthete-gate

전체 법: [`docs/agent-llm-usage.md`](../../docs/agent-llm-usage.md)

```bash
bun lib/skill-gate.mjs <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json --out-dir DIR

bun lib/skill-receipt.mjs verify DIR/decision.json <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json
# gate에 쓴 domain/slide/profile/structure/type와 boolean 평가 플래그도 동일하게 전달
```

| exit | 의미 |
|---|---|
| 0 | pass |
| 1 | fix_geometry 또는 regenerate |
| 2 | human 또는 usage/schema |

저장된 gate decision을 재사용할 때는 receipt `current`에서만 분기한다.
`stale`이면 수동 rebinding 없이 gate/post를 새로 실행한다.
`unbound`·`incomplete`·`invalid`면 새 실행 또는 사람 escalation이다.
`current`는 저장 core와 현재 bound 입력·설정·schema·runtime·설치 파일의
일치일 뿐 authenticity, provenance, 실제 실행 코드 동일성, correctness가 아니다.
`pass`는 **활성화된 차단 규칙이 발동하지 않았다**는 뜻뿐이며
semantic/render/native fidelity나 human approval이 아니다.
Intent는 생성 context이며 gate의 measurement/fold를 바꾸지 않는다.

CI 실패 시 `decision.json`과 사용한 평가 플래그를 함께 보존한다.
모델이 “그래도 통과” 하거나 저장 decision을 검증 없이 실행하면 안 된다.

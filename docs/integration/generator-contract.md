# Generator contract — Aesthete pre → generate → post

1페이지 연동 규약. 생성기(KLIC-PPT / Carpo / HTML 등)는 **이 레포 밖**.  
Aesthete는 사전 지시 + 사후 판정만.

---

## Loop

```
brief.json
   │
   ▼
aesthete-pre  ──►  pre.json + contract.json + intent.json + prompt_bullets.md
   │
   ▼
[external generator]  consumes bullets + structure.id + negation
   │
   ▼
artifact (ALT | svg | pptx | html | …)
   │
   ▼
aesthete-post ──► decision.json   (artifact NOT mutated)
   │
   ▼
receipt verify ──► current only
   │
   ├─ pass            → stop
   ├─ fix_geometry    → execute absolute next.fix_cmd argv unchanged, then post again
   ├─ regenerate      → generator again (max 3) then post
   └─ human           → stop + escalate
```

CI 동일 fold:

```bash
bun lib/skill-gate.mjs <artifact> \
  --contract PRE/contract.json --intent PRE/intent.json
```

---

## MUST

1. **생성 전** `bun lib/skill-pre.mjs <brief.json> --out-dir DIR`  
   - brief에 `artifact_type` 필수 (`dashboard|marketing|report|diagram|poster|…`)  
2. 생성기는 최소한 다음을 준수:  
   - `prompt_bullets` 전체 (프롬프트 또는 스펙에 삽입)  
   - `structure.id` (가능하면 shape 문장)  
   - `negation.bullets` (금지 목록)  
   - `intent.json`의 선언된 goal/scope/content priority/audience/source
3. 산출물은 Aesthete가 import 가능한 도메인 (ALT JSON 권장)  
4. **생성 후** `bun lib/skill-post.mjs <artifact> --contract DIR/contract.json --intent DIR/intent.json --out-dir DIR2`
5. `decision`은 **산술 JSON** — LLM이 재해석해 뒤집지 말 것. LLM은 `next.action`만 실행  
6. `regenerate` 루프 상한 **N=3** 후 `human`  
7. 저장 decision 사용 전 같은 artifact와 post 평가 플래그로 receipt를 검증하고 `current`에서만 분기
8. `stale`은 수동 rebinding 없이 새 post, `unbound|incomplete|invalid`는 새 post 또는 escalation
9. `fix_geometry` 시 에이전트가 저장된 절대 `next.fix_cmd` argv를 flag 재작성 없이 실행 후 **post 재호출**

`pass`는 **활성화된 차단 규칙이 발동하지 않았다**는 뜻뿐이다.
semantic/render/native fidelity나 human approval이 아니다.
receipt `current`도 저장 core와 현재 bound 입력·설정·schema·runtime·설치
파일의 일치일 뿐 authenticity, provenance, 실제 실행 코드 동일성,
correctness를 증명하지 않는다.

Intent digest는 receipt freshness에만 참여한다. Intent 값은 measurement나
decision fold 입력이 아니다. Scope는 구현·review coverage가 아니며 content
priority는 reading order의 증거가 아니다. must_preserve/must_not_assume은
geometric enforcement가 아니고 intent는 correctness, fulfillment,
comprehension, human approval을 확립하지 않는다.

---

## MUST NOT

- post/gate 경로에서 write-back/overlay를 “필수 납품”으로 요구 (별 트랙)  
- vuln를 기본 게이트로 강제 (`--vuln-gate` opt-in)  
- structure verify 기본 강제 (`--structure ID` opt-in)  
- decision을 LLM에게 맡기기  
- pre 없이 “감으로” contract 임계 새로 쓰기 (사전=사후 깨짐)

---

## 최소 예시

```bash
# 1) pre
bun lib/skill-pre.mjs examples/dashboard-intent-brief.json --out-dir /tmp/pipe-pre

# 2) generate — 외부. 입력으로 /tmp/pipe-pre/prompt_bullets.md 사용
#    출력 예: out.layout.json (ALT)

# 3) post
bun lib/skill-post.mjs out.layout.json \
  --contract /tmp/pipe-pre/contract.json \
  --intent /tmp/pipe-pre/intent.json \
  --out-dir /tmp/pipe-post

# 4) verify stored decision with the same post flags
bun lib/skill-receipt.mjs verify \
  /tmp/pipe-post/decision.json out.layout.json \
  --contract /tmp/pipe-pre/contract.json \
  --intent /tmp/pipe-pre/intent.json
# status: current | stale | unbound | incomplete | invalid

# 5) branch on decision only when receipt status=current
# jq -r .decision /tmp/pipe-post/decision.json
```

스키마: `schemas/pre.schema.json`, `schemas/decision.schema.json`.  
스킬 문서: `skills/aesthete-pre|post|gate/SKILL.md`.  
**LLM 전체 플레이북:** [`docs/agent-llm-usage.md`](../agent-llm-usage.md).

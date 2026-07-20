# PRD — Aesthete Pre / Post Agent Skills

| 항목 | 값 |
|---|---|
| 상태 | **Draft → Ready-for-approval** (적대 검토 반영본) |
| 일자 | 2026-07-20 |
| 제품 | KLIC-Aesthete |
| 범위 | 에이전트용 **사전·후처리 스킬 표면** (엔진 코어 재작성 아님) |
| 관련 | `SKILL.md`, `DESIGN.md` §0–§0.2, `lib/preflight.mjs`, `lib/measure.mjs`, `lib/fix.mjs`, `lib/vuln.mjs`, `lib/structure.mjs`, `lib/contract.mjs`, `lib/lint.mjs` |
| 배틀 근거 | 인생낭비-배틀 585 (write-back 본진 기각, pre/post 스킬 LOCK) |
| 적대 검토 | `docs/reviews/2026-07-20-prd-pre-post-skills-adversarial.md` |
| 실측 기준 | origin `14999fd`, `bun run test` → **232 pass / 0 fail** |
| 인지 근거 | CLT · Processing Fluency · Gestalt · Visual Hierarchy · Keyhole(dashboard). SlideAudit 맵 = M2 문서 |

---

## 0. 한 줄

> 생성기(PPT/Carpo/HTML 등)는 밖. Aesthete는 **생성 전 지시**와 **생성 후 판정**만 스킬 한 방씩으로 제공한다.

---

## 1. 배경 · 문제

### 1.1 이미 있는 것 (자산)

- ALT 측정 9스킬, P0 fix, contract, vuln(advisory), structure classify/verify, preflight CLI, lint exit 게이트
- 테스트 **232 pass** (origin `14999fd` 기준)
- 문서상 루프: `preflight → 생성 → measure/fix --contract`
- **존재하나 본 PRD 호출 화이트리스트 밖**: `lib/overlay/*` (SVG/PPTX preserve-ish), neural, bradley-terry, harness, tune
- **없음 (본 PRD가 만듦)**: `skill-pre` / `skill-post` / `skill-gate` facade, `aesthete.pre`·`aesthete.decision` 스키마, 짧은 스킬 엔트리, generator-contract 1페이지

### 1.2 문제 (스킬 마찰)

| 증상 | 결과 |
|---|---|
| 에이전트가 `bun lib/*.mjs`를 4–6번 조합 | 단계 누락·순서 오류 |
| preflight JSON이 생성 프롬프트로 안 붙음 | 사전 목표가 생성에 미반영 (`prompt_bullets` 부재) |
| measure/vuln/structure 결과를 모델이 느낌으로 해석 | 판정 불일치·재생성 남발 또는 통과 오판 |
| SKILL.md 단일 벽 | 컨텍스트에서 스킵 |
| write-back/export fidelity 논쟁 | 본령(사전·후처 스킬) 이탈 |

### 1.3 비문제 (이번 PRD 밖)

- SVG/PPTX source write-back / preserve emit **본개발** (overlay가 이미 있어도 본 스프린트 목표 아님)
- 새 인지 스킬 수학 추가, ρ 튜닝, neural/CLIP 고도화
- VLM을 미학 최종 판정자로 사용
- LLM layout RL reward를 overallScore에 혼합
- 생성기(KLIC-PPT 등) 본체 재작성
- 타 레포 코드 훅 (M3 — 대빵이 타깃 이름 주기 전 금지)

---

## 2. 목표

### 2.1 사용자 목표

KLIC 파이프(에이전트)가:

1. **사전** brief만 주고 → 생성기가 먹을 **지시문 + contract** 를 받는다  
2. **사후** artifact/ALT만 주고 → **decision JSON** 한 장으로 다음 행동(재생성 / 기하fix / 통과 / 인간)을 정한다  
3. CI에서 같은 게이트를 **exit code**로 돌린다  

### 2.2 성공 지표

#### 1주 MVP (M1–M2)

| ID | 지표 | 통과 기준 |
|---|---|---|
| S1 | pre 원샷 | brief → 단일 명령 → `pre.json` + `contract.json` + `prompt_bullets.md` |
| S2 | post 원샷 | artifact → 단일 명령 → `decision.json` + report 경로 (아티팩트 **비파괴**) |
| S3 | 결정 결정론 | 동일 입력 → paths 정규화 후 decision 바이트 동일 |
| S5 | CI | `skill-gate` bad≠0 / good=0 (기본 플래그) |

#### 후속 (MVP 밖 KPI)

| ID | 지표 | 단계 |
|---|---|---|
| S4 | 파이프 1개 연동 | **M3** — 대빵이 타깃 명명 후 |
| S6 | 이론 라벨 | **M2 문서** — reasons.code↔theory 표; 필드 강제는 P1 |

### 2.3 실패 정의

- post가 점수만 덤프하고 decision 없음  
- pre가 내부 JSON만 내고 생성기용 문장 없음  
- gate/post가 LLM 호출에 의존  
- post가 입력 아티팩트를 수정 (fix는 에이전트/`next.action` 몫)  
- write-back/새 미학 공식/neural 기본 경로가 범위에 들어오면 범위 실패  

---

## 3. 페르소나 · 사용 시나리오

| 페르소나 | 니즈 |
|---|---|
| Hermes/구찌/프라다 에이전트 | 짧은 스킬 단계, JSON 계약 |
| KLIC-PPT / Carpo 생성 파이프 | pre 출력을 프롬프트·스펙에 주입 |
| 인간 리뷰어 | decision 사유 코드로 읽음 |
| CI | exit code + 아티팩트 경로 |

### 시나리오 A — 슬라이드 생성

1. 에이전트: `aesthete-pre` ← brief(`artifact_type`, canvas, intent)  
2. 생성기: `prompt_bullets` + `structure.id` + `negation.bullets` 준수하여 산출  
3. 에이전트: `aesthete-post` ← 산출물 (**읽기만**)  
4. `regenerate` → 2로 (상한 N=3 후 `human`)  
5. `fix_geometry` → 에이전트가 `bun lib/fix.mjs …`(P0) 실행 후 **post 재호출**  
6. `pass` → 종료  

### 시나리오 B — CI

```bash
bun lib/skill-gate.mjs examples/catalog-good.layout.json          # exit 0
bun lib/skill-gate.mjs examples/catalog-bad.layout.json           # exit 1
# structure/lint/vuln-gate 는 opt-in 플래그
```

---

## 4. 제품 요구사항

### 4.1 스킬 패키지 (P0)

세 진입점. 구현은 thin orchestrator (화이트리스트 lib만 호출).

| 스킬 ID | 역할 | 입력 | 출력 |
|---|---|---|---|
| `aesthete-pre` | 사전 | brief.json | pre bundle |
| `aesthete-post` | 후처 판정 | artifact + optional contract | decision bundle |
| `aesthete-gate` | CI | artifact + flags | exit code + summary |

**호출 화이트리스트**

| 스킬 | 허용 |
|---|---|
| pre | `preflight` + bullet 렌더 + (옵션) schema validate |
| post/gate | `measure` + (옵션) `contract` eval + (옵션) `structure verify` + (옵션) `vuln` + (옵션) `lint` + decision fold |
| **금지(기본)** | `fix`(post가 직접 실행 금지), `overlay`, `neural`, `tune`, `harness`, `bradley-terry`, 네트워크 |

Hermes 설치 형태(기본 제안):

- `skills/aesthete-pre/SKILL.md`, `skills/aesthete-post/SKILL.md`, `skills/aesthete-gate/SKILL.md`
- 루트 `SKILL.md`는 3링크 + 10줄 이내 요약으로 슬림화(별 커밋 가능)
- 본문 최대 ~80줄, 상세는 `references/`

### 4.2 CLI (P0)

```bash
# 사전
bun lib/skill-pre.mjs <brief.json> [--out-dir DIR] [--diversify]

# 후처 (비파괴)
bun lib/skill-post.mjs <artifact> [--contract c.json] [--type TYPE] \
  [--structure ID] [--lint] [--vuln-gate] [--out-dir DIR]

# CI (post와 동일 fold, exit만 추가)
bun lib/skill-gate.mjs <artifact> [--contract c.json] [--structure ID] \
  [--lint] [--vuln-gate]
```

`package.json` scripts:

```json
"pre": "bun lib/skill-pre.mjs",
"post": "bun lib/skill-post.mjs",
"gate": "bun lib/skill-gate.mjs"
```

`out-dir` 기본: 아티팩트 옆 또는 cwd 하위 `.aesthete-skill/`. **cwd 밖 경로 거부**.

### 4.3 출력 계약

#### 4.3.1 `pre` bundle

기존 preflight 필드를 **유지**하고 facade 필드를 병기한다.

```json
{
  "schema": "aesthete.pre/v1",
  "schema_version": 1,
  "recognized": true,
  "artifact_type": "dashboard",
  "directive": "…",
  "structure": { "id": "evidence-grid", "shape": "…", "source": "inferred|rotated|default" },
  "structurePickReason": "inferred",
  "contract_path": "out/contract.json",
  "contract": { },
  "budget": {},
  "negation": {
    "ids": ["no-rainbow", "ai-cliche-palette"],
    "bullets": ["Do not use more than 3 chromatic hues.", "…"],
    "raw": []
  },
  "prompt_bullets": [
    "One focal per viewport.",
    "freeRatio target 0.22.",
    "Structure: evidence-grid — …"
  ],
  "optional": {
    "keyhole": { "max_visible_chunks": 4, "note": "dashboard only" }
  }
}
```

`structure.source` = 기존 `structurePickReason` 매핑(inferred→brief, rotated→diversify, default→default).

##### prompt_bullets 렌더 규칙 (결정론, P0)

| 순서 | 소스 | 규칙 |
|---|---|---|
| 1 | `directive` | 그대로 1줄 |
| 2 | `structure.shape` | `Structure: {id} — {shape}` |
| 3 | `budget.freeRatio` | target/min 있으면 1줄 |
| 4 | `budget.focal` | 있으면 1줄 |
| 5+ | `negation` 각 항목 | 영어/한글 원문 1줄씩 (엔진 문자열 그대로; 번역 LLM 금지) |
| — | theory/CLT 문장 | **MVP 금지** (M2 문서 표만) |

#### 4.3.2 `post` / decision

```json
{
  "schema": "aesthete.decision/v1",
  "schema_version": 1,
  "decision": "regenerate | fix_geometry | pass | human",
  "reasons": [
    {
      "code": "P0_COLLISION",
      "tier": "P0",
      "detail": "collision.count=1",
      "fixable": true
    }
  ],
  "scores": {
    "hardIntegrityScore": 0.0,
    "measuredAestheticScore": 0.0,
    "coverageScore": 0.0
  },
  "paths": {
    "report": "…",
    "vuln": null,
    "structure": null,
    "contract_eval": null,
    "decision": "…"
  },
  "next": {
    "action": "run_fix_p0 | rewrite_generator | stop | ask_human",
    "fix_cmd": ["bun", "lib/fix.mjs", "<artifact>", "--contract", "c.json"],
    "loop_hint_max": 3
  }
}
```

### 4.4 Decision 규칙 (결정론, P0)

**원칙**

1. **전부 수집**: 해당 검사 축을 돌렸으면 reasons에 남김. silent drop 금지.  
2. **decision = severity fold**: 아래 표 priority 숫자 최소값(가장 심각)이 최종 decision. short-circuit으로 검사 스킵하지 않음(성능 예외 없음; 로컬 카탈로그 <5s).  
3. **post 비파괴**: fix/overlay/write 없음.  
4. **LLM 금지**: decision 함수는 순수 JS.

| priority | 조건 | decision | next.action |
|---|---|---|---|
| 10 | import/ALT/schema 검증 실패 | `regenerate` | rewrite_generator |
| 20 | `--structure ID` 요청됐고 verify FAIL | `regenerate` | rewrite_generator |
| 30 | hardIntegrity 실패 **and** fixable | `fix_geometry` | run_fix_p0 |
| 40 | hardIntegrity 실패 **and** not fixable | `regenerate` | rewrite_generator |
| 50 | `--lint` 이고 lint fail | `regenerate` | rewrite_generator |
| 60 | `--vuln-gate` 이고 high 잔존 (타입 suppress 후) | `regenerate` | rewrite_generator |
| 70 | `--contract` 있고 비-P0 criteria 미달 | `regenerate` | rewrite_generator |
| 80 | coverageScore = 0 (전축 unmeasurable) | `human` | ask_human |
| 90 | 전부 통과 | `pass` | stop |

**기본 플래그 (post/gate)**

| 플래그 | 기본 | 비고 |
|---|---|---|
| `--contract` | off | 있으면 평가 |
| `--structure` | off | CI/에이전트가 명시할 때만 |
| `--lint` | gate 기본 off / CI 문서에서 권장 on | |
| `--vuln-gate` | **off** | vuln 기본은 reasons 참고용 리포트만(opt-in 시 60 적용). DESIGN advisory와 정합 |
| `--human-on-unfixable` | off | on이면 priority 40 → `human` |

##### fixable 정의 (P0)

```
fixable =
  hardIntegrityScore < 1
  AND every P0 violation has fix.mode == autoFixable (or equivalent)
  AND NOT physically_infeasible(alt)
physically_infeasible =
  sum(node areas) > canvas.area * 1.05   // 기존 fix best-effort 서사와 동일 계열; 상수 테스트 고정
```

uncertain → not fixable → `regenerate` (또는 플래그 시 `human`).

### 4.5 Exit code (gate)

| 상황 | exit |
|---|---|
| `decision=pass` | 0 |
| `fix_geometry` / `regenerate` | 1 |
| `human` | 2 |
| usage / brief·artifact 읽기 실패 / schema | 2 |

### 4.6 인지·논문 태그 (M2 문서, P1 필드)

MVP decision/pre **필드 강제 없음**.  
`docs/refs/hci-cognition.md` + code↔tag 표만. reasons.code 없는 장식 태그 금지.

### 4.7 생성기 연동 규약 (M2 문서 P0)

`docs/integration/generator-contract.md`:

1. 생성 전 `aesthete-pre`  
2. 생성기는 `prompt_bullets` + `structure.id` + `negation.bullets` 준수  
3. 산출물은 ALT 또는 지원 도메인 파일  
4. 생성 후 `aesthete-post`  
5. `regenerate` 루프 상한 N=3 후 `human`  
6. `fix_geometry`면 엔진 `fix` P0 후 post 재호출 (post가 fix 안 함)

---

## 5. 비기능

| 항목 | 요구 |
|---|---|
| 결정론 | Date/Math.random 금지; diversify 없으면 동일 brief 바이트급 pre |
| 의존 | 기존 bun + lib. 신규 네트워크 없음 |
| 성능 | pre/post 단일 호출 < 5s (카탈로그 규모) |
| 호환 | 기존 CLI 유지. skill-* 는 facade |
| 정직 | coverage unmeasurable을 pass 위장 금지 |
| 경로 | out-dir은 cwd 하위만 |

---

## 6. 마일스톤

### M0 — PRD 확정

- [x] Draft  
- [x] 적대 검토서  
- [x] 검토 반영 패치 (본 문서)  
- [ ] 대빵 승인  

### M1 — Facade + 스키마 (2–3일)

- [x] `schemas/pre.schema.json`, `schemas/decision.schema.json`  
- [x] `lib/skill-pre.mjs`, `lib/skill-post.mjs`, `lib/skill-gate.mjs` + decision fold 순수 함수  
- [x] 단위 테스트: §7 골든 + 바이트급 decision 안정 (`test/skill-surface.test.mjs`)  
- [x] `examples/skill-pipeline/`  
- [x] `skills/aesthete-{pre,post,gate}/SKILL.md`  
- [x] package.json scripts `pre` / `post` / `gate` 

### M2 — 스킬 문서 (1일)

- [x] 짧은 SKILL 엔트리 3개 (`skills/aesthete-*`) + 루트 `SKILL.md` 슬림 진입  
- [x] `docs/refs/hci-cognition.md`  
- [x] `docs/integration/generator-contract.md`  
- [x] `README.md` 논문 DOI/링크 + facade 절  

### M3 — 연동 1경로 (대빵 타깃 명명 후)

- [ ] 지정 생성 파이프 훅  
- [ ] 루프 상한·로그  

### M4 — CI (0.5일)

- [ ] gate를 test script 또는 CI job에 연결  
- [ ] origin ahead/behind 정리는 **별 트랙**  

---

## 7. 수락 기준 (Acceptance) — 실행 가능 경로만

| # | 명령/조건 | 기대 |
|---|---|---|
| 1 | `bun lib/skill-pre.mjs examples/dashboard-brief.json --out-dir /tmp/ae-pre` | exit 0; `pre.json`에 `prompt_bullets.length ≥ 3`; `contract.json` 존재; `recognized=true` |
| 2 | 동일 입력 pre 2회 (diversify off) | pre.json 핵심 필드 동일 |
| 3 | `bun lib/skill-post.mjs examples/catalog-bad.layout.json --out-dir /tmp/ae-bad` | `decision=fix_geometry`; reasons에 P0 collision 또는 boundary; **입력 파일 mtime/바이트 불변** |
| 4 | `bun lib/skill-post.mjs examples/catalog-good.layout.json --out-dir /tmp/ae-good` | `decision=pass` (플래그 없음 = P0/하드 중심) |
| 5 | `bun lib/skill-gate.mjs examples/catalog-good.layout.json` | exit 0 |
| 6 | `bun lib/skill-gate.mjs examples/catalog-bad.layout.json` | exit 1 |
| 7 | post decision 2회 | paths 스트립 후 바이트 동일 |
| 8 | SKILL 엔트리만으로 에이전트가 pre→(생성 가정)→post 수행 가능 | 장문 DESIGN 불필요 |

**쓰지 말 것:** `examples/catalog-brief.json` (현재 `artifact_type` 없어 brief schema 거부).

실측 앵커 (facade 이전 엔진):

- bad: `hardIntegrityScore=0`, collision.count=1, boundary.overflowCount=1  
- good: `hardIntegrityScore=1`, failing=[]  

---

## 8. 리스크

| 리스크 | 완화 |
|---|---|
| decision 과엄격 → 재생성 폭주 | vuln-gate 기본 off; structure 기본 off; 루프 상한; human 탈출 |
| decision 과관대 → 불량 통과 | hardIntegrity 항상 평가·fold 최상위권 |
| 생성기가 bullets 무시 | integration 계약 문서; post는 기하로만 징벌 |
| 범위 크리프(write-back/overlay 본진) | §1.3 · 화이트리스트 |
| 이론 태그 장식화 | MVP 필드 제거 |
| local git ahead/behind | M4 별 트랙; PRD 커밋과 엔진 히스토리 섞지 않기 |

---

## 9. 명시적 기각 (Out of scope)

1. Preserve write-back / full file rewriter 본개발  
2. VLM aesthetic gate as SSOT  
3. overallScore에 RL layout reward 혼합  
4. 새 미학 스킬 공식 추가  
5. 자동 publish/approve (L5)  
6. 래스터 이미지 생성 프롬프트 가이드  
7. post 내부 자동 fix 루프  
8. 타 레포 무단 수정  

---

## 10. 오픈 질문 (대빵) — 침묵 시 기본값

| # | 질문 | 침묵 시 기본 |
|---|---|---|
| 1 | M3 연동 타깃 | **보류** (문서만; 코드 훅 없음) |
| 2 | vuln high 기본 | **`--vuln-gate` off** (V2) |
| 3 | Hermes 스킬 위치 | 레포 `skills/aesthete-*` |
| 4 | keyhole max_visible_chunks | **4** (dashboard only) |
| 5 | unfixable → human? | 기본 `regenerate`; `--human-on-unfixable` opt-in |

---

## 11. 요약

| | |
|---|---|
| 만들 것 | `aesthete-pre` · `aesthete-post` · `aesthete-gate` |
| 안 만들 것 | 파일 라이터 본진, 새 미학 수학, VLM 판관, post 내부 fix |
| SSOT | 사전=contract+bullets / 사후=decision JSON |
| 엔진 | 기존 lib facade + 화이트리스트 |
| MVP KPI | S1 S2 S3 S5 |

**한줄 PRD:** 에이전트가 생성 전·후에 Aesthete를 **한 방씩** 치게 한다 — 판정은 산술, 손은 에이전트.

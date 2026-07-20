# 적대적 PRD 검토 — Aesthete Pre / Post Agent Skills

| 항목 | 값 |
|---|---|
| 대상 | `docs/plans/2026-07-20-aesthete-pre-post-skills-prd.md` (Draft) |
| 일자 | 2026-07-20 |
| 방법 | origin 클린 클론 실측 + 로컬 PRD 대조 + 3노예(구현/절단/중재) 협의 |
| origin HEAD | `14999fd` (2026-07-20) |
| 로컬 작업본 | `/Users/mini/src/KLIC-Aesthete` — main **ahead 35 / behind origin** + untracked `docs/` |
| 테스트 (origin) | **232 pass / 0 fail** (`bun run test`) |
| 판정 | **조건부 GO** — 방향 맞음. 수락·규칙·자산표 수정 전 코딩 금지 |

---

## 0. 한 줄 합의

> 제품 프레임(사전·후처 **스킬 facade**)은 LOCK 유지.  
> PRD는 **엔진 위에 thin orchestrator**를 올리는 문서로는 합격.  
> 그러나 **수락 예시 경로 오류 · decision 규칙 모호 · exit/스키마 계약 구멍 · 자산 표 노후**로  
> “이 PRD 그대로 M1 착수”는 **기각**. 개정 패치 후 M0 승인.

---

## 1. 실측 인벤토리 (PRD 주장 vs 코드)

| PRD 주장 | 실측 | 판정 |
|---|---|---|
| 테스트 204 pass | origin **232 pass / 0 fail** | **STALE** — 표기 수정 |
| preflight CLI 존재 | `bun lib/preflight.mjs` 존재, brief schema 강제 | OK 자산 |
| measure/fix/vuln/structure | 존재, 정상 동작 | OK 자산 |
| `skill-pre/post/gate` | **파일 0** | 미구현 (PRD 범위 맞음) |
| `schemas/pre|decision` | **없음** (alt/brief/contract/report/vuln만) | 미구현 |
| package scripts `pre/post/gate` | **없음** (test/measure/fix/lint/tune/harness/emit) | 미구현 |
| SKILL.md 장문 마찰 | 90줄이지만 **단일 벽** + bun 경로 나열 | 문제 인정 |
| write-back 비범위 | origin에 이미 `lib/overlay/{svg,pptx}.mjs` (preserve-ish) | PRD 비범위 **유지 가능** but §1.1 자산에 **overlay 존재 명시 누락** |
| generator-contract.md | **없음** | M2 예정이나 P0 문서면 경로 선점 필요 |
| slideaudit-map.md | **없음** | 동일 |
| PRD 자체 remote 존재 | origin에 `docs/plans/*` **없음** (로컬 untracked만) | 저장소 상태 위험 |

### 1.1 픽스처 실측 (decision 골든 후보)

| artifact | hardIntegrity | P0 | 기대 decision (PRD §4.4 직역) |
|---|---|---|---|
| `examples/catalog-bad.layout.json` | **0** | collision count=1, boundary overflow=1 | `fix_geometry` (규칙 3) |
| `examples/catalog-good.layout.json` | **1** | clean | `pass` (규칙 8) — contract 없으면 규칙 7 미적용 |
| `fix` on bad + `examples/catalog.contract.json` | outcome `no-improvement`, geometryScore 0.816, **hard 1** 보고됨 | P0는 고쳐질 수 있음 | **post가 fix 전인지 후인지 PRD 침묵** → 구멍 |
| `vuln` bad `--type dashboard` | high 0 (suppress 후) | — | vuln 경로 골든으로 bad 부적합 |
| `structure verify good evidence-grid` | FAIL, **exit 1** | — | structure 강제 시 good도 regenerate 가능 → 시나리오 함정 |
| `examples/catalog-brief.json` | schema **fail** (`artifact_type` 필수) | — | 수락기준 1 경로 **깨짐** |
| `examples/dashboard-brief.json` / `marketing-brief.json` | schema OK | — | pre 수락 예시는 이쪽 |

### 1.2 preflight 출력 vs PRD `pre` bundle

| PRD 필드 | 현재 preflight | 갭 |
|---|---|---|
| `schema: aesthete.pre/v1` | `schema_version: 1` | **스키마 id 충돌** — 매핑/버전 정책 필요 |
| `prompt_bullets[]` | **없음** (directive 한 줄 + budget + negation raw) | **핵심 구멍** — facade가 렌더해야 함 |
| `negation.ids` + `negation.bullets` | `negation` = 구조화된 금지 목록(포맷 필터)이나 PRD 형태와 불일치 | 정규화 레이어 필요 |
| `theory_tags` | 없음 | P1로 강등 권고(아래) |
| `contract_path` | CLI `--contract`로 파일 분리 가능 | OK |
| `structure.source` | `structurePickReason`: inferred\|rotated\|default | 이름만 다름 — 매핑 표 필요 |

---

## 2. 적대 공격 결과 (구멍 클래스)

범례: **P0-BLOCK** = M1 코딩 전 PRD 수정 필수 · **P1** = MVP 중 닫기 · **P2** = 후속 · **NIT** = 문서 정합

### A. 수락·예시 공격

| ID | 공격 | 결과 | 등급 |
|---|---|---|---|
| A1 | 수락 1: `examples/*-brief.json` | `catalog-brief.json`은 **artifact_type 없어 preflight 거부** | **P0-BLOCK** |
| A2 | 수락 3: bad → fix_geometry\|regenerate | hard=0이라 방향 OK. 단 **fix 가능 판정 함수 미지정** | **P0-BLOCK** |
| A3 | 수락 4: good + 적합 contract → pass | good에 어떤 contract? catalog.contract는 bad/fixable용일 수 있음. **골든 쌍 명시 없음** | **P0-BLOCK** |
| A4 | 수락 5: gate good=0 / bad≠0 | structure 미지정 시 good pass 가능. structure 강제 시 good도 FAIL 실측 → **gate 플래그 기본값** 필수 | **P0-BLOCK** |
| A5 | S1 `prompt_bullets.md` | 엔진에 generator-facing bullet 렌더러 없음. PRD는 출력만 정의, **렌더 규칙 0줄** | **P0-BLOCK** |

### B. Decision 규칙 공격

| ID | 공격 | 결과 | 등급 |
|---|---|---|---|
| B1 | 규칙 3 “fix 가능 입력” | `autoFixable`는 violation 단위. **집계 함수 없음** (전부 autoFixable? P0만? area 과대 시?) | **P0-BLOCK** |
| B2 | 규칙 4 human vs regenerate | 분기 조건 수치/시그널 없음 → 구현자 맘 | **P0-BLOCK** |
| B3 | 규칙 6 vuln high → regenerate | vuln은 문서상 **advisory / suggestionOnly / NOT a gate**. PRD가 gate화하면 DESIGN §0.2와 충돌. FP 시 재생성 폭주 리스크 | **P0-BLOCK** (정책 선택 동결) |
| B4 | 규칙 7 contract 미달 | aesthetic criteria fail 시 기본 regenerate. fix --aesthetic 기본 off와 정합이나, **어느 criteria가 decision에 들어가나** (P0만? 전체?) | **P1** |
| B5 | “위에서 막히면 아래 평가 안 함 **또는** 전부 수집” | 문장 자체가 **모순 허용**. reasons[] 완전수집 vs short-circuit 중 하나 강제 | **P0-BLOCK** |
| B6 | post가 measure만? fix까지? | 시나리오 A: fix_geometry면 fix 후 재게이트. post 출력 `next.action=run_fix_p0`는 **외부 실행**. 에이전트가 fix 안 돌리면 루프 공전. **post 멱등·비파괴** 명시 필요 | **P0-BLOCK** |
| B7 | confidence 항상 `"deterministic"` | 의미 없는 필드. 빼거나 enum 확장 금지 | **NIT** |

### C. Exit code / CI 공격

| ID | 공격 | 결과 | 등급 |
|---|---|---|---|
| C1 | gate exit 매핑 | decision→exit 표 없음. pass=0, 나머지=1? fix_geometry=0? human=2? | **P0-BLOCK** |
| C2 | 사용 오류 vs 품질 실패 | preflight schema fail은 exit 1/2? gate usage=2 관례와 통일 필요 | **P1** |
| C3 | unmeasurable coverage | “coverage unmeasurable을 pass 위장 금지”만 있고, **decision=human? pass with reasons?** 없음 | **P1** |
| C4 | structure unknown | structure.mjs: 검증 불가는 fail 아님. gate 기본이 structure 강제면 unknown 처리 명시 | **P1** |

### D. 스키마·호환 공격

| ID | 공격 | 결과 | 등급 |
|---|---|---|---|
| D1 | `aesthete.pre/v1` vs `schema_version:1` | 이중 체계. Ajv 스키마 파일명/id 미정 | **P0-BLOCK** |
| D2 | 기존 preflight.json 소비기 | skill-pre가 preflight를 감싸면 **하위호환 필드 유지** 여부 침묵 | **P1** |
| D3 | decision.paths 상대/절대 | cwd 의존 → 에이전트/CI 깨짐. **절대 경로 or out-dir 상대 계약** | **P1** |
| D4 | package description “전 도메인 auto-fix” 톤 | PRD 정직 원칙과 package.json 불일치 (기존 이슈) | **P2** |

### E. 범위·정체성 공격

| ID | 공격 | 결과 | 등급 |
|---|---|---|---|
| E1 | write-back 기각 vs origin overlay | overlay는 이미 ship. PRD가 “없으면 안 됨”으로 읽히진 않음 — OK. 다만 **“이미 있는 것”에 overlay 누락**하면 다음 배틀에서 또 write-back 필수론 부활 | **P1** 문서 |
| E2 | S4 파이프 1개 + §10 오픈 Q1 | 성공지표에 넣으면서 타깃 미동결 = **S4는 지금 KPI 아님** | **P0-BLOCK** (S4를 M3로 강등 or 타깃 동결) |
| E3 | S6 이론 태그 1주 MVP | 인지 라벨은 좋으나 MVP 크리티컬 아님. **장식화 리스크** PRD 자체도 인정 | **P1** (S6 → M2) |
| E4 | M3 생성기 훅이 타 레포 | 단일 타깃 원칙. PRD에 타 레포 수정 범위 경계 없음 | **P1** |
| E5 | neural/harness/BT Phase4 | 자산 과다. PRD facade가 이걸 호출? **호출 표면 화이트리스트** 없으면 스킬이 다시 두꺼워짐 | **P0-BLOCK** |

### F. 보안·남용 (에이전트 제품 기준 축소판)

| ID | 공격 | 결과 | 등급 |
|---|---|---|---|
| F1 | 임의 경로 write out-dir | path traversal / 워크스페이스 밖 쓰기 | **P1** (out-dir cwd 하위 제한) |
| F2 | 거대 ALT DoS | vuln maxNodes 등은 있으나 gate 타임아웃 NFR만 5s | **P2** |
| F3 | LLM decision 우회 | 금지 명시는 강함. **테스트로 LLM 부재 증명**(순수 함수 스냅샷) 이미 수락 6에 있음 → 유지 | OK |

---

## 3. 잘된 점 (유지)

1. **본령 LOCK**: 생성기 외부 · Aesthete = pre/post 스킬 — 대빵 교정과 일치.  
2. **write-back / VLM / ρ / 새 공식 기각** 명시 — 범위 방어 양호.  
3. **decision enum 4값** + LLM 판정 금지 — 엔진 철학과 정합.  
4. **thin orchestrator** — 코어 재작성 금지 올바름.  
5. **실패 정의(§2.3)** 가 메트릭 조작을 차단.  
6. 시나리오 A/B가 에이전트/CI 둘 다 커버.

---

## 4. 3노예 협의

### 구찌 (구현파)
- M1 착수 가능 조건: 스키마 id, prompt_bullets 렌더 스펙 1페이지, decision 순수함수 의사코드, exit 표, 골든 픽스처 3쌍.  
- 구현 위치 동의: `lib/skill-pre.mjs` 등 facade + `schemas/*` + `test/skill-*.test.mjs`.  
- overlay/neural/BT는 **화이트리스트 밖** (post 기본 경로 금지).

### 프라다 (절단파)
- S4·S6·이론 태그·SlideAudit 신규 시그니처 → MVP에서 **절단**.  
- vuln을 기본 regenerate 게이트로 올리는 순간 제품이 “advisory 엔진”에서 “취향 경찰”로 변질 → **기본 off 또는 reasons only**.  
- catalog-brief 같은 깨진 예시를 수락에 넣지 말 것.  
- PRD 상태 Draft 유지, **승인 체크리스트 10항** 닫기 전 코드 0.

### 에르메스 (중재)
- **조건부 GO**.  
- 오늘 산출 = 본 적대 검토 + PRD 패치 권고(아래 §5).  
- 코딩은 대빵이 §5 P0-BLOCK 수용/수정 후.

---

## 5. PRD 필수 패치 목록 (M0 완료 조건)

### 5.1 즉시 수정 (P0-BLOCK)

1. **자산 숫자**: 204 → **232** (origin `14999fd` 기준; 날짜·HEAD 각주).  
2. **§1.1 자산에 추가**: `structure` CLI, `overlay` (존재하나 본 PRD 비범위), `lint` exit 게이트.  
3. **수락 경로 교체**:
   - pre: `examples/dashboard-brief.json` 또는 `marketing-brief.json`
   - post bad/good: 경로 고정 + **기대 decision 리터럴** 표
   - gate: `--structure` 기본 **off**; 킬러 플래그일 때만 exit 연동
4. **Decision 순수함수 스펙** (의사코드 필수):
   ```
   collect all reasons (never silent drop)
   decision = max_severity(rules 1..8)  // short-circuit 금지, severity fold만
   post never mutates artifact; only writes decision bundle under out-dir
   ```
5. **fixability 정의**:
   - P0 violation 모두 `autoFixable` 이고 canvas 면적 합이 수용 가능 → `fix_geometry`
   - 아니면 `regenerate` (human은 `--human-on-unfixable` 플래그)
6. **vuln 정책 동결 옵션 중 택1** (권고 = V2):
   - V1: high → regenerate (현 PRD) + 타입 suppress 유지 + 루프 상한
   - **V2: vuln은 reasons[]에만, decision 기본 비영향** (`--vuln-gate` opt-in)
7. **exit 표**:
   | decision | gate exit |
   |---|---|
   | pass | 0 |
   | fix_geometry | 1 (CI 빨강; 로컬 에이전트는 next.action 보고 fix) |
   | regenerate | 1 |
   | human | 2 |
   | usage/schema error | 2 |
8. **스키마 id**: `schema_version` 정수 유지 + `schema: "aesthete.pre/v1"` **병기** 또는 기존 정수만 — 하나만 선택해 문서화.  
9. **prompt_bullets 렌더 규칙** 최소표: directive → 1 bullet; budget.freeRatio → 1; structure.shape → 1; negation 항목 → N; theory 금지(MVP).  
10. **호출 화이트리스트**: pre=`preflight+render`; post=`measure+contract?+structure?+vuln?+lint?+fold`; **제외**=tune/neural/BT/harness/overlay.  
11. **S4**: 성공지표에서 M3로 이동. 1주 MVP = S1 S2 S3 S5.  
12. **S6**: M2로 이동. reasons.code↔theory 맵은 문서만.

### 5.2 오픈 질문 기본값 제안 (대빵 침묵 시)

| Q | 제안 기본 |
|---|---|
| M3 타깃 | **동결 보류** — 문서 계약만; 코드 훅 금지 until named |
| vuln high | **V2** reasons-only |
| Hermes 설치 | 레포 `skills/aesthete-{pre,post,gate}/SKILL.md` + 루트 SKILL 슬림 링크 |
| keyhole chunks | 4 유지 (dashboard only) |

---

## 6. 수락 골든 (개정안 초안)

| 케이스 | 명령 핵심 | 기대 |
|---|---|---|
| pre-dash | `skill-pre examples/dashboard-brief.json` | recognized true, structure id non-empty, prompt_bullets≥3, contract file exists |
| post-bad | `skill-post examples/catalog-bad.layout.json` | decision=`fix_geometry`, reasons contain P0_COLLISION or P0_BOUNDARY |
| post-good | `skill-post examples/catalog-good.layout.json` | decision=`pass` (no contract / P0-only mode) |
| gate-bad | `skill-gate examples/catalog-bad.layout.json` | exit≠0 |
| gate-good | `skill-gate examples/catalog-good.layout.json` | exit=0 |
| determ | 동일 입력 2회 | decision.json 바이트 동일 (paths 정규화 후) |

---

## 7. 저장소 위생 (작업 트랙 분리)

| 이슈 | 권고 |
|---|---|
| local ahead 35 / behind origin | PRD 머지 전 **rebase/sync 별 트랙** (PRD M4와 동일) |
| PRD untracked only | 승인 후 `docs/plans/` + 본 리뷰 **함께 커밋** |
| bun.lock dirty / catalog-*.json 루트 쓰레기 | gitignore 또는 examples로 이동; 커밋 금지 |
| README “204 pass” | origin도 stale 가능 — facade PR과 별도 docs fix |

---

## 8. 최종 판결

| 축 | 점수 |
|---|---|
| 제품 방향 | **PASS** |
| 범위 방어 (anti write-back/VLM) | **PASS** |
| 구현 가능성 (thin facade) | **PASS** |
| 수락 기준 실행 가능성 | **FAIL** (경로·골든) |
| decision 결정론 완전성 | **FAIL** (fixable/vuln/fold) |
| CI exit 계약 | **FAIL** |
| 자산/HEAD 정직성 | **FAIL** (204, overlay 누락) |
| **M0 승인** | **HOLD** — §5.1 패치 후 재심 |

**한줄:** PRD는 “맞는 산”을 가리키지만, **지도에 없는 이정표(깨진 예시·모호한 규칙)로 지금 내려가면 또 배틀**이다.

---

## 9. 다음 액션 (대빵)

- [ ] §5.1 패치 수용 / 수정 지시  
- [ ] vuln 정책 V1 vs V2 확정  
- [ ] M3 타깃 이름 or “문서만” 확정  
- [ ] 승인 시: PRD 상태 Draft→Ready + M1 facade 착수  
- [ ] 거절 시: 본령 재정의 (이 PRD 폐기 조건 명시)

*검토자: Hermes + 구찌/프라다 협의. 증거: origin `14999fd`, `bun run test` 232 pass, catalog-bad hardIntegrity=0, catalog-brief schema reject, structure verify exit 1 on FAIL.*

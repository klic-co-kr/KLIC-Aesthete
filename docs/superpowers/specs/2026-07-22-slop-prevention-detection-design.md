# Slop 예방 + 탐지 — 설계 문서 (v2, 적대적 검토 반영)

- **날짜**: 2026-07-22 (v2: 적대적 검토 12 finding 전면 반영)
- **상태**: 설계 승인됨 → 적대적 검토 → 개정
- **참고**: [nutlope/hallmark](https://github.com/nutlope/hallmark) — "Anti-AI-slop design skill"
- **v1 범위**: prevention 생성 제약 + slop 탐지(HTML 우선) + vuln 비중복 시그니처
- **v2+ (연기)**: SVG/PPTX, 카피 LLM-judge, slop human-corpus 임계 보정, 추가 시그니처

---

## 1. 문제 (근본 원인)

Aesthete = **순수 기하(bbox) 측정기**. 9 스킬 전부 bbox 산술. 그러나 "AI스러운" slop(그라데이션·이모지·글래스모피즘·제네릭 카피·템플릿 tell)은 **시각/스타일/카피 도메인 = 기하 영역 바깥**.

실패 양상 (Github_guide.html): pure-JS `html.mjs` 어댑터가 실제 CSS flow/flex/grid 못 봄 → 브라우저 훅 없이 post-hoc 기하 판정 = 의미있는 측정 안 됨 → false "전부 pass" → `regenerate` 5개 이유는 fluency/hierarchy/proximity/similarity `unmeasurable` = **기하 결함 아닌 coverage 갭**. 진짜 slop는 기하 밖. 도구-도메인 불일치.

| 축 | Aesthete (현재) | Hallmark (참고) |
|---|---|---|
| 도메인 | 기하 (bbox) | 시각/스타일/카피 (semantic) |
| 시점 | post-hoc 산술 판정 | generation-time 방지 |
| 구동 | pure-JS deterministic | LLM 프롬프트 규칙 + slop-test 자가실행 |

## 2. 목표 / 비목표 / 단계화

### 목표
1. **예방**: LLM 생성 시점 slop 차단 — 생성 프롬프트 제약(주력) + 자가 slop-test(보조).
2. **탐지**: post-hoc slop 축 — deterministic 시그니처(주력) + 카피 LLM-judge(v2).
3. **coverage 정직**: 측정 불가 → `unmeasured` 솔직 보고, **false-pass·false-fail 둘 다 금지**.
4. **우아한 강저**: scanner/LLM 한계 → 해당 시그니처만 unmeasured, 크래시/거짓 게이트 없음.

### 비목표
- computed CSS cascade 완전 해석 (외부 `<link>` / `var()` 간접 override). LLM 단일파일엔 제한적 → unmeasured 솔직 처리.
- LLM 미생성 외부 산물 풀 감사 (1차 = 생성 산물 안전망).
- 기하 영역 재설계 (9스킬 + browser-hook Phase 3 = 기하 전용, 그대로).

### 단계화 (H4 반영 — 스코프 축소)
> 사용자가 C(layered) 기각했으나 적대적 검토(H4)로 재확정: 한 plan에 전부 안 들어옴.

| 단계 | 내용 | 증명 목표 |
|---|---|---|
| **v1** | prevention 생성 제약 + slop 탐지 **HTML only** + **vuln 비중복** deterministic 시그니처 + source-scan + FP 회귀 | real HTML에서 slop 진짜 잡고 FP 통제 |
| **v2+** | SVG/PPTX · 카피 LLM-judge · slop human-corpus 임계 보정 · 추가 시그니처 | v1 FP 통제 입증 후 확장 |

## 3. 아키텍처 — 모듈 경계 + 시그니처 소유권

두 층. **slop는 vuln과 시그니처 중복 0** (H1). 비결정 경계 = v1에선 없음(LLM-judge v2 연기 → v1 완전 deterministic).

### 시그니처 소유권 / dedup 규칙 (H1, H3)
**한 패턴 = 한 엔진.** vuln에 있는 패턴은 slop가 다시 만들지 않는다.

| 패턴 | 소유 엔진 | 권위 | 비고 |
|---|---|---|---|
| ai-cliche-palette (보라/바이올렛) | **vuln** (기존) | advisory | slop 비중복 |
| hanging-header (tag-left/heading-right) | **vuln** (기존) | advisory | 합법 side-label 존재 → P0 아님(H3). slop 비중복 |
| even-split / equal-grid | **vuln** (기존, `even-split`) | advisory | dashboard에선 의도. slop 비중복 |
| rainbow-categorical / no-focal / type-scale | **vuln** (기존) | advisory | slop 비중복 |
| **palette.gradient (cliche stops)** | **slop** (NEW) | P0 | vuln에 없음 |
| **palette.glass (backdrop-filter)** | **slop** (NEW) | P0/P1 | vuln에 없음 |
| **decoration.emoji-in-heading** | **slop** (NEW) | P0 | vuln에 없음 |
| **decoration.icon-saturation** | **slop** (NEW) | P1 | vuln에 없음 |
| **decoration.animation (scale/spin)** | **slop** (NEW) | P1 | vuln에 없음 |
| **copy.lexicon (regex)** | **slop** (NEW) | P2 | vuln에 없음 |
| **copy.generic (LLM)** | **slop** (NEW, **v2**) | P2 | vuln에 없음 |
| **template.trusted-by / hero-trio** | **slop** (NEW) | P1 | vuln에 없음 |

→ slop 시그니처 9개, **vuln과 0 중복**.

### Prevention 층 (생성 시점, 매체 무관, 프롬프트)

| 파일 | 상태 | 역할 |
|---|---|---|
| `lib/slop-rules.mjs` | NEW | 순수 데이터. anti-slop **생성 제약** 카탈로그 + 매체별 변형. `getRules(medium) → {bullets, negation}` |
| `lib/skill-pre.mjs` | EXTEND | slop 제약을 `prompt_bullets`/`negation` 주입(주력) + `PRE/slop-test.md` 내보냄(보조 자가점검) |
| `skills/aesthete-pre/SKILL.md` | EXTEND | 플레이북: 생성 제약 준수 + slop-test 자가점검(보조, 비집행) |

### Detection 층 (post-hoc, v1 = deterministic only)

| 파일 | 상태 | 역할 |
|---|---|---|
| `lib/slop.mjs` | NEW | 스캔 엔진 fold. ALT + medium + styleCtx → findings. deterministic, Date-free. vuln 가드레일 복제 |
| `lib/slop/signatures/palette.mjs` | NEW | gradient(cliche stops) · glass(backdrop-filter) |
| `lib/slop/signatures/decoration.mjs` | NEW | emoji-in-heading · icon-saturation · animation |
| `lib/slop/signatures/copy.mjs` | NEW (lexicon만 v1) | lexicon(regex) v1 · generic(LLM) **v2** |
| `lib/slop/signatures/template.mjs` | NEW | trusted-by · hero-trio (hanging/equal은 vuln) |
| `lib/slop/html-source-scan.mjs` | NEW | raw HTML **단순 presence** 스캔. 미니 CSS parser 아님(M1) |
| `lib/slop-llm-judge.mjs` | **v2** | copy LLM-judge. v1에선 미구현 |

> browser-hook.mjs / region-provider.mjs 건드리지 않음(기하 전용). slop = source text presence.

### 통합 (vuln 선례 복제)

| 파일 | 변경 | 내용 |
|---|---|---|
| `lib/contract.mjs` | +criteria 행 | slop criteria (`skill: 'slop-*'`) |
| `lib/skill-post.mjs` | +스캔 호출 | slop findings → `report.skills` 병합 |
| `lib/skill-decision.mjs` | +reason | `regenerate_slop` + `slopGate`/`slopAutofix` 플래그 |
| `schemas/{brief,report,contract}.schema.json` | +필드 | slop config / 슬롯 / criteria |

**v1 파일 수**: NEW 7(slop-rules + slop + 4 signatures + html-source-scan) + EXTEND 4 lib + 1 SKILL + 3 schema = 15. (LLM-judge v2 연기)

## 4. 데이터 흐름

### Prevention (pre) — 생성 제약 주력 (C3 정정)
```
brief.json (artifact_type)
  → skill-pre.mjs
    → slop-rules.getRules(medium) → bullets + negation
    → prompt_bullets += slop 제약(주력) / negation += slop negation
    → emit PRE/slop-test.md  (보조 자가점검 체크리스트)
  → 생성기(LLM): prompt 제약 준수해 생성(주력 예방)
    → slop-test 자가점검(보조, 비집행 — 자기인증 한계 인정 C3)
  → pre bundle에 slop-test 스탬프(참고용, hard criterion 아님 M2)
```

### Detection (post) — v1 deterministic
```
artifact(html) + PRE/contract.json → skill-post.mjs
  → html-source-scan: 단순 presence 추출
      gradient 리터럴 / backdrop-filter 리터럴 / DOM text / class count / 구조
      ※ var() 간접·외부 stylesheet = 추출 불가 → unmeasured (C2)
  → styleCtx = {gradientsLiteral, glassLiteral, headings+text, iconCount, structure(ALT)}
  → slop.mjs scan: applies(medium) 시그니처마다 evaluate(ctx) → finding
  → report.skills 병합 (slop-*) + coverage 계산
  → contract.evaluateContract 폴드 → pass/fail/unmeasured
  → skill-decision 폴드 → regenerate_slop or advisory or human_coverage
```

### 핵심 원칙
1. **coverage 정직 — false-pass·false-fail 둘두 금지 (C1)**:
   - **측정 후 실패**(measured-and-fail) → 게이트 발동(regenerate_slop).
   - **측정 불가**(unmeasured) → **절대 게이트 아님**, `human_coverage` 에스컬레이트.
   - P0 시그니처가 scanner 한계로 과반 unmeasured → `human_coverage`(판정 불가 솔직). 단, 이것이 상시 발동하면 안 됨 → v1 증명 목표 = real HTML에서 P0가 실측 가능해야(의존성 명시).
2. **우아한 강등**: scanner 한계 / LLM(v2) 부재 → 해당만 unmeasured.

## 5. 신호 × 매체 × 메커니즘 매트릭스 (C2 정정)

`✅`측정가능(literal presence) `⚠️`부분(var() 간접=unmeasured) `❌`측정불가 `—`해당없음. **v1 = HTML only**; SVG/PPTX = v2.

| 신호군.시그니처 | 소유 | HTML(v1) | 메커니즘 |
|---|---|---|---|
| palette.gradient (cliche stops 리터럴) | slop | ✅ `<style>`+인라인 `linear-gradient(` 리터럴 | deterministic |
| palette.gradient (var() 간접) | slop | ❌ unmeasured (cascade 불가 C2) | — |
| palette.glass (backdrop-filter 리터럴) | slop | ✅ 소스 리터럴 | deterministic |
| palette.glass (var() 간접) | slop | ❌ unmeasured | — |
| palette.ai-cliche (보라/바이올렛) | **vuln** | ✅ (vuln 기존) | deterministic |
| decoration.emoji-in-heading | slop | ✅ DOM text + 헤딩 태그 | deterministic |
| decoration.icon-saturation | slop | ✅ `class*=lucide`/`<svg>` count | deterministic |
| decoration.animation | slop | ✅ `@keyframes`/`scale-1` 리터럴 | deterministic |
| copy.lexicon | slop | ✅ regex | deterministic |
| copy.generic (LLM) | slop | **v2** | LLM |
| template.trusted-by | slop | ✅ DOM | deterministic |
| template.hero-trio | slop | ✅ DOM+기하 | deterministic |
| template.hanging-header | **vuln** | ✅ (vuln 기존, advisory) | deterministic |
| template.even-split | **vuln** | ✅ (vuln 기존, advisory) | deterministic |

### html-source-scan 범위 (M1)
**단순 presence만.** CSS 미니파서 아님. 대상: `<style>` 블록 + 인라인 `style=""` 의 **리터럴** 토큰(`linear-gradient(`, `backdrop-filter`, `@keyframes`, 색값, `--var` 정의값), DOM text, class 속성, 헤딩/구조. **제외(=unmeasured)**: `var()` 참조 해석, 외부 `<link>` cascade, `@media` 병합, minify된 복합 규칙. 경계 명시 → "HTML 완전측정" 과장 제거.

## 6. decision 권위 모델

### Prevention ≠ Detection (C3, M2 정정)
- **Prevention 생성 제약** = 주력 예방(프롬프트 제약은 작동). **slop-test 자가점검 = 보조, 비집행**(자기인증 한계 인정).
- **slop-test 결과 = contract hard criterion 아님**(비결정 LLM 스탬프를 gate에 넣지 않음 — M2). 진짜 게이트 = **post deterministic 시그니처**.
- v1 전체 deterministic → post 재현 가능(동일 산물 = 동일 decision).

### Detection tier (H2: 임계 미보정 명시)

| tier | 시그니처 | 권위 | 임계 상태 |
|---|---|---|---|
| **P0** hard gate | slop.gradient(cliche) · slop.emoji-in-heading | measured-fail→`regenerate_slop` | **미보정**(conservative 기본, `opts.thresholds` overridable) |
| **P1** `--slop-gate` gate / 기본 advisory | slop.glass · slop.icon-sat · slop.animation · slop.trusted-by · slop.hero-trio | flag별 | 미보정 |
| **P2** advisory 항상 | slop.copy.lexicon(v1) · slop.copy.generic(v2) | 보고만 | 미보정 |
| **vuln**(별도) | ai-cliche · hanging-header · even-split 등 | vuln 규칙(vulnGate) | vuln 기존 |

> **임계 보정 = v2 하위과제 (H2)**. Phase 4 코퍼스는 **기하 미학 선호도** 라벨이지 slop 라벨 아님. slop human-corpus(수백 쌍 라벨링) 별도 구축 전까지 임계 = conservative + overridable, "uncalibrated" 명시. hardcode는 금지하되 보정 전값은 임시.

### decision 폴드 (skill-decision.mjs)

| reason | priority | 동작 |
|---|---|---|
| `regenerate_slop` (신규) | **60** (vuln과 동석, M4 정정) | P0 measured-fail OR `--slop-gate`+P1 measured-fail → 재생성 |
| `human_coverage` (기존 80) | 그대로 | P0 과반 unmeasured → 판정불가 에스컬레이트(C1) |
| advisory (P1 기본·P2) | — | report만, decision 불변 |

slop priority = **60 (vuln과 동석)**. 사유(M4): 둘 다 "known-bad 패턴 탐지기" 동류, slop는 사용자 1순위 관심 → vuln 뒤에 둘 근거 없음. 동점 시 안정적 tiebreak(config 순서). 루프는 전부 pass까지 계속.

### slop fix (보수)
`suggestionOnly` 기본(advisory 힌트). 자동수정 = 극소수 P0(emoji-strip)만 `--slop-autofix` opt-in. `fix.mjs` 확장 아님.

### LLM-judge 비용 (M5, v2)
copy.generic = **헤딩 + 샘플링 텍스트만** 판정(전문 아님). 결과 = content-hash 캐시. cache hit 시 스킵. 비용/지연 한정.

## 7. 테스트 전략 (v1 스코프)

글로벌 룰: 80% 커버리지, TDD. **FP 회귀 최우선.**

| 층 | 대상 | 예 |
|---|---|---|
| **Unit** deterministic | slop-rules · slop.mjs fold · signatures · html-source-scan | cliche gradient 리터럴→fail · H1 🚀→fail · "delve"→fail · var() 경로→unmeasured(측정 안 됨 검증) |
| **Integration** | skill-pre 주입 · skill-post 스캔 · decision 폴드 · contract · **vuln/slop dedup** | gradient HTML→regenerate_slop · var()-gradient→human_coverage(unmeasured) · hanging-header→vuln 보고(slop 비중복 검증) |
| **E2E fixture** (HTML) | 실 산물 | Github_guide.html(현재→pass/advisory) · 합성 AI-slop HTML(cliche gradient+emoji+trusted-by→regenerate_slop) |

### FP 회귀 스위트 (합법 디자인 절대 트리처 금지)

| 합법 케이스 | 기대 | 방어 |
|---|---|---|
| 학술/에디토리얼 side-label(hanging header) | pass | vuln advisory + `artifact_type` 억제(H3) |
| 보라 브랜드색(합법) | pass/P1 | 색 allowlist(brief) — 단 보라는 vuln 소유 |
| 단일 em-dash in clean copy | pass | 빈도 임계 |
| 정당 미묘 gradient(비-cliche stops) | P1 advisory only | P0는 cliche stops(indigo→pink/violet) 한정 |
| **var()-정의 gradient(합법적일 수 있음)** | unmeasured, **게이트 아님** | scanner 한계 솔직(C2) — false-fail 금지 |

### TDD
시그니처마다 RED 먼저. 임계 hardcode 금지 → `opts.thresholds`.

### v1 커버리지
deterministic만 → 90%+ 용이. 전체 80%+ 부합.

## 8. v1 구현 순서 (writing-plans에서 상세화)

1. `lib/slop-rules.mjs` + `html-source-scan.mjs` (단순 presence, 의존 0)
2. signatures (palette/decoration/copy-lexicon/template) — TDD RED→GREEN. **vuln 중복 0 검증 포함**
3. `lib/slop.mjs` fold (deterministic)
4. 통합: contract/skill-post/skill-decision(60)/schemas — vuln 선례 + dedup
5. pre: 생성 제약 주입 + slop-test.md(보조) + aesthete-pre SKILL
6. HTML fixture 코퍼스 + FP 회귀. **v1 게이트 = real HTML P0 실측 + FP 통제 입증**

## 9. 결정 근거 요약 + 적대적 검토 해소

| 근거 | 해소 finding |
|---|---|
| prevention = 생성 제약 주력, slop-test는 보조 비집행 | C3, M2 |
| P0 게이트 = measured-fail만, unmeaved는 human_coverage(false-fail 금지) | C1 |
| 매트릭스 var()-간접 = unmeasured 솔직 | C2 |
| slop 시그니처 = vuln과 0 중복, 한 패턴 한 엔진 | H1, H3 |
| 임계 = 미보정 conservative, slop corpus v2 구축 | H2 |
| v1 = HTML + vuln비중복 deterministic, SVG/PPTX/LLM v2 | H4, M3 |
| html-source-scan = 단순 presence, 미니파서 아님 | M1 |
| slop priority 60 (vuln 동석) | M4 |
| LLM-judge 헤딩샘플+캐시 (v2) | M5 |

### v1 성공 기준 (증명해야 할 것)
1. real HTML에서 slop P0(gradient/emoji) 실측 → 합성 slop HTML을 `regenerate_slop`로 잡는다.
2. FP 회귀: 합법 디자임 0 트리처.
3. var() 경로 slop → unmeasured(게이트 아님), false-fail 0.
4. vuln/slop 동일 산물 → 중복 finding 0.
5. coverage 정직: 측정불가 = human_coverage, false-pass 0.

미달 = v2 확장 정지, scanner/시그니처 재작업.

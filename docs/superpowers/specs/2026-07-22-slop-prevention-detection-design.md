# Slop 예방 + 탐지 — 설계 문서

- **날짜**: 2026-07-22
- **상태**: 설계 승인됨 (brainstorming 5섹션 통과)
- **참고**: [nutlope/hallmark](https://github.com/nutlope/hallmark) — "Anti-AI-slop design skill"
- **범위 결정**: 예방(prevention) + 탐지(detection) 동시 구축 · 매체 HTML+SVG+PPTX · 신호 4군(색·배경 / 장식·모션 / 카피·텍스트 / 구조·템플릿)

---

## 1. 문제 (근본 원인)

Aesthete = **순수 기하(bbox) 측정기**. 9 스킬(balance·collision·fluency·harmony·hierarchy·proximity·similarity·symmetry·whitespace) 전부 bbox 산술. 그러나 "AI스러운" 슬롭(그라데이션·이모지·글래스모피즘·제네릭 카피·템플릿 tell)은 **시각/스타일/카피 도메인 = 기하 영역 바깥**.

실패 양상 (Github_guide.html 사례):
- pure-JS `html.mjs` 어댑터는 `data-*`/`position:absolute`만 보고 **실제 CSS flow/flex/grid를 못 봄**.
- 브라우저 훅 없이 post-hoc 기하 판정 → 의미있는 측정 안 됨 → false "전부 pass".
- `decision=regenerate` 5개 이유 = fluency/hierarchy/proximity/similarity가 `unmeasurable`. 기하 결함이 아니라 **coverage 갭**.
- 진짜 slop(기하 밖)는 aesthete가 잡을 수 없는 게 당연. 도구-도메인 불일치.

**근본 불일치 정리:**

| 축 | Aesthete (현재) | Hallmark (참고) |
|---|---|---|
| 도메인 | 기하 (bbox) | 시각/스타일/카피 (semantic) |
| 시점 | post-hoc 산술 판정 | generation-time 방지 |
| 구동 | pure-JS deterministic | LLM 프롬프트 규칙 + 58-gate slop-test (LLM 자가실행) |
| HTML | pure-JS adapter, CSS flow/flex/grid 맹 | LLM 생성 시 규칙 적용, adapter 불필요 |

## 2. 목표 / 비목표

### 목표
1. **예방(prevention)**: LLM 생성 시점 slop 차단 — anti-slop 규칙 + LLM 자가 slop-test. 매체 무관(프롬프트라 HTML/SVG/PPTX 전부).
2. **탐지(detection)**: post-hoc slop 축 — deterministic 시그니처 + 카피 LLM-judge. 매체별.
3. **coverage 정직**: 측정 불가 → `unmeasured` 솔직 보고, **false-pass 절대 금지** (사용자 고통의 직격 해결).
4. **우아한 강등**: browser/LLM 부재 → 해당 시그니처만 unmeasured, 크래시/거짓 게이트 없음.

### 비목표 (out of scope)
- computed CSS cascade 완전 해석 (외부 `<link>` stylesheet override). LLM 단일파일엔 희귀 → unmeasured로 솔직 처리.
- LLM이 생성하지 않은 외부 산물의 풀 감사 (detection은 LLM 생성 산물의 안전망이 1차 목적; 외부 감사는 coverage가 허용하는 범위에서 부산물).
- 기하 영역 재설계 (기존 9스킼 + browser-hook Phase 3 = 기하 전용, 그대로).

## 3. 아키텍처 — 모듈 경계

두 층, 깨끗한 seam. slop는 **vuln 선례 정확 복제**로 통합. **비결정 경계 = LLM-judge 1개만** (browser 의존 0).

### Prevention 층 (생성 시점, 매체 무관, 프롬프트 구동)

| 파일 | 상태 | 역할 |
|---|---|---|
| `lib/slop-rules.mjs` | NEW | 순수 데이터. anti-slop 규칙 카탈로그(4군) + 매체별 변형. `getRules(medium) → {bullets, negation}` |
| `lib/skill-pre.mjs` | EXTEND | slop 규칙을 `prompt_bullets`/`negation` 주입 + `PRE/slop-test.md` 내보냄 (LLM이 자기 산출물에 실행할 N-gate 체크리스트) |
| `skills/aesthete-pre/SKILL.md` | EXTEND | 플레이북: slop-test 실행 → 결과 스탬프 → fail 시 emit 전 수정 |

### Detection 층 (post-hoc, 매체별, deterministic + LLM 경계 1곳)

| 파일 | 상태 | 역할 |
|---|---|---|
| `lib/slop.mjs` | NEW | 스캔 엔진. ALT + medium + styleCtx + llmJudge 결과 → findings. deterministic, Date-free. vuln.mjs 가드레일(문맥인식·임계설정·advisory-기본) 복제 |
| `lib/slop/signatures/palette.mjs` | NEW | 색·배경: ai-cliche-palette / gradient / glass |
| `lib/slop/signatures/decoration.mjs` | NEW | 장식·모션: emoji-in-heading / icon-saturation / animation |
| `lib/slop/signatures/copy.mjs` | NEW | 카피: lexicon(regex) + generic(LLM-judge) 2-pass |
| `lib/slop/signatures/template.mjs` | NEW | 구조: hanging-header / equal-grid / 3-card / hero-trio / trusted-by |
| `lib/slop/html-source-scan.mjs` | NEW | raw HTML 텍스트 스캔 (`<style>` 블록 + 인라인 style + CSS `--var` + DOM). pure-JS, no browser |
| `lib/slop-llm-judge.mjs` | NEW | **유일 비결정 경계**. copy 텍스트 → slop findings. 스키마화된 계약. 격리 |

> **browser-hook.mjs / region-provider.mjs 는 건드리지 않음.** 기존 Phase 3 훅 = 기하(flex/grid bbox) 전용. slop는 source text에서 presence를 잡으므로 browser 불필요 (computed cascade가 아니라 존재 여부가 slop 탐지의 대상).

### 통합 (vuln 선례 복제)

| 파일 | 변경 | 내용 |
|---|---|---|
| `lib/contract.mjs` | +criteria 행 | slop criteria (`skill: 'slop-*'`) |
| `lib/skill-post.mjs` | +스캔 호출 | slop findings → `report.skills` 병합 |
| `lib/skill-decision.mjs` | +reason | `regenerate_slop` (priority 65) + `slopGate`/`slopAutofix` 플래그 |
| `schemas/brief.schema.json` | +필드 | slop config (allowlist, tier override) |
| `schemas/report.schema.json` | +슬롯 | slop skill 결과 (`report.skills['slop-*']`) |
| `schemas/contract.schema.json` | +criteria | slop criteria 행 |

**파일 수**: NEW 8(slop-rules + slop + 4 signatures + html-source-scan + slop-llm-judge) + EXTEND 4 lib(skill-pre·skill-post·skill-decision·contract) + 1(SKILL) + 3(schema) = 16. "many small files" 부합.

## 4. 데이터 흐름

### Prevention (pre)
```
brief.json (artifact_type)
  → skill-pre.mjs
    → slop-rules.getRules(medium) → bullets + negation
    → prompt_bullets += slop bullets / negation += slop negation
    → emit PRE/slop-test.md  (gate 수 = 4군 규칙 카탈로그에서 도출, hallmark의 고정 58과 다르게 본 프로젝트 신호 세트 기반)
  → 생성기(LLM): prompt_bullets 읽어 생성 → slop-test 자가실행 → 결과 스탬프
    → fail 시 emit 전 수정 (hallmark 모델)
  → pre bundle에 slop-test 스탬프 기록 → contract prevention criterion
```

### Detection (post)
```
artifact + PRE/contract.json → skill-post.mjs
  → styleCtx 확보 (medium별):
      HTML  → html-source-scan(raw 텍스트: <style>+인라인+--var+DOM)
      SVG   → svg.mjs (fill/stroke/font/<linearGradient>/<text>)
      PPTX  → ooxml (theme color/gradFill/text run)
  → styleCtx = {palette, gradients, blurs, fonts, copyText, structure(ALT)}
  → slop.mjs scan: applies(medium) 시그니처마다 evaluate(ctx) → finding
  → copy.mjs → slop-llm-judge.mjs(유일 비결정) → copy findings
  → report.skills 병합 (slop-*) + coverage 계산
  → contract.evaluateContract 폴드 → pass/fail/unmeasured
  → skill-decision 폴드 → regenerate_slop or advisory
  → POST/{decision,report}.json (slop 섹션)
```

### 핵심 원칙
1. **coverage 정직**: 측정불가 → `coverage:'unmeasurable'`, false-pass 금지. **P0(critical) 시그니처** 중 과반이 unmeasured → `human_coverage` 에스컬레이트 (P1/P2 unmeasured는 보고만).
2. **우아한 강등**: LLM 미구성 → copy.generic=unmeasured, copy.lexicon은 계속 측정. 크래치/거짓 게이트 없음.

## 5. 신호 × 매체 × 메커니즘 매트릭스

`✅`측정가능 `⚠️`부분측정(partial) `❌`측정불가(unmeasured) `—`해당없음

| 신호군.시그니처 | HTML(순수JS) | SVG | PPTX | 메커니즘 |
|---|---|---|---|---|
| palette.ai-cliche (보라/바이올렛/마젠타) | ✅ CSS 색값/`--var` | ✅ fill/stroke | ✅ theme | deterministic |
| palette.gradient (indigo→pink/aurora) | ✅ `<style>`+인라인 | ✅ `<linearGradient>` stops | ✅ gradFill | deterministic |
| palette.glass (backdrop-blur) | ✅ 소스 스캔 | ❌(희귀) | ❌(희귀) | deterministic |
| decoration.emoji-in-heading | ✅ DOM text | ✅ `<text>` | ✅ run | deterministic |
| decoration.icon-saturation (lucide 도배) | ✅ `class*=lucide`/`<svg>` count | — | — | deterministic |
| decoration.animation (scale-105/spin) | ✅ `@keyframes`/`scale` | ✅ `<animate>` | ⚠️ transition | deterministic |
| copy.generic (제네릭 카피) | ✅ LLM-judge | ✅ LLM-judge | ✅ LLM-judge | **LLM**(유일 비결정) |
| copy.lexicon (em-dash/delve/seamlessly) | ✅ regex | ✅ regex | ✅ regex | deterministic |
| template.hanging-header | ✅ DOM+bbox | (vuln 기존) | ✅ | deterministic |
| template.equal-grid/3-card/hero-trio | ✅ 기하+DOM | ✅ 기하 | ✅ 기하 | deterministic |
| template.trusted-by (logo strip) | ✅ DOM | — | — | deterministic |

**유일 unmeasured**: 외부 `<link>` stylesheet cascade (LLM 단일파일엔 희귀) + SVG/PPTX glass. → 솔직 보고, false-pass 아님.

**copy 2-pass**: lexicon(regex, 항상 deterministic) + generic(LLM-judge, optional). LLM 없으면 lexicon만, generic=unmeasured. cheap-first.

## 6. decision 권위 모델

### Prevention ≠ Detection 권위
- **Prevention slop-test** = hard gate, 생성 시점, LLM 자가집행. fail → emit 금지/수정.
- **Detection** = tiered (FP 위험 따라 3단계).

### Detection tier

| tier | 시그니처 | 권위 | 이유 |
|---|---|---|---|
| **P0** hard gate (항상) | template.hanging-header · palette.gradient(cliche) · decoration.emoji-in-heading | fail→`regenerate_slop` | presence=결함 정의, FP≈0 (hallmark gate54 동급) |
| **P1** `--slop-gate`시 gate, 기본 advisory | palette.ai-cliche · palette.glass · decoration.icon-sat · decoration.animation | flag별 | 합법 사용 존재. 임계 의존 |
| **P2** advisory (항상) | copy.generic(LLM) · copy.lexicon | 보고만, decision 영향 0 | 주관적·LLM FP 높음 |

### decision 폴드 (skill-decision.mjs)

| reason | priority | 동작 |
|---|---|---|
| `regenerate_slop` (신규) | **65** (vuln 60·contract 70 사이) | P0 fail OR `--slop-gate`+P1 fail → 재생성 |
| `human_coverage` (기존 80) | 그대로 | 임계 시그니처 unmeasured 과반 → 사람 에스컬레이트 |
| advisory (P1 기본·P2) | — | report에 실림, decision 불변 |

순서: geometry fix(30) → vuln(60) → **slop(65)** → contract(70). 구조 잡힌 베이스 위에 스타일 손. slop(65)는 vuln(60) 뒤 — 둘 다 실패면 vuln reason 보고, 루프는 전부 pass까지 계속.

### slop fix (보수)
slop 결함 일부 deterministic 수정 가능(emoji 제거·gradient→고체·hanging-header→수직적재·반경 토큰화 = 사용자가 손수 한 것). 단 HTML 소스 CSS 재작성 = 위험.
→ **suggestionOnly 기본** (advisory 힌트). 자동수정 = 극소수 P0(emoji-strip·gradient-stop 중화)만 `--slop-autofix` opt-in. `fix.mjs` 확장 아님, 별도 경로.

### 정직 보고
- prevention 정상 작동 → post가 slop fail 안 봄 (LLM이 emit 전 수정). post = 안전망.
- slop 결함 없고 coverage 충분 → `pass`.
- slop 측정불가 과반 → `human_coverage`.

## 7. 테스트 전략

글로벌 룰: 80% 커버리지, TDD(RED→GREEN→REFACTOR). **FP 회귀가 핵심 위험.**

### 층

| 층 | 대상 | 예 |
|---|---|---|
| **Unit** (deterministic) | slop-rules · slop.mjs fold · signatures×4 · html-source-scan | 보라→fail/흙톤→pass · backdrop-blur→fail · H1에 🚀→fail · hanging-header→fail · "delve"→fail |
| **Unit** (LLM 경계, mocked) | slop-llm-judge 계약 | 입출력 스키마 · LLM 불가→unmeasured 강등 |
| **Integration** | skill-pre 주입 · skill-post 스캔 · skill-decision 폴드 · contract | brief(html)→slop bullets+slop-test.md · gradient HTML→regenerate_slop · 임계 unmeasured 과반→human_coverage |
| **E2E fixture** (full pre→post→decision) | 실 산물 코퍼스 | Github_guide.html(clean→pass/advisory) · 합성 AI-slop HTML(보라 gradient+emoji+3카드+제네릭→regenerate_slop) · SVG/PPTX slop fixture |

### FP 회귀 스위트 (합법 디자인 절대 트리처 금지)

| 합법 케이스 | 기대 | 방어 |
|---|---|---|
| dashboard 동일 KPI 그리드 | pass | `artifact_type=dashboard` → template 억제 (vuln 선례) |
| 보라 브랜드색 (합법) | pass/P1 advisory | 색 allowlist(brief config) |
| clean 카피 내 em-dash 1개 | pass | 임계(빈도) 기반 |
| 정당 미묘 gradient | P1 advisory only | P0는 cliche stop(indigo→pink/violet) 한정 |

### TDD 규율
시그니처마다 RED 먼저: 실패 fixture → `evaluate()` 최소 구현(GREEN) → 리팩터. 임계 hardcode 금지 → `opts.thresholds` overridable (vuln 가드레일 2).

### 임계값 보정 = Phase 4 재활용
P0/P1/P2 컷오프 임의 설정 금지. 기존 `lib/bradley-terry.mjs` + human-corpus 빌더로 보정: slop fixture 쌍을 인간 판정 코퍼스에 넣고 Bradley-Terry로 임계 도출. slop = 프로젝트 검증 인프라와 자동 연결.

### 커버리지
deterministic 모듈 90%+ 용이. LLM-judge = 계약(mock) 경로 커버. 전체 80%+ 부합.

## 8. 구현 순서 (참고 — writing-plans에서 상세화)

1. `lib/slop-rules.mjs` + `html-source-scan.mjs` (순수 데이터/스캔, 의존 없음)
2. signatures×4 (TDD: RED fixture → evaluate)
3. `lib/slop.mjs` 엔진 fold + `slop-llm-judge.mjs` 격리 계약
4. 통합: contract/skill-post/skill-decision/schemas (vuln 선례)
5. pre: slop-test.md + skill-pre 주입 + aesthete-pre SKILL
6. fixture 코퍼스 + FP 회귀 + Bradley-Terry 임계 보정

## 9. 결정 근거 요약

- **왜 prevention+detection 둘 다**: 사용자 선택(이중 방어). prevention이 주력(hallmark 검증), detection은 안전망.
- **왜 browser 안 쓰는가**: slop 탐지 = presence(존재 여부)지 computed cascade 아님. source text에 다 있음. browser 의존 = 프로젝트 정체성(pure-JS no-DOM core) 위배 + 비결정 경계 2개로 증식. YAGNI.
- **왜 slop를 vuln과 별개 모듈로**: vuln = 기하 증거 기반 known-bad, slop = style/semantic known-bad. 도메인 다르나 통합 패턴(criteria/fold/advisory)은 동일 → 선례 복제, 코드는 분리.
- **왜 임계값을 Bradley-Terry로**: hardcode = FP 폭발(vuln 주석 경고). 인간 판정 코퍼스로 보정 = 프로젝트 Phase 4 인프라 재활용, 정직한 임계.

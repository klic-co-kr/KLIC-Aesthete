# DESIGN.md — Aesthete 설계 계약서

본 문서는 `aesthete` 스킬의 **미학 법칙·측정 규칙·도메인 한계**를 협업 친화적 마크다운으로 고정한다. 에이전트는 언제든 이 파일을 파싱해 자신이 올바른 컴포넌트 조합 법칙을 견지하고 있는지 정합성을 검사할 수 있다.

## 0. 역할 정립 (positioning) — 뭘 하고 뭘 안 하는가

> **"구조화된 레이아웃(SVG · HTML · PPTX · ALT)의 미학을, 생성 *후*에 *결정론적 기하*로 측정하고 보정한다."**

aesthete는 **사후(post) · 기하(geometry) · 구조화(structured)** 삼중 정체성이다. 이 경계를 솔직히 못 박는 것 자체가 정체성이다.

| 산출물 | 생성 방식 | 미학 통제 시점 | 담당 | aesthete 역할 |
|---|---|---|---|---|
| SVG / HTML / PPTX / ALT | 코드·좌표 생성 | **사후 기하 보정** | aesthete | **본령 ✅** (measure + fix) |
| 래스터 이미지 (ChatGPT/나노바나나 등 diffusion) | 처음부터 픽셀 생성 | **사전 프롬프트 가이드** | 별도 *design guideline* 영역 | ❌ 직접 불가 (픽셀 = 기하 없음) |

**한다(본령)**: 구조화 산출물의 사후 측정·보정 · 평가자=산술(합리화 없는 판정) · 에이전트 루프 내 반복 사후 보정(=점진 개선 근사).
**안 한다(경계 밖)**: 래스터 이미지 미학의 생성/편집 · 이미지 생성용 사전 프롬프트 design guideline(별개 프롬프트 엔지니어링 영역).
**보조로만**: 비전 전단(또는 MLLM)이 요소 영역을 뽑아줄 때 래스터 이미지 **구도 채점**에 기여 — 본령 아님.

```
이미지 생성  →  [사전: design guideline(프롬프트 영역, 별도)]  →  생성  →  (사후 편집 불가)
레이아웃 생성 →  생성  →  [사후: aesthete(기하 보정, 본령)]  →  재출력
```

## 0.1 전처리 preflight — 같은 기하 원리를 생성 전 목표로 (구현됨)

aesthete는 본령이 **사후**(measure/fix). `lib/preflight.mjs`는 그 **사전** 짝이다: 산출물이 생기기 **전**에, artifact type(dashboard·marketing·report·diagram·poster) + canvas + intent에서 **결정론적으로** 세 가지를 뽑는다.

1. **타입별 튜닝 frozen contract** — 측정 스킬 메트릭에 임계값을 type별로 매핑. dashboard는 밀도 허용(`freeRatio≥0.12`), marketing은 여백 요구(`freeRatio≥0.35`), report는 안정(`balance≥0.85`), poster는 긴장 허용(`balance≥0.6`). 이 contract를 `fix.mjs --contract`로 **그대로** 먹이므로, **같은 contract가 생성 목표이자 수용 기준**이 된다.
2. **geometric budget** — 생성기 향 과금: `freeRatio` 목표·`typeScale`(tight/sober/dramatic/paired)·focal 수·balance 자세(stable/dynamic)·decoration 예산·spacing rhythm.
3. **negation** — Polanyi "negation > assertion": 금지 기본값(보라 그라데이션/동일 간격/50:50/`shadow-md+rounded-lg` 전역 등). token 샌드박스(탈출구 금지)의 미학 사촌.

```
preflight(brief) → contract + budget + negation → 생성 → measure/fix --contract → 수용
```

unknown type은 `recognized=false` + 검증 가능 P0 바닥(generic fallback)으로 떨어진다 — 사전 스펙이 없어도 수용 기준은 있다. 본령(사후 기하 보정)과 정체성은 그대로; preflight는 "측정하는 같은 수식을 생성 전 목표로 출력"하는 짝일 뿐. (래스터 이미지의 사전 프롬프트 가이드는 여전히 별개 영역 — §0.)

## 0.2 취약점 엔진 + 실행 프로파일 (구현됨)

**취약점 엔진**(`lib/vuln.mjs`) — 9개 측정 스킬이 continuum(얼마나 균형?)을 점수화한다면, 이 엔진은 **이산 known-bad 패턴**(분명히 약한 것)을 탐지한다. polanyi-design "negation > assertion"과 gestalt "template 같다"의 결정론 구현. 시그니처:

- `no-focal-point`(high) — 어느 요소도 광학 무게를 지배 못 함(figure-ground 실패).
- `no-spacing-rhythm`(medium) — 간격이 거의 동일(템플릿 rhythm 부재).
- `type-scale-accident`(medium) — 폰트 사이즈 >5개("시스템 아닌 사고").
- `rainbow-categorical`(medium) — 범주형 그룹에 무지개 팔레트.
- `even-split`(low) — 좌/우 또는 상/하 ~50/50(우유부단).
- `ai-cliche-palette`(low) — 색이 청~보라 밴드에 집중(디폴트 "AI" 룩).

각 발견은 `signal`(왜 걸렸는지 수치)·`threshold`·`nodes`·`remediation`·`mode: suggestionOnly`(기하 fixer가 못 고치는 디자인 방향)를 낸다. §12 coverage를 따라 텍스트/색이 없으면 해당 시그니처를 skip(가짜 탐지 안 함). `measure-only` 프로파일에서 read-only로 돈다.

**현실 가드레일**(smell-탐지 문헌의 1순위 실패 = 높은 위양성; "결정론적으로 틀린 답도 틀리다"):
- **맥락-인식**: polanyi negation은 생성 휴리스틱이라 맥락 없는 평가 게이트로는 올바른 디자인을 깨진다고 본다(예: 대시보드의 동일-가중치 KPI 그리드). `scanAlt(alt,{artifact_type})`로 타입 의도에 모순되는 시그니처를 억제(dashboard→no-focal/no-rhythm/even-split; diagram→no-focal/even-split). 억제는 `summary.suppressed`에 투명 공개(숨김 아님).
- **임계값 설정 가능**: 모든 컷오프는 `opts.thresholds`로 override(부분 override도 per-signature deep-merge). 고정 임계값은 smell FP의 1번 원인.
- **뉴트럴 색 l-floor**: `ai-cliche-palette`는 채도+명도 바닥(`l∈[0.15,0.85]`)을 통과한 채색만 본다 — 다크 네이비 등 정당 브랜드 뉴트럴을 "AI 클리셰"로 오탐하지 않는다.
- **advisory**: 보고서는 `advisory:true`이며 gate가 아니다. 위양성 가드 테스트(타입-정답 레이아웃→조용)가 엔진이 올바른 디자인에 발화하지 않음을 단정.

**실행 프로파일 매트릭스**(`lib/profiles.mjs`) — searchpo 패턴. 층마다 "성공의 진실"이 다르다는 realistic-review 결론을 코드로 선언:

| profile | 허용 | 금지 | 성공의 진실 |
|---|---|---|---|
| `measure-only` | measure·report·vuln-scan·preflight | mutate-alt·apply-fix·call-model·publish·approve | coverage+measuredAestheticScore; ALT 불변 |
| `fix-geometry` | autoFixable 패치·snapshot | suggestionOnly 적용·의미 변이 | contract pass + 단조게이트 |
| `llm-judge` | 외부 축 병합·contract 평가·근거 ledger | publish·approve·판정 자동 변이 | 다양 판정기 합치+근거; 자동 publish 금지 |
| `human-gate` | present·await-signature | publish·approve·mutate | 인간 서명 |

**정직한 한계 — 이 매트릭스는 naming+투명성이지 enforcement 경계가 아니다**(realistic-review 자체 교정). 진짜 강제는 **구조적**이다 — 예: fixer의 `PATCHES`가 suggestionOnly 종류를 아예 안 갖고 있어, allow/deny 목록과 무관하게 적용 못 한다. `assertAllowed`/`isAllowed`는 OPA in-process 패턴처럼 **같은 프로세스가 consult하는 advisory 게이트**라 OS/네트워크 격리가 없고 우회 가능하다. 그래서 각 프로파일은 `enforced` 플래그로 **실제 바인딩 여부**를 솔히히 밝힌다: `measure-only`·`fix-geometry`는 `enforced:true`(vuln·fix가 실제 bind), `llm-judge`·`human-gate`는 `enforced:false`(aspirational — 발행/승인 런타임이 아직 없다). Aesthete는 L3(제한 쓰기)까지만, 자동 publish/approve(L5)는 없다.

**fix.mjs의 `fix-geometry` gate**(투명성): 루프에서 각 fix를 `isAllowed`로 검사해 `suggestionOnly`를 skip하고 `fix-log.skippedFixes`에 이유와 함께 기록한다(소비자가 "자동 안 고쳐진 것"을 본다). fix-log는 `profile:'fix-geometry'` 선언. 단 이 gate가 suggestionOnly를 "막는" 건 아니라 — 구조적으로(PATCHES) 원래 못 고치던 것을 **이름 붙이고 기록**할 뿐이다. 진입 시 tautological assert(자기참조라 의미 없음)는 제거했다.

## 0.3 검증 하네스 (구현됨) — 경험적 타당성의 유일한 정직한 테스트

현실적 검토의 수렴 결론: 엔진은 결정론적으로 정교하지만 **경험적으로 미검증**이다. hand-crafted 미학 공식(Ngo BM 등)은 인간 판정과 약상관이라 분야가 data-driven(AVA·MLLM)으로 이동했다. 코드 리뷰를 아무리 돌려도 이 갭은 안 닫힌다 — 닫는 건 **인간 평가 말뭉치 대비 상관**뿐이다.

`lib/validate.mjs`는 그 하네스다. corpus(`entries: [{id, humanScore, alt}]`)를 `measureAlt`로 재고, 4개 변형을 인간 점수와 **Spearman + Pearson 상관**으로 비교:

| 변형 | 가설 | source |
|---|---|---|
| **A** overallScore | legacy(측정 불가 축을 중립 1로 포함) | summary |
| **B** measuredAestheticScore | §12(측정 축만) | summary |
| **C** hardIntegrityScore | "인간은 그냥 '안 깨진' 것에 반응한다" (P0) | summary |
| **D** coverageScore | "인간은 잘 구조화된(측정 가능한) 입력에 반응한다" | summary |

+ **baseline**(평균 예측 → r≈0). 진짜 신호는 baseline을 이겨야 한다. winner/beatsBaseline 보고.

**정직한 한계 — demo corpus는 synthetic이다**: `examples/validation-corpus.json`의 `humanScore`는 **내가 부여한 placeholder**라 상관이 **순환적**으로 부풀어 있다(내 미학 직관이 메트릭과 같은 원리에서 왔으므로). 그래서 `demo:true` + NOTE가 "이 결과는 하네스가 돌아감을 증명할 뿐, 메트릭이 검증됨을 증명하지 않는다"고 못 박는다. `entries[].humanScore`를 **실 인간 평가**로 갈아끼우면 코드 변경 없이 진짜 검증이 된다.

**비순환 코퍼스(부분 한 걸음) — `examples/ground-truth-corpus.json`**: `scripts/gen-ground-truth-corpus.mjs`가 라벨을 **주입한 결함 종류+심각도**(구성 사실, 메트릭과 독립)로 생성해 순환성을 끊는다. ρ≈0.33으로 baseline(0.0)을 이긴다 — 하지만 이것은 **엔지니어링된 구조 결함에 대한 (a) 심각도 단조성 (b) 스킬 직교성 (c) clean 위양성 없음**을 보일 뿐, **실 인간 미학 선호를 검증한 것이 아니다**. ρ=0.33은 "necessary-not-sufficient, 약~중간"이지 유효성 증명이 아니다 — "메트릭이 검증됨"이라는 말은 여전히 성급하다. 실 인간 평가가 들어와야 그때 검증.

## 1. 프레임워크 명제

정적 IAA/IQA 모델은 이미지에 사후 점수를 매기지만, **생성 중인 에이전트가 점진 품질 개선**을 하지는 못한다. Aesthete는 인지 미학 원리를 **결정론적 실행 모듈(측정 스킬)**로 캡슐화해 이 간극을 메운다.

> 핵심: 측정·평가·보정이 전부 산술이다. 평가자가 LLM이 아니므로 "이 정도면 충분히 괜찮다"는 사후 합리화가 구조적으로 불가능하다.

## 2. 인지 스킬의 3계층 구조

각 스킬(`lib/skills/*.mjs`)은 제안서의 삼중 결합을 그대로 구현한다:
1. **관찰 규칙** — ALT에서 기하 정보를 추출(bbox, 중심, 거리, 점유).
2. **측정 규칙** — 기하를 수학적으로 검증(아래 §3). `{score, metrics, violations}` 반환.
3. **인지 효과** — `effect` 메타데이터로 "왜 이렇게 재배치해야 하는가"의 심리적 타당성을 서술(LLLM 추론용 의미 매핑).

## 2.1 인지 심리학 근거 (Evidence Base)

각 스킬은 인지 심리/계산 미학 연구에 근거한다 (`effect` 메타에 해당 기전을 명시):

| 스킬 | 근거 이론/연구 | 기전 |
|---|---|---|
| `proximity` | **Wertheimer (1923)** 게슈탈트 근접성 / **Reber et al.** 처리 유창성 | 근접 요소 → 단일 지각 단위 군집화 → saccade↓·유창성↑ |
| `balance` | **Ngo et al. (2001)** Aesthetic Measures (BM) / 2024 *Symmetry* | 광학 무게 평형 → 정서 안정·early visual processing |
| `whitespace` | **Reber et al.** Processing Fluency / **Fan et al.** 시각 복잡도(quadtree) | 능동 여백 → 인지 부하↓·주의 집중 |
| `hierarchy` | **Treisman** Feature Integration Theory | 명확한 계층 → visual search 시간↓ |
| `harmony` | **Birkhoff** M=O/C / **Munsell** 색채 공간(보색 모멘트) | 색 평형 → 색채 피로↓·지각 안정 |
| `similarity` | **게슈탈트 유사성(Similarity)** | 동일 그룹 시각 일관성 → 지각 단위화 |
| `fluency` | **Processing Fluency** (Reber·Schwarz·Winkielman, 2004) / Topolinski & Strack (2009, motor fluency) | 읽기 흐름 정렬 + 크기-중요도 기울기 → 처리 유창성↑ → 미학적 쾌감·이해·회상 |
| `collision` | figure-ground 분리 / saccadic eye movement | 겹침 제거 → 안정적 주사 |
| `boundary` | **게슈탈트 폐쇄성(closure)** | 완결 배치 → 인지 단절 방지 |

> **Processing Fluency 핵심**: 자극이 인지적으로 쉽게 처리될수록(perceptual + conceptual fluency) 긍정 정서 → 미학 판단 향상(Reber et al., 2004, *Personality and Social Psychology Review*). 대칭·고대비·원형·명확 타이포가 fluency를 높여 liking↑. **한계**: over-fluency(과도한 단순함)는 지루함 → optimal complexity 필요(Birkhoff M=O/C와 동일 균형). 따라서 fluency 스킬은 "최대화"가 아닌 "충분한 계층 + 읽기 흐름 정렬"을 점수화한다.
>
> 우선순위 위계(P0 > P1 > P2)는 "가독성 기본 전제가 장식적 미학보다 선행"이라는 게슈탈트/Neurodesign(뇌의 에너지 보존 → 단순·유창 레이아웃 선호) 원칙과 일치.

## 3. 수학적 정형화 (및 조작화 선택)

모든 수식은 0나누기/NaN 가드를 갖는다(`lib/geometry.mjs`, `lib/color.mjs`).

- **근접성 P_group** = `exp(−α · d_ij / d_ref)`, `α=1.0`. `d_ref` = **최근접거리의 중앙값**.
  - 제안서는 `d_min`(전역 최소)을 쓰지만, 그렇게 하면 가장 가까운 쌍조차 `d/d_min=1`이 되어 아무것도 군집화되지 않는다(검증됨). 중앙값 최근접거리를 참조 척도로 채택해 감쇠가 실제로 변별력을 갖게 했다.
  - 군집 결정은 **RANG(비율 이웃 그래프)**: `d_ij ≤ 1.5·min(nn_i, nn_j)` 로 스케일 불변.
  - **α/P_group 역할 결정**: `P_group`/α는 **보고용 신뢰도(meanGroupP)만** 영향을 주고, **군집 '결정'은 RANG이 주도**. 제안 v2 식(`exp(−α·d/d_min)`)은 d_min 정규화에서 α=1.5~3을 가정하지만, 본 스킬은 d_ref 기준 α=1.0으로 조작화했으므로 α 범위를 그대로 가져오지 않는다(정규화기가 다르면 α도 재보정). α는 튜너로 조정 가능(§7).
  - 그룹 의미(category)가 선언된 쌍이 없으면 `skipped`(거짓 양성 방지).
- **Ngo 균형 BM** = `1 − (|BMv| + |BMh|)/2`, `BM_{v,h} = (W_left − W_right)/max(...)`.
  - 광학 무게 `W = Σ a · c · s · d`. `c = luminanceWeight = 0.36 + 0.64·lum`(검은 요소가 ~2.8× 무거움), `s = min(8, perimeter/√area)`.
- **능동 여백** = 점유 기반 **쿼드트리**(픽셀 없음). `freeRatio = free영역 / 캔버스`. 제안서의 local-variance 픽셀 버전의 결정론적 아날로그.
- **계층 clarity** = `fontSizeStepRegularity × contrastAdequacy`. 단위성은 `1 − stddev(log-단위)/mean`, 대비는 WCAG AA(4.5:1) 바닥.
- **색채 균형 harmony** = `harmonyScore = max(R, momentBalance)`.
  - `momentBalance = 1 − |Σ Aᵢ·(cos hᵢ, sin hᵢ)| / Σ Aᵢ` — 보색 모멘트 평형(제안서 `Σ Aᵢ·Dist(ωᵢ,ω₀)≈0` 의 색상환 기하 등가). 각 채색 요소를 면적 가중 단위벡터로 투영.
  - `R` = 색상 합벡터 평균 길이(analogous 점수). analogous OR 보색 평형 둘 다 조화로 인정(단색=1). 무채색(채도<0.08)은 중성으로 제외.
  - Birkhoff `M=O/C`(조화쌍/색복잡도)는 정보 메트릭. 튜너로 α·임계값 조정 가능(§7).

## 4. 폐루프 Fixer 보장

- **P0 하드 청소**: 매 반복 서브루프(`resolveP0`)로 이탈(boundary)은 항상 0으로 클램프하고, 충돌(collision)은 **비겹침 배치가 가능한 입력**에서 0으로. P2 shift가 노드를 밀어 넣어도 종료 전 청소. **한계(정직 명시)**: 물리적으로 불가능한 입력(예: 캔버스보다 노드 합산 면적이 커서 절대 안 겹칠 수 없는 경우)에서는 충돌이 0이 될 수 없으며, 잔존 충돌 쌍 수가 `report.skills.collision.metrics.count`에 남는다. "보정 후 항상 0"이 아닌 **"가능한 입력에서 0, 불가능 입력에선 잔존량 보고(best-effort)"**가 정확한 표현이다.
- **단조 개선 게이트**: 가중 위반 총합이 strictly 감소하지 않으면(연속 2회) 정지 → 최저 위반 스냅샷 반환. 진동 원천 차단.
- **노드 동결**: 캔버스 대비 과도 이동 노드는 동결(요요 방지; 1차 방어는 게이트).
- **충돌 중재 (동적 보상)**: `compensationFactor('proximity', {freeRatio})` 연속 곡선이 freeRatio 비례 감쇠 — `freeRatio≤0.15`면 근접성 pull 완전 억제, `≥0.35`면 자유. hard threshold 아님. balance↔proximity는 광학 중심 재정렬로 평행이동(겹침 안전). influence(hierarchy→proximity)는 urgency 부스트로 반영.
- **결정론**: `Math.random`/`Date` 없음. 동일 입력 → byte 동일 출력(`test/golden.mjs`가 단정).
- **기본은 P0 구조 청소 ONLY (Goodhart 방어)**: fixer는 기본이 **P0만**(`resolveP0` — 충돌 해소·이탈 클램프, 가독성 바닥) 손댄다. P1/P2 **미학 shift**(balance 재정렬·근접 이동·`pSnapToMarginGrid` 균일스케일)과 suggestionOnly 거부-기록은 **`--aesthetic` opt-in**으로만 켠다. 근거 — 실측: 점수는 올라도 미학은 나빠지는 Goodhart가 real SVG로 재현됐다(C의 깔끔한 그리드를 balance/whitespace 점수 올리려 흩뿌리고, B를 거대 빨간 벽으로 채움). **기하 메트릭은 필요충분이 아니다** — collision 해소 ≠ 좋은 디자인. 그래서 자동 미학 shift는 기본 끄고, "미학 품질" 신호는 measure continuum + vuln negation + (실 검증 시) 인간/신경이 함께 봐야 한다.

## 4.1 스킬 관계 그래프 (3관계, 선언적)

`lib/graph.mjs`가 **priority**(tier) · **conflict**(동적 보상) · **influence**(hierarchy→proximity 상향 전이, weight 0.3) 세 관계를 엣지 데이터로 정의. `GRAPH` 객체(nodes+typed edges)를 export해 시각화·확장 — 새 스킬은 노드+엣지 추가만으로 코어 수정 없이 통합(제안서의 위상 그래프 확장성).

## 4.2 측정 coverage와 점수 분리 (Intent Quality Plane §12 반영)

기하가 "항상 측정 가능"한 건 아니다. 소스에 그룹 의미(category)가 없으면 `proximity`는, 비교 가능한 동일-그룹 쌍이 없으면 `similarity`는 **판정을 내릴 수 없다**. 이 축들이 `score: 1`(중립)을 반환하면 종합 점수가 **부풀어** — P0가 깨진 레이아웃도 0.5 언저리로 보고되는 거짓이 생긴다(실측 재현). 스킬이 예외로 터져도 같은 함정.

그래서 측정 보고서는 측정 **사실**과 점수를 분리한다:

- **`skills[id].coverage`** = `measured | partial | unmeasurable`. 측정 못 한 축(proximity-skip, similarity-no-groups, 예외)은 `unmeasurable`.
- **`summary` 점수 3분할**:
  - `hardIntegrityScore` — P0(collision·boundary) 가중평균. 구조 안전 바닥. P0는 기하라 항상 측정.
  - `measuredAestheticScore` — **측정된 축만** 가중평균(unmeasurable 제외). 정직한 미학 점수.
  - `coverageScore` — `measuredWeight / totalWeight`(0~1). 얼마나 실제로 측정했나.
  - `overallScore` — **legacy**(모든 축 포함, unmeasurable을 중립 1로). 호환·golden용; 소비자는 `measuredAestheticScore` + `coverageScore`를 볼 것.
- 예외로 터진 스킬은 `passing`이 아니라 `failing`로(coverage `unmeasurable` + `metrics.error`). 측정 못 한 걸 "통과"로 착각하는 사태 차단.

각 위반의 `fix`는 적용 가능성을 명시: `mode: autoFixable`(기하 fixer가 실제로 적용 — `lib/fixkind.mjs`의 6종) | `suggestionOnly`(폰트·색·의미·읽기순서 등 기하 fixer가 못 고침 — 인간/재생성으로). 보고서가 "자동 고정 가능"을 거짓으로 암시하지 않는다.

**contract도 coverage를 존중**: `contract.evaluate`는 criterion의 스킬이 `unmeasurable`이면 해당 criterion을 `status: 'unmeasured'`(passed=false)로 처리 — 기본 메트릭(clarity=1, inconsistentGroups=0 등)으로 **거짓 통과하지 않는다**. fix-log는 criteria를 3분할(`passedCriteria`/`failingCriteria`/`unmeasuredCriteria`)로 보고. 측정 못 한 축이 "통과"로 둔갑하는 경로를 점수·contract 양쪽에서 차단.

## 5. 도메인 불가지론과 정직한 한계

측정 코어는 ALT만 본다. 도메인은 어댑터(`lib/adapters/`)에서 ALT로 변환. **순수 JS(브라우저 없음)** 선택에서 오는 한계를 메타에 명시:
- **SVG / PPTX**: **import(파싱)**는 도형 좌표가 명시 → 완전 결정론적. SVG import는 전체 affine transform 목록과 viewBox 원점을 캔버스 좌표로 합성한다. PowerPoint 호환용으로 CSS가 presentation attribute로 평탄화된 SVG에서는 `<defs>`·marker·`aria-hidden`/`role="img"` 내부를 레이아웃 노드로 세지 않고, 패널·shadow stack·connector·annotation pill을 의미별로 분리해 표시 방식 차이가 P0 충돌 오탐으로 번지지 않게 한다. 단 **export는 원본 패치가 아니라 ALT 재출력**이다 — `circle`/`ellipse`/`rect`는 형상을 보존하나, `<path>`의 Bézier 곡선·`<line>`·gradient·transform·stroke-width/대시 등 세부 스타일은 bbox-rect로 **평탄화**된다(원본 형상 손실). 즉 "SVG 미학 보정"은 "ALT 기반 최소 SVG 재구성"이지 원본 SVG를 그대로 되돌려주는 것이 아니다. PPTX export는 단일 슬라이드 최소 패키지(마스터·테마·미디어·차트 미포함, §8).
- **아이콘/선-아트의 collision 위양성 방지**: 루시드(lucide) 같은 stroke-only 아이콘은 `fill="none"`이라 어댑터가 `style.filled=false`로 기록. `collision`(과 fixer의 `resolveP0`)은 **둘 다 non-text unfilled(stroke)인 쌍의 교차는 collision에서 제외** — 선-아이콘에서 교차가 의도(asterisk·snowflake·anchor)이기 때문이다. CSS class 때문에 inline fill이 없는 텍스트는 선-아트 예외로 취급하지 않는다. `kind=decor` 연결선·그림자·주석은 독립 레이아웃 충돌 대상에서 제외하고, `kind=container`가 실제로 포함한 자식도 충돌로 세지 않는다. 독립된 채움 객체와 부분 중첩한 peer container는 계속 잡는다(`filled` 기본값 true → 기존 ALT 영향 없음). 단일-path 아이콘(루시드 대다수)은 노드 1개라 애초에 측정 못 함 — 아이콘은 기본 도메인 밖(§0).
- **HTML**: CSS 박스 모델의 실 bbox는 브라우저 렌더링 필요. 본 스킬은 **명시 기하**(절대좌표/인라인/`data-*`)만. 플렉스·그리드 흐름은 측정 불가.
- **DOCX/XLSX**: 절대 2D 좌표가 없음(흐름/격자) → 흐름·균일격자로 근사 ALT(근사 명시).
- **Image**: 래스터는 기하가 없음 → 캔버스 크기는 헤더에서 순수 JS 추출(PNG/JPEG/GIF/WebP), **요소 영역은 선언(주석) 필요**. 픽셀 분할은 CV/캔버스 의존이며 본 스킬 범위 외.

## 6. Sprint Contract 격리 (합리화 방지)

- 계약서(`schemas/contract.schema.json`)는 생성 **전**에 동결. 평가자(`contract.evaluate`)는 이 파일과 `report.json`만 본다 — 생성자의 코드·주석·변명은 평가자 세션에 전달되지 않는다(본 스킬에선 평가자가 산술이라 물리적 격리와 동등).
- 결과는 가중 합산 점수 + PASS/FAIL enum. `fix-log.json`의 `outcome`은 `pass|best-effort|no-improvement|budget-exhausted`.

## 7. 디자인 토큰 샌드박싱 + 자가진화 (구현됨)

- **토큰 샌드박싱**: `lib/tokens.mjs` + `lib/lint.mjs`. 승인 팔레트·타입스케일·라디오(`DEFAULT_TOKENS`, `tokens.json` 오버라이드 가능)만 허용. ALT를 정적 분석해 임의 핵사·옵션 외 폰트를 "탈출구" 위반으로 검출 → `lint.mjs`가 exit 1(CI 게이트). 에이전트 보정은 기하 토큰(정규화 bbox·여백 비율) 단위로만 수행.
- **자가진화 피드백 루프**: `lib/tune.mjs`. 사용자 편집 전후 ALT의 diff(관련 쌍 거리 비율)를 분석해 근접성 `FRAG_FACTOR`·`RANG_RATIO` 튜닝 → `skill-params.json` 역전파(코드 수정 없이). **거버넌스(단일 편집 → 전역 변동 방지)**: (0) 튜너는 cached 파라미터를 **clone**해 변이(차단·dry-run에도 캐시 오염 없음); (1) 기본 dry-run; (2) `--apply`는 최소 표본(`MIN_PAIRS=3`쌍) 미달 시 거부, `--force`로만 우회; (3) `--apply`는 **기본적으로 profile에만 기록** — 글로벌 `skill-params.json` 쓰기는 명시적 `--global`로만(단일 레이아웃이 전역을 덮어쓰는 사태 차단); (4) 적용 전 이전 값을 `skill-params*.backup-NNN`(Date 없는 카운터)에 스냅샷(롤백); (5) `--profile <name>` → `skill-params.<name>.json` 격리 — `measure.mjs`/`fix.mjs`의 `--profile <name>`이 이를 **읽어** 측정·보정에 적용(없으면 글로벌→기본값 폴백). α·임계값이 인간 선호에 맞춰 진화하되, 단일 사례가 전역 인지 상수를 덮어쓰지 않는다(제안서 §인간 선호 데이터 피드백 루프 + 안전 장치).

## 8. 범위 밖 (v1 이후)

- **실제 GRPO 학습 루프**(LLM 훈련 인프라 필요) — 본 스킬은 보상 신호까지는 산출 가능(`report`의 가중 점수), 정책 최적화 자체는 외부.
- 멀티 에이전트 세션 물리 격리(Planner/Generator/Evaluator 분리) — 본 스킬은 "평가자=산술"로 합리화 방지 효과를 달성.
- PPTX 슬라이드 마스터/테마 포함 완전 패키지, HTML 실렌더링 bbox·이미지 영역 CV 자동추출(브라우저/캔버스 의존).

## 9. Neuro-Symbolic 결합 seam (구현됨)

aesthete는 **기호(symbolic)·결정론 기하 코어**다. 여기에 **신경(neural) 미학 평가자**(MLLM/CLIP IAA)의 점수를 **외부 JSON으로 주입**받아 가중 Sprint Contract로 결합하는 seam을 구현했다(`lib/neural.mjs`) — 순수 JS 본령(코어는 모델 미호출)을 유지하면서 기하가 닿지 못하는 **주관적 무드·래스터 이미지 미학**을 보강한다.

**규약**: 신경 축의 skill id는 `_` 접두어(예: `_neural.clip`). 외부 평가자(Claude/CLIP)가 JSON으로 점수를 내면 aesthete가 `report.skills`에 병합만 하고, `contract.evaluate`가 기하 점수와 동일 방식으로 가중 합산/판정.

```bash
# 외부 신경 평가자가 낸 점수 파일을 측정에 주입
bun lib/measure.mjs poster.svg --neural neural-scores.json
# neural-scores.json: { "_neural.clip": { "score": 0.82, "metrics": { "aesthetic": 0.82 } } }
# contract criterion: { "skill": "_neural.clip", "metric": "aesthetic", "op": ">=", "threshold": 0.7, "weight": 0.5 }
```

- **API**: `mergeNeural(report, scores)`(코어 불변, 새 report 반환) · `loadNeural(path)` · `neuralAxes(report)`(`_` 축만 추출).
- **래스터 이미지 연계** (§0 보조 역할): 비전/MLLM이 요소 영역을 ALT로 뽑아주면 기하가 구도를 채점 — "눈=MLLM / 자=aesthete" 분업. 신경 점수 축은 이 주관적/전체적 미학 평가를 담당.
- **E2E 학습과의 관계**: aesthete를 베이스라인+보상원으로 쓰는 학습 파이프라인은 별개 연구(§8). 본 seam은 학습 없이 **추론 단에서 기호+신경을 결합**하며, 해석 가능성을 버리지 않는다.
- **경계**: 신경 축은 **옵션** — 없어도 aesthete는 9 스킬(기하)로 완전 동작. 본 스킬 자체는 결코 모델 의존이 되지 않는다(모델 호출은 전적으로 외부).
- **outcome 정합성**: 신경 미충족은 `outcome=best-effort` + `stoppedReason: neural-criteria-failed: …`로 표현된다(`applyNeuralGate`). `pass|best-effort|no-improvement|budget-exhausted` enum **밖의 값**(예: `best-effort(neural)`)은 내지 않는다. CLI `score`는 순수 기하 가중 점수(`report.summary.overallScore`, 신경 축 미포함) — `geometryScore`로 표기.

### ALT = 기호 프로그램 (program-synthesis 렌즈)

추상 레이아웃 트리(ALT)는 레이아웃에 대한 **결정론적 기호 프로그램**이다 — 각 노드는 좌표·스타일 토큰을 가진 명제이고, 스킬들은 그 프로그램의 **정적 검증기** 역할을 한다. 이는 neuro-symbolic program synthesis 관점(Stanford, *Bridging Design and Fabrication via Neuro-Symbolic Visual Program Synthesis*)과 합치: 신경(MLLM/CLIP)은 raw 입력을 이해하고, **aesthete는 그 결과물(ALT)을 기호 프로그램으로 검증·보정**한다. export는 프로그램 합성의 출력(SVG/HTML/PPTX)이다.

### 연구 근거 (Neuro-Symbolic)

- *Design Patterns for LLM-based Neuro-Symbolic Systems* (2025) — boxology/모듈 아키텍처. 멀티에이전트+스킬 그래프 재설계 시 레퍼런스.
- *Unlocking the Potential of Generative AI through Neuro-Symbolic AI* (arXiv, 2025) — NSAI 분류(RAG/GNN/RL/MAS 통합), 생성 디자인 사례.
- *A Roadmap Toward Neurosymbolic Approaches in AI Design* (2025–26) — 생성 디자인에서 신경→기호 표현→추론 다단계 통합의 실증.
- *Bridging Design and Fabrication via Neuro-Symbolic Visual Program Synthesis* (Stanford) — raw shape→vector CAD/layout 프로그램 합성. **ALT=기호 프로그램** 근거.
- *Neuro-Symbolic Generative Art* (Meta AI, 2020) — 신경 생성+기호 제약 하이브리드; human study에서 창의성 더 높음. 미학+제약 구도의 고전 근거.

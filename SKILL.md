---
name: aesthete
description: 레이아웃의 인지 미학을 기하학으로 측정하고 결정론적으로 보정하는 폐루프 엔진. SVG·PPTX·OOXML(docx/xlsx)·HTML·Image를 Abstract Layout Tree(ALT)로 통일해서 9개 인지 스킬(근접성·여백·균형·계층·색조화·유사성·유창성·충돌·경계)이 같은 수식으로 평가하고, Sprint Contract(동결 루브릭) 대항 PASS/FAIL 판정 후 자동보정. 평가자는 LLM이 아니라 산술이라 합리화 불가. 트리거 — "레이아웃 미학 검사/평가해줘", "이 디자인 균형/여백/정렬 점검", "SVG/PPTX/HTML 레이아웃 보정해줘", "근접성·대칭·여백 분석", "/aesthete".
license: "SEE LICENSE IN LICENSE"
metadata:
  version: "1.0"
---

# Aesthete

레이아웃(미학) → **ALT(Abstract Layout Tree)** → 결정론적 측정·폐루프 보정. 측정·평가·보정이 전부 순수 기하학 수학(브라우저 없음). pateo의 "결정론적 렌더러" 원칙을 평가·보정까지 밀어붙인 형태.

## 핵심 (눈짐작과의 결별)
- **Claude는 미학을 '느낌'으로 판단하지 않는다.** 측정 엔진(`lib/measure.mjs`)이 기하학으로 점수를 내고 `lib/fix.mjs`가 결정론적으로 보정한다. (구 방식: LLM이 직관으로 "괜찮아 보인다" 사후 합리화 → 평가 일관성 붕괴. 본 스킬: 산술이 판정한다.)
- **평가자는 LLM이 아니라 수식이다.** Sprint Contract(동결 루브릭)과 보고서만 비교하므로 제안서의 "평가자 합리화(Evaluator Rationalization)"가 구조적으로 불가능.
- **결정론적** → 품질 일관, golden 테스트, git diff friendly. `Date.now()`/`Math.random()` 금지.
- **도메인 불가지론**: 측정 코어는 ALT만 본다. SVG·PPTX·docx·xlsx·HTML·Image는 어댑터가 ALT로 변환. 새 도메인 = 어댑터 한 쌍 추가(코어 수정 없음).

## Setup (1회)
```bash
bun install   # ajv — 스키마 검증용. 없어도 동작(검증만 스킵, 친절한 실패).
```

## 워크플로우
0. **전처리(Preflight, 옵션)** ★ — 생성 *전*: `bun lib/preflight.mjs <brief.json> [--contract c.json] [--diversify [log.json]]`. artifact type(dashboard/marketing/report/diagram/poster)에서 **타입별 튠 contract + 기하 budget + 구조 선행사(structure) + 금지 기본값(negation)**을 결정론적으로 뽑는다. `--contract`로 뽑은 루브릭을 아래 5단계 fix에 그대로 먹이면 **사전 목표 = 사후 기준**(같은 contract). **구조 pick 우선순위**: brief 신호(`inferStructure` — "manifesto/선언"→manifesto, "bento"→bento, "계층/아키텍처"→layered ...) > `--diversify` 회전(`.aesthete/log.json`에서 직전 동일 타입과 다른 구조) > 결정론 index 0. brief가 구조를 시사하면 그게 이긴다(강제 다양화가 품질 깎는 FP 방지); 조용하면 회전. 본령은 사후지만, 같은 기하 수식을 생성 전 목표로 출력하는 짝. 자세히 `DESIGN.md` §0.1.
   - **structure 사후 검증 (`lib/structure.mjs`)**: 각 구조 선행사는 기하 **서명**(노드 수·면적 분산·열/행 클러스터·최대 노드 지배력·여백률)을 가진다. `classifyStructure(alt)` / `verifyStructure(alt, id)`로 생성된 레이아웃이 요청받은 구조를 만족하는지 결정론 검증 — contract의 기하 임계치와 마찬가지로 **"사전 목표 = 사후 기준" 루프가 구조 축에도 닫힘**. **정직한 범위**: 서명은 형상의 *기하 본질*을 검증하지 풀 템플릿 매치는 아님; 명확하지 않으면 `unknown` + metrics 반환(강제 라벨링 안 함).
1. **추출(Observe)** — 대상을 ALT로. 직접 작성(`schemas/alt.schema.json`)하거나 어댑터가 자동 변환(아래 도메인 표). 각 노드는 `bbox{x,y,w,h}` + 선택 `style`/`category`/`kind`.
2. **계약(Contract)** — brief로 Sprint Contract 작성·동결(`examples/catalog.contract.json`). 평가자는 이 파일과 보고서만 본다.
3. **측정(Measure)** — `bun lib/measure.mjs <file> [report.json] [--profile <name>]`. 확장자로 도메인 자동 감지. 9스킬 실행 → `report.json`. `--profile`로 해당 튜닝 파라미터 적용.
4. **진단(Diagnose)** — `lib/graph.mjs`가 위반을 우선순위(P0 충돌/경계 > P1 계층 > P2 균형/근접/여백)로 정렬, 충돌 엣지(proximity↔whitespace 등) 중재. 보조로 `bun lib/vuln.mjs <file>` — continuum 점수 말고 **이산 known-bad 패턴**(no-focal·no-rhythm·type-accident·rainbow·even-split·ai-cliche·hanging-header)을 탐지하는 negation 엔진. `measure-only` read-only, 발견은 전부 `suggestionOnly`. 층마다 허용/금지/성공의 진실은 `lib/profiles.mjs`(DESIGN §0.2).
5. **보정(Fix)** ★ — `bun lib/fix.mjs <file> --contract <c.json> [--max-iters N] [--emit svg|html|pptx|alt] [--neural scores.json] [--profile <name>]`. 6패치 + 단조 개선 게이트(진동 차단)로 폐루프. 결과 enum(`pass|best-effort|no-improvement|budget-exhausted`) + `*.fix-log.json`. `--neural`은 외부 신경 점수를 병합해 미충족 시 `outcome=best-effort` + `stoppedReason: neural-criteria-failed`(재생성 권고, enum 위반 값 없음). CLI 점수는 순수 기하(`geometryScore`).
6. **재측정 폐루프(Loop)** ★ — measure → resolve → patch → re-measure. contract 통과 or 비진행 시 정지(최저 위반 스냅샷 반환).
7. **버전 스냅샷** ★ — 보정 전 `versions/vNN-pre.json` 보존.
8. **재출력(Emit)** ★ — 보정된 ALT를 원 도메인(또는 `--emit`)으로. `fix.mjs --emit` 또는 어댑터 직접 사용.

## 9 인지 스킬
| 스킬 | 측정(어떻게) | 인지 효과(왜) | 우선순위 |
|---|---|---|---|
| `collision` | 쌍별 bbox 겹침. metric `count` | figure-ground 분리·saccade 안정화 | P0 |
| `boundary` | 캔버스 이탈. metric `overflowCount` | 게슈탈트 폐쇄성·인지 단절 방지 | P0 |
| `hierarchy` | 폰트 스케일 단위성 × WCAG 대비. metric `clarity` | Treisman FIT visual search 단축 | P1 |
| `balance` | Ngo 대칭균형 BM(`Σ a·c·s·d`). metric `BM` | 광학 평형·정서 안정(Ngo 2001) | P2 |
| `proximity` | RANG + PDL(`P_group`). metric `fragmentedCount`/`falseAdjacencyCount` | 게슈탈트 근접 군집화·유창성(Wertheimer) | P2 |
| `whitespace` | 점유 쿼드트리. metric `freeRatio` | 처리 유창성·cognitive load 감소(Reber) | P2 |
| `harmony` | 보색 모멘트 평형 + analogous. metric `harmonyScore` | 색채 피로 감소(Birkhoff/Munsell) | P2 |
| `similarity` | 같은 그룹+종류의 시각 일관성. metric `inconsistentGroups` | 게슈탈트 유사성 군집화 강화 | P2 |
| `fluency` | 읽기 흐름(Z/F-pattern) + 크기-중요도 기울기. metric `fluency` | 처리 유창성↑(Reber 2004)·이해·회상 | P2 |

## 스킬 관계 그래프 (3관계)
`lib/graph.mjs`가 **priority**(tier 위계) · **conflict**(동적 보상 가중치, freeRatio 비례 감쇠) · **influence**(hierarchy→proximity 상향 전이) 세 관계를 선언적 엣지 데이터로 정의. 충돌 시 hard threshold가 아닌 **연속 보상 곡선**(`compensationFactor`)으로 타협. `GRAPH` 객체 export로 시각화·확장 가능(새 스킬 = 노드+엣지 추가).

## 자가진화 + 토큰 샌드박스 (제안서 피드백/토큰 절)
- `bun lib/tune.mjs <before.json> <after.json> --apply` ★ — 사용자 편집 전후 diff → 근접성 α·FRAG_FACTOR 자율 튜닝(`skill-params.json` 역전파, 코드 수정 없이).
- `bun lib/lint.mjs <file>` ★ — 토큰 샌드박싱 CI 게이트. 승인 색/폰트만 허용, 임의 핵사·오프셋 위반 시 exit 1(거부).

## 디자인 스펙 하네스 (@design) — 프론트메타 자동화
`bun lib/harness.mjs <file>` ★ — HTML 선두의 `<!-- @design {...} -->` 프론트메타(또는 sidecar `design.json`)에서 **palette·fontScale·시맨틱 토큰**을 읽어, 인지 스킬(9개) 측정 + **디자인 토큰 준수 lint**를 한 번에. HTML은 선언된 팔레트/토큰을 위반(허용밖 hex·옵션외 폰트)하면 REJECT(exit 1). HTML export는 `:root` CSS 변수(`--color-*`/`--font-*`)로 시맨틱 토큰을 **적극 사용**(임의 hex 대신 `var(--color-primary)`).
```html
<!-- @design { "palette":["#1A73E8","#111827","#FFFFFF"], "fontScale":[16,24,32],
              "tokens":{"color":{"primary":"#1A73E8","text":"#111827"}} } -->
```

## 도메인 어댑터 (전 도메인, 순수 JS)
| 도메인 | import → ALT | export ALT → | 비고 |
|---|---|---|---|
| `svg` | XML→bbox(rect/circle/text/g+translate) ✓ | ✓(재출력) | 텍스트 폭은 폰트크기×추정치. export는 **ALT 재출력**(원본 패치 아님) — circle/ellipse/rect 보존, `<path>` Bézier·gradient·transform·stroke는 bbox-rect로 평탄화 ⚠ |
| `html` | 명시 기하(data-x 또는 position:absolute) ✓ | ✓(절대좌표 div) | 실 CSS 플렉스/그리드는 브라우저 필요 ⚠ |
| `pptx` | .pptx(zip)→슬라이드 a:off/a:ext(EMU) ✓ | ✓(최소 패키지) | import 결정론적. export는 단일 슬라이드 최소 패키지(마스터·테마·미디어·차트 미포함, shape는 rect) ⚠ |
| `docx`/`xlsx` | 본문/셀 → 흐름·격자 ALT(최선) | — | 절대 좌표 없음, 근사 ⚠ |
| `image` | 헤더에서 캔버스 크기 ✓; **영역은 선언 필요** | — | 픽셀 분할은 CV 필요 ⚠ |
| `alt` | JSON(네이티브) | ✓ | 캐노니컬 입력 |

## Cardinal Rule (Design Tokens / 샌드박싱)
에이전트가 임의 핵사코드/오프셋를 하드코딩하는 "탈출구"는 미학 붕괴의 주원인. 본 스킬은 측정·보정을 **기하 토큰**(bbox 단위)으로만 다룬다. 색상·타이포 토큰 샌드박싱과 DESIGN.md 계약서 규격은 `DESIGN.md` 참조.

## 제약(정직한 한계)
- P0: 이탈(boundary)은 보정 후 항상 0(클램프). 충돌(collision)은 **비겹침 배치가 가능한 입력**에서 0 — 물리적으로 안 겹칠 수 없는 입력(캔버스 대비 합산 면적 과대 등)에선 잔존 충돌이 `collision.count`에 남는다(**"항상 0" 아님, best-effort**). P2(균형·근접)도 best-effort — `outcome`으로 솔직 보고.
- HTML 실렌더링 bbox·이미지 영역 자동추출은 브라우저/CV 필요 → 본 스킬은 순수 JS 한계를 메타에 명시.
- 근접성은 **그룹 의미(category)가 선언된 경우에만** 측정. 의미 없는 임포트(pptx 등)는 `skipped`.
- **측정 coverage·점수 분리**: 측정 못 한 축(proximity skip·similarity no-groups·예외)은 `coverage: unmeasurable`이 되고 종합 점수를 부풀리지 않음. 보고서 `summary` = `hardIntegrityScore`(P0) · `measuredAestheticScore`(측정 축만) · `coverageScore`(측정 비율). `overallScore`는 legacy 포함값. 각 `fix.mode` = `autoFixable`(기하 fixer 적용) · `suggestionOnly`(폰트/색/의미 — 인간·재생성). 자세히 `DESIGN.md` §4.2.

## 참조
- 스킬/수학: `lib/skills/*.mjs`(collision/boundary/hierarchy/balance/proximity/whitespace/harmony), `lib/{geometry,color,similarity,quadtree}.mjs`
- 오케스트레이션: `lib/measure.mjs`, `lib/contract.mjs`, `lib/graph.mjs`, `lib/fix.mjs`, `lib/preflight.mjs`(사전 생성 — 구조 선행사+budget+negation+contract), `lib/structure.mjs`(구조 분류/검증 — 서명 기반), `lib/diversify.mjs`(.aesthete/log.json 구조 회전)
- 자가진화·토큰·신경·하네스: `lib/tune.mjs`, `lib/lint.mjs`, `lib/tokens.mjs`, `lib/skill-params.mjs`, `lib/neural.mjs`(neuro-symbolic gate), `lib/harness.mjs`(@design 자동화), `lib/designspec.mjs`
- 어댑터: `lib/adapters/{svg,html,pptx,ooxml,image,index,xml,zip,emu}.mjs`
- 스키마: `schemas/{common,alt,contract,report}.schema.json`
- 예제: `examples/catalog-{good,bad,fixable}.layout.json`, `examples/catalog.contract.json`
- 테스트: `test/*.test.mjs`, `test/golden.mjs` (`bun run test` = golden + 단위테스트; `bun test` = 단위만)
- 설계 계약서: `DESIGN.md`

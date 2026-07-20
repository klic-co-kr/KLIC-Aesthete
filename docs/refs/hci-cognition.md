# HCI · 인지 근거 맵 (Aesthete)

에이전트/리뷰어용 **짧은 이론 치트시트**. 수학 상세는 [`DESIGN.md` §2–§3](../../DESIGN.md).  
논문 서지·DOI는 [`README.md` 참조 논문](../../README.md#참조-논문-cognitive-psychology--computational-aesthetics)과 동기화.

> **정직 고지:** 아래 이론은 엔진 수식의 *동기(motivation)* 이다.  
> hand-crafted 미학 공식 ≠ 인간 미학 판정의 증명. 경험 검증은 `validate.mjs` + 인간 corpus 트랙.

---

## 1. 이론 → 스킬 / decision code

| 태그 | 이론 한 줄 | 엔진 연결 | 대표 reasons.code |
|---|---|---|---|
| `gestalt.proximity` | 가까운 요소는 한 덩어리로 지각 | `proximity` (RANG/PDL) | (P2 metric) |
| `gestalt.similarity` | 비슷한 것은 같이 묶임 | `similarity` | (P2) |
| `gestalt.closure` / figure-ground | 닫힌 형태·분리된 전경 | `boundary`, `collision` | `P0_BOUNDARY`, `P0_COLLISION` |
| `fluency` | 처리가 쉬울수록 호감·이해↑ (한계: over-fluency) | `whitespace`, `fluency`, type scale | `CONTRACT_FAIL` (freeRatio 등) |
| `CLT.extraneous` | 불필요 부하(겹침·이탈·잡음) 제거 | P0 hard + clutter 계열 | `P0_*`, structure fail |
| `hierarchy` / FIT | 특징 통합·검색 비용; 계층이 명확하면 탐색↓ | `hierarchy` (clarity) | contract hierarchy |
| `keyhole` | 대시보드: 한 뷰에 보이는 청크 수 제한 | preflight dashboard optional | pre only |
| `harmony.order` | 질서/복잡도 균형 (Birkhoff M=O/C) | `harmony` | (P2) |

### SlideAudit 계열 → 기존 `vuln` id (맵핑만, 신규 시그니처 없음)

| 느슨한 카테고리 | vuln id (구현됨) | 노트 |
|---|---|---|
| no focal / flat | `no-focal` | type=dashboard 시 억제 가능 |
| rainbow / AI cliché palette | `ai-cliche-palette`, rainbow 계열 | color coverage 필요 |
| type accident | `type-scale-accident` | text coverage |
| hanging header | `hanging-header` | diagram 억제 |
| even split / no rhythm | `even-split`, `no-rhythm` | advisory |

vuln 기본은 **advisory**. decision에 넣으려면 `skill-post --vuln-gate`.

---

## 2. 핵심 논문 (짧은 요약)

### Gestalt (Wertheimer 1923)
근접·유사·폐쇄 등 지각 조직화 법칙.  
→ `proximity` / `similarity` / boundary·collision의 figure-ground 서사.

### Ngo et al. — Aesthetic Measures for Graphic Screens (JISE, ~2000/2001)
스크린 UI에 대한 다수 aesthetic measure; 본 엔진 **balance BM**의 직접 조상.  
DOI: [10.1688/JISE.2000.16.1.6](https://doi.org/10.1688/JISE.2000.16.1.6) · [JISE full text](https://jise.iis.sinica.edu.tw/JISESearch/fullText?pId=1324&code=FFAD81F325CD6DC)

### Processing Fluency (Reber, Schwarz, Winkielman 2004)
처리 유창성 → 미적 쾌감. DOI: [10.1207/s15327957pspr0804_3](https://doi.org/10.1207/s15327957pspr0804_3) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/15582859/) · [USC PDF](https://dornsife.usc.edu/norbert-schwarz/wp-content/uploads/sites/231/2023/11/04_pspr_reber_et_al_beauty.pdf)

### Feature Integration Theory (Treisman & Gelade 1980)
주의·특징 통합. DOI: [10.1016/0010-0285(80)90005-5](https://doi.org/10.1016/0010-0285(80)90005-5) · [PubMed](https://pubmed.ncbi.nlm.nih.gov/7351125/)  
→ hierarchy / visual search 서사.

### Cognitive Load Theory (Sweller 1988+)
외재 부하 최소화. Sweller (1988) *Cognitive Science* 12(2).  
[Wiley abstract](https://onlinelibrary.wiley.com/doi/abs/10.1207/s15516709cog1202_4)  
→ collision/boundary/clutter를 “외재 부하”로 읽는 다리 (CLT 태그).

### Birkhoff (1933) Aesthetic Measure
M = O/C. 질서·복잡도 균형 — harmony / over-fluency 경고와 정합.

### Topolinski & Strack (2009) Motor fluency
운동·감각 유창성 확장 — `fluency` 스킬 동기 보조.

### Ratcliff/Obershelp (Gestalt pattern matching)
문자열 유사도 알고리즘(Dr. Dobb’s 1988 계열). 엔진 similarity 계열 구현 참조.  
[Wikipedia: Gestalt pattern matching](https://en.wikipedia.org/wiki/Gestalt_pattern_matching)

---

## 3. decision 우선순위와의 정합

P0 hard (collision/boundary) = **가독성 전제** — fluency/CLT extraneous의 바닥.  
P2 aesthetic = 취향·밀도·조화 — contract opt-in / regenerate 권고.  
자세한 fold: `lib/skill-decision.mjs` + PRD §4.4.

---

## 4. 하지 않는 주장

1. ρ 또는 공식 점수가 “아름다움의 진리”다.  
2. VLM 점수 = SSOT.  
3. SlideAudit 논문 전체를 재구현했다 (맵핑표만).  
4. Ngo의 14 measure 전부 구현 (BM balance 중심 차용).

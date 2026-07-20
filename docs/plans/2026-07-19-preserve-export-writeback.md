# PLAN — Preserve Export (Source Write-Back)

| 항목 | 값 |
|---|---|
| 상태 | **Draft → Ready for implement** |
| 일자 | 2026-07-19 |
| 범위 | KLIC-Aesthete only |
| 관련 | `DESIGN.md` §5·§8, `lib/adapters/*`, `lib/fix.mjs`, `lib/emit.mjs`, `schemas/alt.schema.json` |
| 승자 해법 | **S1 Source-Overlay Write-Back** (lossy preview 유지, full rewriter 기각) |

---

## 0. 한 줄 목표

> **fix가 바꾼 것은 bbox뿐이다. 납품 파일은 원본을 복사한 뒤 기하 attr만 갱신한다.**  
> 측정 SSOT는 계속 ALT. “원본 재합성(export)”과 “원본 보존(write-back)”을 분리한다.

---

## 1. 문제 (해결 대상 — 증명 아님, 계약)

현재 `export*`는 **ALT 재합성**이다. ALT 스키마에 path `d`·OOXML part·마스터·미디어가 없으므로:

| 도메인 | 현행 emit | 사용자 기대와 충돌 |
|---|---|---|
| SVG | path/line → bbox rounded-rect; gradient/transform/stroke 세부 손실 | 아이콘·일러스트 납품 |
| HTML | 절대좌표 div만 | flex/grid 원본 유지 |
| PPTX | 단일 슬라이드 최소 패키지, shape=rect | 마스터·테마·미디어·차트 유지 |
| docx/xlsx | export 없음 | (범위: 유지 또는 edits-only) |
| image | export 없음 | (범위 밖 유지) |
| ALT | 완전 | 문제 없음 |

`fix.mjs` 패치는 **bbox translate/clamp/scale**만 수행한다.  
정보 이론상 납품에 필요한 추가 신호는 `Δbbox` + **원본 바이트**이면 충분하다.  
→ 풀 라이터(S4)는 과잉. 스키마에 전 도메인 blob을 싣는 전면 native(S2 full)도 과잉.

---

## 2. 비목표 (명시적 제외)

1. PPTX/SVG **풀 에디터**·마스터 생성·차트 재생성  
2. 측정 코어가 native path/OOXML을 직접 해석하도록 오염  
3. 기본 경로에 headless 브라우저 강제 (HTML flex는 P2 opt-in)  
4. docx/xlsx/image를 “완전한 preserve export”로 위장  
5. ρ/미학 상관 개선 (별 트랙; 본 계획과 무관)  
6. lossy preview emit **삭제** (디버그·골든·source 없는 ALT에 필요)

---

## 3. 설계 원칙

| # | 원칙 | 함의 |
|---|---|---|
| P1 | **ALT = 측정 IR** | 스킬·contract·fix 입력 불변 |
| P2 | **Original + Bind + Δbbox = 납품** | fidelity는 adapter write-back 계층 |
| P3 | **결정론** | `Date`/`Math.random` 금지. 동일 (원본, alt', bind) → 동일 바이트 |
| P4 | **등급 정직** | `preserve` / `preview` / `edits` 삼분. 표에 거짓 ✅ 금지 |
| P5 | **최소 쓰기** | write-back은 기하 관련 attr/XML만. 그 외 part/해시 불변 |
| P6 | **실패 공개** | bind 실패·지원 불가 geom은 skip + report. 조용히 평탄화 금지(preserve 모드) |

---

## 4. 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│ importWithBind(file)                                        │
│   → { alt, bind, original: Uint8Array|string, domain }      │
└───────────────────────────┬─────────────────────────────────┘
                            │ measure / fix (기존, ALT만)
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ alt'  (bbox only mutated)                                   │
└───────────────────────────┬─────────────────────────────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                 ▼
   mode=preserve      mode=preview       mode=edits
   writeBack()        export*(alt')      toEditList()
   원본+bind+alt'     현행 lossy          ops.json
```

### 4.1 BindMap

import 시 노드마다 **원본 위치 포인터**를 남긴다. ALT 필수 스키마 밖(별 객체) — 측정 경로 비오염.

```ts
type BindMap = {
  schema_version: 1
  domain: 'svg' | 'html' | 'pptx'
  /** stable id → locator */
  entries: Record<string, BindEntry>
  /** optional content hash of original for safety */
  original_sha256?: string
}

type BindEntry =
  | {
      domain: 'svg'
      /** element identity */
      locator: { type: 'id', value: string } | { type: 'seq', value: number } | { type: 'path', value: string }
      geom: SvgGeomStrategy
      /** bbox at import time — for delta compute */
      bbox0: { x: number; y: number; w: number; h: number }
    }
  | {
      domain: 'pptx'
      part: string              // e.g. ppt/slides/slide1.xml
      shapeId: number           // cNvPr id
      geom: 'off-ext'           // a:off + a:ext
      bbox0: { x: number; y: number; w: number; h: number }
    }
  | {
      domain: 'html'
      locator: { type: 'data-id' | 'id' | 'seq'; value: string | number }
      geom: 'box-style'         // left/top/width/height (px)
      bbox0: { x: number; y: number; w: number; h: number }
    }

type SvgGeomStrategy =
  | 'xywh'           // rect, image, text(x,y)
  | 'circle'         // cx,cy,r from bbox
  | 'ellipse'        // cx,cy,rx,ry
  | 'translate-d'    // path/line: keep d; wrap or multiply translate(dx,dy)
  | 'transform-append' // existing transform + translate
```

**id 안정성:** import가 부여하는 `nodes[].id`와 bind key 1:1.  
seq locator는 DOM 순서 의존 — 원본 미변경 전제(fix는 트리 구조를 안 바꿈).

### 4.2 Write-back 알고리즘 (공통)

```
given original, bind, alt':
  assert sha optional match
  for each node in alt'.nodes:
    e = bind.entries[node.id]
    if !e: record unbound; continue
    Δ = bboxDelta(e.bbox0, node.bbox)  // dx,dy,sx,sy (sx=w'/w0 …)
    applyGeom(originalDOM_or_XML, e, node.bbox, Δ)
  serialize → bytes
  return { bytes, report: { written[], skipped[], unbound[] } }
```

**Δ 정책 (보수):**

| fix 패턴 | write-back |
|---|---|
| pure translate (w,h 불변) | 모든 strategy 안전 |
| uniform scale (그룹) | path: affine on `d` **또는** translate+scale transform; rect/circle: attr 재기록 |
| non-uniform scale | **path는 translate-only + warning**; box는 xywh 재기록 |
| clamp only | translate로 환원 |

### 4.3 도메인별 apply

#### SVG (`writeBackSvg`)
- 파서: 기존 `lib/adapters/xml.mjs` 확장 또는 문자열 안전 치환(결정론).
- `xywh`: `@x @y @width @height` 갱신  
- `circle`/`ellipse`: 중심·반지름을 bbox에서 역산  
- `translate-d` (path/line **핵심**):
  - **기본:** 요소에 `transform="translate(dx,dy)"` append (기존 transform 뒤 곱셈 규칙 문서화)
  - **옵션 P1:** `d` 좌표 일괄 평행이동(commands walker — 이미 `pathBbox` walker 재사용)
- **절대 금지(preserve):** path를 rounded-rect로 대체
- `defs` / gradient / filter: **무수정**
- group `translate` 누적은 import와 동일 규칙으로 locator 해석

#### PPTX (`writeBackPptx`)
- `readZip` → 해당 `part` XML만 파싱
- `p:cNvPr@id == shapeId` 인 `p:sp`(및 필요 시 `p:pic`) 탐색
- `a:off@x a:off@y a:ext@cx a:ext@cy` 를 `pxToEmu(bbox')` 로 기록
- **다른 모든 zip entry 바이트 동일** (stored/deflate 재압축 시 **동일 엔트리만** 재기록; 가능하면 해당 엔트리만 replace)
- 마스터·테마·미디어·차트·notes: 무수정 → **현재 “최소 패키지 export” 문제 소멸**

#### HTML (`writeBackHtml`) — P2
- `data-aesthete-id` 또는 import 시 심은 id로 노드 매칭
- `style.left/top/width/height` (px) 갱신; position 없으면 `position:absolute` 부여 여부 **옵션 플래그**(기본: 이미 절대배치된 노드만)
- flex/grid 원본 구조 유지 가능 시에만 preserve 의미 있음 → **import가 headless used-bbox일 때(P2)와 세트**

#### docx / xlsx / image
- preserve write-back **비목표**
- `mode=edits` 만 허용하거나 CLI에서 명시적 에러

### 4.4 Preview emit (현행 유지, 강등)

| 함수 | 역할 |
|---|---|
| `exportSvg` / `exportHtml` / `exportPptx` | **preview** — ALT only, lossy 허용 |
| `writeBack*` | **preserve** — 원본 필수 |

CLI·README 표:

| 도메인 | import | emit preview | emit preserve |
|---|---|---|---|
| ALT | ✅ | ✅ | ✅ |
| SVG | ✅ | ⚠️ lossy | ✅ write-back (P0) |
| HTML | ⚠️ abs / P2 headless | ⚠️ abs | ⚠️ write-back (P2) |
| PPTX | ✅ | ⚠️ minimal | ✅ write-back (P0) |
| docx/xlsx | ⚠️ approx | ❌ | ❌ |
| image | ⚠️ declared | ❌ | ❌ |

### 4.5 Edit-list (S3, 병행 API)

```json
{
  "schema_version": 1,
  "domain": "svg",
  "original_sha256": "...",
  "ops": [
    { "id": "n3", "op": "setBBox", "bbox": { "x": 10, "y": 20, "w": 40, "h": 40 } },
    { "id": "n7", "op": "translate", "dx": 12, "dy": -4 }
  ]
}
```

- `toEditList(alt0, alt1, bind?)`  
- `applyEditList(original, bind, edits)` → 내부적으로 write-back과 동일 엔진  
- 에이전트/CI가 파일 대신 패치만 옮길 때 사용

---

## 5. API · 파일 배치

### 신규
| 경로 | 책임 |
|---|---|
| `lib/adapters/bind.mjs` | BindMap 타입·sha·delta·validateBind |
| `lib/adapters/writeback-svg.mjs` | writeBackSvg |
| `lib/adapters/writeback-pptx.mjs` | writeBackPptx |
| `lib/adapters/writeback-html.mjs` | writeBackHtml (P2) |
| `lib/adapters/edits.mjs` | toEditList / applyEditList |
| `lib/writeback.mjs` | 도메인 라우팅 CLI 엔트리 |
| `schemas/bind.schema.json` | BindMap 스키마 |
| `schemas/edits.schema.json` | edit-list 스키마 |

### 수정
| 경로 | 변경 |
|---|---|
| `lib/adapters/svg.mjs` | `importSvgWithBind` (또는 import 옵션 `{ bind:true }`) |
| `lib/adapters/pptx.mjs` | 동상; shapeId를 노드 id/메타와 정렬 |
| `lib/adapters/html.mjs` | 동상 + data-id 심기 옵션 |
| `lib/adapters/index.mjs` | `importPathWithBind`, `writeBack`, emit mode 분기 |
| `lib/fix.mjs` | `--emit preserve` 시 original+bind 필요; 없으면 fail soft→preview 금지 옵션 |
| `lib/emit.mjs` | `--mode preserve\|preview\|edits` |
| `lib/diffview.mjs` | preserve 경로 옵션(원본 좌/우 비교) |
| `README.md` / `SKILL.md` / `DESIGN.md` §5 | 3열 표 + write-back 계약 |
| `test/adapters.test.mjs` + `test/writeback.test.mjs` | 아래 수락 기준 |

### 스키마 정책
- **ALT 필수 필드 불변** (`additionalProperties: false` 유지)
- native blob **전면 확장 안 함** (P0)
- P1 optional: SVG only `nodes[].native.svg.d` **optional 필드** — source 없는 ALT-only path preview용. preserve 기본 경로와 독립

---

## 6. CLI 계약

```bash
# 기존 (preview 명시)
bun lib/emit.mjs layout.json out.svg --mode preview

# 신규 preserve
bun lib/fix.mjs poster.svg --contract c.json --emit preserve --out poster.fixed.svg
# 내부: importWithBind → fix → writeBack → out

bun lib/writeback.mjs poster.svg poster.fixed.alt.json --bind poster.bind.json -o poster.out.svg

# edits only
bun lib/fix.mjs poster.svg --contract c.json --emit edits -o poster.edits.json
```

**Exit code**
- preserve 성공: 0  
- bind 부분 실패 but written≥1: 0 + stderr summary (또는 `--strict-bind` 시 1)  
- original 없음 + preserve 요청: **1** (preview로 조용히 폴백 금지 — 정직)  
- domain 미지원 preserve: **1**

---

## 7. 페이즈 · 일정 단위

### P0 — MVP (필수, 이 계획이 “됐다”의 최소)
1. BindMap + schemas  
2. `importSvgWithBind` / `importPptxWithBind`  
3. `writeBackSvg` (rect/circle/ellipse/text + **path translate-transform**)  
4. `writeBackPptx` (off/ext only, 타 part 불변)  
5. CLI `--emit preserve` on `fix` / `writeback.mjs`  
6. 테스트 (§8)  
7. README/SKILL/DESIGN 표 3열 개정  

**완료 정의:** §8.1–8.2 테스트 전부.

### P1 — Path·API 강화
1. path `d` parallel translate (transform 대신/추가)  
2. uniform scale 그룹 → transform `translate scale` 또는 d-affine  
3. `edits` emit/apply  
4. optional `native.svg.d` (ALT-only workflow)  
5. bind report JSON 표준화  

### P2 — HTML
1. opt-in headless used-bbox import (`playwright-core`, profile 플래그)  
2. `writeBackHtml`  
3. 기본 pure 경로 유지, DESIGN에 “브라우저 없음 = 기본” 재확인  

### P3 — 정리
1. preview 함수 이름 deprecate 경고 (`export*` → `previewExport*`)  
2. diffview preserve 모드  
3. golden에 write-back fixture 추가  

---

## 8. 수락 기준 (Acceptance)

### 8.1 SVG path 보존
```
given: lucide-style SVG with <path d="..."> fill=none stroke=...
when:  importWithBind → move one icon bbox by (+10,+0) via fix/manual → writeBack
then:
  - output path @d equals input @d  (or transform-only; d unchanged)
  - stroke/fill/opacity unchanged
  - re-import bbox center x increased ≈ 10 (±0.5px)
```

### 8.2 PPTX part 불변
```
given: pptx with ≥1 image or chart part (or any non-slide part)
when:  writeBack after bbox clamp
then:
  - sha256 of every zip entry except modified slide XML == original
  - slide shape off/ext reflect new bbox (EMU)
  - re-import geometry matches alt' (±1px)
```

### 8.3 Preview 회귀
```
existing adapters.test export→import round-trips still pass (preview path)
```

### 8.4 정직 실패
```
fix --emit preserve without original → exit 1, message explains need for source
```

### 8.5 결정론
```
same inputs twice → byte-identical write-back output
```

---

## 9. 테스트 계획

| 파일 | 내용 |
|---|---|
| `test/writeback.test.mjs` | 8.1–8.5 |
| `test/bind.test.mjs` | locator 안정성, 누락 id, sha mismatch |
| `examples/writeback/` | `icon-path.svg`, `mini-media.pptx` (소형 fixture; LFS 금지 작은 파일) |
| 기존 `test/adapters.test.mjs` | preview 회귀 |

Fixture 생성: 합성 최소 pptx(기존 `exportPptx`로 만든 뒤 media 엔트리 하나 수동 zip insert) 또는 초소형 고정 바이너리.

---

## 10. 리스크 · 대응

| 리스크 | 영향 | 대응 |
|---|---|---|
| SVG transform 곱셈 순서 | 위치 오차 | import와 동일한 translate 누적 규칙 문서화 + 수치 테스트 |
| path + non-uniform scale | 형태 왜곡 | P0는 translate-only; scale 시 skip+report |
| PPTX 재압축으로 타 엔트리 변경 | “불변” 깨짐 | 엔트리 단위 replace; 미수정 entry raw 재사용 (`zip.mjs` 확장) |
| shapeId 충돌/그룹 spTree | bind 실패 | grpSp 자식 walk; 실패는 unbound |
| HTML cascade | write-back 무의미 | P2에서 abs/headless만 preserve 허용 |
| 스키마 확장 압박 | 코어 오염 | native는 optional·SVG only·P1 이후 |

---

## 11. 문서 변경 체크리스트

- [ ] `README.md` 도메인 표 → 3열 (import / preview / preserve)  
- [ ] `SKILL.md` 워크플로 5–8단계에 preserve emit  
- [ ] `DESIGN.md` §5: “export = 재출력” 문단을 **preview vs preserve** 로 개정; §8 범위 밖 목록에서 “preserve write-back”은 본령으로 승격  
- [ ] `package.json` scripts: `"writeback": "bun lib/writeback.mjs"`  
- [ ] 본 계획서 상태 → `Implemented` 시 체크

---

## 12. 구현 순서 (개발 체크리스트)

```
[ ] 1. schemas/bind.schema.json + edits.schema.json
[ ] 2. lib/adapters/bind.mjs (delta, sha256, validate)
[ ] 3. svg importWithBind + writeBackSvg (rect/circle/ellipse/text)
[ ] 4. svg path translate-transform write-back + test 8.1
[ ] 5. pptx importWithBind + writeBackPptx + zip entry preserve + test 8.2
[ ] 6. lib/writeback.mjs CLI + fix.mjs --emit preserve
[ ] 7. docs 표 개정 (README/SKILL/DESIGN)
[ ] 8. P1: edits + d-translate + optional native.d
[ ] 9. P2: html headless import + writeBackHtml
```

---

## 13. 성공 한 줄

**Preserve 모드에서 SVG path 아이콘과 미디어 포함 PPTX를 돌려줬을 때,  
미학 fix는 bbox만 바꿨고 나머지 바이트·벡터 표현은 살아 있다.**

preview lossy는 남는다. 다만 그것은 **납품 기본값이 아니다.**

---

## 14. 부록 — 기각된 대안 (기록)

| 코드 | 대안 | 기각 사유 |
|---|---|---|
| S4 | Full domain writer | 범위 폭발, fix 정보량과 불일치 |
| S2-full | ALT에 OOXML/SVG 전체 적재 | IR 오염, 사실상 덤프 저장소 |
| S3-only | edit-list만, apply 없음 | 사용자 납품 미완 |
| “더 좋은 bbox→path 추론” | 정보 창조 | 수학적으로 불가에 가깝고 사기 위험 |

**채택 조합:** S1(본) + S3(API) + S2-SVG-thin(P1 optional) + S5(P2 HTML import)

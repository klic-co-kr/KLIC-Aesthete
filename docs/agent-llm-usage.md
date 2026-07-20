# LLM / 에이전트 — Aesthete 사용법 (뻘짓 방지)

이 문서만 읽고 따라도 됨. `DESIGN.md` 장문 읽지 말 것.

**한 줄:** 너는 **생성·손(fix 실행·파일 이동)** 만 한다. **판정은 Aesthete 산술**이 한다.

---

## 0. 역할 분담

| 역할 | 누가 | 하지 말 것 |
|---|---|---|
| 미학 점수·PASS/FAIL·다음 행동 | **Aesthete** (`skill-post` → `decision`) | LLM이 “좀 예뻐 보인다”로 덮어쓰기 |
| 레이아웃 생성 (PPT/SVG/HTML…) | **외부 생성기** 또는 너 | Aesthete에게 그려 달라고 하기 |
| bbox 기하 보정 | 네가 `fix.mjs` **실행** | post가 고쳐 줄 거라 기대 |
| 원본 path/마스터 보존 납품 | overlay 별 트랙 (기본 루프 밖) | write-back 필수인 줄 알고 막힘 |

레포 루트에서 명령 실행. 먼저 한 번:

```bash
cd /path/to/KLIC-Aesthete && bun install   # 최초 1회
```

---

## 1. 표준 루프 (이것만)

```text
[1] skill-pre  →  DIR_PRE
[2] 생성기     ← prompt_bullets.md + structure + negation (+ contract 의식)
[3] skill-post →  DIR_POST  (artifact 안 고침)
[4] decision 분기
      pass         → 끝
      fix_geometry → fix.mjs 실행 → [3] 다시 (같은 contract)
      regenerate   → [2] 다시 (최대 3회) → 초과 시 human
      human        → 사람/상위 에이전트에 올리고 끝
```

### 복사해서 쓰는 명령

```bash
REPO=.   # KLIC-Aesthete 루트
PRE=/tmp/ae-pre-$$
POST=/tmp/ae-post-$$
ART=out.layout.json          # 생성기 산출 (ALT JSON 권장)
BRIEF=examples/dashboard-brief.json   # 또는 네가 만든 brief

# ── 1) 사전 ──────────────────────────────────
bun lib/skill-pre.mjs "$BRIEF" --out-dir "$PRE"
# 생성 프롬프트에 붙일 것:
#   $PRE/prompt_bullets.md
#   (참고) jq -r .structure.id $PRE/pre.json
#   (참고) jq -r '.negation.bullets[]' $PRE/pre.json

# ── 2) 생성 ── (외부) ART 경로에 파일 생성 ──

# ── 3) 사후 ──────────────────────────────────
bun lib/skill-post.mjs "$ART" \
  --contract "$PRE/contract.json" \
  --out-dir "$POST"

DEC=$(jq -r .decision "$POST/decision.json")
echo "decision=$DEC"

# ── 4) 분기 ──────────────────────────────────
case "$DEC" in
  pass)
    echo DONE
    ;;
  fix_geometry)
    # 기본 출력: <base>.fixed.json (또는 --out 경로). 그 파일로 post 재호출
    bun lib/fix.mjs "$ART" --contract "$PRE/contract.json"
    FIXED=$(jq -r .output "${ART%.*}.fix-log.json" 2>/dev/null || ls "${ART%.*}.fixed."* 2>/dev/null | head -1)
    bun lib/skill-post.mjs "${FIXED:-$ART}" --contract "$PRE/contract.json" --out-dir "$POST"
    ;;
  regenerate)
    # 생성기 재실행 (루프 카운터 +1, 3 초과 시 human)
    ;;
  human)
    echo "ESCALATE: $(jq -c .reasons "$POST/decision.json")"
    ;;
esac
```

CI만 필요하면 post 대신:

```bash
bun lib/skill-gate.mjs "$ART" --contract "$PRE/contract.json" --out-dir "$POST"
# exit: pass=0 | fix_geometry·regenerate=1 | human·usage=2
```

---

## 2. brief.json 쓰는 법 (pre 입력)

**필수:** `artifact_type`

```json
{
  "artifact_type": "dashboard",
  "brief": "migration KPI board, 4 cards",
  "canvas": { "w": 1440, "h": 900 },
  "format": "svg",
  "audience_frequency": "daily"
}
```

| 필드 | 필수? | 값 |
|---|---|---|
| `artifact_type` | **예** | `dashboard` `marketing` `report` `diagram` `poster` (그 외 → generic) |
| `brief` | 권장 | 자연어 의도 (structure 추론에 쓰임) |
| `canvas` | 권장 | `{w,h}` |
| `format` | 옵션 | `svg` `html` `pptx` … → negation 도메인 필터 |
| `audience_frequency` | 옵션 | `daily` `weekly` `once` |

### 금지 (자주 하는 실수)

| 잘못 | 결과 |
|---|---|
| `examples/catalog-brief.json` 그대로 pre | `artifact_type` 없어 **schema fail** |
| brief 없이 preflight만 감으로 | bullets 없음 → 생성기가 허공 |
| `artifact_type` 오타만 있고 brief 김 | generic 떨어져도 동작은 함 — 타입 맞추는 게 이득 |

예제 brief: `examples/dashboard-brief.json`, `examples/marketing-brief.json`

---

## 3. decision 읽는 법 (post 출력)

파일: `$POST/decision.json`

```json
{
  "decision": "fix_geometry",
  "reasons": [{ "code": "P0_COLLISION", "tier": "P0", "fixable": true, "detail": "…" }],
  "scores": { "hardIntegrityScore": 0, "measuredAestheticScore": 0.35, "coverageScore": 1 },
  "next": { "action": "run_fix_p0", "fix_cmd": ["bun","lib/fix.mjs", "…"], "loop_hint_max": 3 },
  "paths": { "report": "…", "decision": "…" }
}
```

| `decision` | 네가 할 일 | 하지 말 일 |
|---|---|---|
| `pass` | 산출 채택, 루프 종료 | 괜히 fix/재생성 |
| `fix_geometry` | `fix.mjs` **실행** 후 **post 재호출** | “겹쳐 보이는데 패스” / post만 다시 |
| `regenerate` | 생성기 **다시** (bullets·contract 유지) | fix로 미학 점수 쥐어짜기 |
| `human` | 사람/상위에게 reasons 전달 | 무한 루프 |

### 절대 규칙

1. **`decision`을 네 취향으로 바꾸지 마.** JSON 값이 SSOT.  
2. **post는 입력 artifact를 수정하지 않음.** 고치는 건 `fix` 또는 생성기.  
3. **reasons만 읽고 “느낌 판정” 금지.** code/`next.action`만 실행.  
4. **`hardIntegrityScore` < 1 인데 pass로 우기지 마.**  
5. **`coverageScore` 낮음** = 측정 못 한 축 있음 → 만점 자랑 금지.  
6. **regenerate 최대 3회.** 그다음 `human`.  
7. **fix 한 뒤 반드시 post 다시.** fix outcome만 보고 끝내지 마.

---

## 4. 생성기에 무엇을 넣을까

pre 출력에서 **반드시** 넘길 것:

1. `$PRE/prompt_bullets.md` 전체 (또는 `pre.json` → `prompt_bullets[]`)  
2. `structure.id` (+ 가능하면 shape 문장)  
3. `negation.bullets` (금지 목록)  
4. 같은 런의 `contract.json` 경로 — **post/fix에 그대로**

생성기 산출 **권장 형식:** ALT JSON (`schemas/alt.schema.json`).  
SVG/PPTX/HTML도 import 가능. bbox 없는 “예쁜 마크다운”만 있으면 **측정 불가**.

---

## 5. 명령 치트시트 (허용 / 금지)

### 기본 루프에서 써도 됨

| 명령 | 언제 |
|---|---|
| `bun lib/skill-pre.mjs` | 생성 전 **항상** |
| `bun lib/skill-post.mjs` | 생성 후 **항상** |
| `bun lib/skill-gate.mjs` | CI |
| `bun lib/fix.mjs … --contract` | decision=`fix_geometry` 일 때만 |
| `bun lib/measure.mjs` | 디버그용 (판정은 post가 함) |

### 기본 루프에서 쓰지 마 (뻘짓 온상)

| 명령/행동 | 왜 |
|---|---|
| `lib/*.mjs` 4~6개 손으로 조합 | 순서 틀림 → **post 한 방** 써 |
| `vuln.mjs` 결과로 무조건 재생성 | advisory; 게이트는 `--vuln-gate`일 때만 |
| `--aesthetic` fix 기본 사용 | Goodhart — 점수↑ 미학↓ 가능 |
| `tune.mjs --apply` | 파라미터 오염; 대빵/명시 없이 금지 |
| `neural` / bradley-terry / harness | 기본 파이프 아님 |
| overlay write-back을 “필수”로 | 본령 아님; 납품 fidelity 별 트랙 |
| export SVG/PPTX를 무손실 납품으로 신뢰 | **lossy 재합성** — 무손실은 ALT |
| DESIGN.md 통독 후 임의 임계 창작 | contract는 pre가 준 것만 |
| catalog-good을 structure 강제 verify | 기본 off; 잘못 켜면 false fail |

### 플래그 기본값 (외우기)

| 플래그 | 기본 | 켤 때 |
|---|---|---|
| `--contract` | 꺼짐 | pre가 준 contract **켜는 걸 권장** |
| `--structure ID` | 꺼짐 | pre structure를 꼭 검증할 때만 |
| `--lint` | 꺼짐 | 토큰 샌드박스 CI |
| `--vuln-gate` | **꺼짐** | known-bad를 decision에 넣을 때만 |
| `--diversify` (pre) | 꺼짐 | 연속 생성 구조 회전할 때만 |

---

## 6. fix CLI 메모

```bash
# decision=fix_geometry 일 때
bun lib/fix.mjs "$ART" --contract "$PRE/contract.json"
# 선택: --out path 로 출력 지정. 기본은 <basename>.fixed.<ext>
```

- 기본은 **P0**(collision/boundary) 위주.  
- `--aesthetic` 넣지 마 (명시 요청 없으면).  
- 출력 파일·`*.fix-log.json` 경로를 확인한 뒤, **그 결과 파일**로 post.  
- `next.fix_cmd` 배열이 있으면 그걸 우선 참고 (경로는 환경에 맞게).

`fix` outcome (`pass|best-effort|…`) ≠ post `decision`.  
fix 끝난 뒤 **항상 post**로 최종 decision 다시 받아.

---

## 7. 미니 시나리오

### A. 슬라이드/대시보드 새로 만들기
1. brief 작성 (`artifact_type` 포함)  
2. pre → bullets를 생성 프롬프트에 붙임  
3. 생성 → ART  
4. post --contract  
5. 표대로 분기 (fix면 fix→post, regen이면 생성 재시도 ≤3)

### B. 이미 있는 SVG/PPTX “괜찮은지”만
1. pre 생략 가능 (contract 없으면 P0 중심 판정)  
2. `skill-post.mjs file.svg --out-dir …`  
3. pass / fix_geometry / regenerate / human 만 보고

### C. CI
`skill-gate.mjs` + 실패 시 로그에 `decision.json` 첨부.  
LLM 재판정 넣지 말 것.

---

## 8. 자가 점검 체크리스트 (보내기 전)

- [ ] brief에 `artifact_type` 있나  
- [ ] pre 돌렸고 `prompt_bullets`를 생성에 넣었나  
- [ ] post에 **같은** `contract.json` 넣었나  
- [ ] `decision`을 내가 덮어쓰지 않았나  
- [ ] fix_geometry면 fix **실행 후** post 재호출했나  
- [ ] regenerate ≤ 3 인가  
- [ ] “이쁘다/별로다” 문장으로 최종 판정하지 않았나  
- [ ] lossy export를 원본 보존 납품이라고 거짓말 안 했나  

---

## 9. 파일 지도 (더 읽을 때만)

| 목적 | 경로 |
|---|---|
| 이 문서 | `docs/agent-llm-usage.md` |
| 생성기 1페이지 | `docs/integration/generator-contract.md` |
| 짧은 스킬 3종 | `skills/aesthete-pre|post|gate/SKILL.md` |
| 진입 SKILL | `SKILL.md` |
| decision 스키마 | `schemas/decision.schema.json` |
| 이론 맵 (선택) | `docs/refs/hci-cognition.md` |

**끝.** 판정은 JSON, 손은 너.

# Stop Slop

문장에서 AI 티가 나는 표현을 제거하는 스킬.

<img width="3840" height="2160" alt="G-Yg4RVbIAAhVxW" src="https://github.com/user-attachments/assets/902afc15-1f40-4a9d-af24-8cd67afb8ebf" />

## 이것은 무엇인가

AI 글쓰기에는 패턴이 있다. 예측 가능한 구절, 구조, 리듬. 이 스킬은 Claude(또는 어떤 LLM이든)가 그런 패턴을 포착하고 제거하도록 가르친다.

## 스킬 구조

```
stop-slop/
├── SKILL.md              # 핵심 지시문
├── references/
│   ├── phrases.md        # 제거할 구절
│   ├── structures.md     # 피해야 할 구조적 패턴
│   └── examples.md       # 변환 전/후 예시
├── README.md
└── LICENSE
```

## 빠른 시작

**Claude Code:** 이 폴더를 스킬로 추가한다.

**Claude Projects:** `SKILL.md`와 참조 파일을 프로젝트 지식에 업로드한다.

**커스텀 지시문:** `SKILL.md`의 핵심 규칙을 복사한다.

**API 호출:** `SKILL.md`를 시스템 프롬프트에 포함한다. 참조 파일은 필요할 때 로드한다.

## 잡아내는 것

**금지된 구절** — 서론을 질질 끄는 도입, 강조를 위한 보조 표현, 비즈니스 용어, 모든 부사, 모호한 단정, 메타 코멘터리. `references/phrases.md` 참고.

**상투적인 구조** — 이분법적 대조, 부정형 나열, 극적인 단절, 수사적 설정, 거짓 주체성, 멀리서 서술하는 목소리, 수동태. `references/structures.md` 참고.

**문장 수준 규칙** — Wh- 문장 시작 금지, em dash 금지, 스타카토식 단편화 금지, 게으른 극단 표현 금지, 능동태 필수.

## 점수

각 차원을 1–10으로 평가한다:

| 차원 | 질문 |
|-----------|----------|
| 직접성 | 진술이나 발표인가? |
| 리듬 | 다양하거나 기계적으로 반복되는가? |
| 신뢰 | 독자의 지성을 존중하는가? |
| 진정성 | 사람처럼 들리는가? |
| 밀도 | 잘라낼 수 있는 부분이 있는가? |

35/50 미만이면 수정한다.

## 작성자

[Hardik Pandya](https://hvpandya.com)

## 라이선스

MIT. 자유롭게 사용하고 널리 공유하라.

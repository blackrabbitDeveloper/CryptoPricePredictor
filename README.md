# CryptoPricePredictor

> BTC / ETH 실시간 시세 + 기술적 분석 기반 가격 예측

## 🚀 Live Demo

GitHub Pages에 배포 후: `https://<username>.github.io/CryptoPricePredictor/`

## 기능

- **실시간 가격** — Binance Public API (키 불필요, rate-limit 여유)
- **72시간 차트** — Canvas 기반 미니 차트
- **1분/1일 예측** — EMA, RSI, MACD, Bollinger Bands 기반
- **30초 자동 갱신** + 메모리 캐시

## 기술 지표

| 지표 | 용도 |
|------|------|
| EMA 12/26 | 단기/장기 추세 교차 |
| RSI 14 | 과매수/과매도 판별 |
| MACD | 모멘텀 방향 및 가속도 |
| Bollinger Bands | 변동성 기반 되돌림 |

## 배포 방법

1. GitHub repo에 push
2. Settings → Pages → Source: `main` branch, `/ (root)`
3. 저장 후 1~2분 대기

## 파일 구조

```
├── index.html   # 메인 페이지
├── style.css    # 스타일
├── app.js       # API + 예측 알고리즘
└── README.md
```

## ⚠ 면책

본 예측은 기술적 분석 기반의 참고 자료이며, 투자 조언이 아닙니다.

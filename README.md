# \# CryptoPricePredictor

# 

# 비트코인(BTC) / 이더리움(ETH) 실시간 가격과 다음 \*\*1분 / 1일 예측 가격\*\*을 보여주는 GitHub Pages용 정적 웹앱입니다.

# 

# \## 주요 기능

# \- CoinGecko API 기반 실시간 시세 조회

# \- 간단한 트렌드 + 평균회귀 기반 예측 알고리즘

# &nbsp; - 1분 예측: 단기 기울기 중심

# &nbsp; - 1일 예측: 단기 기울기 + 30일 평균회귀

# \- 브라우저 메모리 + LocalStorage 캐싱으로 API 호출량 감소

# \- 1분 단위 자동 갱신

# 

# \## GitHub Pages 배포 방법

# 1\. 이 저장소를 GitHub에 푸시합니다.

# 2\. GitHub 저장소 설정 → \*\*Pages\*\*로 이동합니다.

# 3\. Build and deployment에서 Source를 \*\*Deploy from a branch\*\*로 선택합니다.

# 4\. Branch를 `main` (또는 배포 브랜치), 폴더는 `/ (root)`로 선택합니다.

# 5\. 잠시 후 `https://<github-id>.github.io/<repo-name>/` 에서 확인합니다.

# 

# \## 로컬 실행

# 정적 파일이므로 별도 빌드 없이 바로 실행할 수 있습니다.

# 

# ```bash

# python3 -m http.server 8000

# ```

# 

# 브라우저에서 `http://localhost:8000` 접속.

# 

# \## 주의

# \- 본 예측 값은 데모 목적의 단순 알고리즘 결과이며 투자 판단 근거로 사용할 수 없습니다.

# \- 무료 API 특성상 요청 제한/일시 오류가 있을 수 있습니다.


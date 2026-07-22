# 방학 일과표 앱

세 아들의 방학 일정을 일 단위/주 단위로 관리하고, 버킷리스트와 완료 과제를 퀘스트처럼 진행하는 작은 웹앱입니다.

## 주요 기능

- 로그인 화면: 관리자 또는 옥승현(hyeon1), 옥수현(hyeon2), 옥서현(hyeon3) 개인 계정 선택
- 관리자 화면: 세 아이를 전환하면서 일정과 퀘스트를 관리
- 개인 화면: 본인 일정과 공통/개인 퀘스트만 표시
- 일 보기: 구글 캘린더처럼 시간축을 드래그해 5분 단위 일정 생성
- 주 보기: 한 주의 일정과 달성률을 요약
- 퀘스트: 방학 때 해보고 싶은 것, 완료해야 하는 것, 버킷리스트를 포인트/레벨로 관리
- 서버 저장: `/api/vacation`에 저장되어 같은 Render URL로 접속하는 기기끼리 데이터를 공유

## 로컬 실행

```bash
npm start
```

기본 주소:

```text
http://localhost:4177
```

## 테스트

```bash
npm test
```

## Render 배포

Render에서 Web Service로 배포합니다.

```text
Runtime: Node
Build Command: 비워두기
Start Command: node server.js
```

또는 `render.yaml` Blueprint를 사용할 수 있습니다.

## 주의

현재 버전은 Render 서버의 파일 저장소(`data/vacation-data.json`)를 사용합니다. 무료 Web Service에서는 재시작/재배포 시 파일 저장 지속성이 보장되지 않을 수 있으므로, 장기 운영 버전에서는 PostgreSQL 또는 Supabase 같은 외부 DB 연결을 권장합니다.

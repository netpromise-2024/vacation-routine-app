# 방학 일과표 앱

세 아들의 방학 일과표를 일 단위/주 단위로 관리하고, 방학 버킷리스트와 완료 과제를 퀘스트처럼 깨는 앱입니다.

## 주요 기능

- 아이 선택: 옥승현, 옥수현, 옥서현
- 일 보기: 하루 일정 목록, 완료 체크, 예정 시간, 달성률
- 주 보기: 구글 캘린더처럼 한 주의 일정과 달성률 확인
- 5분 단위 일정 입력: 시작/종료 시간이 5분 단위로 조정됩니다.
- 퀘스트: 버킷리스트/완료 과제, 진행 수치, 목표, 포인트, 레벨
- 서버 저장: `/api/vacation`에 저장되어 같은 Render URL을 쓰는 기기끼리 데이터가 공유됩니다.

## 로컬 실행

```bash
npm start
```

기본 주소:

```text
http://localhost:4177
```

## Render 배포

Render에서 **Web Service**로 배포합니다.

```text
Runtime: Node
Build Command: 비워두기
Start Command: node server.js
```

또는 `render.yaml` Blueprint를 사용할 수 있습니다.

## 주의

현재 버전은 Render 서버의 파일 저장소(`data/vacation-data.json`)를 사용합니다. 무료 Web Service에서는 재시작/재배포 시 파일 저장 지속성이 보장되지 않을 수 있으므로, 장기 운영 버전에서는 PostgreSQL 또는 Supabase로 옮기는 것이 좋습니다.

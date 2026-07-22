# 방학 일과표 앱

세 아들의 방학 일정을 일 단위/주 단위로 관리하고, 버킷리스트와 완료 과제를 퀘스트처럼 진행하는 작은 웹앱입니다.

## 주요 기능

- 로그인 화면: 관리자 또는 옥승현(hyeon1), 옥수현(hyeon2), 옥서현(hyeon3) 개인 계정 선택
- 관리자 화면: 세 아이를 전환하면서 일정과 퀘스트를 관리
- 개인 화면: 본인 일정과 공통/개인 퀘스트만 표시
- 일 보기: 구글 캘린더처럼 시간축을 드래그해 5분 단위 일정 생성
- 주 보기: 한 주의 일정과 달성률을 요약
- 퀘스트: 방학 때 해보고 싶은 것, 완료해야 하는 것, 버킷리스트를 포인트/레벨로 관리
- Supabase 저장: Render 재시작/재배포 이후에도 일정과 완료 기록 유지

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

## Supabase 설정

Supabase 프로젝트를 만든 뒤 SQL Editor에서 `supabase.sql` 내용을 실행합니다.

```sql
create table if not exists public.vacation_app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.vacation_app_state disable row level security;
```

Render 환경변수에 아래 값을 추가합니다.

```text
SUPABASE_URL=https://프로젝트ID.supabase.co
SUPABASE_SERVICE_ROLE_KEY=Supabase Project Settings > API > service_role key
```

`SUPABASE_SERVICE_ROLE_KEY`는 서버에서만 쓰는 비밀키입니다. GitHub 코드나 브라우저 화면에 넣으면 안 됩니다.

## Render 배포

Render에서 Web Service로 배포합니다.

```text
Runtime: Node
Build Command: npm install
Start Command: node server.js
```

또는 `render.yaml` Blueprint를 사용할 수 있습니다.

## 저장 방식

환경변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 있으면 Supabase에 저장합니다. 두 값이 없으면 로컬 개발용으로 `data/vacation-data.json` 파일에 저장합니다.

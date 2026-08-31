# 현이 삼형제 주간 루틴 앱

확정된 세 아들의 주간 시간표를 기준으로, 아이가 오늘의 일정을 확인하고 실행·공부 기록을 남기는 작은 웹앱입니다.

## 아이가 사용하는 방식

- 아이는 일정을 직접 입력하지 않습니다.
- 앱은 `weekly-template.json`의 확정 시간표를 요일별로 자동 표시합니다.
- 생활·학교·예체능·휴식 블록은 `완료` 한 번으로 기록합니다.
- 공부 블록은 `공부 시작` → `공부 마침` → `오늘 한 공부` 한 줄 기록으로 완료합니다.
- 부모용 화면은 기존의 예외 일정·퀘스트 관리 기능을 유지합니다.

## 시간표 업데이트

`weekly-template.json`은 확정 시간표에서 생성한 주간 반복 기준 데이터입니다. 새 시간표가 확정되면 아래 명령으로 갱신합니다.

```bash
python scripts/import-weekly-template.py
```

현재 변환 스크립트는 프로젝트 외부의 확정 A2 Excel 파일을 입력으로 사용합니다. 배포 환경에서 반복 사용하려면 원본 Excel의 보관 경로를 팀 운영 방식에 맞게 지정해야 합니다.

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

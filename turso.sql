-- Turso schema for the OK Family routine app.
-- The confirmed weekly template stays version-controlled in weekly-template.json.

create table if not exists family_app_state (
  id text primary key,
  data text not null,
  updated_at text not null
);

create table if not exists daily_checkins (
  student_id text not null,
  date text not null,
  template_id text not null,
  status text not null check (status in ('completed')),
  study_note text not null default '',
  started_at text,
  completed_at text not null,
  updated_at text not null,
  primary key (student_id, date, template_id)
);

create index if not exists daily_checkins_student_date_idx
  on daily_checkins (student_id, date);

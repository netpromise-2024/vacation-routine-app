const API = "/api/vacation";
const STORAGE_KEY = "vacation-routine-cache-v1";
const TODAY = "2026-07-22";
const app = document.querySelector("#app");

let state = {
  view: "day",
  selectedStudent: "hyeon1",
  selectedDate: TODAY,
  editingSchedule: null,
  editingQuest: null,
  syncStatus: "syncing",
  data: loadCache(),
};

let saveTimer = null;

function defaultData() {
  return {
    students: [
      { id: "hyeon1", name: "옥승현", color: "#3182f6" },
      { id: "hyeon2", name: "옥수현", color: "#03b26c" },
      { id: "hyeon3", name: "셋째 아들", color: "#8b5cf6" },
    ],
    schedules: [
      seedSchedule("hyeon1", TODAY, "09:00", "09:50", "수학 문제풀이", "study"),
      seedSchedule("hyeon1", TODAY, "10:00", "10:30", "독서", "habit"),
      seedSchedule("hyeon2", TODAY, "09:30", "10:10", "영어 단어", "study"),
      seedSchedule("hyeon3", TODAY, "10:30", "11:00", "운동", "play"),
    ],
    quests: [
      seedQuest("all", "방학 독서 5권 완주", "must", 120, 0, 5),
      seedQuest("all", "수영장 가기", "bucket", 40, 0, 1),
      seedQuest("hyeon1", "수학 심화 문제집 1권 끝내기", "must", 160, 0, 1),
    ],
  };
}

function seedSchedule(studentId, date, start, end, title, category) {
  return {
    id: cryptoId(),
    studentId,
    date,
    start,
    end,
    title,
    category,
    memo: "",
    done: false,
    updatedAt: new Date().toISOString(),
  };
}

function seedQuest(studentId, title, type, points, progress, target) {
  return {
    id: cryptoId(),
    studentId,
    title,
    type,
    points,
    progress,
    target,
    done: progress >= target,
    note: "",
    updatedAt: new Date().toISOString(),
  };
}

function cryptoId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadCache() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultData();
  } catch {
    return defaultData();
  }
}

function saveCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

async function loadRemote() {
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (!response.ok) throw new Error("API unavailable");
    const data = await response.json();
    state.data = normalizeData(data);
    state.syncStatus = "online";
    saveCache();
    render();
  } catch {
    state.syncStatus = "local";
    render();
  }
}

function normalizeData(data) {
  const fallback = defaultData();
  return {
    students: Array.isArray(data.students) && data.students.length ? data.students : fallback.students,
    schedules: Array.isArray(data.schedules) ? data.schedules : [],
    quests: Array.isArray(data.quests) ? data.quests : [],
  };
}

function scheduleSave() {
  saveCache();
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveRemote, 250);
}

async function saveRemote() {
  try {
    const response = await fetch(API, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state.data),
    });
    if (!response.ok) throw new Error("Save failed");
    state.syncStatus = "online";
  } catch {
    state.syncStatus = "local";
  }
  render();
}

function icon(name) {
  const paths = {
    day: '<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/>',
    week: '<path d="M4 6h16"/><path d="M4 12h16"/><path d="M4 18h16"/><path d="M8 6v12"/><path d="M16 6v12"/>',
    quest: '<path d="M12 2 15 8l6 .9-4.5 4.4 1.1 6.2L12 16.6 6.4 19.5l1.1-6.2L3 8.9 9 8z"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    check: '<path d="m20 6-11 11-5-5"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M6 6l1 16h10l1-16"/>',
    close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function currentStudent() {
  return state.data.students.find((student) => student.id === state.selectedStudent) || state.data.students[0];
}

function dayName(dateValue) {
  return ["일", "월", "화", "수", "목", "금", "토"][parseDate(dateValue).getDay()];
}

function parseDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDays(dateValue, days) {
  const date = parseDate(dateValue);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

function weekDates(dateValue) {
  const date = parseDate(dateValue);
  const offset = date.getDay();
  const sunday = new Date(date);
  sunday.setDate(date.getDate() - offset);
  return Array.from({ length: 7 }, (_, index) => formatDate(new Date(sunday.getFullYear(), sunday.getMonth(), sunday.getDate() + index)));
}

function shortDate(dateValue) {
  const date = parseDate(dateValue);
  return `${date.getMonth() + 1}/${date.getDate()} (${dayName(dateValue)})`;
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function duration(item) {
  return Math.max(0, timeToMinutes(item.end) - timeToMinutes(item.start));
}

function schedulesFor(studentId, date) {
  return state.data.schedules
    .filter((item) => item.studentId === studentId && item.date === date)
    .sort((a, b) => a.start.localeCompare(b.start));
}

function visibleQuests() {
  return state.data.quests.filter((quest) => quest.studentId === "all" || quest.studentId === state.selectedStudent);
}

function pointsFor(studentId) {
  return state.data.quests
    .filter((quest) => (quest.studentId === "all" || quest.studentId === studentId) && quest.done)
    .reduce((sum, quest) => sum + Number(quest.points || 0), 0);
}

function levelFor(points) {
  return Math.floor(points / 100) + 1;
}

function completionRate(items) {
  if (!items.length) return 0;
  return Math.round((items.filter((item) => item.done).length / items.length) * 100);
}

function selectStudent(id) {
  state.selectedStudent = id;
  render();
}

function switchView(view) {
  state.view = view;
  render();
}

function setDate(value) {
  state.selectedDate = value;
  render();
}

function openScheduleForm(id = "") {
  state.editingSchedule =
    state.data.schedules.find((item) => item.id === id) ||
    seedSchedule(state.selectedStudent, state.selectedDate, "09:00", "09:30", "", "study");
  render();
}

function saveSchedule(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const item = {
    id: state.editingSchedule.id || cryptoId(),
    studentId: form.get("studentId"),
    date: form.get("date"),
    start: form.get("start"),
    end: form.get("end"),
    title: form.get("title").trim(),
    category: form.get("category"),
    memo: form.get("memo").trim(),
    done: form.get("done") === "on",
    updatedAt: new Date().toISOString(),
  };

  if (!item.title) return;
  if (timeToMinutes(item.end) <= timeToMinutes(item.start)) {
    item.end = minutesToTime(timeToMinutes(item.start) + 5);
  }

  state.data.schedules = state.data.schedules.filter((schedule) => schedule.id !== item.id).concat(item);
  state.editingSchedule = null;
  scheduleSave();
  render();
}

function minutesToTime(minutes) {
  const safe = Math.max(0, Math.min(23 * 60 + 55, minutes));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function toggleSchedule(id) {
  state.data.schedules = state.data.schedules.map((item) =>
    item.id === id ? { ...item, done: !item.done, updatedAt: new Date().toISOString() } : item,
  );
  scheduleSave();
  render();
}

function deleteSchedule(id) {
  state.data.schedules = state.data.schedules.filter((item) => item.id !== id);
  state.editingSchedule = null;
  scheduleSave();
  render();
}

function openQuestForm(id = "") {
  state.editingQuest =
    state.data.quests.find((item) => item.id === id) || seedQuest(state.selectedStudent, "", "bucket", 30, 0, 1);
  render();
}

function saveQuest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const progress = Math.max(0, Math.round(Number(form.get("progress") || 0)));
  const target = Math.max(1, Math.round(Number(form.get("target") || 1)));
  const item = {
    id: state.editingQuest.id || cryptoId(),
    studentId: form.get("studentId"),
    title: form.get("title").trim(),
    type: form.get("type"),
    points: Math.max(0, Math.round(Number(form.get("points") || 0))),
    progress,
    target,
    done: progress >= target || form.get("done") === "on",
    note: form.get("note").trim(),
    updatedAt: new Date().toISOString(),
  };

  if (!item.title) return;
  state.data.quests = state.data.quests.filter((quest) => quest.id !== item.id).concat(item);
  state.editingQuest = null;
  scheduleSave();
  render();
}

function addQuestProgress(id) {
  state.data.quests = state.data.quests.map((quest) => {
    if (quest.id !== id) return quest;
    const progress = Math.min(quest.target, Number(quest.progress || 0) + 1);
    return { ...quest, progress, done: progress >= quest.target, updatedAt: new Date().toISOString() };
  });
  scheduleSave();
  render();
}

function deleteQuest(id) {
  state.data.quests = state.data.quests.filter((quest) => quest.id !== id);
  state.editingQuest = null;
  scheduleSave();
  render();
}

function closeForms() {
  state.editingSchedule = null;
  state.editingQuest = null;
  render();
}

function render() {
  const student = currentStudent();
  const dayItems = schedulesFor(student.id, state.selectedDate);
  const points = pointsFor(student.id);
  app.innerHTML = `
    <div class="app-shell">
      <header class="top">
        <div>
          <p class="eyebrow">방학 루틴</p>
          <h1>${student.name} 일과표</h1>
          <span class="sync ${state.syncStatus === "online" ? "online" : ""}">${state.syncStatus === "online" ? "서버 동기화" : state.syncStatus === "syncing" ? "동기화 확인" : "기기 저장"}</span>
        </div>
        <div class="level">
          <strong>Lv.${levelFor(points)}</strong>
          <span>${points}P</span>
        </div>
      </header>
      ${renderStudentTabs()}
      <nav class="tabs">
        ${tabButton("day", "day", "일 보기")}
        ${tabButton("week", "week", "주 보기")}
        ${tabButton("quests", "quest", "퀘스트")}
      </nav>
      <main>
        ${state.view === "week" ? renderWeek() : state.view === "quests" ? renderQuests() : renderDay(dayItems)}
      </main>
    </div>
    ${state.editingSchedule ? renderScheduleSheet() : ""}
    ${state.editingQuest ? renderQuestSheet() : ""}
  `;
}

function renderStudentTabs() {
  return `
    <section class="students">
      ${state.data.students
        .map(
          (student) => `
            <button type="button" class="${student.id === state.selectedStudent ? "active" : ""}" onclick="selectStudent('${student.id}')">
              <span>${student.name}</span>
              <small>${pointsFor(student.id)}P</small>
            </button>
          `,
        )
        .join("")}
    </section>
  `;
}

function tabButton(view, iconName, label) {
  return `
    <button type="button" class="${state.view === view ? "active" : ""}" onclick="switchView('${view}')">
      ${icon(iconName)}<span>${label}</span>
    </button>
  `;
}

function renderDay(items) {
  const rate = completionRate(items);
  return `
    <section class="toolbar">
      <input type="date" value="${state.selectedDate}" onchange="setDate(this.value)" />
      <button type="button" class="primary" onclick="openScheduleForm()">${icon("plus")}일정</button>
    </section>
    <section class="summary">
      <article><span>오늘 달성률</span><strong>${rate}%</strong><small>${items.filter((item) => item.done).length}/${items.length}개 완료</small></article>
      <article><span>예정 시간</span><strong>${items.reduce((sum, item) => sum + duration(item), 0)}분</strong><small>5분 단위 조정</small></article>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>${shortDate(state.selectedDate)}</h2>
        <span>${items.length}개 일정</span>
      </div>
      <div class="schedule-list">
        ${items.length ? items.map(renderScheduleItem).join("") : `<div class="empty">오늘 일정이 없습니다.</div>`}
      </div>
    </section>
  `;
}

function renderScheduleItem(item) {
  return `
    <article class="schedule-item ${item.done ? "done" : ""}">
      <time>${item.start}<span>${item.end}</span></time>
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <p>${categoryLabel(item.category)} · ${duration(item)}분${item.memo ? ` · ${escapeHtml(item.memo)}` : ""}</p>
      </div>
      <div class="row-actions">
        <button type="button" class="round" onclick="toggleSchedule('${item.id}')" title="완료">${icon("check")}</button>
        <button type="button" class="round subtle" onclick="openScheduleForm('${item.id}')" title="수정">${icon("edit")}</button>
      </div>
    </article>
  `;
}

function renderWeek() {
  const dates = weekDates(state.selectedDate);
  return `
    <section class="toolbar">
      <input type="date" value="${state.selectedDate}" onchange="setDate(this.value)" />
      <button type="button" class="primary" onclick="openScheduleForm()">${icon("plus")}일정</button>
    </section>
    <section class="week-grid">
      ${dates
        .map((date) => {
          const items = schedulesFor(state.selectedStudent, date);
          const rate = completionRate(items);
          return `
            <article class="day-column ${date === state.selectedDate ? "active" : ""}" onclick="setDate('${date}')">
              <header>
                <strong>${dayName(date)}</strong>
                <span>${date.slice(5).replace("-", "/")}</span>
              </header>
              <div class="mini-bar"><span style="height:${rate}%"></span></div>
              <div class="week-events">
                ${items.slice(0, 4).map((item) => `<p>${item.start} ${escapeHtml(item.title)}</p>`).join("")}
                ${items.length > 4 ? `<p>+${items.length - 4}개</p>` : ""}
              </div>
            </article>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderQuests() {
  const quests = visibleQuests();
  const done = quests.filter((quest) => quest.done).length;
  return `
    <section class="toolbar">
      <div class="quest-score">
        <strong>${done}/${quests.length}</strong>
        <span>퀘스트 완료</span>
      </div>
      <button type="button" class="primary" onclick="openQuestForm()">${icon("plus")}퀘스트</button>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>방학 퀘스트</h2>
        <span>버킷리스트와 필수 과제</span>
      </div>
      <div class="quest-list">
        ${quests.map(renderQuest).join("")}
      </div>
    </section>
  `;
}

function renderQuest(quest) {
  const rate = Math.min(100, Math.round((Number(quest.progress || 0) / Number(quest.target || 1)) * 100));
  return `
    <article class="quest ${quest.done ? "done" : ""}">
      <div>
        <span class="badge ${quest.type}">${quest.type === "must" ? "완료 과제" : "버킷리스트"}</span>
        <strong>${escapeHtml(quest.title)}</strong>
        <p>${quest.studentId === "all" ? "공통" : studentName(quest.studentId)} · ${quest.points}P${quest.note ? ` · ${escapeHtml(quest.note)}` : ""}</p>
        <div class="bar"><span style="width:${rate}%"></span></div>
      </div>
      <div class="quest-actions">
        <button type="button" class="round" onclick="addQuestProgress('${quest.id}')" title="진행 +1">${icon("check")}</button>
        <button type="button" class="round subtle" onclick="openQuestForm('${quest.id}')" title="수정">${icon("edit")}</button>
      </div>
    </article>
  `;
}

function studentName(id) {
  return state.data.students.find((student) => student.id === id)?.name || "알 수 없음";
}

function categoryLabel(category) {
  return { study: "공부", habit: "습관", play: "놀이", chore: "집안일", rest: "휴식" }[category] || "기타";
}

function renderScheduleSheet() {
  const item = state.editingSchedule;
  return `
    <div class="sheet-backdrop">
      <section class="sheet">
        <header><h2>일정 ${state.data.schedules.some((schedule) => schedule.id === item.id) ? "수정" : "추가"}</h2><button type="button" onclick="closeForms()">${icon("close")}</button></header>
        <form class="form" onsubmit="saveSchedule(event)">
          <label>아이<select name="studentId">${state.data.students.map((student) => `<option value="${student.id}" ${student.id === item.studentId ? "selected" : ""}>${student.name}</option>`).join("")}</select></label>
          <label>날짜<input name="date" type="date" value="${item.date}" /></label>
          <div class="form-row">
            <label>시작<input name="start" type="time" step="300" value="${item.start}" /></label>
            <label>종료<input name="end" type="time" step="300" value="${item.end}" /></label>
          </div>
          <label>일정명<input name="title" value="${escapeAttr(item.title)}" placeholder="예: 수학 문제풀이" /></label>
          <label>분류<select name="category">${["study", "habit", "play", "chore", "rest"].map((value) => `<option value="${value}" ${value === item.category ? "selected" : ""}>${categoryLabel(value)}</option>`).join("")}</select></label>
          <label>메모<textarea name="memo" placeholder="준비물, 장소, 보상 등을 적어두세요.">${escapeHtml(item.memo || "")}</textarea></label>
          <label class="check"><input name="done" type="checkbox" ${item.done ? "checked" : ""} /> 완료</label>
          <div class="form-actions">
            ${state.data.schedules.some((schedule) => schedule.id === item.id) ? `<button type="button" class="danger" onclick="deleteSchedule('${item.id}')">${icon("trash")}삭제</button>` : ""}
            <button type="submit" class="primary">저장</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function renderQuestSheet() {
  const quest = state.editingQuest;
  return `
    <div class="sheet-backdrop">
      <section class="sheet">
        <header><h2>퀘스트 ${state.data.quests.some((item) => item.id === quest.id) ? "수정" : "추가"}</h2><button type="button" onclick="closeForms()">${icon("close")}</button></header>
        <form class="form" onsubmit="saveQuest(event)">
          <label>대상<select name="studentId"><option value="all" ${quest.studentId === "all" ? "selected" : ""}>공통</option>${state.data.students.map((student) => `<option value="${student.id}" ${student.id === quest.studentId ? "selected" : ""}>${student.name}</option>`).join("")}</select></label>
          <label>퀘스트명<input name="title" value="${escapeAttr(quest.title)}" placeholder="예: 자전거 타고 한강 가기" /></label>
          <label>유형<select name="type"><option value="bucket" ${quest.type === "bucket" ? "selected" : ""}>버킷리스트</option><option value="must" ${quest.type === "must" ? "selected" : ""}>완료 과제</option></select></label>
          <div class="form-row">
            <label>진행<input name="progress" type="number" min="0" step="1" value="${quest.progress || 0}" /></label>
            <label>목표<input name="target" type="number" min="1" step="1" value="${quest.target || 1}" /></label>
          </div>
          <label>포인트<input name="points" type="number" min="0" step="10" value="${quest.points || 30}" /></label>
          <label>메모<textarea name="note" placeholder="완료 조건이나 약속을 적어두세요.">${escapeHtml(quest.note || "")}</textarea></label>
          <label class="check"><input name="done" type="checkbox" ${quest.done ? "checked" : ""} /> 완료</label>
          <div class="form-actions">
            ${state.data.quests.some((item) => item.id === quest.id) ? `<button type="button" class="danger" onclick="deleteQuest('${quest.id}')">${icon("trash")}삭제</button>` : ""}
            <button type="submit" class="primary">저장</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

window.selectStudent = selectStudent;
window.switchView = switchView;
window.setDate = setDate;
window.openScheduleForm = openScheduleForm;
window.saveSchedule = saveSchedule;
window.toggleSchedule = toggleSchedule;
window.deleteSchedule = deleteSchedule;
window.openQuestForm = openQuestForm;
window.saveQuest = saveQuest;
window.addQuestProgress = addQuestProgress;
window.deleteQuest = deleteQuest;
window.closeForms = closeForms;

render();
loadRemote();

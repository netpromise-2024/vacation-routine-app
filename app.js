const API = "/api/vacation";
const STORAGE_KEY = "vacation-routine-cache-v2";
const TODAY = todayString();
const DAY_START = 7 * 60;
const DAY_END = 23 * 60 + 30;
const AXIS_END = 24 * 60;
const STEP = 5;
const PX_PER_MINUTE = 1.25;
const DAILY_STUDY_TARGET_MINUTES = 180;
const STUDY_BASE_MINUTES = 180;
const STUDY_BASE_POINTS = 10;
const STUDY_BONUS_STEP_MINUTES = 30;
const STUDY_BONUS_POINTS = 5;
const PARENT_SCHEDULE_POINTS = 10;
const MISSED_SCHEDULE_PENALTY = -10;
const SELF_QUEST_POINTS = 50;
const PARENT_QUEST_POINTS = 100;
const WEEKLY_REWARD_TARGET = 500;
const WEEKLY_REWARD_BASE = 50000;
const WEEKLY_REWARD_STEP_POINTS = 50;
const WEEKLY_REWARD_STEP_AMOUNT = 5000;
const app = document.querySelector("#app");

let state = {
  view: "day",
  selectedStudent: "hyeon1",
  selectedDate: TODAY,
  editingSchedule: null,
  editingQuest: null,
  dragDraft: null,
  syncStatus: "syncing",
  activeStudy: null,
  studySheet: null,
  session: null,
  data: loadCache(),
};

let saveTimer = null;

function todayString() {
  if (globalThis.__VACATION_TEST_TODAY__) {
    return globalThis.__VACATION_TEST_TODAY__;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultData() {
  return {
    students: [
      { id: "hyeon1", name: "옥승현", color: "#58714d" },
      { id: "hyeon2", name: "옥수현", color: "#c96542" },
      { id: "hyeon3", name: "옥서현", color: "#d09a3f" },
    ],
    weeklyTemplate: [],
    checkins: [],
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

function seedSchedule(studentId, date, start, end, title, category, createdBy = "parent") {
  return { id: cryptoId(), studentId, date, start, end, title, category, memo: "", done: false, createdBy, approvalStatus: createdBy === "student" ? "pending" : "approved", completedAt: "", updatedAt: new Date().toISOString() };
}

function seedQuest(studentId, title, type, points, progress, target, createdBy = "parent") {
  const done = progress >= target;
  return { id: cryptoId(), studentId, title, type, points, progress, target, done, createdBy, completedAt: done ? new Date().toISOString() : "", note: "", updatedAt: new Date().toISOString() };
}

function cryptoId() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function saveSession(session) {
  state.session = session;
}

function loadCache() {
  try {
    return normalizeData(JSON.parse(localStorage.getItem(STORAGE_KEY)) || defaultData());
  } catch {
    return defaultData();
  }
}

function normalizeData(data) {
  const fallback = defaultData();
  const canonicalStudents = fallback.students;
  const incomingStudents = Array.isArray(data?.students) ? data.students : [];
  const students = canonicalStudents.map((student) => ({
    ...student,
    ...(incomingStudents.find((item) => item.id === student.id) || {}),
    name: student.name,
    color: student.color,
  }));
  return {
    students,
    weeklyTemplate: Array.isArray(data?.weeklyTemplate) ? data.weeklyTemplate : fallback.weeklyTemplate,
    checkins: Array.isArray(data?.checkins) ? data.checkins : fallback.checkins,
    schedules: (Array.isArray(data?.schedules) ? data.schedules : fallback.schedules).map(normalizeSchedule),
    quests: (Array.isArray(data?.quests) ? data.quests : fallback.quests).map(normalizeQuest),
  };
}

function normalizeSchedule(item) {
  const createdBy = item.createdBy || "parent";
  return {
    ...item,
    createdBy,
    approvalStatus: item.approvalStatus || (createdBy === "student" && !item.done ? "pending" : "approved"),
    penalty: Number(item.penalty || 0),
    completedAt: item.done ? item.completedAt || item.updatedAt || "" : "",
  };
}

function normalizeQuest(quest) {
  const createdBy = quest.createdBy || "parent";
  const done = Boolean(quest.done || Number(quest.progress || 0) >= Number(quest.target || 1));
  return {
    ...quest,
    createdBy,
    points: questPointsByCreator(createdBy),
    done,
    completedAt: done ? quest.completedAt || quest.updatedAt || "" : "",
  };
}

function saveCache() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
}

async function loadRemote() {
  try {
    const response = await fetch(API, { cache: "no-store" });
    if (response.status === 401) throw new Error("Authentication required");
    if (!response.ok) throw new Error("API unavailable");
    const localCheckins = state.data.checkins || [];
    const remoteData = normalizeData(await response.json());
    state.data = {
      ...remoteData,
      checkins: localCheckins.reduce((merged, checkin) => RoutineModel.upsertCheckin(merged, checkin), remoteData.checkins || []),
    };
    state.syncStatus = "online";
    saveCache();
  } catch (error) {
    if (error.message === "Authentication required") {
      state.session = null;
      state.syncStatus = "offline";
    } else {
      state.syncStatus = "local";
    }
  }
  applySessionStudent();
  render();
}

async function loadBundledTemplate() {
  try {
    const response = await fetch("./weekly-template.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Template unavailable");
    const weeklyTemplate = await response.json();
    if (Array.isArray(weeklyTemplate)) {
      state.data.weeklyTemplate = weeklyTemplate;
      saveCache();
    }
  } catch {
    // The child UI shows a clear reload message when the bundled timetable cannot be read.
  }
  render();
}

async function saveCheckinRemote(checkin) {
  saveCache();
  try {
    const response = await fetch("/api/checkins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(checkin),
    });
    if (!response.ok) throw new Error("Check-in save failed");
    state.syncStatus = "online";
  } catch {
    state.syncStatus = "local";
  }
  render();
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
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function isAdmin() {
  return state.session?.role === "parent";
}

function applySessionStudent() {
  if (state.session?.role === "student") state.selectedStudent = state.session.studentId;
  if (!state.data.students.some((student) => student.id === state.selectedStudent)) {
    state.selectedStudent = state.data.students[0]?.id || "hyeon1";
  }
}

async function login(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const identity = String(form.get("identity") || "");
  const pin = String(form.get("pin") || "");
  const error = event.currentTarget.querySelector(".login-error");
  if (!identity || !pin) return;
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, pin }),
    });
    if (!response.ok) throw new Error("PIN이 맞지 않습니다.");
    const payload = await response.json();
    saveSession(payload.session);
    if (payload.session.studentId) state.selectedStudent = payload.session.studentId;
    state.view = "day";
    await loadRemote();
  } catch (loginError) {
    if (error) error.textContent = loginError.message || "로그인에 실패했습니다.";
  }
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } finally {
    state.session = null;
    state.activeStudy = null;
    state.studySheet = null;
    render();
  }
}

function currentStudent() {
  return state.data.students.find((student) => student.id === state.selectedStudent) || state.data.students[0];
}

function parseDate(dateValue) {
  const [year, month, day] = dateValue.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function weekDates(dateValue) {
  const date = parseDate(dateValue);
  const monday = new Date(date);
  const daysFromMonday = (date.getDay() + 6) % 7;
  monday.setDate(date.getDate() - daysFromMonday);
  return Array.from({ length: 7 }, (_, index) => formatDate(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index)));
}

function earnedWeekDates(dateValue) {
  return weekDates(dateValue).filter((date) => date <= TODAY);
}

function dayName(dateValue) {
  return ["일", "월", "화", "수", "목", "금", "토"][parseDate(dateValue).getDay()];
}

function shortDate(dateValue) {
  const date = parseDate(dateValue);
  return `${date.getMonth() + 1}/${date.getDate()} (${dayName(dateValue)})`;
}

function timeToMinutes(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(minutes) {
  const safe = Math.max(0, Math.min(23 * 60 + 55, Math.round(minutes / STEP) * STEP));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function minutesToAxisLabel(minutes) {
  if (minutes === 24 * 60) return "24:00";
  return minutesToTime(minutes);
}

function duration(item) {
  return Math.max(0, timeToMinutes(item.end) - timeToMinutes(item.start));
}

function formatDuration(minutes) {
  const safe = Math.max(0, Number(minutes || 0));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (!hours) return `${rest}분`;
  if (!rest) return `${hours}시간`;
  return `${hours}시간 ${rest}분`;
}

function schedulesFor(studentId, date) {
  return state.data.schedules.filter((item) => item.studentId === studentId && item.date === date).sort((a, b) => a.start.localeCompare(b.start));
}

function visibleQuests() {
  return state.data.quests.filter((quest) => quest.studentId === "all" || quest.studentId === state.selectedStudent);
}

function pointsFor(studentId) {
  return pointStatsFor(studentId, earnedWeekDates(state.selectedDate)).total;
}

function questPointsByCreator(createdBy) {
  return createdBy === "student" ? SELF_QUEST_POINTS : PARENT_QUEST_POINTS;
}

function studyPointsFor(minutes) {
  if (minutes < STUDY_BASE_MINUTES) return 0;
  return STUDY_BASE_POINTS + Math.floor((minutes - STUDY_BASE_MINUTES) / STUDY_BONUS_STEP_MINUTES) * STUDY_BONUS_POINTS;
}

function pointStatsFor(studentId, dates = null) {
  const dateSet = dates ? new Set(dates) : null;
  const schedules = state.data.schedules.filter((item) => item.studentId === studentId && item.done && item.approvalStatus === "approved" && (!dateSet || dateSet.has(item.date)));
  const penalties = state.data.schedules
    .filter((item) => item.studentId === studentId && item.approvalStatus === "missed" && (!dateSet || dateSet.has(item.date)))
    .reduce((sum, item) => sum + Number(item.penalty || MISSED_SCHEDULE_PENALTY), 0);
  const datesForStudy = dateSet || new Set(schedules.map((item) => item.date));
  let studyMinutes = 0;
  let studyPoints = 0;
  let schedulePoints = 0;
  const sources = [];
  const studyTargetMetDates = new Set();
  datesForStudy.forEach((date) => {
    const dayStudyMinutes = schedules.filter((item) => item.date === date && item.category === "study").reduce((sum, item) => sum + duration(item), 0);
    const dayStudyPoints = studyPointsFor(dayStudyMinutes);
    const daySchedulePoints = dayStudyMinutes >= DAILY_STUDY_TARGET_MINUTES ? schedules.filter((item) => item.date === date && item.createdBy === "parent").length * PARENT_SCHEDULE_POINTS : 0;
    studyMinutes += dayStudyMinutes;
    studyPoints += dayStudyPoints;
    schedulePoints += daySchedulePoints;
    if (dayStudyMinutes >= DAILY_STUDY_TARGET_MINUTES) {
      studyTargetMetDates.add(date);
      if (dayStudyPoints || daySchedulePoints) sources.push({ date, label: `${shortDate(date)} 공부/일정`, points: dayStudyPoints + daySchedulePoints });
    }
  });
  const quests = state.data.quests
    .filter((quest) => (quest.studentId === "all" || quest.studentId === studentId) && quest.done)
    .filter((quest) => !dateSet || dateSet.has(completionDate(quest)));
  const questPoints = quests.reduce((sum, quest) => sum + questPointsByCreator(quest.createdBy), 0);
  quests.forEach((quest) => sources.push({ date: completionDate(quest) || state.selectedDate, label: `퀘스트 · ${quest.title}`, points: questPointsByCreator(quest.createdBy) }));
  state.data.schedules
    .filter((item) => item.studentId === studentId && item.approvalStatus === "missed" && (!dateSet || dateSet.has(item.date)))
    .forEach((item) => sources.push({ date: item.date, label: `${shortDate(item.date)} 미수행`, points: Number(item.penalty || MISSED_SCHEDULE_PENALTY) }));
  return {
    studyMinutes,
    studyPoints,
    schedulePoints,
    questPoints,
    penalties,
    sources,
    total: studyPoints + schedulePoints + questPoints + penalties,
  };
}

function completionDate(item) {
  return String(item.completedAt || item.updatedAt || "").slice(0, 10);
}

function rewardFor(points) {
  if (points < WEEKLY_REWARD_TARGET) return { amount: 0, next: WEEKLY_REWARD_TARGET - points };
  const bonus = Math.floor((points - WEEKLY_REWARD_TARGET) / WEEKLY_REWARD_STEP_POINTS) * WEEKLY_REWARD_STEP_AMOUNT;
  return { amount: WEEKLY_REWARD_BASE + bonus, next: WEEKLY_REWARD_STEP_POINTS - ((points - WEEKLY_REWARD_TARGET) % WEEKLY_REWARD_STEP_POINTS || WEEKLY_REWARD_STEP_POINTS) };
}

function money(amount) {
  return `${Number(amount || 0).toLocaleString("ko-KR")}원`;
}

function dailyStudyText(minutes) {
  const remaining = Math.max(0, DAILY_STUDY_TARGET_MINUTES - minutes);
  return remaining ? `3시간까지 ${formatDuration(remaining)} 남음` : "3시간 기본 달성";
}

function creatorLabel(createdBy) {
  return createdBy === "student" ? "직접 등록" : "부모 공유";
}

function approvalLabel(status) {
  return {
    pending: "승인 대기",
    approved: "승인",
    rejected: "반려",
    missed: "미수행 -10P",
    excused: "면제",
    change_requested: "변경 요청",
  }[status] || "승인 대기";
}

function approvalClass(status) {
  return {
    approved: "approved",
    rejected: "rejected",
    missed: "missed",
    excused: "excused",
    change_requested: "pending",
  }[status] || "pending";
}

function levelFor(points) {
  return Math.max(1, Math.floor(Math.max(0, points) / 100) + 1);
}

function completionRate(items) {
  return items.length ? Math.round((items.filter((item) => item.done).length / items.length) * 100) : 0;
}

function selectStudent(id) {
  if (!isAdmin()) return;
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

function openDay(value) {
  state.selectedDate = value;
  state.view = "day";
  render();
}

function openScheduleForm(id = "", draft = null) {
  const existing = state.data.schedules.find((item) => item.id === id);
  state.editingSchedule =
    existing ||
    seedSchedule(isAdmin() ? state.selectedStudent : state.session.studentId, state.selectedDate, draft?.start || "09:00", draft?.end || "09:30", "", "study");
  render();
}

function saveSchedule(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const existing = state.data.schedules.find((schedule) => schedule.id === state.editingSchedule.id);
  const done = form.get("done") === "on";
  const item = {
    id: state.editingSchedule.id || cryptoId(),
    studentId: isAdmin() ? form.get("studentId") : state.session.studentId,
    date: form.get("date"),
    start: form.get("start"),
    end: form.get("end"),
    title: form.get("title").trim(),
    category: form.get("category"),
    memo: form.get("memo").trim(),
    done,
    createdBy: isAdmin() ? form.get("createdBy") || "parent" : "student",
    approvalStatus: isAdmin() ? form.get("approvalStatus") || "approved" : existing?.approvalStatus === "approved" ? "change_requested" : existing?.approvalStatus || "pending",
    penalty: (isAdmin() ? form.get("approvalStatus") : existing?.approvalStatus) === "missed" ? MISSED_SCHEDULE_PENALTY : 0,
    completedAt: done ? existing?.completedAt || new Date().toISOString() : "",
    updatedAt: new Date().toISOString(),
  };
  if (!item.title) return;
  if (timeToMinutes(item.end) <= timeToMinutes(item.start)) item.end = minutesToTime(Math.min(DAY_END, timeToMinutes(item.start) + STEP));
  if (["missed", "rejected", "excused"].includes(item.approvalStatus)) {
    item.done = false;
    item.completedAt = "";
  }
  state.data.schedules = state.data.schedules.filter((schedule) => schedule.id !== item.id).concat(item);
  state.editingSchedule = null;
  scheduleSave();
  render();
}

function toggleSchedule(id) {
  state.data.schedules = state.data.schedules.map((item) => {
    if (item.id !== id) return item;
    const done = !item.done;
    const approvalStatus = done && item.approvalStatus === "pending" && isAdmin() ? "approved" : item.approvalStatus;
    return { ...item, done, approvalStatus, completedAt: done ? new Date().toISOString() : "", updatedAt: new Date().toISOString() };
  });
  scheduleSave();
  render();
}

function setScheduleApproval(id, approvalStatus) {
  state.data.schedules = state.data.schedules.map((item) => {
    if (item.id !== id) return item;
    const missed = approvalStatus === "missed";
    return {
      ...item,
      approvalStatus,
      done: missed ? false : item.done,
      penalty: missed ? MISSED_SCHEDULE_PENALTY : 0,
      completedAt: missed ? "" : item.completedAt,
      updatedAt: new Date().toISOString(),
    };
  });
  scheduleSave();
  render();
}

function focusSchedule(id) {
  const item = state.data.schedules.find((schedule) => schedule.id === id);
  if (!item) return;
  state.selectedStudent = item.studentId;
  state.selectedDate = item.date;
  state.view = "day";
  state.editingSchedule = item;
  render();
}

function deleteSchedule(id) {
  state.data.schedules = state.data.schedules.filter((item) => item.id !== id);
  state.editingSchedule = null;
  scheduleSave();
  render();
}

function openQuestForm(id = "") {
  state.editingQuest = state.data.quests.find((item) => item.id === id) || seedQuest(isAdmin() ? state.selectedStudent : state.session.studentId, "", "bucket", 30, 0, 1);
  render();
}

function saveQuest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const progress = Math.max(0, Math.round(Number(form.get("progress") || 0)));
  const target = Math.max(1, Math.round(Number(form.get("target") || 1)));
  const existing = state.data.quests.find((quest) => quest.id === state.editingQuest.id);
  const createdBy = isAdmin() ? form.get("createdBy") || "parent" : "student";
  const done = progress >= target || form.get("done") === "on";
  const item = {
    id: state.editingQuest.id || cryptoId(),
    studentId: isAdmin() ? form.get("studentId") : state.session.studentId,
    title: form.get("title").trim(),
    type: form.get("type"),
    points: questPointsByCreator(createdBy),
    progress,
    target,
    done,
    createdBy,
    completedAt: done ? existing?.completedAt || new Date().toISOString() : "",
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
    const done = progress >= quest.target;
    return { ...quest, progress, done, completedAt: done ? quest.completedAt || new Date().toISOString() : "", updatedAt: new Date().toISOString() };
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
  state.dragDraft = null;
  render();
}

function syncScheduleEndTime(startInput) {
  const form = startInput.closest("form");
  const endInput = form?.querySelector('input[name="end"]');
  if (!endInput) return;
  endInput.min = startInput.value;
  endInput.value = startInput.value;
}

function timelineMinutesFromEvent(event, element) {
  const rect = element.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const minutes = DAY_START + Math.round((y / PX_PER_MINUTE) / STEP) * STEP;
  return Math.max(DAY_START, Math.min(DAY_END, minutes));
}

function timelinePointerDown(event) {
  if (event.target.closest(".event-block")) return;
  const timeline = event.currentTarget;
  const start = timelineMinutesFromEvent(event, timeline);
  state.dragDraft = { start, end: start + 30 };
  timeline.setPointerCapture?.(event.pointerId);
  renderTimelineDraft();
}

function timelinePointerMove(event) {
  if (!state.dragDraft) return;
  const current = timelineMinutesFromEvent(event, event.currentTarget);
  const anchor = state.dragDraft.start;
  state.dragDraft = { start: Math.min(anchor, current), end: Math.max(anchor + STEP, current) };
  renderTimelineDraft();
}

function timelinePointerUp() {
  if (!state.dragDraft) return;
  const start = Math.min(state.dragDraft.start, state.dragDraft.end);
  const end = Math.max(start + STEP, state.dragDraft.end);
  const draft = { start: minutesToTime(start), end: minutesToTime(end) };
  state.dragDraft = null;
  openScheduleForm("", draft);
}

function renderTimelineDraft() {
  const draft = document.querySelector(".drag-draft");
  if (!draft || !state.dragDraft) return;
  const start = Math.min(state.dragDraft.start, state.dragDraft.end);
  const end = Math.max(start + STEP, state.dragDraft.end);
  draft.style.top = `${(start - DAY_START) * PX_PER_MINUTE}px`;
  draft.style.height = `${Math.max(28, (end - start) * PX_PER_MINUTE)}px`;
  draft.textContent = `${minutesToTime(start)}-${minutesToTime(end)}`;
  draft.hidden = false;
}

function routineItemsFor(studentId, date) {
  return RoutineModel.occurrencesForDate(state.data.weeklyTemplate, studentId, date, state.data.checkins);
}

function completeRoutine(templateId) {
  const item = routineItemsFor(state.selectedStudent, state.selectedDate).find((occurrence) => occurrence.id === templateId);
  if (!item) return;
  const checkin = {
    studentId: item.studentId,
    date: item.date,
    templateId: item.id,
    status: "completed",
    completedAt: new Date().toISOString(),
  };
  state.data.checkins = RoutineModel.upsertCheckin(state.data.checkins, checkin);
  saveCheckinRemote(checkin);
  render();
}

function startStudy(templateId) {
  const item = routineItemsFor(state.selectedStudent, state.selectedDate).find((occurrence) => occurrence.id === templateId);
  if (!item) return;
  state.activeStudy = { templateId, startedAt: new Date().toISOString() };
  render();
}

function finishStudy(templateId) {
  if (!state.activeStudy || state.activeStudy.templateId !== templateId) return;
  state.studySheet = { templateId, startedAt: state.activeStudy.startedAt };
  state.activeStudy = null;
  render();
}

function openStudyLog(templateId = "") {
  const items = routineItemsFor(state.selectedStudent, state.selectedDate);
  const firstAcademic = items.find((item) => ["study", "reading"].includes(item.category));
  const selected = items.find((item) => item.id === templateId && ["study", "reading"].includes(item.category)) || firstAcademic;
  if (!selected) return;
  state.studySheet = { templateId: selected.id, startedAt: new Date().toISOString(), manual: !templateId };
  render();
}

function saveStudyRecord(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const templateId = form.get("templateId");
  const item = routineItemsFor(state.selectedStudent, state.selectedDate).find((occurrence) => occurrence.id === templateId);
  if (!item) return;
  const checkin = {
    studentId: item.studentId,
    date: item.date,
    templateId: item.id,
    status: "completed",
    studyNote: String(form.get("studyNote") || "").trim(),
    startedAt: state.studySheet?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  state.data.checkins = RoutineModel.upsertCheckin(state.data.checkins, checkin);
  state.studySheet = null;
  saveCheckinRemote(checkin);
  render();
}

function closeStudySheet() {
  state.studySheet = null;
  render();
}

function inlineArgument(value) {
  return escapeAttr(JSON.stringify(String(value)));
}

function routineAction(item) {
  const templateId = inlineArgument(item.id);
  const canRecord = ["study", "reading"].includes(item.category);
  const recordButton = canRecord ? `<button type="button" class="routine-record" onclick="openStudyLog(${templateId})">기록</button>` : "";
  if (item.status === "completed") return canRecord ? `<span class="routine-actions"><span class="routine-complete">완료</span>${recordButton}</span>` : "";
  if (item.category !== "study") return canRecord ? `<span class="routine-actions"><button type="button" class="routine-action" onclick="completeRoutine(${templateId})">완료</button>${recordButton}</span>` : "";
  if (state.activeStudy?.templateId === item.id) return `<span class="routine-actions"><button type="button" class="routine-action active" onclick="finishStudy(${templateId})">공부 마침</button>${recordButton}</span>`;
  return `<span class="routine-actions"><button type="button" class="routine-action" onclick="startStudy(${templateId})">공부 시작</button>${recordButton}</span>`;
}

function renderChildToday(student) {
  const items = routineItemsFor(student.id, state.selectedDate);
  const remaining = items.filter((item) => item.status !== "completed");
  const priority = remaining.find((item) => item.category === "study") || remaining[0];
  const completed = items.filter((item) => item.status === "completed").length;
  const studyRecords = items.filter((item) => item.status === "completed" && item.studyNote);
  if (!items.length) return `<section class="child-empty"><h2>오늘 시간표를 불러오지 못했어요.</h2><p>새로고침 후 다시 확인해 주세요.</p></section>`;
  return `
    <section class="today-hero">
      <div class="child-topline"><p class="eyebrow">오늘의 루틴</p><button type="button" class="child-logout" onclick="logout()">로그아웃</button></div>
      <h1>${student.name}의 오늘</h1>
      <p>${shortDate(state.selectedDate)} · 완료 ${completed}/${items.length}</p>
    </section>
    <section class="now-card">
      <span>${priority ? "다음 할 일" : "오늘 일정 완료"}</span>
      ${priority ? `<strong>${escapeHtml(priority.title)}</strong><p>${priority.start}–${priority.end} · ${categoryLabel(priority.category)}</p>${routineAction(priority)}` : `<strong>오늘 일정을 모두 마쳤어요.</strong><p>공부 기록은 아래에서 다시 볼 수 있어요.</p>`}
    </section>
    <section class="routine-section">
      <div class="routine-head"><h2>오늘 일정</h2><span>${items.length}개</span></div>
      <div class="routine-list">${items.map((item) => `<article class="routine-row ${item.status === "completed" ? "done" : ""}"><time>${item.start}<span>${item.end}</span></time><div><strong>${escapeHtml(item.title)}</strong><p>${categoryLabel(item.category)}${item.studyNote ? ` · ${escapeHtml(item.studyNote)}` : ""}</p></div>${routineAction(item)}</article>`).join("")}</div>
    </section>
    <section class="study-log"><div class="study-log-head"><h2>오늘 공부 기록</h2><button type="button" class="study-log-add" onclick="openStudyLog()">기록 추가</button></div>${studyRecords.length ? studyRecords.map((item) => `<p><strong>${escapeHtml(item.title)}</strong> · ${escapeHtml(item.studyNote)}</p>`).join("") : `<p class="study-log-empty">아직 기록이 없습니다. 공부한 과목과 내용을 남겨보세요.</p>`}</section>
  `;
}

function renderStudySheet() {
  const academicItems = routineItemsFor(state.selectedStudent, state.selectedDate).filter((occurrence) => ["study", "reading"].includes(occurrence.category));
  const item = academicItems.find((occurrence) => occurrence.id === state.studySheet?.templateId);
  if (!item) return "";
  const subjectPicker = state.studySheet?.manual ? `<label>과목<select name="templateId">${academicItems.map((occurrence) => `<option value="${escapeAttr(occurrence.id)}" ${occurrence.id === item.id ? "selected" : ""}>${escapeHtml(occurrence.title)} · ${occurrence.start}</option>`).join("")}</select></label>` : `<input type="hidden" name="templateId" value="${escapeAttr(item.id)}" />`;
  return `<div class="sheet-backdrop"><section class="study-sheet"><header><div><p>공부 기록</p><h2>${state.studySheet?.manual ? "오늘 공부 내용" : escapeHtml(item.title)}</h2></div><button type="button" onclick="closeStudySheet()">${icon("close")}</button></header><form class="form" onsubmit="saveStudyRecord(event)">${subjectPicker}<label>오늘 한 공부<input name="studyNote" required maxlength="140" placeholder="예: 수학 문제집 34~41쪽" /></label><button type="submit" class="primary">기록 완료</button></form></section></div>`;
}

function render() {
  if (!state.session) {
    renderLogin();
    return;
  }

  applySessionStudent();
  const student = currentStudent();
  const items = schedulesFor(student.id, state.selectedDate);
  const points = pointsFor(student.id);
  const isParent = isAdmin();
  app.innerHTML = `
    <div class="app-shell ${isParent ? "admin-shell" : "child-shell"}">
      ${isParent ? `<header class="top"><div><p class="eyebrow">엄마 · 아빠 화면</p><h1>가족 일정 관리</h1><button type="button" class="sync ${state.syncStatus === "online" ? "online" : ""}" onclick="loadRemote()">${state.syncStatus === "online" ? "서버 동기화" : "동기화 확인"}</button></div><div class="top-actions"><button type="button" class="logout" onclick="logout()" title="로그아웃">${icon("logout")}</button></div></header>${renderStudentTabs()}${renderApprovalQueue()}<nav class="tabs">${tabButton("day", "day", "일 보기")}${tabButton("week", "week", "주 보기")}${tabButton("quests", "quest", "퀘스트")}</nav><main>${state.view === "week" ? renderWeek() : state.view === "quests" ? renderQuests() : renderDay(items)}</main>` : `<main>${renderChildToday(student)}</main>`}
    </div>
    ${state.editingSchedule ? renderScheduleSheet() : ""}
    ${state.editingQuest ? renderQuestSheet() : ""}
    ${state.studySheet ? renderStudySheet() : ""}
  `;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-screen">
      <section class="login-hero">
        <figure class="family-logo">
          <img src="./assets/ok-family-logo.jpg" alt="OK Family SH Happy together" />
        </figure>
        <p class="eyebrow">OK Family Routine</p>
        <h1>누가 사용할까요?</h1>
        <p>방학 일과, 퀘스트, 버킷리스트를 가족이 함께 보고 관리합니다.</p>
      </section>
      <section class="login-options">
        <form class="form login-form" onsubmit="login(event)">
          <label>사용자
            <select name="identity" required>
              <option value="parent">엄마 · 아빠 — 전체 일정 관리</option>
              ${state.data.students.map((student) => `<option value="${student.id}">${student.name}</option>`).join("")}
            </select>
          </label>
          <label>PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required /></label>
          <p class="login-error" role="alert"></p>
          <button type="submit" class="primary">로그인</button>
        </form>
      </section>
    </main>
  `;
}

function renderStudentTabs() {
  return `<section class="students">${state.data.students.map((student) => `<button type="button" class="${student.id === state.selectedStudent ? "active" : ""}" onclick="selectStudent('${student.id}')"><span>${student.name}</span><small>${pointsFor(student.id)}P</small></button>`).join("")}</section>`;
}

function approvalQueueItems() {
  return state.data.schedules
    .filter((item) => item.approvalStatus === "pending" || item.approvalStatus === "change_requested")
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}

function renderApprovalQueue() {
  const items = approvalQueueItems();
  return `
    <section class="approval-queue">
      <div class="approval-head"><strong>승인 대기함</strong><span>${items.length}건</span></div>
      ${items.length ? `<div class="approval-list">${items.slice(0, 5).map(renderApprovalQueueItem).join("")}</div>` : `<p class="approval-empty">아들이 올린 승인 대기 계획이 없습니다.</p>`}
    </section>
  `;
}

function renderApprovalQueueItem(item) {
  return `
    <article class="approval-card">
      <button type="button" class="approval-main" onclick="focusSchedule('${item.id}')">
        <span>${studentName(item.studentId)} · ${shortDate(item.date)} · ${item.start}</span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${approvalLabel(item.approvalStatus)} · ${categoryLabel(item.category)} · ${formatDuration(duration(item))}</small>
      </button>
      <div class="approval-actions">
        <button type="button" class="mini success" onclick="setScheduleApproval('${item.id}', 'approved')">승인</button>
        <button type="button" class="mini subtle" onclick="setScheduleApproval('${item.id}', 'rejected')">반려</button>
      </div>
    </article>
  `;
}

function renderPersonalBadge(student) {
  return `<section class="personal-badge"><strong>${student.name}</strong><span>내 일정과 퀘스트만 표시됩니다.</span></section>`;
}

function calendarHttpsUrl(studentId) {
  return `${location.origin}/calendar/${encodeURIComponent(studentId)}.ics`;
}

function calendarWebcalUrl(studentId) {
  return calendarHttpsUrl(studentId).replace(/^https?:\/\//, "webcal://");
}

function renderCalendarConnect(student) {
  return `
    <section class="calendar-connect">
      <div><strong>아이폰 캘린더 연결</strong><span>${student.name} 승인 일정 · 10분 전 알림</span></div>
      <div class="calendar-actions">
        <button type="button" class="mini success" onclick="openCalendarSubscription('${student.id}')">연결</button>
        <button type="button" class="mini subtle" onclick="copyCalendarUrl('${student.id}')">주소 복사</button>
      </div>
    </section>
  `;
}

function openCalendarSubscription(studentId) {
  window.location.href = calendarWebcalUrl(studentId);
}

async function copyCalendarUrl(studentId) {
  const url = calendarHttpsUrl(studentId);
  try {
    await navigator.clipboard.writeText(url);
    alert("캘린더 구독 주소를 복사했습니다.");
  } catch {
    prompt("캘린더 구독 주소입니다.", url);
  }
}

function tabButton(view, iconName, label) {
  return `<button type="button" class="${state.view === view ? "active" : ""}" onclick="switchView('${view}')">${icon(iconName)}<span>${label}</span></button>`;
}

function renderDay(items) {
  const rate = completionRate(items);
  const todayStats = pointStatsFor(state.selectedStudent, [state.selectedDate]);
  const weekStats = pointStatsFor(state.selectedStudent, earnedWeekDates(state.selectedDate));
  const reward = rewardFor(weekStats.total);
  return `
    <section class="toolbar">
      <input type="date" value="${state.selectedDate}" onchange="setDate(this.value)" />
      <button type="button" class="primary" onclick="openScheduleForm()">${icon("plus")}일정</button>
    </section>
    <section class="summary">
      <article><span>오늘 달성률</span><strong>${rate}%</strong><small>${items.filter((item) => item.done).length}/${items.length}개 완료</small></article>
      <article><span>예정 시간</span><strong>${formatDuration(items.reduce((sum, item) => sum + duration(item), 0))}</strong><small>5분 단위 조정</small></article>
      <article><span>오늘 순공부</span><strong>${formatDuration(todayStats.studyMinutes)}</strong><small>${dailyStudyText(todayStats.studyMinutes)}</small></article>
      <article><span>오늘 포인트</span><strong>${todayStats.total}P</strong><small>3시간 달성 후 적립</small></article>
    </section>
    ${renderRewardPanel(weekStats, reward)}
    <section class="panel">
      <div class="panel-head"><div><h2>${shortDate(state.selectedDate)}</h2><p>빈 시간을 드래그하면 5분 단위로 새 일정이 만들어집니다.</p></div><span>${items.length}개 일정</span></div>
      ${renderTimeline(items)}
      <div class="schedule-list">${items.length ? items.map(renderScheduleItem).join("") : `<div class="empty">오늘 일정이 없습니다.</div>`}</div>
    </section>
  `;
}

function renderTimeline(items) {
  const marks = [];
  for (let minutes = DAY_START; minutes <= AXIS_END; minutes += 60) {
    marks.push(`<div class="time-mark" style="top:${(minutes - DAY_START) * PX_PER_MINUTE}px">${minutesToAxisLabel(minutes)}</div>`);
  }
  return `
    <div class="timeline-wrap">
      <div class="timeline-hours">${marks.join("")}</div>
      <div class="timeline-board" style="height:${(AXIS_END - DAY_START) * PX_PER_MINUTE}px" onpointerdown="timelinePointerDown(event)" onpointermove="timelinePointerMove(event)" onpointerup="timelinePointerUp(event)">
        ${items.map(renderTimelineBlock).join("")}
        <div class="drag-draft" hidden></div>
      </div>
    </div>
  `;
}

function renderTimelineBlock(item) {
  const top = Math.max(0, (timeToMinutes(item.start) - DAY_START) * PX_PER_MINUTE);
  const height = Math.max(30, duration(item) * PX_PER_MINUTE);
  return `<button type="button" class="event-block ${item.done ? "done" : ""}" style="top:${top}px;height:${height}px" onclick="openScheduleForm('${item.id}')"><strong>${escapeHtml(item.title)}</strong><span>${item.start}-${item.end}</span></button>`;
}

function renderScheduleItem(item) {
  return `
    <article class="schedule-item ${item.done ? "done" : ""} ${approvalClass(item.approvalStatus)}">
      <time>${item.start}<span>${item.end}</span></time>
      <div><span class="badge approval ${approvalClass(item.approvalStatus)}">${approvalLabel(item.approvalStatus)}</span><strong>${escapeHtml(item.title)}</strong><p>${categoryLabel(item.category)} · ${formatDuration(duration(item))} · ${creatorLabel(item.createdBy)}${item.createdBy === "parent" && item.approvalStatus === "approved" ? ` +${PARENT_SCHEDULE_POINTS}P` : ""}${item.memo ? ` · ${escapeHtml(item.memo)}` : ""}</p></div>
      <div class="row-actions">
        ${renderScheduleActions(item)}
      </div>
    </article>
  `;
}

function renderScheduleActions(item) {
  if (isAdmin()) {
    const approvalButtons = item.approvalStatus === "pending" || item.approvalStatus === "change_requested"
      ? `<button type="button" class="mini success" onclick="setScheduleApproval('${item.id}', 'approved')">승인</button><button type="button" class="mini subtle" onclick="setScheduleApproval('${item.id}', 'rejected')">반려</button>`
      : "";
    return `${approvalButtons}<button type="button" class="mini danger" onclick="setScheduleApproval('${item.id}', 'missed')">미수행</button><button type="button" class="mini subtle" onclick="setScheduleApproval('${item.id}', 'excused')">면제</button><button type="button" class="round" onclick="toggleSchedule('${item.id}')" title="완료">${icon("check")}</button><button type="button" class="round subtle" onclick="openScheduleForm('${item.id}')" title="수정">${icon("edit")}</button>`;
  }
  return `<button type="button" class="round" onclick="toggleSchedule('${item.id}')" title="완료">${icon("check")}</button><button type="button" class="round subtle" onclick="openScheduleForm('${item.id}')" title="${item.approvalStatus === "approved" ? "변경 요청" : "수정"}">${icon("edit")}</button>`;
}

function renderRewardPanel(stats, reward) {
  const rate = Math.max(0, Math.min(100, Math.round((stats.total / WEEKLY_REWARD_TARGET) * 100)));
  const rewardText = reward.amount
    ? `일요일 저녁 ${money(reward.amount)} · 다음 +5,000원까지 ${reward.next}P`
    : `${reward.next}P 더 달성하면 ${money(WEEKLY_REWARD_BASE)} 보상`;
  return `
    <section class="reward-panel">
      <div class="reward-head"><div><span>이번 주 포인트</span><strong>${stats.total}P</strong></div><p>${rewardText}</p></div>
      <div class="reward-meter"><span style="width:${rate}%"></span></div>
      <div class="reward-breakdown">
        <span>순공부 ${stats.studyPoints}P</span>
        <span>부모 일정 ${stats.schedulePoints}P</span>
        <span>퀘스트 ${stats.questPoints}P</span>
        <span>감점 ${stats.penalties}P</span>
      </div>
      ${renderPointSources(stats.sources)}
    </section>
  `;
}

function renderPointSources(sources = []) {
  if (!sources.length) return `<p class="point-sources-empty">이번 주 적립 기록이 없습니다.</p>`;
  return `
    <div class="point-sources">
      ${sources.map((source) => `<button type="button" onclick="setDate('${source.date}')"><span>${escapeHtml(source.label)}</span><strong>${source.points > 0 ? "+" : ""}${source.points}P</strong></button>`).join("")}
    </div>
  `;
}

function renderWeek() {
  const dates = weekDates(state.selectedDate);
  const weekStats = pointStatsFor(state.selectedStudent, earnedWeekDates(state.selectedDate));
  const reward = rewardFor(weekStats.total);
  return `
    <section class="toolbar"><input type="date" value="${state.selectedDate}" onchange="setDate(this.value)" /><button type="button" class="primary" onclick="openScheduleForm()">${icon("plus")}일정</button></section>
    ${renderRewardPanel(weekStats, reward)}
    <section class="week-grid">
      ${dates.map((date) => {
        const items = schedulesFor(state.selectedStudent, date);
        const rate = completionRate(items);
        return `<article class="day-column ${date === state.selectedDate ? "active" : ""}" onclick="setDate('${date}')" ondblclick="openDay('${date}')" title="두 번 클릭하면 일 보기로 이동합니다."><header><strong>${dayName(date)}</strong><span>${date.slice(5).replace("-", "/")}</span></header><div class="mini-bar"><span style="height:${rate}%"></span></div><div class="week-events">${items.slice(0, 4).map((item) => `<p>${item.start} ${escapeHtml(item.title)}</p>`).join("")}${items.length > 4 ? `<p>+${items.length - 4}개</p>` : ""}</div></article>`;
      }).join("")}
    </section>
  `;
}

function renderQuests() {
  const quests = visibleQuests();
  const done = quests.filter((quest) => quest.done).length;
  const weekStats = pointStatsFor(state.selectedStudent, earnedWeekDates(state.selectedDate));
  const reward = rewardFor(weekStats.total);
  return `
    <section class="toolbar"><div class="quest-score"><strong>${done}/${quests.length}</strong><span>퀘스트 완료</span></div><button type="button" class="primary" onclick="openQuestForm()">${icon("plus")}퀘스트</button></section>
    ${renderRewardPanel(weekStats, reward)}
    <section class="panel"><div class="panel-head"><h2>방학 퀘스트</h2><span>버킷리스트와 필수 과제</span></div><div class="quest-list">${quests.map(renderQuest).join("")}</div></section>
  `;
}

function renderQuest(quest) {
  const rate = Math.min(100, Math.round((Number(quest.progress || 0) / Number(quest.target || 1)) * 100));
  const points = questPointsByCreator(quest.createdBy);
  const progress = Number(quest.progress || 0);
  const target = Number(quest.target || 1);
  const progressText = target === 1 ? (quest.done ? "완료" : "한 번 지키면 완료") : `${progress}/${target}회`;
  return `
    <article class="quest ${quest.done ? "done" : ""}">
      <div><span class="badge ${quest.type}">${quest.type === "must" ? "완료 과제" : "버킷리스트"}</span><span class="badge source">${creatorLabel(quest.createdBy)} ${points}P</span><strong>${escapeHtml(quest.title)}</strong><p>${quest.studentId === "all" ? "공통" : studentName(quest.studentId)} · ${progressText}${quest.note ? ` · ${escapeHtml(quest.note)}` : ""}</p><div class="bar"><span style="width:${rate}%"></span></div></div>
      <div class="quest-actions"><button type="button" class="round" onclick="addQuestProgress('${quest.id}')" title="한 번 했어요">${icon("check")}</button><button type="button" class="round subtle" onclick="openQuestForm('${quest.id}')" title="수정">${icon("edit")}</button></div>
    </article>
  `;
}

function studentName(id) {
  return state.data.students.find((student) => student.id === id)?.name || "알 수 없음";
}

function categoryLabel(category) {
  return {
    study: "공부",
    reading: "독서",
    school: "학교",
    home: "생활",
    arts: "예체능",
    rest: "휴식",
    test: "시험",
    habit: "습관",
    play: "놀이",
    chore: "집안일",
  }[category] || "기타";
}

function renderScheduleSheet() {
  const item = state.editingSchedule;
  const existing = state.data.schedules.some((schedule) => schedule.id === item.id);
  return `
    <div class="sheet-backdrop">
      <section class="sheet">
        <header><h2>일정 ${existing ? "수정" : "추가"}</h2><button type="button" onclick="closeForms()">${icon("close")}</button></header>
        <form class="form" onsubmit="saveSchedule(event)">
          ${isAdmin() ? `<label>아이<select name="studentId">${state.data.students.map((student) => `<option value="${student.id}" ${student.id === item.studentId ? "selected" : ""}>${student.name}</option>`).join("")}</select></label>` : ""}
          <label>날짜<input name="date" type="date" value="${item.date}" /></label>
          <div class="form-row"><label>시작<input name="start" type="time" step="300" min="${minutesToTime(DAY_START)}" max="${minutesToTime(DAY_END - STEP)}" value="${item.start}" onchange="syncScheduleEndTime(this)" /></label><label>종료<input name="end" type="time" step="300" min="${item.start}" max="${minutesToTime(DAY_END)}" value="${item.end}" /></label></div>
          <label>일정명<input name="title" value="${escapeAttr(item.title)}" placeholder="예: 수학 문제풀이" /></label>
          <label>분류<select name="category">${["study", "habit", "play", "chore", "rest"].map((value) => `<option value="${value}" ${value === item.category ? "selected" : ""}>${categoryLabel(value)}</option>`).join("")}</select></label>
          ${isAdmin() ? `<label>출처<select name="createdBy"><option value="parent" ${item.createdBy !== "student" ? "selected" : ""}>부모 공유 일정 (+${PARENT_SCHEDULE_POINTS}P)</option><option value="student" ${item.createdBy === "student" ? "selected" : ""}>아이 직접 등록</option></select></label>` : `<input type="hidden" name="createdBy" value="student" />`}
          ${isAdmin() ? `<label>승인 상태<select name="approvalStatus">${["pending", "approved", "rejected", "missed", "excused", "change_requested"].map((value) => `<option value="${value}" ${value === item.approvalStatus ? "selected" : ""}>${approvalLabel(value)}</option>`).join("")}</select></label>` : `<div class="point-hint">${approvalLabel(item.approvalStatus)}${item.approvalStatus === "approved" ? " 상태에서 수정하면 부모에게 변경 요청으로 표시됩니다." : ""}</div>`}
          <label>메모<textarea name="memo" placeholder="준비물, 장소, 보상 등을 적어주세요.">${escapeHtml(item.memo || "")}</textarea></label>
          <label class="check"><input name="done" type="checkbox" ${item.done ? "checked" : ""} /> 완료</label>
          <div class="form-actions">${existing ? `<button type="button" class="danger" onclick="deleteSchedule('${item.id}')">${icon("trash")}삭제</button>` : ""}<button type="submit" class="primary">저장</button></div>
        </form>
      </section>
    </div>
  `;
}

function renderQuestSheet() {
  const quest = state.editingQuest;
  const existing = state.data.quests.some((item) => item.id === quest.id);
  return `
    <div class="sheet-backdrop">
      <section class="sheet">
        <header><h2>퀘스트 ${existing ? "수정" : "추가"}</h2><button type="button" onclick="closeForms()">${icon("close")}</button></header>
        <form class="form" onsubmit="saveQuest(event)">
          ${isAdmin() ? `<label>대상<select name="studentId"><option value="all" ${quest.studentId === "all" ? "selected" : ""}>공통</option>${state.data.students.map((student) => `<option value="${student.id}" ${student.id === quest.studentId ? "selected" : ""}>${student.name}</option>`).join("")}</select></label>` : ""}
          <label>퀘스트명<input name="title" value="${escapeAttr(quest.title)}" placeholder="예: 자전거 타고 한강 가기" /></label>
          <label>유형<select name="type"><option value="bucket" ${quest.type === "bucket" ? "selected" : ""}>버킷리스트</option><option value="must" ${quest.type === "must" ? "selected" : ""}>완료 과제</option></select></label>
          ${isAdmin() ? `<label>출처<select name="createdBy"><option value="parent" ${quest.createdBy !== "student" ? "selected" : ""}>부모 퀘스트 (${PARENT_QUEST_POINTS}P)</option><option value="student" ${quest.createdBy === "student" ? "selected" : ""}>아이 직접 퀘스트 (${SELF_QUEST_POINTS}P)</option></select></label>` : `<input type="hidden" name="createdBy" value="student" /><div class="point-hint">직접 만든 퀘스트 완료 시 ${SELF_QUEST_POINTS}P</div>`}
          <div class="form-row"><label>현재 횟수<input name="progress" type="number" min="0" step="1" value="${quest.progress || 0}" /></label><label>완료 기준<input name="target" type="number" min="1" step="1" value="${quest.target || 1}" /></label></div>
          <div class="point-hint">예: 하루 약속은 완료 기준 1, 독서 5권은 완료 기준 5로 입력하세요.</div>
          <label>메모<textarea name="note" placeholder="완료 조건이나 약속을 적어주세요.">${escapeHtml(quest.note || "")}</textarea></label>
          <label class="check"><input name="done" type="checkbox" ${quest.done ? "checked" : ""} /> 완료</label>
          <div class="form-actions">${existing ? `<button type="button" class="danger" onclick="deleteQuest('${quest.id}')">${icon("trash")}삭제</button>` : ""}<button type="submit" class="primary">저장</button></div>
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

Object.assign(window, {
  login,
  logout,
  loadRemote,
  selectStudent,
  switchView,
  setDate,
  openDay,
  openScheduleForm,
  saveSchedule,
  toggleSchedule,
  setScheduleApproval,
  focusSchedule,
  deleteSchedule,
  openQuestForm,
  saveQuest,
  addQuestProgress,
  deleteQuest,
  closeForms,
  openCalendarSubscription,
  copyCalendarUrl,
  syncScheduleEndTime,
  timelinePointerDown,
  timelinePointerMove,
  timelinePointerUp,
  completeRoutine,
  startStudy,
  finishStudy,
  openStudyLog,
  saveStudyRecord,
  closeStudySheet,
});

async function initialize() {
  try {
    const response = await fetch("/api/session", { cache: "no-store" });
    if (!response.ok) throw new Error("Session unavailable");
    const payload = await response.json();
    saveSession(payload.session);
    if (state.session) await loadRemote();
  } catch {
    state.session = null;
  }
  render();
}

render();
initialize();

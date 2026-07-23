const fs = require("fs");
const path = require("path");
const vm = require("vm");

const appPath = path.join(__dirname, "..", "app.js");
const appCode = fs.readFileSync(appPath, "utf8");

const storage = new Map();
const context = {
  console,
  setTimeout,
  clearTimeout,
  __VACATION_TEST_TODAY__: "2026-07-22",
  crypto: { randomUUID: () => `test-${Math.random().toString(16).slice(2)}` },
  localStorage: {
    getItem: (key) => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
  document: {
    querySelector: () => ({ innerHTML: "" }),
  },
  fetch: async () => {
    throw new Error("network disabled in point test");
  },
  window: {},
};

vm.runInNewContext(
  `${appCode}
window.__pointsTest = { state, pointsFor, pointStatsFor, normalizeData, weekDates, earnedWeekDates };`,
  context,
);

const date = "2026-07-22";
const week = context.window.__pointsTest.weekDates(date);
if (week[0] !== "2026-07-20" || week[6] !== "2026-07-26") {
  throw new Error(`Expected Monday-Sunday week, received ${week.join(",")}`);
}

context.window.__pointsTest.state.data = context.window.__pointsTest.normalizeData({
  students: [{ id: "hyeon1", name: "옥승현", color: "#3182f6" }],
  schedules: [
    { id: "study-1", studentId: "hyeon1", date, start: "09:00", end: "10:10", title: "study", category: "study", done: true, createdBy: "parent", approvalStatus: "approved" },
    { id: "study-2", studentId: "hyeon1", date, start: "10:20", end: "11:30", title: "study", category: "study", done: true, createdBy: "parent", approvalStatus: "approved" },
    { id: "habit-1", studentId: "hyeon1", date, start: "13:00", end: "13:30", title: "habit", category: "habit", done: true, createdBy: "parent", approvalStatus: "approved" },
  ],
  quests: [],
});

const underTarget = context.window.__pointsTest.pointStatsFor("hyeon1", [date]);
if (underTarget.studyMinutes !== 140 || underTarget.total !== 0) {
  throw new Error(`Expected 0P below daily target, received ${underTarget.total}P`);
}

context.window.__pointsTest.state.data.schedules.push({
  id: "study-3",
  studentId: "hyeon1",
  date,
  start: "14:00",
  end: "14:40",
  title: "study",
  category: "study",
  done: true,
  createdBy: "parent",
  approvalStatus: "approved",
});

const targetMet = context.window.__pointsTest.pointStatsFor("hyeon1", [date]);
if (targetMet.studyMinutes !== 180 || targetMet.studyPoints !== 10 || targetMet.schedulePoints !== 40 || targetMet.total !== 50) {
  throw new Error(`Expected 50P at daily target, received ${JSON.stringify(targetMet)}`);
}

context.window.__pointsTest.state.data.schedules.push(
  { id: "future-study-1", studentId: "hyeon1", date: "2026-07-23", start: "09:00", end: "12:00", title: "future study", category: "study", done: true, createdBy: "parent", approvalStatus: "approved" },
  { id: "future-habit-1", studentId: "hyeon1", date: "2026-07-23", start: "13:00", end: "13:30", title: "future habit", category: "habit", done: true, createdBy: "parent", approvalStatus: "approved" },
);

const earnedWeek = context.window.__pointsTest.pointStatsFor("hyeon1", context.window.__pointsTest.earnedWeekDates(date));
if (earnedWeek.sources.some((source) => source.date === "2026-07-23")) {
  throw new Error(`Future points should not be included in earned week stats: ${JSON.stringify(earnedWeek.sources)}`);
}

const headerPoints = context.window.__pointsTest.pointsFor("hyeon1");
if (headerPoints !== earnedWeek.total) {
  throw new Error(`Header points should match earned week points, received ${headerPoints}P vs ${earnedWeek.total}P`);
}

console.log("vacation routine point rules passed");

const assert = require("assert");
const RoutineModel = require("../routine.js");

const template = [
  { id: "mon-study", studentId: "hyeon1", weekday: 0, start: "19:00", end: "20:00", title: "수학", category: "study" },
  { id: "mon-rest", studentId: "hyeon1", weekday: 0, start: "20:00", end: "20:30", title: "휴식", category: "rest" },
];

assert.equal(RoutineModel.weekdayIndex("2026-08-31"), 0, "Monday must map to weekday 0");

const occurrences = RoutineModel.occurrencesForDate(template, "hyeon1", "2026-08-31", []);
assert.equal(occurrences.length, 2, "shows every planned item for the selected student and weekday");
assert.equal(occurrences[0].status, "planned", "an unchecked item starts as planned");

const afterStudy = RoutineModel.upsertCheckin([], {
  studentId: "hyeon1",
  date: "2026-08-31",
  templateId: "mon-study",
  status: "completed",
  studyNote: "수학 문제집 34~41쪽",
  startedAt: "2026-08-31T10:00:00.000Z",
  completedAt: "2026-08-31T11:00:00.000Z",
});
const completed = RoutineModel.occurrencesForDate(template, "hyeon1", "2026-08-31", afterStudy);
assert.equal(completed[0].status, "completed", "completed study overrides the planned occurrence");
assert.equal(completed[0].studyNote, "수학 문제집 34~41쪽", "study note stays attached to the completed occurrence");
assert.equal(completed[1].status, "planned", "one completion does not alter the next routine item");

assert.equal(RoutineModel.isValidCheckin({ studentId: "hyeon1", date: "2026-08-31", templateId: "mon-study", status: "completed", studyNote: "수학 문제집 34~41쪽" }, new Set(["mon-study"])), true, "valid check-in targets a real routine and has a valid date");
assert.equal(RoutineModel.isValidCheckin({ studentId: "hyeon1", date: "2026-08-31", templateId: "other", status: "completed" }, new Set(["mon-study"])), false, "unknown routine cannot be recorded");
assert.equal(RoutineModel.isValidCheckin({ studentId: "hyeon1", date: "2026-08-31", templateId: "mon-study", status: "completed", studyNote: "x".repeat(141) }, new Set(["mon-study"])), false, "study note is limited to one short line");

console.log("routine model test passed");

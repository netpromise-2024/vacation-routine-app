const assert = require("assert");
const template = require("../weekly-template.json");

assert.ok(Array.isArray(template), "weekly template is an array");
assert.ok(template.length >= 300, "confirmed timetable imports the planned routine blocks");
assert.ok(template.some((item) => item.studentId === "hyeon1" && item.weekday === 0 && item.start === "19:00" && item.title === "수학"), "승현 Monday 19:00 math is imported");
assert.ok(template.some((item) => item.studentId === "hyeon2" && item.weekday === 2 && item.title === "태권도"), "수현 Wednesday taekwondo is imported");
assert.ok(template.every((item) => item.id && item.start && item.end && item.category), "all imported routines have stable identity, time, and category");

console.log("weekly template test passed");

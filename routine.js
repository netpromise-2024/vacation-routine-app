(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RoutineModel = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function weekdayIndex(date) {
    const day = new Date(`${date}T12:00:00`).getDay();
    return (day + 6) % 7;
  }

  function checkinKey(item) {
    return `${item.studentId}:${item.date}:${item.templateId}`;
  }

  function upsertCheckin(checkins, item) {
    const normalized = { ...item, id: item.id || checkinKey(item) };
    return (Array.isArray(checkins) ? checkins : []).filter((checkin) => checkinKey(checkin) !== checkinKey(normalized)).concat(normalized);
  }

  function occurrencesForDate(template, studentId, date, checkins) {
    const byTemplateId = new Map(
      (Array.isArray(checkins) ? checkins : [])
        .filter((checkin) => checkin.studentId === studentId && checkin.date === date)
        .map((checkin) => [checkin.templateId, checkin]),
    );
    return (Array.isArray(template) ? template : [])
      .filter((item) => item.studentId === studentId && Number(item.weekday) === weekdayIndex(date))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((item) => ({ ...item, date, ...(byTemplateId.get(item.id) || { status: "planned" }) }));
  }

  function isValidCheckin(item, templateIds) {
    if (!item || !templateIds || !templateIds.has(item.templateId)) return false;
    if (!/^hyeon[123]$/.test(String(item.studentId || ""))) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(item.date || ""))) return false;
    if (item.status !== "completed") return false;
    const note = String(item.studyNote || "");
    return note.length <= 140 && !/[\r\n]/.test(note);
  }

  return { weekdayIndex, checkinKey, upsertCheckin, occurrencesForDate, isValidCheckin };
});

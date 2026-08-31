const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const RoutineModel = require("./routine");
const { createClient } = require("@libsql/client");

const root = __dirname;
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.join(root, "data");
const dataPath = path.join(dataDir, "vacation-data.json");
const supabaseUrl = trimTrailingSlash(process.env.SUPABASE_URL || "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseTable = process.env.SUPABASE_TABLE || "vacation_app_state";
const tursoDatabaseUrl = process.env.TURSO_DATABASE_URL || "";
const tursoAuthToken = process.env.TURSO_AUTH_TOKEN || "";
const requiredEnvironmentVariables = ["FAMILY_PIN_HYEON1", "FAMILY_PIN_HYEON2", "FAMILY_PIN_HYEON3", "FAMILY_PIN_PARENT", "SESSION_SECRET"];
const missingEnvironmentVariables = requiredEnvironmentVariables.filter((name) => !process.env[name]);
if (missingEnvironmentVariables.length) throw new Error(`Missing required environment variables: ${missingEnvironmentVariables.join(", ")}`);
if (Boolean(tursoDatabaseUrl) !== Boolean(tursoAuthToken)) throw new Error("TURSO_DATABASE_URL and TURSO_AUTH_TOKEN must be configured together");
const tursoClient = tursoDatabaseUrl ? createClient({ url: tursoDatabaseUrl, authToken: tursoAuthToken }) : null;
const appStateId = process.env.APP_STATE_ID || "family-vacation-routine";
const configuredAppBaseUrl = trimTrailingSlash(process.env.APP_BASE_URL || "");
const telegramTargets = parseTelegramTargets();

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ics": "text/calendar; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".sql": "text/sql; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
};

const canonicalStudents = [
  { id: "hyeon1", name: "옥승현", color: "#58714d" },
  { id: "hyeon2", name: "옥수현", color: "#c96542" },
  { id: "hyeon3", name: "옥서현", color: "#d09a3f" },
];

const sessionCookieName = "family_session";
const sessionTtlSeconds = 60 * 60 * 12;
const pinByIdentity = {
  hyeon1: process.env.FAMILY_PIN_HYEON1 || "",
  hyeon2: process.env.FAMILY_PIN_HYEON2 || "",
  hyeon3: process.env.FAMILY_PIN_HYEON3 || "",
  parent: process.env.FAMILY_PIN_PARENT || "",
};
const sessionSigningKey = process.env.SESSION_SECRET;

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function signSessionPayload(encodedPayload) {
  return crypto.createHmac("sha256", sessionSigningKey).update(encodedPayload).digest("base64url");
}

function createSession(identity) {
  const session = identity === "parent" ? { role: "parent" } : { role: "student", studentId: identity };
  const encodedPayload = base64Url(JSON.stringify({ ...session, exp: Math.floor(Date.now() / 1000) + sessionTtlSeconds }));
  return `${encodedPayload}.${signSessionPayload(encodedPayload)}`;
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((entry) => entry.trim().split(/=(.*)/s))
      .filter(([name]) => name)
      .map(([name, value]) => [name, decodeURIComponent(value || "")]),
  );
}

function sessionFromRequest(req) {
  const token = parseCookies(req)[sessionCookieName];
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;
  const expected = signSessionPayload(encodedPayload);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    if (payload.role === "parent") return { role: "parent" };
    if (payload.role === "student" && canonicalStudents.some((student) => student.id === payload.studentId)) return { role: "student", studentId: payload.studentId };
  } catch {
    // Treat malformed or forged cookie values as anonymous sessions.
  }
  return null;
}

function sessionCookie(token, maxAge = sessionTtlSeconds) {
  return `${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function publicSession(session) {
  return session?.role === "parent" ? { role: "parent" } : session ? { role: "student", studentId: session.studentId } : null;
}

function scopedData(data, session) {
  if (session.role === "parent") return data;
  const { studentId } = session;
  return {
    ...data,
    students: data.students.filter((item) => item.id === studentId),
    weeklyTemplate: data.weeklyTemplate.filter((item) => item.studentId === studentId),
    checkins: data.checkins.filter((item) => item.studentId === studentId),
    schedules: data.schedules.filter((item) => item.studentId === studentId),
    quests: data.quests.filter((item) => item.studentId === "all" || item.studentId === studentId),
  };
}

function readWeeklyTemplate() {
  try {
    const templatePath = path.join(root, "weekly-template.json");
    const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
    return Array.isArray(template) ? template : [];
  } catch {
    return [];
  }
}

const bundledWeeklyTemplate = readWeeklyTemplate();
const bundledTemplateIdsByStudent = new Map(
  canonicalStudents.map((student) => [student.id, new Set(bundledWeeklyTemplate.filter((item) => item.studentId === student.id).map((item) => item.id))]),
);

const initialData = {
  students: canonicalStudents,
  weeklyTemplate: bundledWeeklyTemplate,
  checkins: [],
  schedules: [],
  quests: [
    {
      id: "q-reading",
      studentId: "all",
      title: "방학 독서 5권 완주",
      type: "must",
      points: 120,
      progress: 0,
      target: 5,
      done: false,
      note: "읽은 책 제목을 메모에 남기기",
      updatedAt: new Date().toISOString(),
    },
    {
      id: "q-swim",
      studentId: "all",
      title: "수영장 가기",
      type: "bucket",
      points: 40,
      progress: 0,
      target: 1,
      done: false,
      note: "방학 중 해보고 싶은 것",
      updatedAt: new Date().toISOString(),
    },
  ],
};

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function parseTelegramChatIds(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseTelegramTargets() {
  return [
    [process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_IDS || process.env.TELEGRAM_CHAT_IDs || process.env.TELEGRAM_CHAT_ID],
    [process.env.TELEGRAM_MOM_BOT_TOKEN, process.env.TELEGRAM_MOM_CHAT_IDS || process.env.TELEGRAM_MOM_CHAT_ID],
    [process.env.TELEGRAM_BOT_TOKEN_2, process.env.TELEGRAM_CHAT_IDS_2 || process.env.TELEGRAM_CHAT_ID_2],
  ].flatMap(([botToken, chatIds]) => {
    if (!botToken) return [];
    return parseTelegramChatIds(chatIds).map((chatId) => ({ botToken, chatId }));
  });
}

function hasTursoConfig() {
  return Boolean(tursoClient);
}

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

function hasTelegramConfig() {
  return telegramTargets.length > 0;
}

function normalizeData(data) {
  const incomingStudents = Array.isArray(data?.students) ? data.students : [];
  return {
    students: canonicalStudents.map((student) => ({
      ...student,
      ...(incomingStudents.find((item) => item.id === student.id) || {}),
      name: student.name,
      color: student.color,
    })),
    // Confirmed timetable is server-owned and must never be replaced by client state.
    weeklyTemplate: bundledWeeklyTemplate,
    checkins: Array.isArray(data?.checkins) ? data.checkins : [],
    schedules: Array.isArray(data?.schedules) ? data.schedules : [],
    quests: Array.isArray(data?.quests) ? data.quests : initialData.quests,
  };
}

function ensureData() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataPath)) fs.writeFileSync(dataPath, JSON.stringify(initialData, null, 2));
}

function readFileData() {
  ensureData();
  try {
    return normalizeData(JSON.parse(fs.readFileSync(dataPath, "utf8")));
  } catch {
    return initialData;
  }
}

function writeFileData(data) {
  ensureData();
  fs.writeFileSync(dataPath, JSON.stringify({ ...normalizeData(data), updatedAt: new Date().toISOString() }, null, 2));
}

async function readTursoData() {
  const stateResult = await tursoClient.execute({
    sql: "select data from family_app_state where id = ? limit 1",
    args: [appStateId],
  });
  const persisted = stateResult.rows[0]?.data ? JSON.parse(String(stateResult.rows[0].data)) : initialData;
  const checkinResult = await tursoClient.execute({
    sql: "select student_id, date, template_id, status, study_note, started_at, completed_at, updated_at from daily_checkins",
    args: [],
  });
  const checkins = checkinResult.rows.map((row) => ({
    studentId: String(row.student_id),
    date: String(row.date),
    templateId: String(row.template_id),
    status: String(row.status),
    studyNote: String(row.study_note || ""),
    startedAt: row.started_at ? String(row.started_at) : "",
    completedAt: String(row.completed_at),
    updatedAt: String(row.updated_at),
  }));
  return normalizeData({ ...persisted, checkins });
}

async function writeTursoData(data) {
  const normalized = normalizeData({ ...data, checkins: [] });
  await tursoClient.execute({
    sql: "insert into family_app_state (id, data, updated_at) values (?, ?, ?) on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at",
    args: [appStateId, JSON.stringify(normalized), new Date().toISOString()],
  });
  return normalizeData(data);
}

async function writeTursoCheckin(checkin) {
  await tursoClient.execute({
    sql: "insert into daily_checkins (student_id, date, template_id, status, study_note, started_at, completed_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict(student_id, date, template_id) do update set status = excluded.status, study_note = excluded.study_note, started_at = excluded.started_at, completed_at = excluded.completed_at, updated_at = excluded.updated_at",
    args: [checkin.studentId, checkin.date, checkin.templateId, checkin.status, checkin.studyNote || "", checkin.startedAt || null, checkin.completedAt, checkin.updatedAt],
  });
}

function supabaseHeaders(prefer = "") {
  return {
    apikey: supabaseServiceRoleKey,
    Authorization: `Bearer ${supabaseServiceRoleKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function readSupabaseData() {
  const url = `${supabaseUrl}/rest/v1/${supabaseTable}?id=eq.${encodeURIComponent(appStateId)}&select=data`;
  const response = await fetch(url, { headers: supabaseHeaders() });
  if (!response.ok) throw new Error(`Supabase read failed: ${response.status}`);

  const rows = await response.json();
  if (!Array.isArray(rows) || !rows[0]?.data) {
    await writeSupabaseData(initialData);
    return initialData;
  }
  return normalizeData(rows[0].data);
}

async function writeSupabaseData(data) {
  const normalized = normalizeData(data);
  const payload = {
    id: appStateId,
    data: normalized,
    updated_at: new Date().toISOString(),
  };
  const url = `${supabaseUrl}/rest/v1/${supabaseTable}?on_conflict=id`;
  const response = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders("resolution=merge-duplicates"),
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Supabase write failed: ${response.status}`);
  return normalized;
}

async function readData() {
  if (hasTursoConfig()) return readTursoData();
  if (hasSupabaseConfig()) return readSupabaseData();
  return readFileData();
}

async function writeData(data) {
  if (hasTursoConfig()) return writeTursoData(data);
  if (hasSupabaseConfig()) return writeSupabaseData(data);
  writeFileData(data);
  return normalizeData(data);
}

function studentName(studentId, data) {
  return data.students.find((student) => student.id === studentId)?.name || studentId;
}

function requestBaseUrl(req) {
  if (configuredAppBaseUrl) return configuredAppBaseUrl;
  const protocol = req.headers["x-forwarded-proto"] || "https";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || "vacation-routine-app.onrender.com";
  return trimTrailingSlash(`${protocol}://${hostHeader}`);
}

function scheduleNoticeType(previous, item) {
  if (!previous) return item.createdBy === "student" ? "아이 일정 등록" : "부모 일정 공유";
  if (item.createdBy !== "student") return "";
  if (!["pending", "change_requested"].includes(item.approvalStatus)) return "";
  if (previous.approvalStatus !== item.approvalStatus) return item.approvalStatus === "change_requested" ? "일정 변경 요청" : "일정 수정";
  if (previous.updatedAt !== item.updatedAt) return item.approvalStatus === "change_requested" ? "일정 변경 요청" : "일정 수정";
  return "";
}

function buildTelegramMessages(before, after, appUrl = "") {
  const previousSchedules = new Map(before.schedules.map((item) => [item.id, item]));
  const previousQuests = new Map(before.quests.map((item) => [item.id, item]));
  const messages = [];

  after.schedules.forEach((item) => {
    const noticeType = scheduleNoticeType(previousSchedules.get(item.id), item);
    if (!noticeType) return;
    messages.push(
      [
        `[방학 일과] ${noticeType}`,
        `아이: ${studentName(item.studentId, after)}`,
        `날짜: ${item.date}`,
        `시간: ${item.start}~${item.end}`,
        `내용: ${item.title}`,
        appUrl ? `바로가기: ${appUrl}` : "",
      ].filter(Boolean).join("\n"),
    );
  });

  after.quests.forEach((item) => {
    if (item.createdBy !== "student" || previousQuests.has(item.id)) return;
    messages.push(
      [
        "[방학 일과] 새 퀘스트 등록",
        `아이: ${item.studentId === "all" ? "공통" : studentName(item.studentId, after)}`,
        `퀘스트: ${item.title}`,
        `완료 기준: ${item.target || 1}회`,
        appUrl ? `바로가기: ${appUrl}` : "",
      ].filter(Boolean).join("\n"),
    );
  });

  return messages;
}

async function sendTelegramMessage(text) {
  if (!hasTelegramConfig()) return;
  await Promise.all(
    telegramTargets.map(async ({ botToken, chatId }) => {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!response.ok) throw new Error(`Telegram send failed: ${response.status}`);
    }),
  );
}

async function notifyTelegramChanges(before, after, appUrl = "") {
  if (!hasTelegramConfig()) return;
  const messages = buildTelegramMessages(before, after, appUrl);
  if (!messages.length) return;
  await Promise.all(messages.map(sendTelegramMessage));
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function toIcsDateTime(dateValue, timeValue) {
  const date = new Date(`${dateValue}T${timeValue}:00+09:00`);
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldIcsLine(line) {
  const chunks = [];
  let rest = line;
  while (rest.length > 72) {
    chunks.push(rest.slice(0, 72));
    rest = ` ${rest.slice(72)}`;
  }
  chunks.push(rest);
  return chunks.join("\r\n");
}

function calendarEventsFor(studentId, data) {
  return data.schedules
    .filter((item) => item.studentId === studentId && item.approvalStatus === "approved")
    .filter((item) => item.date && item.start && item.end && item.title)
    .sort((a, b) => `${a.date} ${a.start}`.localeCompare(`${b.date} ${b.start}`));
}

function buildCalendar(studentId, data) {
  const student = data.students.find((item) => item.id === studentId);
  if (!student) return null;
  const now = new Date();
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//OK Family//Vacation Routine//KO",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcs(`${student.name} 방학 일과`)}`,
    "X-WR-TIMEZONE:Asia/Seoul",
  ];

  calendarEventsFor(studentId, data).forEach((item) => {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcs(`${item.id}@ok-family-vacation`)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${toIcsDateTime(item.date, item.start)}`,
      `DTEND:${toIcsDateTime(item.date, item.end)}`,
      `SUMMARY:${escapeIcs(item.title)}`,
      `DESCRIPTION:${escapeIcs([item.memo, item.category ? `category: ${item.category}` : ""].filter(Boolean).join("\n"))}`,
      `LAST-MODIFIED:${stamp}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "DESCRIPTION:10분 후 일정이 시작됩니다.",
      "TRIGGER:-PT10M",
      "END:VALARM",
      "END:VEVENT",
    );
  });

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
}

async function handleCalendar(req, res, pathname) {
  const match = pathname.match(/^\/calendar\/([^/]+)\.ics$/);
  if (!match) return false;
  const session = requireSession(req, res);
  if (!session) return true;
  const studentId = decodeURIComponent(match[1]);
  if (session.role === "student" && session.studentId !== studentId) {
    sendJson(res, 403, { error: "Student calendar access is limited to their own calendar" });
    return true;
  }
  const data = await readData();
  const calendar = buildCalendar(studentId, data);
  if (!calendar) {
    sendJson(res, 404, { error: "Calendar not found" });
    return true;
  }
  res.writeHead(200, {
    "Content-Type": "text/calendar; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="${studentId}.ics"`,
  });
  res.end(calendar);
  return true;
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

function requireSession(req, res) {
  const session = sessionFromRequest(req);
  if (!session) {
    sendJson(res, 401, { error: "Authentication required" });
    return null;
  }
  return session;
}

function pinMatches(identity, pin) {
  const expected = pinByIdentity[identity];
  if (!expected || typeof pin !== "string") return false;
  const actualBuffer = Buffer.from(pin);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

const loginFailureWindowMs = 15 * 60 * 1000;
const maxLoginFailures = 5;
const loginFailures = new Map();

function loginAttemptKey(req, identity) {
  const ip = req.socket.remoteAddress || "unknown";
  const principal = typeof identity === "string" ? identity.slice(0, 128) : "unknown";
  return `${ip}\u0000${principal}`;
}

function isLoginRateLimited(key, now = Date.now()) {
  const attempts = (loginFailures.get(key) || []).filter((timestamp) => now - timestamp < loginFailureWindowMs);
  if (attempts.length) loginFailures.set(key, attempts);
  else loginFailures.delete(key);
  return attempts.length >= maxLoginFailures;
}

function recordLoginFailure(key, now = Date.now()) {
  const attempts = (loginFailures.get(key) || []).filter((timestamp) => now - timestamp < loginFailureWindowMs);
  attempts.push(now);
  loginFailures.set(key, attempts);
}

function clearLoginFailures(key) {
  loginFailures.delete(key);
}

async function handleAuth(req, res, pathname) {
  if (pathname === "/api/session" && req.method === "GET") {
    sendJson(res, 200, { session: publicSession(sessionFromRequest(req)) });
    return true;
  }
  if (pathname === "/api/logout" && req.method === "POST") {
    sendJson(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
    return true;
  }
  if (pathname !== "/api/login") return false;
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return true;
  }
  try {
    const { identity, pin } = JSON.parse((await readBody(req)) || "{}");
    const attemptKey = loginAttemptKey(req, identity);
    if (isLoginRateLimited(attemptKey)) {
      sendJson(res, 429, { error: "Invalid credentials" });
      return true;
    }
    if (!Object.hasOwn(pinByIdentity, identity) || !pinMatches(identity, pin)) {
      recordLoginFailure(attemptKey);
      sendJson(res, 401, { error: "Invalid credentials" });
      return true;
    }
    clearLoginFailures(attemptKey);
    const session = identity === "parent" ? { role: "parent" } : { role: "student", studentId: identity };
    sendJson(res, 200, { session: publicSession(session) }, { "Set-Cookie": sessionCookie(createSession(identity)) });
  } catch {
    const attemptKey = loginAttemptKey(req, "unknown");
    if (isLoginRateLimited(attemptKey)) sendJson(res, 429, { error: "Invalid credentials" });
    else {
      recordLoginFailure(attemptKey);
      sendJson(res, 401, { error: "Invalid credentials" });
    }
  }
  return true;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  try {
    if (req.method === "GET") {
      sendJson(res, 200, scopedData(await readData(), session));
      return;
    }

    if (req.method === "PUT") {
      if (session.role !== "parent") {
        sendJson(res, 403, { error: "Parent access required" });
        return;
      }
      const body = await readBody(req);
      const before = await readData();
      const after = await writeData(JSON.parse(body || "{}"));
      notifyTelegramChanges(before, after, requestBaseUrl(req)).catch((error) => console.error(error.message || error));
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

async function handleCheckin(req, res) {
  const session = requireSession(req, res);
  if (!session) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }
  try {
    const item = JSON.parse(await readBody(req) || "{}");
    if (session.role === "student" && item.studentId !== session.studentId) {
      sendJson(res, 403, { error: "Students can only check in to their own routine" });
      return;
    }
    const templateIds = bundledTemplateIdsByStudent.get(item.studentId);
    if (!RoutineModel.isValidCheckin(item, templateIds)) {
      sendJson(res, 400, { error: "Invalid check-in" });
      return;
    }
    const checkin = { ...item, id: RoutineModel.checkinKey(item), updatedAt: new Date().toISOString() };
    if (hasTursoConfig()) {
      await writeTursoCheckin(checkin);
    } else {
      const before = await readData();
      const after = { ...before, checkins: RoutineModel.upsertCheckin(before.checkins, checkin) };
      await writeData(after);
    }
    sendJson(res, 200, { ok: true, checkin });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

function handleStatus(req, res) {
  if (!requireSession(req, res)) return;
  sendJson(res, 200, {
    ok: true,
    storage: hasTursoConfig() ? "turso" : hasSupabaseConfig() ? "supabase" : "local-file",
    turso: { configured: hasTursoConfig() },
    supabase: {
      configured: hasSupabaseConfig(),
      table: supabaseTable,
      appStateId,
    },
    telegram: {
      configured: hasTelegramConfig(),
      recipientCount: telegramTargets.length,
      botCount: new Set(telegramTargets.map((target) => target.botToken)).size,
    },
    app: {
      baseUrl: configuredAppBaseUrl || null,
    },
  });
}

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(req.url.split("?")[0]);
    handleAuth(req, res, pathname)
      .then((handled) => {
        if (handled) return;
        if (pathname === "/api/vacation") {
          handleApi(req, res);
          return;
        }
        if (pathname === "/api/checkins") {
          handleCheckin(req, res);
          return;
        }
        if (pathname === "/api/status") {
          handleStatus(req, res);
          return;
        }

        return handleCalendar(req, res, pathname).then((handledCalendar) => {
          if (handledCalendar) return;

          const filePath = pathname === "/" ? "/index.html" : pathname;
          const publicStaticFiles = new Set(["/index.html", "/app.js", "/routine.js", "/styles.css"]);
          const isPublicAsset = /^\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:css|gif|ico|jpe?g|js|png|svg|webp)$/i.test(filePath);
          const hasHiddenSegment = filePath.split("/").some((segment) => segment.startsWith("."));
          if (hasHiddenSegment || (!publicStaticFiles.has(filePath) && !isPublicAsset)) {
            res.writeHead(404);
            res.end("not found");
            return;
          }

          const file = path.normalize(path.join(root, filePath));
          if (!file.startsWith(`${root}${path.sep}`)) {
            res.writeHead(404);
            res.end("not found");
            return;
          }

          fs.readFile(file, (error, data) => {
            if (error) {
              res.writeHead(404);
              res.end("not found");
              return;
            }
            res.writeHead(200, {
              "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream",
              "Cache-Control": "no-store",
            });
            res.end(data);
          });
        });
      })
      .catch((error) => sendJson(res, 500, { error: error.message || "Server error" }));
  })
  .listen(port, host, () => {
    const storage = hasSupabaseConfig() ? "Supabase" : "local file";
    console.log(`Vacation routine app running at http://${host}:${port} using ${storage} storage`);
  });

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.join(root, "data");
const dataPath = path.join(dataDir, "vacation-data.json");
const supabaseUrl = trimTrailingSlash(process.env.SUPABASE_URL || "");
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const supabaseTable = process.env.SUPABASE_TABLE || "vacation_app_state";
const appStateId = process.env.APP_STATE_ID || "family-vacation-routine";
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
  { id: "hyeon1", name: "옥승현", color: "#3182f6" },
  { id: "hyeon2", name: "옥수현", color: "#03b26c" },
  { id: "hyeon3", name: "옥서현", color: "#8b5cf6" },
];

const initialData = {
  students: canonicalStudents,
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
  if (!hasSupabaseConfig()) return readFileData();
  return readSupabaseData();
}

async function writeData(data) {
  if (!hasSupabaseConfig()) {
    writeFileData(data);
    return normalizeData(data);
  }
  return writeSupabaseData(data);
}

function studentName(studentId, data) {
  return data.students.find((student) => student.id === studentId)?.name || studentId;
}

function scheduleNoticeType(previous, item) {
  if (!previous) return item.createdBy === "student" ? "아이 일정 등록" : "부모 일정 공유";
  if (item.createdBy !== "student") return "";
  if (!["pending", "change_requested"].includes(item.approvalStatus)) return "";
  if (previous.approvalStatus !== item.approvalStatus) return item.approvalStatus === "change_requested" ? "일정 변경 요청" : "일정 수정";
  if (previous.updatedAt !== item.updatedAt) return item.approvalStatus === "change_requested" ? "일정 변경 요청" : "일정 수정";
  return "";
}

function buildTelegramMessages(before, after) {
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
      ].join("\n"),
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
      ].join("\n"),
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

async function notifyTelegramChanges(before, after) {
  if (!hasTelegramConfig()) return;
  const messages = buildTelegramMessages(before, after);
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
  const studentId = decodeURIComponent(match[1]);
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

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
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
  try {
    if (req.method === "GET") {
      sendJson(res, 200, await readData());
      return;
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      const before = await readData();
      const after = await writeData(JSON.parse(body || "{}"));
      notifyTelegramChanges(before, after).catch((error) => console.error(error.message || error));
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

function handleStatus(req, res) {
  sendJson(res, 200, {
    ok: true,
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
  });
}

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(req.url.split("?")[0]);
    if (pathname === "/api/vacation") {
      handleApi(req, res);
      return;
    }
    if (pathname === "/api/status") {
      handleStatus(req, res);
      return;
    }

    handleCalendar(req, res, pathname)
      .then((handled) => {
        if (handled) return;

        const filePath = pathname === "/" ? "/index.html" : pathname;
        const file = path.normalize(path.join(root, filePath));

        if (!file.startsWith(root)) {
          res.writeHead(403);
          res.end("forbidden");
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
      })
      .catch((error) => sendJson(res, 500, { error: error.message || "Server error" }));
  })
  .listen(port, host, () => {
    const storage = hasSupabaseConfig() ? "Supabase" : "local file";
    console.log(`Vacation routine app running at http://${host}:${port} using ${storage} storage`);
  });

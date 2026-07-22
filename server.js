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

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
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

function hasSupabaseConfig() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
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
      await writeData(JSON.parse(body || "{}"));
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Server error" });
  }
}

http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(req.url.split("?")[0]);
    if (pathname === "/api/vacation") {
      handleApi(req, res);
      return;
    }

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
      res.writeHead(200, { "Content-Type": contentTypes[path.extname(file)] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(port, host, () => {
    const storage = hasSupabaseConfig() ? "Supabase" : "local file";
    console.log(`Vacation routine app running at http://${host}:${port} using ${storage} storage`);
  });

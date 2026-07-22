const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "0.0.0.0";
const dataDir = path.join(root, "data");
const dataPath = path.join(dataDir, "vacation-data.json");

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
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

function readData() {
  ensureData();
  try {
    return normalizeData(JSON.parse(fs.readFileSync(dataPath, "utf8")));
  } catch {
    return initialData;
  }
}

function writeData(data) {
  ensureData();
  fs.writeFileSync(dataPath, JSON.stringify({ ...normalizeData(data), updatedAt: new Date().toISOString() }, null, 2));
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
      sendJson(res, 200, readData());
      return;
    }

    if (req.method === "PUT") {
      const body = await readBody(req);
      writeData(JSON.parse(body || "{}"));
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    sendJson(res, 400, { error: error.message || "Bad request" });
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
    console.log(`Vacation routine app running at http://${host}:${port}`);
  });

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const node = process.execPath;
const cwd = path.join(__dirname, "..");
const port = 4207;

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        headers: payload
          ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: data }));
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await request("GET", "/");
      if (response.statusCode === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Server did not start");
}

(async () => {
  const child = spawn(node, ["server.js"], {
    cwd,
    env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
    stdio: "ignore",
  });

  try {
    await waitForServer();

    const home = await request("GET", "/");
    if (!home.body.includes("방학 일과표")) throw new Error("HTML did not render");

    const data = await request("GET", "/api/vacation");
    if (data.statusCode !== 200 || !data.body.includes("옥승현")) throw new Error("API did not return seed data");

    const payload = JSON.parse(data.body);
    payload.schedules.push({
      id: "test-schedule",
      studentId: "hyeon1",
      date: "2026-07-22",
      start: "08:05",
      end: "08:10",
      title: "5분 테스트",
      category: "study",
      memo: "",
      done: true,
      updatedAt: new Date().toISOString(),
    });

    const write = await request("PUT", "/api/vacation", payload);
    if (write.statusCode !== 200) throw new Error("API PUT failed");

    const reread = await request("GET", "/api/vacation");
    if (!reread.body.includes("5분 테스트")) throw new Error("API did not persist written data");

    console.log("vacation routine smoke test passed");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

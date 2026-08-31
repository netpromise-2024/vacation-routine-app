const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const node = process.execPath;
const cwd = path.join(__dirname, "..");
const port = 4207;
let sessionCookie = "";

function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      {
        method,
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode, body: data, headers: res.headers }));
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
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      FAMILY_PIN_HYEON1: "test-student-one-pin",
      FAMILY_PIN_HYEON2: "test-student-two-pin",
      FAMILY_PIN_HYEON3: "test-student-three-pin",
      FAMILY_PIN_PARENT: "test-parent-pin",
      SESSION_SECRET: "test-session-secret-that-is-long-enough",
    },
    stdio: "ignore",
  });

  try {
    await waitForServer();

    const home = await request("GET", "/");
    if (home.statusCode !== 200 || !home.body.includes("app.js")) throw new Error("HTML did not render");

    const login = await request("POST", "/api/login", { identity: "parent", pin: "test-parent-pin" });
    if (login.statusCode !== 200 || !login.headers["set-cookie"]?.[0]) throw new Error("Parent login failed");
    sessionCookie = login.headers["set-cookie"][0].split(";", 1)[0];

    const data = await request("GET", "/api/vacation");
    if (data.statusCode !== 200) throw new Error("API did not return data");

    const status = await request("GET", "/api/status");
    if (status.statusCode !== 200) throw new Error("Status API did not return data");
    const statusPayload = JSON.parse(status.body);
    if (statusPayload.telegram.configured !== false || statusPayload.telegram.recipientCount !== 0 || statusPayload.telegram.botCount !== 0) {
      throw new Error("Status API should hide missing Telegram config cleanly");
    }

    const payload = JSON.parse(data.body);
    if (!payload.students.some((student) => student.id === "hyeon3")) throw new Error("Third student is missing");

    payload.schedules.push({
      id: "five-minute-test",
      studentId: "hyeon1",
      date: "2026-07-22",
      start: "08:05",
      end: "08:10",
      title: "five minute test",
      category: "study",
      memo: "",
      done: true,
      createdBy: "parent",
      approvalStatus: "approved",
      updatedAt: new Date().toISOString(),
    });

    const write = await request("PUT", "/api/vacation", payload);
    if (write.statusCode !== 200) throw new Error("API PUT failed");

    const reread = await request("GET", "/api/vacation");
    if (!reread.body.includes("five-minute-test")) throw new Error("API did not persist written data");

    const calendar = await request("GET", "/calendar/hyeon1.ics");
    if (calendar.statusCode !== 200 || !calendar.body.includes("BEGIN:VCALENDAR")) throw new Error("Calendar did not render");
    if (!calendar.body.includes("five minute test") || !calendar.body.includes("BEGIN:VALARM")) throw new Error("Calendar event or alarm is missing");

    console.log("vacation routine smoke test passed");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

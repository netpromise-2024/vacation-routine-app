const assert = require("assert/strict");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const node = process.execPath;
const cwd = path.join(__dirname, "..");
const port = 4208;

function request(method, urlPath, body, cookie = "") {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        method,
        hostname: "127.0.0.1",
        port,
        path: urlPath,
        headers: {
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
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

function cookieFrom(response) {
  const setCookie = response.headers["set-cookie"];
  assert.ok(Array.isArray(setCookie) && setCookie.length === 1, "login must set one session cookie");
  assert.match(setCookie[0], /HttpOnly/);
  assert.match(setCookie[0], /SameSite=Strict/);
  assert.match(setCookie[0], /Secure/);
  return setCookie[0].split(";", 1)[0];
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      if ((await request("GET", "/")).statusCode === 200) return;
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
    assert.equal((await request("GET", "/api/vacation")).statusCode, 401, "API reads require a session");
    assert.equal((await request("GET", "/api/status")).statusCode, 401, "status requires a session");
    assert.equal((await request("POST", "/api/login", { identity: "hyeon1", pin: "wrong" })).statusCode, 401, "wrong PIN is rejected");

    const studentLogin = await request("POST", "/api/login", { identity: "hyeon1", pin: "test-student-one-pin" });
    assert.equal(studentLogin.statusCode, 200);
    assert.deepEqual(JSON.parse(studentLogin.body), { session: { role: "student", studentId: "hyeon1" } }, "login only returns public session metadata");
    const studentCookie = cookieFrom(studentLogin);

    const session = await request("GET", "/api/session", undefined, studentCookie);
    assert.deepEqual(JSON.parse(session.body), { session: { role: "student", studentId: "hyeon1" } });

    const studentData = await request("GET", "/api/vacation", undefined, studentCookie);
    assert.equal(studentData.statusCode, 200);
    const parsedStudentData = JSON.parse(studentData.body);
    assert.deepEqual(parsedStudentData.students.map((student) => student.id), ["hyeon1"], "student reads are scoped to their own profile");
    assert.ok(parsedStudentData.weeklyTemplate.every((item) => item.studentId === "hyeon1"));
    assert.ok(parsedStudentData.checkins.every((item) => item.studentId === "hyeon1"));
    assert.ok(parsedStudentData.schedules.every((item) => item.studentId === "hyeon1"));
    assert.equal((await request("GET", "/calendar/hyeon1.ics", undefined, studentCookie)).statusCode, 200, "student can read their own calendar");
    assert.equal((await request("GET", "/calendar/hyeon2.ics", undefined, studentCookie)).statusCode, 403, "student cannot read a sibling calendar");
    assert.equal((await request("GET", "/weekly-template.json")).statusCode, 404, "weekly routines are not publicly downloadable");
    assert.equal((await request("GET", "/data/vacation-data.json")).statusCode, 404, "stored family data is not publicly downloadable");

    const ownCheckin = { studentId: "hyeon1", date: "2026-08-31", templateId: "hyeon1-d0-s0", status: "completed", completedAt: new Date().toISOString() };
    assert.equal((await request("POST", "/api/checkins", ownCheckin, studentCookie)).statusCode, 200, "student can check in to their own routine");
    assert.equal((await request("POST", "/api/checkins", { ...ownCheckin, studentId: "hyeon2" }, studentCookie)).statusCode, 403, "student cannot check in for a sibling");
    assert.equal((await request("POST", "/api/checkins", { ...ownCheckin, templateId: "hyeon2-d0-s0" }, studentCookie)).statusCode, 400, "student cannot check in with a sibling template ID");
    assert.equal((await request("PUT", "/api/vacation", parsedStudentData, studentCookie)).statusCode, 403, "student cannot access management writes");

    const parentLogin = await request("POST", "/api/login", { identity: "parent", pin: "test-parent-pin" });
    assert.equal(parentLogin.statusCode, 200);
    const parentCookie = cookieFrom(parentLogin);
    const parentData = await request("GET", "/api/vacation", undefined, parentCookie);
    assert.equal(parentData.statusCode, 200);
    assert.equal(JSON.parse(parentData.body).students.length, 3, "parent can read all student data");
    assert.equal((await request("PUT", "/api/vacation", JSON.parse(parentData.body), parentCookie)).statusCode, 200, "parent can manage shared data");

    const logout = await request("POST", "/api/logout", undefined, studentCookie);
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["set-cookie"][0], /Max-Age=0/);
    assert.deepEqual(JSON.parse((await request("GET", "/api/session")).body), { session: null }, "logout clears the browser session cookie");
    console.log("authentication and authorization test passed");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

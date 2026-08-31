const assert = require("assert/strict");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const cwd = path.join(__dirname, "..");
const port = 4312;
const env = {
  ...process.env,
  PORT: String(port), HOST: "127.0.0.1",
  FAMILY_PIN_HYEON1: "test-student-one-pin", FAMILY_PIN_HYEON2: "test-student-two-pin",
  FAMILY_PIN_HYEON3: "test-student-three-pin", FAMILY_PIN_PARENT: "test-parent-pin",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
};
function request(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({ method: "POST", hostname: "127.0.0.1", port, path: "/api/login", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      let response = "";
      res.on("data", (chunk) => (response += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: response }));
    });
    req.on("error", reject); req.end(payload);
  });
}
async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try { await request({ identity: "unknown", pin: "x" }); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  throw new Error("Server did not start");
}
(async () => {
  const child = spawn(process.execPath, ["server.js"], { cwd, env, stdio: "ignore" });
  try {
    await waitForServer();
    const unknown = await request({ identity: "not-a-user", pin: "wrong" });
    const wrongPin = await request({ identity: "hyeon1", pin: "wrong" });
    assert.equal(unknown.status, 401);
    assert.equal(wrongPin.status, 401);
    assert.deepEqual(JSON.parse(unknown.body), JSON.parse(wrongPin.body), "invalid identities and PINs return the same safe error");
    for (let i = 0; i < 5; i += 1) await request({ identity: "hyeon2", pin: "wrong" });
    const limited = await request({ identity: "hyeon2", pin: "wrong" });
    assert.equal(limited.status, 429, "repeated failures for one IP and principal are rate limited");
    assert.deepEqual(JSON.parse(limited.body), { error: "Invalid credentials" }, "rate-limit response does not disclose account state");
    const differentPrincipal = await request({ identity: "hyeon3", pin: "wrong" });
    assert.equal(differentPrincipal.status, 401, "a distinct principal has an independent limit bucket");
    console.log("login rate limiting test passed");
  } finally { child.kill(); }
})().catch((error) => { console.error(error); process.exit(1); });

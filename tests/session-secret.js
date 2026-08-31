const assert = require("assert/strict");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const cwd = path.join(__dirname, "..");
const port = 4313;
const baseEnv = {
  ...process.env, PORT: String(port), HOST: "127.0.0.1",
  FAMILY_PIN_HYEON1: "one", FAMILY_PIN_HYEON2: "two", FAMILY_PIN_HYEON3: "three", FAMILY_PIN_PARENT: "parent",
  SESSION_SECRET: "stable-session-secret-for-test",
};
function request(method, urlPath, body, cookie = "") {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ method, hostname: "127.0.0.1", port, path: urlPath, headers: { ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}), ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      let data = ""; res.on("data", (chunk) => (data += chunk)); res.on("end", () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on("error", reject); if (payload) req.write(payload); req.end();
  });
}
async function start(env) {
  const child = spawn(process.execPath, ["server.js"], { cwd, env, stdio: "ignore" });
  for (let i = 0; i < 30; i += 1) {
    try { if ((await request("GET", "/")).status === 200) return child; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
  }
  child.kill(); throw new Error("Server did not start");
}
function stop(child) { return new Promise((resolve) => { child.once("exit", resolve); child.kill(); }); }
(async () => {
  let child = await start(baseEnv);
  const login = await request("POST", "/api/login", { identity: "hyeon1", pin: "one" });
  const cookie = login.headers["set-cookie"][0].split(";", 1)[0];
  await stop(child);

  child = await start({ ...baseEnv, FAMILY_PIN_HYEON1: "changed-one", FAMILY_PIN_HYEON2: "changed-two" });
  assert.equal((await request("GET", "/api/session", undefined, cookie)).status, 200, "changing PINs does not invalidate sessions signed with the unchanged SESSION_SECRET");
  await stop(child);

  child = await start({ ...baseEnv, SESSION_SECRET: "different-session-secret-for-test" });
  assert.deepEqual(JSON.parse((await request("GET", "/api/session", undefined, cookie)).body), { session: null }, "changing SESSION_SECRET invalidates the signed session");
  await stop(child);
  console.log("session HMAC secret test passed");
})().catch((error) => { console.error(error); process.exit(1); });

const assert = require("assert/strict");
const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const cwd = path.join(__dirname, "..");
const port = 4311;
const env = {
  ...process.env,
  PORT: String(port),
  HOST: "127.0.0.1",
  FAMILY_PIN_HYEON1: "test-student-one-pin",
  FAMILY_PIN_HYEON2: "test-student-two-pin",
  FAMILY_PIN_HYEON3: "test-student-three-pin",
  FAMILY_PIN_PARENT: "test-parent-pin",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
};

function request(urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: urlPath }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      if ((await request("/")) === 200) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("Server did not start");
}

(async () => {
  const child = spawn(process.execPath, ["server.js"], { cwd, env, stdio: "ignore" });
  try {
    await waitForServer();
    assert.equal(await request("/index.html"), 200, "public entrypoint remains available");
    assert.equal(await request("/app.js"), 200, "public app asset remains available");
    for (const hiddenPath of ["/server.js", "/package.json", "/render.yaml", "/.git/config", "/.env"]) {
      assert.equal(await request(hiddenPath), 404, `${hiddenPath} must not be publicly served`);
    }
    console.log("static allowlist test passed");
  } finally {
    child.kill();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

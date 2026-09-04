const assert = require("assert/strict");
const path = require("path");
const { spawn } = require("child_process");

const cwd = path.join(__dirname, "..");
const requiredEnv = {
  FAMILY_PIN_HYEON1: "test-student-one-pin",
  FAMILY_PIN_HYEON2: "test-student-two-pin",
  FAMILY_PIN_HYEON3: "test-student-three-pin",
  FAMILY_PIN_PARENT: "test-parent-pin",
  SESSION_SECRET: "test-session-secret-that-is-long-enough",
};

function startServer(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["server.js"], {
      cwd,
      env: { ...process.env, ...env, PORT: "4310", HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("exit", (code) => resolve({ child, code, output }));
    setTimeout(() => resolve({ child, code: null, output }), 1200);
  });
}

(async () => {
  for (const missingVariable of Object.keys(requiredEnv)) {
    const { child, code, output } = await startServer({ ...requiredEnv, [missingVariable]: "" });
    if (code === null) child.kill();
    assert.notEqual(code, null, `server must exit when ${missingVariable} is missing`);
    assert.match(output, new RegExp(missingVariable), "startup error identifies the missing required setting");
  }
  for (const partialTursoEnv of [{ TURSO_DATABASE_URL: "libsql://example.turso.io", TURSO_AUTH_TOKEN: "" }, { TURSO_DATABASE_URL: "", TURSO_AUTH_TOKEN: "token" }]) {
    const { child, code, output } = await startServer({ ...requiredEnv, ...partialTursoEnv });
    if (code === null) child.kill();
    assert.notEqual(code, null, "server must exit for partial Turso configuration");
    assert.match(output, /TURSO_DATABASE_URL and TURSO_AUTH_TOKEN/, "partial Turso error identifies both required settings");
  }
  console.log("security configuration test passed");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");

const blueprint = fs.readFileSync(path.join(__dirname, "..", "render.yaml"), "utf8");
for (const variable of ["FAMILY_PIN_HYEON1", "FAMILY_PIN_HYEON2", "FAMILY_PIN_HYEON3", "FAMILY_PIN_PARENT", "SESSION_SECRET"]) {
  assert.match(blueprint, new RegExp(`- key: ${variable}(?:\\n|\\r\\n)`), `Render blueprint documents ${variable}`);
}
console.log("Render required environment documentation test passed");

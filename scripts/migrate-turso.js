const fs = require("fs");
const path = require("path");
const { createClient } = require("@libsql/client");

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before running this migration.");
}

async function main() {
  const client = createClient({ url, authToken });
  const sql = fs.readFileSync(path.join(__dirname, "..", "turso.sql"), "utf8");
  const statements = sql
    .split(";")
    .map((statement) => statement.replace(/--[^\n]*/g, "").trim())
    .filter(Boolean);
  for (const statement of statements) {
    await client.execute(statement);
  }
  console.log(JSON.stringify({ migrated: true, statements: statements.length }));
  client.close();
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});

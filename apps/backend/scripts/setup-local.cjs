const { existsSync, writeFileSync } = require("node:fs")
const { randomBytes } = require("node:crypto")
if (existsSync(".env")) console.log("Existing .env preserved")
else {
  writeFileSync(".env", [
    "NODE_ENV=development", "DATABASE_URL=", "DATABASE_CA_CERT_PATH=",
    "JWT_SECRET=" + randomBytes(48).toString("hex"), "COOKIE_SECRET=" + randomBytes(48).toString("hex"),
    "STORE_CORS=http://localhost:8000", "ADMIN_CORS=http://localhost:9000,http://localhost:9001",
    "AUTH_CORS=http://localhost:8000,http://localhost:9000,http://localhost:9001",
    "MEDUSA_BACKEND_URL=http://localhost:9000", "MEDUSA_WORKER_MODE=shared", "",
  ].join("\n"), { mode: 0o600, flag: "wx" })
  console.log("Created ignored .env with random local secrets. Add DATABASE_URL and the trusted database CA if required; do not paste secrets in chat.")
}

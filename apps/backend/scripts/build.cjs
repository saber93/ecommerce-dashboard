const { spawnSync } = require("node:child_process")
const { copyFileSync, mkdirSync, existsSync } = require("node:fs")
const admin = process.argv[2] === "admin"
const env = { ...process.env, BUILD_ONLY: "true", ADMIN_ONLY_BUILD: String(admin), MEDUSA_DISABLE_TELEMETRY: "true" }
for (const key of Object.keys(env)) {
  if (/^(DATABASE_|REDIS_|JWT_SECRET$|COOKIE_SECRET$|S3_|ZIINA_)/.test(key)) delete env[key]
}
if (admin && !env.MEDUSA_BACKEND_URL) {
  console.error("Set MEDUSA_BACKEND_URL explicitly before building the Admin")
  process.exit(1)
}
const result = spawnSync("medusa", ["build", ...(admin ? ["--admin-only"] : [])], { env, stdio: "inherit" })
if (result.status !== 0) process.exit(result.status || 1)
if (admin) {
  if (!existsSync(".medusa/admin/index.html")) throw new Error("Expected .medusa/admin/index.html was not generated")
} else {
  mkdirSync(".medusa/server/config", { recursive: true })
  copyFileSync("config/runtime.cjs", ".medusa/server/config/runtime.cjs")
}

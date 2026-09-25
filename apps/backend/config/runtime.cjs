const { readFileSync } = require("node:fs")
const PROJECT_REF = "ffukncssuqmwlowdrbau"
const DATABASE_REGION = "ap-northeast-2"

function databaseOptions(env) {
  if (!env.DATABASE_URL) throw new Error("Set DATABASE_URL in apps/backend/.env")
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error("TLS verification must remain enabled")
  let url
  try { url = new URL(env.DATABASE_URL) } catch { throw new Error("DATABASE_URL is invalid") }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("PostgreSQL URL required")
  const direct = url.hostname === `db.${PROJECT_REF}.supabase.co`
  const session = /^aws-\d+-ap-northeast-2\.pooler\.supabase\.com$/.test(url.hostname)
    && decodeURIComponent(url.username) === `postgres.${PROJECT_REF}`
  if (!direct && !session) throw new Error("Database must target the approved Seoul Supabase project")
  if ((url.port && url.port !== "5432") || url.pathname !== "/postgres") throw new Error("Use the direct or session connection on port 5432, database postgres")
  for (const key of url.searchParams.keys()) {
    if (/^ssl/i.test(key)) throw new Error("Remove SSL URL parameters; verified TLS is configured separately")
  }
  if (!url.password || /\[|\]|YOUR_PASSWORD|REPLACE_ME/.test(decodeURIComponent(url.password))) throw new Error("Supply the actual database password through the ignored environment file")
  const ca = env.DATABASE_CA_CERT?.replace(/\\n/g, "\n") || (env.DATABASE_CA_CERT_PATH ? readFileSync(env.DATABASE_CA_CERT_PATH, "utf8") : undefined)
  const max = Number(env.DATABASE_POOL_MAX || "5")
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error("DATABASE_POOL_MAX must be 1–20")
  return { connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: true, ...(ca ? { ca } : {}) }, max, connectionTimeoutMillis: 10000, statement_timeout: 15000 }
}

function origins(value, fallback, production) {
  const values = (value || fallback).split(",").map(v => v.trim())
  for (const value of values) {
    let url
    try { url = new URL(value) } catch { throw new Error("CORS entries must be explicit origins") }
    if (value !== url.origin || value.includes("*") || !["https:", "http:"].includes(url.protocol)) throw new Error("CORS entries must be explicit HTTP origins without paths or wildcards")
    if (production && url.protocol !== "https:") throw new Error("Hosted origins require HTTPS")
  }
  return values.join(",")
}

function runtime(env) {
  const production = env.NODE_ENV === "production"
  const building = env.BUILD_ONLY === "true"
  const adminOnly = env.ADMIN_ONLY_BUILD === "true"
  const mode = env.MEDUSA_WORKER_MODE || "shared"
  if (!["shared", "server", "worker"].includes(mode)) throw new Error("Invalid MEDUSA_WORKER_MODE")
  if (!building) {
    for (const name of ["JWT_SECRET", "COOKIE_SECRET"]) {
      if (!env[name] || env[name].length < 32) throw new Error(`${name} must have at least 32 characters`)
    }
    if ((production || mode !== "shared") && !env.REDIS_URL) throw new Error("Hosted or split processes require REDIS_URL")
    if (production && !env.REDIS_URL?.startsWith("rediss://")) throw new Error("Hosted Redis requires TLS")
    if (production && !env.S3_BUCKET) throw new Error("Hosted media requires persistent S3 storage")
  }
  const db = building ? undefined : databaseOptions(env)
  const backendUrl = env.MEDUSA_BACKEND_URL || "http://localhost:9000"
  const parsedBackend = new URL(backendUrl)
  if (parsedBackend.origin !== backendUrl) throw new Error("MEDUSA_BACKEND_URL must be an origin without a trailing slash")
  if (env.VERCEL && parsedBackend.protocol !== "https:") throw new Error("Vercel Admin requires the HTTPS backend origin")
  return {
    building, adminOnly, db, mode, backendUrl,
    storeCors: origins(env.STORE_CORS, "http://localhost:8000", production && !building),
    adminCors: origins(env.ADMIN_CORS, "http://localhost:9000,http://localhost:9001", production && !building),
    authCors: origins(env.AUTH_CORS, "http://localhost:8000,http://localhost:9000,http://localhost:9001", production && !building),
  }
}
module.exports = { PROJECT_REF, DATABASE_REGION, databaseOptions, runtime }

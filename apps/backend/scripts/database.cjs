const { performance } = require("node:perf_hooks")
const { spawnSync } = require("node:child_process")
const { loadEnv } = require("@medusajs/framework/utils")
const { Pool } = require("pg")
const { databaseOptions, PROJECT_REF, DATABASE_REGION } = require("../config/runtime.cjs")
loadEnv(process.env.NODE_ENV || "development", process.cwd())

async function main() {
  const action = process.argv[2] || "inspect"
  if (!["inspect", "latency", "migrate"].includes(action)) throw new Error("Unknown database action")
  const pool = new Pool({ ...databaseOptions(process.env), max: 1 })
  let preflight
  try {
    const client = await pool.connect()
    try {
      await client.query("BEGIN READ ONLY")
      const version = await client.query("select current_setting('server_version') as version")
      const tables = await client.query("select schemaname, tablename from pg_tables where schemaname = 'public' order by tablename")
      const tls = await client.query("select ssl, version from pg_stat_ssl where pid = pg_backend_pid()")
      if (!tls.rows[0]?.ssl) throw new Error("Database session did not negotiate TLS")
      preflight = { project: PROJECT_REF, region: DATABASE_REGION, postgres: version.rows[0].version, tls: tls.rows[0], publicTables: tables.rows }
      console.log(JSON.stringify(preflight, null, 2))
      if (action === "latency") {
        const times = []
        for (let i = 0; i < 55; i++) {
          const start = performance.now()
          await client.query("select 1")
          if (i >= 5) times.push(performance.now() - start)
        }
        times.sort((a, b) => a - b)
        console.log(JSON.stringify({ probeOrigin: process.env.PROBE_ORIGIN || "unspecified", samples: times.length, warmP50Ms: times[24], warmP95Ms: times[47], note: "Run inside the candidate API runtime; local results do not establish Singapore-to-Seoul latency." }))
      }
      await client.query("ROLLBACK")
    } finally { client.release() }
  } finally { await pool.end() }
  if (action === "migrate") {
    if (process.env.MEDUSA_MIGRATION_TARGET !== PROJECT_REF) throw new Error("Set MEDUSA_MIGRATION_TARGET to the inspected project ref")
    if (process.env.SUPABASE_DATA_API_DISABLED !== "true") throw new Error("Verify Data API is disabled before migrations; then set SUPABASE_DATA_API_DISABLED=true")
    if (preflight.publicTables.length && process.env.EXISTING_SCHEMA_REVIEWED !== "true") throw new Error("Existing public tables detected. Review ownership and backup before setting EXISTING_SCHEMA_REVIEWED=true")
    const result = spawnSync("medusa", ["db:migrate"], { stdio: "inherit", env: process.env })
    if (result.status !== 0) process.exitCode = result.status || 1
  }
}
main().catch(error => {
  const message = error.message || ""
  if (/^(Set |Verify |Existing public|Database must|Use the direct|Remove SSL|Supply the actual|DATABASE_|TLS verification|PostgreSQL URL|Database session|Unknown database)/.test(message)) console.error(message)
  else console.error(`Database operation failed (${error.code || error.name}). Check credentials, network and trusted CA; secrets have not been logged.`)
  process.exitCode = 1
})

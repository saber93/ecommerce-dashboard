import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
await mkdir("dist", { recursive: true });
for (const file of ["index.html", "admin.js", "admin.css"])
  await copyFile(`admin/${file}`, `dist/${file}`);
const saved = JSON.parse(await readFile("admin/public-config.json", "utf8"));
const key = process.env.PUBLIC_SUPABASE_KEY || saved.publishableKey || "";
if (key.startsWith("sb_secret_"))
  throw new Error("Use a publishable key, never a secret key");
if (key.split(".").length === 3) {
  let claims;
  try {
    claims = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
  } catch {
    throw new Error("Invalid public key");
  }
  if (claims.role !== "anon")
    throw new Error("Only the anon JWT may be published");
}
const config = {
  supabaseUrl: "https://ffukncssuqmwlowdrbau.supabase.co",
  publishableKey: key,
  apiBase: "https://ffukncssuqmwlowdrbau.supabase.co/functions/v1/commerce",
};
await writeFile(
  "dist/config.js",
  `window.ADMIN_CONFIG = Object.freeze(${JSON.stringify(config)});\n`,
);
console.log(
  "Admin static build complete. " +
    (key
      ? "Public key configured."
      : "Sign-in stays disabled until PUBLIC_SUPABASE_KEY is configured."),
);

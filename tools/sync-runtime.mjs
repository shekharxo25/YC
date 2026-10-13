// Copies server/ops-runtime.mjs into company-brain/index.html so the in-app API console and the server's
// POST /api/v1/resolve run byte-for-byte the same logic. Run after editing the runtime:
//   node tools/sync-runtime.mjs          (writes)
//   node tools/sync-runtime.mjs --check  (exits 1 if the copy is stale; used by npm test)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeFile = path.join(root, "server", "ops-runtime.mjs");
const appFile = path.join(root, "company-brain", "index.html");
const START = "/* ---- OPS runtime (copied from server/ops-runtime.mjs by tools/sync-runtime.mjs; do not edit here) ---- */\n";
const END = "/* ---- end OPS runtime ---- */";

const runtime = fs.readFileSync(runtimeFile, "utf8").replace("export function opsResolve", "function opsResolve");
const app = fs.readFileSync(appFile, "utf8");
const a = app.indexOf(START), b = app.indexOf(END);
if (a < 0 || b < a) { console.error("Runtime markers not found in index.html"); process.exit(1); }
const current = app.slice(a + START.length, b);
if (process.argv.includes("--check")) {
  if (current !== runtime) { console.error("The app's copy of the OPS runtime is out of date. Run: node tools/sync-runtime.mjs"); process.exit(1); }
  console.log("OPS runtime copy is in sync.");
} else {
  fs.writeFileSync(appFile, app.slice(0, a + START.length) + runtime + app.slice(b));
  console.log(current === runtime ? "Already in sync." : "Updated the app's copy of the OPS runtime.");
}

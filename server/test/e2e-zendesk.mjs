// Browser end-to-end test of the whole loop against a Zendesk stand-in: sign up, import, learn, auto-sync,
// catch drift and a new situation, de-duplicate, run the scheduler, accept drift, and call the agent API.
// Needs Playwright with Chromium:  NODE_PATH=$(npm root -g) node test/e2e-zendesk.mjs
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(process.env.NODE_PATH + "/x");
const { chromium } = require("playwright");
const { startMockZendesk } = await import(new URL("./mock-zendesk.mjs", import.meta.url).href);

const parse = (text) => { const [head, ...lines] = text.trim().split("\n"); const cols = head.split(","); return lines.map((l) => { const out = []; let f = "", qd = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (qd) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else qd = false; } else f += c; } else if (c === '"') qd = true; else if (c === ",") { out.push(f); f = ""; } else f += c; } out.push(f); return Object.fromEntries(cols.map((c, i) => [c, out[i] ?? ""])); }); };
const base = parse(fs.readFileSync(new URL("./fixtures/quillfield-tickets.csv", import.meta.url), "utf8"));
const zd = await startMockZendesk({ rows: base });
const DB = (await import("node:os")).tmpdir() + "/tacit-e2e-zd.db"; for (const f of [DB, DB + "-wal", DB + "-shm"]) fs.rmSync(f, { force: true });
const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", new URL("../server.mjs", import.meta.url).pathname], { env: { ...process.env, PORT: "8794", TACIT_DB: DB, TACIT_SECRET: "test-secret-0123456789", TACIT_ZENDESK_BASE: zd.base, TACIT_SYNC_TICK_MS: "1500", ANTHROPIC_API_KEY: "", ANTHROPIC_AUTH_TOKEN: "" }, stdio: ["ignore", "pipe", "inherit"] });
await new Promise((r) => srv.stdout.once("data", r));
const B = "http://localhost:8794/";
const b = await chromium.launch({ ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}) });
const p = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
try {
  await p.goto(B + "#signup"); await p.waitForTimeout(800);
  await p.fill("#suName", "Dana Morales"); await p.fill("#suEmail", "dana@quillfield.example"); await p.fill("#suCompany", "Quillfield"); await p.fill("#suPw", "correct horse battery"); await p.click("#suBtn"); await p.waitForTimeout(900);
  await p.click('[data-opt="zendesk"]'); await p.waitForTimeout(200);
  await p.fill("#zdSub", "acme"); await p.fill("#zdEmail", "agent@acme.io"); await p.fill("#zdToken", "zd-token");
  console.log("autosync checkbox:", await p.isChecked("#zdAuto"));
  await p.click("#onbGo"); await p.waitForTimeout(5000);
  console.log("after import:", await p.evaluate(() => location.hash), "|", (await p.innerText("#ovBody .tiles")).replace(/\n/g, " "));
  await p.evaluate(() => (location.hash = "#brain")); await p.waitForTimeout(800);
  console.log("procedures:", (await p.$$eval("#plist .pitem .nm", (x) => x.map((e) => e.textContent))).join(" · "));
  const refundSteps = await p.evaluate(() => [...document.querySelectorAll("#plist .pitem")].find((x) => /refund/i.test(x.textContent)) && true);
  await p.evaluate(() => (location.hash = "#drift")); await p.waitForTimeout(1500);
  console.log("connector panel:", (await p.innerText("#liveConn")).replace(/\n/g, " ").slice(0, 200));
  // --- new solved tickets arrive in Zendesk: the team now refunds up to 45 days, and a new PTO situation ---
  const today = new Date().toISOString().slice(0, 10);
  const fresh = [];
  [34, 37, 39, 42, 44, 36, 41, 38].forEach((d, i) => fresh.push({ ticket_id: "#" + (7000 + i), created: today, agent: ["Theo K.", "Maya R.", "Sam O."][i % 3], subject: "Refund after renewal", message: `We renewed ${d} days ago ($900) and have decided to switch providers. Can we get a refund?`, internal_note: "Checked invoice; Full refund, RNW-30; Confirmed timeline", plan: "growth", amount: "900", days_since_renewal: String(d) }));
  [[64, "Switched policy to unlimited"], [190, "Handed to Implementation team for a guided change"], [95, "Switched policy to unlimited"], [1200, "Handed to Implementation team for a guided change"], [40, "Switched policy to unlimited"]].forEach(([e, act], i) => fresh.push({ ticket_id: "#" + (7100 + i), created: today, agent: "Inès A.", subject: "Switch to unlimited PTO", message: `We're moving all ${e} employees to unlimited PTO next month. How do we turn off accrual?`, internal_note: `Checked PTO policy settings; Exported current balances for the admin; ${act}; Sent confirmation to admin`, plan: "growth", employees: String(e) }));
  await fetch(zd.base + "/_add", { method: "POST", body: JSON.stringify({ rows: fresh }) });
  await p.click("#connSync"); await p.waitForTimeout(5000);
  console.log("after sync tiles:", (await p.innerText("#driftList .tiles")).replace(/\n/g, " | "));
  console.log("drift:", await p.$$eval("#driftList .diff", (ds) => ds.map((d) => d.innerText.replace(/\n/g, " "))));
  console.log("new situations:", await p.$$eval("[data-addnew]", (bs) => bs.map((x) => x.dataset.addnew)));
  // second sync must not duplicate
  await p.click("#connSync"); await p.waitForTimeout(4000);
  const db = new DatabaseSync(DB);
  const c = db.prepare("SELECT token_enc, last_rows, seen_ids FROM connectors").get();
  console.log("token stored encrypted:", !c.token_enc.includes("zd-token"), "| last sync rows:", c.last_rows, "| synced ids:", JSON.parse(c.seen_ids).length);
  const st = JSON.parse(db.prepare("SELECT state FROM workspaces").get().state);
  console.log("updates in state:", st.updates.map((u) => u.name + ":" + u.rows).join(", "), "| ops bundle procedures:", st.ops && st.ops.procedures.length);
  // scheduler: one more ticket arrives, pretend the last check was 7 hours ago
  await fetch(zd.base + "/_add", { method: "POST", body: JSON.stringify({ rows: [{ ticket_id: "#7200", created: today, agent: "Theo K.", subject: "Refund after renewal", message: "We renewed 40 days ago ($600). Refund?", internal_note: "Checked invoice; Full refund, RNW-30; Confirmed timeline", plan: "starter", amount: "600", days_since_renewal: "40" }] }) });
  db.prepare("UPDATE connectors SET last_sync = ?").run(new Date(Date.now() - 7 * 3600_000).toISOString());
  await new Promise((r) => setTimeout(r, 4000));
  const c2 = db.prepare("SELECT last_sync, last_rows, last_status FROM connectors").get();
  console.log("scheduler ran on its own:", Date.now() - Date.parse(c2.last_sync) < 60_000, "| rows:", c2.last_rows, "| status:", c2.last_status);
  // the agent API answers with the updated procedures after the drift is accepted
  await p.reload(); await p.waitForTimeout(2500); await p.evaluate(() => (location.hash = "#drift")); await p.waitForTimeout(1200);
  for (const a of await p.$$("[data-accept]")) { await a.click(); await p.waitForTimeout(700); }
  await p.waitForTimeout(1500);
  await p.evaluate(() => (location.hash = "#schema")); await p.waitForTimeout(1500); await p.click("#apiNewKey"); await p.waitForTimeout(1000);
  const key = (await p.innerText("#apiCard .quote .mono")).trim();
  const r = await fetch(B + "api/v1/resolve", { method: "POST", headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" }, body: JSON.stringify({ message: "We renewed 40 days ago and want a refund of $900", facts: { plan: "growth", days_since_renewal: 40, amount: 900 } }) });
  const j = await r.json();
  console.log("agent API on synced brain:", r.status, j.outcome, "|", j.procedure && j.procedure.name, "v" + (j.procedure && j.procedure.version), "|", (j.plan || []).map((s) => s.text).join(" > "));
  console.log("zendesk endpoints called:", [...new Set((await (await fetch(zd.base + "/_calls")).json()).map((x) => x.split("?")[0].replace(/\d+/g, ":id")))].join(", "));
} finally { console.log("ERRS", errs); await b.close(); srv.kill(); zd.server.close(); }

// End-to-end smoke test: starts a stand-in Anthropic API and the Tacit server, then exercises every endpoint.
// Run with `npm test`. Needs no API key and no network.
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { opsResolve } from "../ops-runtime.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tacit-"));
const seen = [];
const mock = http.createServer((req, res) => {
  let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
    const body = JSON.parse(b); seen.push({ body, beta: req.headers["anthropic-beta"] });
    const last = body.messages.at(-1).content;
    const text = /JSON/.test(last) ? '```json\n{"ok":true}\n```' : "hello";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: /REFUSE/.test(last) ? [] : [{ type: "text", text }], stop_reason: /REFUSE/.test(last) ? "refusal" : "end_turn", usage: { input_tokens: 5, output_tokens: 3 } }));
  });
}).listen(0);
await new Promise((r) => mock.once("listening", r));
const port = 20000 + Math.floor(Math.random() * 20000);
const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(here, "..", "server.mjs")], {
  env: { ...process.env, PORT: String(port), TACIT_DB: path.join(tmp, "t.db"), ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_BASE_URL: `http://127.0.0.1:${mock.address().port}` },
  stdio: ["ignore", "pipe", "inherit"],
});
await new Promise((r) => srv.stdout.once("data", r));

const base = `http://127.0.0.1:${port}`;
let cookie = "";
async function call(method, p, body, extra = {}) {
  const r = await fetch(base + p, { method, headers: { "Content-Type": "application/json", "X-Tacit": "1", cookie, ...extra }, body: body ? JSON.stringify(body) : undefined });
  const set = r.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const text = await r.text(); let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}
let failures = 0;
async function check(name, fn) { try { await fn(); console.log("ok  ", name); } catch (e) { failures++; console.log("FAIL", name, "-", e.message); } }

await check("health reports AI on", async () => { const r = await call("GET", "/api/health"); assert.equal(r.json.ok, true); assert.equal(r.json.ai, true); });
await check("app page is served with a proper head", async () => { const r = await fetch(base + "/"); const t = await r.text(); assert.match(t, /^<!doctype html>/); assert.match(t, /og:title/); });
await check("mutations need the X-Tacit header", async () => { const r = await call("POST", "/api/auth/login", {}, { "X-Tacit": "" }); assert.equal(r.status, 403); });
await check("weak password is refused", async () => { const r = await call("POST", "/api/auth/signup", { name: "A", email: "a@b.io", password: "x" }); assert.equal(r.status, 400); });
await check("signup sets a session", async () => { const r = await call("POST", "/api/auth/signup", { name: "Ana", email: "ana@acme.io", password: "correct horse" }); assert.equal(r.status, 201); assert.ok(cookie.startsWith("tacit_session=")); });
await check("duplicate signup is refused", async () => { const r = await call("POST", "/api/auth/signup", { name: "Ana", email: "ana@acme.io", password: "correct horse" }); assert.equal(r.status, 409); });
await check("workspace create, state save, read back", async () => {
  const csv = "subject,message,internal_note\n" + Array(6).fill("Refund,please,Full refund").join("\n");
  const c = await call("POST", "/api/workspaces", { id: "wsmoke1", name: "Acme", csv }); assert.equal(c.status, 201);
  assert.equal((await call("PUT", "/api/workspaces/wsmoke1/state", { state: { procs: [1] } })).status, 200);
  const g = await call("GET", "/api/workspaces/wsmoke1"); assert.deepEqual(g.json.state, { procs: [1] }); assert.equal(g.json.rows, 6);
});
await check("AI call uses the default model with refusal fallback", async () => {
  const r = await call("POST", "/api/ai", { input: "hi" }); assert.equal(r.json.text, "hello");
  const last = seen.at(-1); assert.equal(last.body.model, "claude-opus-5-5"); assert.equal(last.body.fallbacks, "default"); assert.equal(last.beta, "server-side-fallback-2026-07-01");
});
await check("AI JSON mode parses fenced JSON", async () => { const r = await call("POST", "/api/ai", { input: "give JSON", json: true }); assert.deepEqual(r.json.json, { ok: true }); });
await check("AI refusal becomes a clear error", async () => { const r = await call("POST", "/api/ai", { input: "REFUSE" }); assert.equal(r.status, 422); assert.equal(r.json.code, "refused"); });
await check("AI usage is metered", async () => { const r = await call("GET", "/api/me"); assert.equal(r.json.ai.usedToday, 3); });
await check("Zendesk import rejects unsafe subdomains", async () => { const r = await call("POST", "/api/connectors/zendesk/import", { subdomain: "evil.com/x", email: "a@b.io", token: "t" }); assert.equal(r.status, 400); });
await check("waitlist accepts a lead", async () => { const r = await call("POST", "/api/waitlist", { email: "lead@co.io", source: "test" }); assert.equal(r.status, 201); });
/* ---------- the portable format: schema, runtime, agent API ---------- */
const schema = JSON.parse(fs.readFileSync(path.join(here, "..", "..", "schema", "ops-0.3.schema.json"), "utf8"));
const bundle = JSON.parse(fs.readFileSync(path.join(here, "fixtures", "quillfield.ops.json"), "utf8"));
// A small validator for the JSON Schema keywords OPS uses.
function validate(node, sch, at = "$") {
  if (sch.$ref) sch = schema.$defs[sch.$ref.split("/").pop()];
  const errs = [];
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (sch.oneOf) { const ok = sch.oneOf.filter((alt) => validate(node, alt, at).length === 0).length; if (ok !== 1) errs.push(`${at}: matches ${ok} of the oneOf alternatives`); return errs; }
  if (sch.const !== undefined && node !== sch.const) errs.push(`${at}: must be ${JSON.stringify(sch.const)}`);
  if (sch.enum && !sch.enum.includes(node)) errs.push(`${at}: must be one of ${sch.enum.join(", ")}`);
  if (sch.type) { const types = [].concat(sch.type), t = typeOf(node); if (!types.includes(t) && !(t === "integer" && types.includes("number"))) errs.push(`${at}: expected ${types.join("|")}, got ${t}`); }
  if (typeof node === "string" && sch.pattern && !new RegExp(sch.pattern).test(node)) errs.push(`${at}: doesn't match ${sch.pattern}`);
  if (typeof node === "number") { if (sch.minimum !== undefined && node < sch.minimum) errs.push(`${at}: below ${sch.minimum}`); if (sch.maximum !== undefined && node > sch.maximum) errs.push(`${at}: above ${sch.maximum}`); }
  if (node && typeof node === "object" && !Array.isArray(node)) {
    for (const r of sch.required || []) if (!(r in node)) errs.push(`${at}: missing "${r}"`);
    for (const [k, sub] of Object.entries(sch.properties || {})) if (k in node) errs.push(...validate(node[k], sub, `${at}.${k}`));
  }
  if (Array.isArray(node) && sch.items) node.forEach((x, i) => errs.push(...validate(x, sch.items, `${at}[${i}]`)));
  return errs;
}
await check("exported bundle validates against the OPS 0.3 schema", async () => { const e = validate(bundle, schema); assert.deepEqual(e.slice(0, 5), []); });
await check("schema rejects a broken procedure", async () => { const bad = JSON.parse(JSON.stringify(bundle)); delete bad.procedures[0].steps; bad.procedures[1].steps.push({ if: { field: "x", op: "near", value: 1 }, then: [] }); assert.ok(validate(bad, schema).length >= 2); });
await check("app's runtime copy matches the server module", async () => { execFileSync(process.execPath, [path.join(here, "..", "..", "tools", "sync-runtime.mjs"), "--check"], { stdio: "pipe" }); });
await check("runtime: resolves, asks, escalates and hands off", async () => {
  const r1 = opsResolve(bundle, { message: "We renewed 20 days ago and want our $900 back. Refund please.", facts: { plan: "growth", days_since_renewal: 20, amount: 900 } });
  assert.equal(r1.outcome, "resolve"); assert.equal(r1.procedure.id, "refund-after-renewal"); assert.ok(r1.plan.some((s) => /full refund/i.test(s.text)));
  const r2 = opsResolve(bundle, { message: "We renewed recently, refund please", facts: { plan: "growth" } }); assert.equal(r2.outcome, "ask"); assert.deepEqual(r2.missing_facts, ["days_since_renewal"]);
  const r3 = opsResolve(bundle, { message: "Refund on our renewal?", facts: { plan: "enterprise", days_since_renewal: 5, amount: 100 } }); assert.equal(r3.outcome, "escalate"); assert.deepEqual(r3.escalate_to, ["Account management"]);
  const r4 = opsResolve(bundle, { message: "Can you connect our 401k to Guideline?" }); assert.equal(r4.outcome, "handoff");
  const r5 = opsResolve(bundle, { message: "Please add a bonus to Friday's payroll run", facts: { customer: "Brightwater Clinics" } }); assert.equal(r5.procedure.id, "vip-brightwater");
  const r6 = opsResolve(bundle, { message: "Please add a bonus to Friday's payroll run", facts: { customer: "Oakline Logistics" } }); assert.notEqual(r6.procedure && r6.procedure.id, "vip-brightwater");
});
await check("schema is served publicly", async () => { const r = await fetch(base + "/schema/ops-0.3.json"); assert.equal(r.status, 200); assert.equal((await r.json()).$id, "tacit-ops/0.3"); });
let apiKey = "";
await check("agent API: no procedures yet gives 409", async () => {
  const k = await call("POST", "/api/workspaces/wsmoke1/keys", { name: "test" }); assert.equal(k.status, 201); apiKey = k.json.key; assert.match(apiKey, /^tk_/);
  const r = await fetch(base + "/api/v1/procedures", { headers: { Authorization: "Bearer " + apiKey } }); assert.equal(r.status, 409);
});
await check("agent API: resolve and list with a key", async () => {
  assert.equal((await call("PUT", "/api/workspaces/wsmoke1/state", { state: { procs: [], ops: bundle } })).status, 200);
  const h = { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" };
  const r = await fetch(base + "/api/v1/resolve", { method: "POST", headers: h, body: JSON.stringify({ message: "Payroll failed, the bank rejected the ACH debit", facts: { bank_status: "closed", hours_to_payroll: 10, hours_to_payrun: 10 } }) });
  const j = await r.json(); assert.equal(r.status, 200); assert.equal(j.procedure.id, "payroll-bank-rejected"); assert.equal(r.headers.get("access-control-allow-origin"), "*");
  const l = await (await fetch(base + "/api/v1/procedures", { headers: h })).json(); assert.equal(l.procedures.length, 10);
  const one = await fetch(base + "/api/v1/procedures/w2-correction", { headers: h }); assert.equal(one.status, 200);
  const keys = await call("GET", "/api/workspaces/wsmoke1/keys"); assert.equal(keys.json.keys[0].calls, 3);
});
await check("agent API: CORS preflight, bad key, revoked key", async () => {
  const o = await fetch(base + "/api/v1/resolve", { method: "OPTIONS" }); assert.equal(o.status, 204);
  assert.equal((await fetch(base + "/api/v1/procedures", { headers: { Authorization: "Bearer tk_nope" } })).status, 401);
  const keys = await call("GET", "/api/workspaces/wsmoke1/keys");
  await call("DELETE", "/api/workspaces/wsmoke1/keys/" + keys.json.keys[0].prefix);
  assert.equal((await fetch(base + "/api/v1/procedures", { headers: { Authorization: "Bearer " + apiKey } })).status, 401);
});

await check("logout ends the session", async () => { await call("POST", "/api/auth/logout"); const r = await call("GET", "/api/me"); assert.equal(r.status, 401); });
await check("login with wrong password fails, right one works", async () => {
  assert.equal((await call("POST", "/api/auth/login", { email: "ana@acme.io", password: "nope" })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { email: "ana@acme.io", password: "correct horse" })).status, 200);
  assert.equal((await call("GET", "/api/me")).json.workspaces.length, 1);
});

srv.kill(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);

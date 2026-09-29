// End-to-end smoke test: starts a stand-in Anthropic API and the Tacit server, then exercises every endpoint.
// Run with `npm test`. Needs no API key and no network.
import http from "node:http";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

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
await check("logout ends the session", async () => { await call("POST", "/api/auth/logout"); const r = await call("GET", "/api/me"); assert.equal(r.status, 401); });
await check("login with wrong password fails, right one works", async () => {
  assert.equal((await call("POST", "/api/auth/login", { email: "ana@acme.io", password: "nope" })).status, 401);
  assert.equal((await call("POST", "/api/auth/login", { email: "ana@acme.io", password: "correct horse" })).status, 200);
  assert.equal((await call("GET", "/api/me")).json.workspaces.length, 1);
});

srv.kill(); mock.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);

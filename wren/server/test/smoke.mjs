// End-to-end smoke test: engine, then the real HTTP server with a throwaway database.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import * as E from "../../public/engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
const ok = (name) => { passed++; console.log("  ✓", name); };

/* ---------- engine ---------- */
console.log("engine");
const skills = (w) => E.parseWord(w).skills;
assert.deepEqual(skills("stop"), ["b:st", "v:o", "c:p"]); ok("blend parse: stop");
assert.deepEqual(skills("cake"), ["c:c", "m:a_e", "c:k"]); ok("magic e parse: cake");
assert.deepEqual(skills("car"), ["c:c", "r:ar"]); ok("bossy r at word end: car");
assert.deepEqual(skills("jumping"), ["c:j", "v:u", "f:mp", "e:-ing"]); ok("ending parse: jumping");
assert.deepEqual(skills("said"), ["w:said"]); ok("sight word: said");
const blame = (w, h) => E.evidenceFrom([{ word: w, heard: h, status: "error" }]).filter((e) => !e.ok).map((e) => e.skill);
assert.deepEqual(blame("stop", "top"), ["b:st"]); ok("blames st- for stop→top");
assert.deepEqual(blame("rode", "rod"), ["m:o_e"]); ok("blames o–e for rode→rod");
assert.deepEqual(blame("rain", "ran"), ["t:ai"]); ok("blames ai for rain→ran");
const live = E.alignReading(E.PASSAGES[0].text, "sam has a red cap sam", { prefix: true });
assert.equal(live.filter((a) => a.status === "pending").length, live.length - 6); ok("live alignment doesn't jump ahead");
let state = {};
for (const p of E.PASSAGES) state = E.applyEvidence(state, E.evidenceFrom(E.alignReading(p.text, E.simulateReading(p.text, "typical5", 3))));
const map = E.masteryMap(state);
const targets = E.pickTargets(map, state);
assert.ok(targets.length >= 2 && targets.length <= 3); ok(`picks targets: ${targets.join(", ")}`);
for (const w of Object.keys(E.WORLDS)) {
  const s = E.generateStory({ world: w, childName: "Mia", map, targets });
  assert.ok(s.pages.length >= 7 && s.decodability >= 80, `${w} decodability ${s.decodability}`);
}
ok("stories in all 5 worlds are at least 80% decodable");

/* ---------- server ---------- */
console.log("server");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wren-"));
const PORT = 8900 + Math.floor(Math.random() * 90);
const srv = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(here, "..", "server.mjs")], {
  env: { ...process.env, PORT: String(PORT), WREN_DB: path.join(dir, "t.db"), ANTHROPIC_API_KEY: "" }, stdio: ["ignore", "pipe", "inherit"],
});
let log = "";
srv.stdout.on("data", (d) => (log += d));
await new Promise((r, j) => { const t = setInterval(() => { if (log.includes("http://")) { clearInterval(t); r(); } }, 50); setTimeout(() => j(new Error("server didn't start")), 8000); });

const base = `http://localhost:${PORT}/api`;
let cookie = "";
async function call(method, p, body, headers = {}) {
  const r = await fetch(base + p, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get("set-cookie");
  if (sc) cookie = sc.split(";")[0].endsWith("=") ? "" : sc.split(";")[0];
  return { status: r.status, body: await r.json(), setCookie: sc };
}
try {
  assert.equal((await call("GET", "/health")).body.mode, "server"); ok("health");
  let r = await call("POST", "/auth/signup", { name: "Ana", email: "ana@example.com", password: "short", adult: true });
  assert.equal(r.status, 400); assert.equal(r.body.field, "password"); ok("rejects a weak password");
  r = await call("POST", "/auth/signup", { name: "Ana", email: "ana@example.com", password: "reading-rocks-42" });
  assert.equal(r.body.field, "adult"); ok("requires an adult");
  r = await call("POST", "/auth/signup", { name: "Ana", email: "Ana@Example.com", password: "reading-rocks-42", adult: true });
  assert.equal(r.status, 201); assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Lax/); ok("signup sets an HttpOnly session cookie");
  assert.equal((await call("POST", "/auth/signup", { name: "A", email: "ana@example.com", password: "reading-rocks-42", adult: true })).status, 409); ok("duplicate email is 409");
  assert.equal((await call("POST", "/children", { name: "Mia", age: 5 })).status, 403); ok("can't add a child before consent");
  assert.equal((await call("POST", "/onboarding", { child: { name: "Mia", age: 5 } })).status, 400); ok("onboarding requires consent");
  r = await call("POST", "/onboarding", { consent: true, plan: "annual", child: { name: "Mia", age: 5, world: "dinos", pronoun: "she" } });
  assert.equal(r.status, 201); assert.equal(r.body.user.onboarded, true); assert.ok(r.body.user.trialEnds);
  const cid = r.body.child.id; ok("onboarding creates the child and starts the trial");
  assert.equal((await call("POST", "/auth/signout", {}, { origin: "http://evil.example" })).status, 403); ok("blocks cross-origin writes");
  r = await call("POST", `/children/${cid}/readings`, { kind: "assessment", seconds: 90, passages: E.PASSAGES.map((p) => ({ text: p.text, transcript: E.simulateReading(p.text, "typical5", 3) })) });
  assert.equal(r.status, 201); assert.ok(r.body.reading.accuracy > 50 && r.body.reading.accuracy < 100); assert.ok(r.body.report.targets.length >= 2);
  ok(`scores a reading check (${r.body.reading.accuracy}% accurate, targets ${r.body.report.targets.join(", ")})`);
  r = await call("POST", `/children/${cid}/story`, {});
  assert.equal(r.status, 200); assert.ok(r.body.story.pages.length >= 7); ok(`writes a story: "${r.body.story.title}" (${r.body.story.decodability}% decodable)`);
  const savedCookie = cookie;
  await call("POST", "/auth/signout", {});
  assert.equal((await call("GET", `/children/${cid}`)).status, 401); ok("signout ends the session");
  assert.equal((await call("POST", "/auth/signin", { email: "ana@example.com", password: "nope-nope-nope" })).status, 401); ok("wrong password is 401");
  cookie = savedCookie;
  assert.equal((await call("GET", "/auth/me")).body.user, null); ok("old session token is revoked server-side");
  cookie = "";
  r = await call("POST", "/auth/forgot", { email: "ana@example.com" });
  const token = r.body.devLink.split("/").pop();
  assert.equal((await call("POST", "/auth/forgot", { email: "nobody@example.com" })).body.ok, true); ok("forgot password doesn't reveal accounts");
  r = await call("POST", "/auth/reset", { token, password: "a-brand-new-one-7" });
  assert.equal(r.status, 200); ok("reset password signs in");
  assert.equal((await call("POST", "/auth/reset", { token, password: "again-and-again-8" })).status, 400); ok("reset tokens are single-use");
  r = await call("GET", "/account/export");
  assert.equal(r.body.children[0].readings.length, 1); ok("exports family data");
  const other = cookie; cookie = "";
  await call("POST", "/auth/signup", { name: "Eve", email: "eve@example.com", password: "reading-rocks-42", adult: true });
  assert.equal((await call("GET", `/children/${cid}`)).status, 404); ok("one parent can't read another's child");
  cookie = other;
  assert.equal((await call("DELETE", "/account", { password: "wrong" })).status, 400);
  assert.equal((await call("DELETE", "/account", { password: "a-brand-new-one-7" })).status, 200);
  assert.equal((await call("POST", "/auth/signin", { email: "ana@example.com", password: "a-brand-new-one-7" })).status, 401); ok("delete account erases it");
  const page = await fetch(`http://localhost:${PORT}/`); assert.equal(page.status, 200);
  assert.equal((await fetch(`http://localhost:${PORT}/..%2fserver/server.mjs`)).status, 403); ok("serves the site and blocks path traversal");
  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error("\nFAILED:", e.message); process.exitCode = 1;
} finally {
  srv.kill(); fs.rmSync(dir, { recursive: true, force: true });
}

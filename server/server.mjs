// Tacit server: accounts, sessions, workspaces, AI (Claude) and a Zendesk importer.
// Zero framework, one dependency (@anthropic-ai/sdk). Node 22+ (uses the built-in node:sqlite).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import Anthropic from "@anthropic-ai/sdk";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const MODEL = process.env.TACIT_MODEL || "claude-opus-5-5";
const AI_DAILY_LIMIT = Number(process.env.TACIT_AI_DAILY_LIMIT || 200);
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const APP_FILE = process.env.TACIT_APP_FILE || path.join(here, "..", "company-brain", "index.html");
const DB_FILE = process.env.TACIT_DB || path.join(here, "data", "tacit.db");
const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_AI_INPUT = 64 * 1024;
const SESSION_DAYS = 30;
const VERSION = "0.4.0";

/* ---------------- database ---------------- */
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, company TEXT NOT NULL DEFAULT '',
    pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, onboarded INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, csv TEXT NOT NULL, rows INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT 'csv', state TEXT, created TEXT NOT NULL, updated TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS ai_usage (user_id TEXT NOT NULL, day TEXT NOT NULL, calls INTEGER NOT NULL,
    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
  CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, name TEXT,
    company TEXT, team_size TEXT, helpdesk TEXT, source TEXT, created TEXT NOT NULL);
`);
const q = (sql) => db.prepare(sql);
const now = () => new Date().toISOString();
const newId = (p) => p + crypto.randomBytes(9).toString("base64url");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

/* ---------------- passwords & sessions ---------------- */
function hashPassword(pw, salt) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k.toString("hex")))));
}
async function verifyPassword(pw, user) {
  const h = Buffer.from(await hashPassword(pw, user.pw_salt), "hex");
  const stored = Buffer.from(user.pw_hash, "hex");
  return h.length === stored.length && crypto.timingSafeEqual(h, stored);
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  q("INSERT INTO sessions VALUES (?,?,?,?)").run(sha256(token), userId, now(), Date.now() + SESSION_DAYS * 864e5);
  return token;
}
function sessionCookie(token, maxAge) {
  return `tacit_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${COOKIE_SECURE ? "; Secure" : ""}`;
}
function currentUser(req) {
  const m = /(?:^|;\s*)tacit_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "");
  if (!m) return null;
  const s = q("SELECT * FROM sessions WHERE token_hash = ?").get(sha256(m[1]));
  if (!s || s.expires < Date.now()) return null;
  return q("SELECT * FROM users WHERE id = ?").get(s.user_id) || null;
}
const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, company: u.company, onboarded: !!u.onboarded, created: u.created });

/* ---------------- tiny rate limiter ---------------- */
const buckets = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const b = buckets.get(key) || { n: 0, reset: t + windowMs };
  if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
  b.n++; buckets.set(key, b);
  return b.n > max;
}

/* ---------------- http helpers ---------------- */
class HttpError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
const SEC_HEADERS = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" };
function send(res, status, body, headers = {}) {
  const isStr = typeof body === "string";
  res.writeHead(status, { ...SEC_HEADERS, "Content-Type": isStr ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, "That upload is too large.", "too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new HttpError(400, "The request body isn't valid JSON.", "bad_json")); } });
    req.on("error", reject);
  });
}
const ip = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";
const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/* ---------------- AI ---------------- */
let anthropic = null;
const aiConfigured = () => !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
function client() { if (!anthropic) anthropic = new Anthropic(); return anthropic; }
const SYSTEM = "You are the assistant built into Tacit, a product that learns how a customer support team handles situations from their resolved tickets and turns it into procedures. The user's message contains the instructions for this task and the data to use. Follow those instructions exactly, keep to the data you are given, and never invent thresholds, owners or policies.";

function parseLooseJSON(text) {
  const t = text.trim();
  try { return JSON.parse(t); } catch {}
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = Math.min(...["{", "["].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c))));
  const b = Math.max(t.lastIndexOf("}"), t.lastIndexOf("]"));
  if (a !== Infinity && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch {} }
  throw new HttpError(502, "Claude's answer wasn't valid JSON. Try again.", "invalid_json");
}
function toMessages(input) {
  if (typeof input === "string") { if (!input.trim()) throw new HttpError(400, "Nothing to send.", "invalid_request"); return [{ role: "user", content: input }]; }
  if (!Array.isArray(input) || !input.length) throw new HttpError(400, "Send a prompt or a list of turns.", "invalid_request");
  const msgs = input.map((m) => {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) throw new HttpError(400, "Each turn needs a role of user or assistant and some text.", "invalid_request");
    return { role: m.role, content: m.content };
  });
  if (msgs[0].role !== "user" || msgs[msgs.length - 1].role !== "user") throw new HttpError(400, "Turns must start and end with the user.", "invalid_request");
  return msgs;
}
async function runAI(user, body) {
  if (!aiConfigured()) throw new HttpError(503, "AI isn't configured on this server. Set ANTHROPIC_API_KEY and restart.", "ai_not_configured");
  const raw = JSON.stringify(body.input ?? "");
  if (raw.length > MAX_AI_INPUT) throw new HttpError(413, "That's too much text for one request. Send less at a time.", "prompt_too_large");
  const day = now().slice(0, 10);
  const use = q("SELECT calls FROM ai_usage WHERE user_id = ? AND day = ?").get(user.id, day);
  if (use && use.calls >= AI_DAILY_LIMIT) throw new HttpError(429, `You've used today's ${AI_DAILY_LIMIT} AI requests. It resets tomorrow.`, "rate_limited");
  if (limited("ai:" + user.id, 20, 60_000)) throw new HttpError(429, "Too many AI requests in a minute. Wait a moment.", "rate_limited");
  const messages = toMessages(body.input);
  if (body.json) messages[messages.length - 1] = { role: "user", content: messages[messages.length - 1].content + "\n\nReply with only the JSON value, no other text." };
  const effort = ["low", "medium", "high"].includes(body.effort) ? body.effort : "low";
  let resp;
  try {
    resp = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages,
      output_config: { effort },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, "The server's Anthropic API key was rejected.", "ai_not_configured");
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, "Claude is busy right now. Try again in a minute.", "rate_limited");
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(400, "Claude couldn't accept that request: " + e.message, "invalid_request");
    if (e instanceof Anthropic.APIError) throw new HttpError(502, "Claude had a problem answering. Try again.", "upstream_error");
    throw new HttpError(502, "Couldn't reach Claude. Check the server's network.", "upstream_error");
  }
  q(`INSERT INTO ai_usage VALUES (?,?,1,?,?) ON CONFLICT(user_id, day) DO UPDATE SET calls = calls + 1,
     input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`)
    .run(user.id, day, resp.usage?.input_tokens || 0, resp.usage?.output_tokens || 0);
  if (resp.stop_reason === "refusal") throw new HttpError(422, "Claude declined this request. Change what it asks and try again.", "refused");
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  if (!text) throw new HttpError(502, "Claude returned an empty answer.", "empty_completion");
  const out = { text, truncated: resp.stop_reason === "max_tokens", model: resp.model };
  if (body.json) out.json = parseLooseJSON(text);
  return out;
}

/* ---------------- Zendesk importer ---------------- */
function csvEscape(v) { v = String(v ?? "").replace(/\r?\n/g, " ").trim(); return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
async function zendeskImport({ subdomain, email, token, limit }) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/i.test(subdomain)) throw new HttpError(400, "Use just your Zendesk subdomain, like 'acme' from acme.zendesk.com.", "bad_subdomain");
  if (!validEmail(email) || !token) throw new HttpError(400, "Add the agent email and API token from Zendesk Admin Center.", "bad_credentials");
  const base = `https://${subdomain}.zendesk.com/api/v2`;
  const auth = "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64");
  const zget = async (url) => {
    const r = await fetch(url, { headers: { Authorization: auth, Accept: "application/json" } });
    if (r.status === 401 || r.status === 403) throw new HttpError(400, "Zendesk rejected those credentials. Check the email and API token.", "zendesk_auth");
    if (r.status === 429) throw new HttpError(429, "Zendesk is rate limiting us. Try again in a minute.", "zendesk_rate");
    if (!r.ok) throw new HttpError(502, `Zendesk answered ${r.status}.`, "zendesk_error");
    return r.json();
  };
  const max = Math.min(Math.max(Number(limit) || 200, 20), 1000);
  const tickets = [];
  let url = `${base}/search.json?query=${encodeURIComponent("type:ticket status:solved")}&sort_by=updated_at&sort_order=desc&per_page=100`;
  while (url && tickets.length < max) { const page = await zget(url); tickets.push(...(page.results || [])); url = page.next_page; }
  tickets.length = Math.min(tickets.length, max);
  if (tickets.length < 4) throw new HttpError(400, "We found fewer than 4 solved tickets in that Zendesk account.", "too_few");
  const comments = new Map();
  for (let i = 0; i < tickets.length; i += 5) {
    await Promise.all(tickets.slice(i, i + 5).map(async (t) => { const c = await zget(`${base}/tickets/${t.id}/comments.json`); comments.set(t.id, c.comments || []); }));
  }
  const userIds = [...new Set(tickets.map((t) => t.assignee_id).filter(Boolean))];
  const names = new Map();
  for (let i = 0; i < userIds.length; i += 100) { const u = await zget(`${base}/users/show_many.json?ids=${userIds.slice(i, i + 100).join(",")}`); (u.users || []).forEach((x) => names.set(x.id, x.name)); }
  const fieldIds = [...new Set(tickets.flatMap((t) => (t.custom_fields || []).filter((f) => f.value !== null && f.value !== "" && typeof f.value !== "object").map((f) => f.id)))].slice(0, 20);
  const head = ["ticket_id", "created", "agent", "subject", "message", "internal_note", "priority", "channel", ...fieldIds.map((id) => "field_" + id)];
  const lines = [head.join(",")];
  for (const t of tickets) {
    const cs = comments.get(t.id) || [];
    const privateNotes = cs.filter((c) => !c.public).map((c) => c.plain_body || c.body);
    const agentReplies = cs.slice(1).filter((c) => c.public && c.author_id === t.assignee_id).map((c) => c.plain_body || c.body);
    const note = (privateNotes.length ? privateNotes : agentReplies.slice(-1)).join(". ").slice(0, 2000);
    const fv = new Map((t.custom_fields || []).map((f) => [f.id, f.value]));
    lines.push([t.id, (t.created_at || "").slice(0, 10), names.get(t.assignee_id) || "", t.subject, (t.description || "").slice(0, 1500), note, t.priority || "", t.via?.channel || "", ...fieldIds.map((id) => fv.get(id) ?? "")].map(csvEscape).join(","));
  }
  return { csv: lines.join("\n"), rows: tickets.length };
}

/* ---------------- app page ---------------- */
function appHtml() {
  const body = fs.readFileSync(APP_FILE, "utf8");
  const title = (/<title>([^<]*)<\/title>/.exec(body) || [])[1] || "Tacit";
  const desc = "Tacit learns how your support team really handles each situation from resolved tickets, and turns it into procedures your AI agent can follow. Start with a free knowledge audit.";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="description" content="${desc}"><meta property="og:title" content="${title}"><meta property="og:description" content="${desc}"><meta property="og:type" content="website"><meta name="twitter:card" content="summary">
<meta name="theme-color" content="#2F3DC4"><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect x='3' y='3' width='26' height='26' rx='5' fill='none' stroke='%231B1A17' stroke-width='3.5'/%3E%3Crect x='8' y='8' width='7' height='7' rx='1.5' fill='%232F3DC4'/%3E%3C/svg%3E">
<style>[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
}

/* ---------------- routes ---------------- */
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  const m = req.method;

  if (m === "GET" && (p === "/" || p === "/index.html")) return send(res, 200, appHtml(), { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
  if (m === "GET" && p === "/robots.txt") return send(res, 200, "User-agent: *\nAllow: /\nDisallow: /api/\n");
  if (!p.startsWith("/api/")) return send(res, 404, { error: "Not found", code: "not_found" });

  // Mutating API calls must carry a custom header, which cross-site forms can't send.
  if (m !== "GET" && req.headers["x-tacit"] !== "1") throw new HttpError(403, "Missing request header.", "csrf");

  if (m === "GET" && p === "/api/health") return send(res, 200, { ok: true, ai: aiConfigured(), model: MODEL, version: VERSION, zendesk: true, waitlist: true });

  if (m === "POST" && p === "/api/waitlist") {
    if (limited("wl:" + ip(req), 10, 3600_000)) throw new HttpError(429, "Too many sign-ups from here. Try later.", "rate_limited");
    const b = await readBody(req, 10_000);
    const email = str(b.email).toLowerCase();
    if (!validEmail(email)) throw new HttpError(400, "That email doesn't look right. Try name@company.com.", "bad_email");
    q("INSERT INTO waitlist (email,name,company,team_size,helpdesk,source,created) VALUES (?,?,?,?,?,?,?)").run(email, str(b.name), str(b.company), str(b.team_size, 40), str(b.helpdesk, 40), str(b.source, 40), now());
    return send(res, 201, { ok: true });
  }

  if (m === "POST" && p === "/api/auth/signup") {
    if (limited("auth:" + ip(req), 20, 900_000)) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.", "rate_limited");
    const b = await readBody(req, 10_000);
    const name = str(b.name, 80), email = str(b.email).toLowerCase(), company = str(b.company, 80), pw = typeof b.password === "string" ? b.password : "";
    if (!name) throw new HttpError(400, "Add your name.", "bad_name");
    if (!validEmail(email)) throw new HttpError(400, "That email doesn't look right. Try name@company.com.", "bad_email");
    if (pw.length < 8 || pw.length > 200) throw new HttpError(400, "Use a password with at least 8 characters.", "weak_password");
    if (q("SELECT 1 FROM users WHERE email = ?").get(email)) throw new HttpError(409, "There's already an account for this email. Sign in instead.", "exists");
    const salt = crypto.randomBytes(16).toString("hex");
    const id = newId("u_");
    q("INSERT INTO users (id,email,name,company,pw_hash,pw_salt,onboarded,created) VALUES (?,?,?,?,?,?,0,?)").run(id, email, name, company || "My company", await hashPassword(pw, salt), salt, now());
    const token = createSession(id);
    return send(res, 201, { user: publicUser(q("SELECT * FROM users WHERE id = ?").get(id)) }, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
  }
  if (m === "POST" && p === "/api/auth/login") {
    if (limited("auth:" + ip(req), 20, 900_000)) throw new HttpError(429, "Too many attempts. Wait 15 minutes and try again.", "rate_limited");
    const b = await readBody(req, 10_000);
    const u = q("SELECT * FROM users WHERE email = ?").get(str(b.email).toLowerCase());
    if (!u || !(await verifyPassword(typeof b.password === "string" ? b.password : "", u))) throw new HttpError(401, "That email and password don't match an account.", "bad_login");
    const token = createSession(u.id);
    return send(res, 200, { user: publicUser(u) }, { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 86400) });
  }
  if (m === "POST" && p === "/api/auth/logout") {
    const mm = /(?:^|;\s*)tacit_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie || "");
    if (mm) q("DELETE FROM sessions WHERE token_hash = ?").run(sha256(mm[1]));
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  }

  const user = currentUser(req);
  if (!user) throw new HttpError(401, "Sign in to continue.", "unauthenticated");

  if (m === "GET" && p === "/api/me") {
    const ws = q("SELECT id,name,rows,source,created,updated FROM workspaces WHERE user_id = ? ORDER BY created").all(user.id);
    const day = now().slice(0, 10);
    const use = q("SELECT calls FROM ai_usage WHERE user_id = ? AND day = ?").get(user.id, day);
    return send(res, 200, { user: publicUser(user), workspaces: ws, ai: { configured: aiConfigured(), usedToday: use?.calls || 0, dailyLimit: AI_DAILY_LIMIT } });
  }
  if (m === "PATCH" && p === "/api/me") {
    const b = await readBody(req, 10_000);
    const name = str(b.name, 80) || user.name, company = typeof b.company === "string" ? str(b.company, 80) : user.company;
    const onboarded = b.onboarded === true ? 1 : user.onboarded;
    q("UPDATE users SET name = ?, company = ?, onboarded = ? WHERE id = ?").run(name, company, onboarded, user.id);
    return send(res, 200, { user: publicUser(q("SELECT * FROM users WHERE id = ?").get(user.id)) });
  }
  if (m === "DELETE" && p === "/api/me") {
    q("DELETE FROM workspaces WHERE user_id = ?").run(user.id);
    q("DELETE FROM sessions WHERE user_id = ?").run(user.id);
    q("DELETE FROM ai_usage WHERE user_id = ?").run(user.id);
    q("DELETE FROM users WHERE id = ?").run(user.id);
    return send(res, 200, { ok: true }, { "Set-Cookie": sessionCookie("", 0) });
  }

  if (m === "POST" && p === "/api/workspaces") {
    const b = await readBody(req, MAX_CSV_BYTES + 20_000);
    const name = str(b.name, 80) || "My workspace";
    const csv = typeof b.csv === "string" ? b.csv : "";
    if (!csv.trim() || csv.split("\n").length < 5) throw new HttpError(400, "Add a CSV with a header row and at least 4 tickets.", "bad_csv");
    const id = typeof b.id === "string" && /^w[a-z0-9]{4,24}$/.test(b.id) && !q("SELECT 1 FROM workspaces WHERE id = ?").get(b.id) ? b.id : newId("w");
    q("INSERT INTO workspaces (id,user_id,name,csv,rows,source,state,created,updated) VALUES (?,?,?,?,?,?,NULL,?,?)").run(id, user.id, name, csv, Math.max(0, csv.split("\n").length - 1), str(b.source, 20) || "csv", now(), now());
    q("UPDATE users SET onboarded = 1 WHERE id = ?").run(user.id);
    return send(res, 201, { id, name });
  }
  const wm = /^\/api\/workspaces\/([A-Za-z0-9_-]+)(\/state)?$/.exec(p);
  if (wm) {
    const w = q("SELECT * FROM workspaces WHERE id = ? AND user_id = ?").get(wm[1], user.id);
    if (!w) throw new HttpError(404, "That workspace doesn't exist, or it isn't yours.", "not_found");
    if (m === "GET" && !wm[2]) return send(res, 200, { id: w.id, name: w.name, csv: w.csv, rows: w.rows, source: w.source, state: w.state ? JSON.parse(w.state) : null, created: w.created });
    if (m === "PUT" && wm[2]) {
      const b = await readBody(req, MAX_STATE_BYTES);
      q("UPDATE workspaces SET state = ?, updated = ? WHERE id = ?").run(JSON.stringify(b.state ?? null), now(), w.id);
      return send(res, 200, { ok: true });
    }
    if (m === "PATCH" && !wm[2]) { const b = await readBody(req, 10_000); q("UPDATE workspaces SET name = ?, updated = ? WHERE id = ?").run(str(b.name, 80) || w.name, now(), w.id); return send(res, 200, { ok: true }); }
    if (m === "DELETE" && !wm[2]) { q("DELETE FROM workspaces WHERE id = ?").run(w.id); return send(res, 200, { ok: true }); }
  }

  if (m === "POST" && p === "/api/ai") {
    const b = await readBody(req, MAX_AI_INPUT + 10_000);
    return send(res, 200, await runAI(user, b));
  }

  if (m === "POST" && p === "/api/connectors/zendesk/import") {
    if (limited("zd:" + user.id, 5, 3600_000)) throw new HttpError(429, "Too many imports this hour.", "rate_limited");
    const b = await readBody(req, 10_000);
    const { csv, rows } = await zendeskImport({ subdomain: str(b.subdomain, 63).toLowerCase(), email: str(b.email).toLowerCase(), token: str(b.token, 200), limit: b.limit });
    return send(res, 200, { csv, rows }); // credentials are used once and never stored
  }

  throw new HttpError(404, "Not found.", "not_found");
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    if (e instanceof HttpError) return send(res, e.status, { error: e.message, code: e.code });
    console.error(e);
    send(res, 500, { error: "Something went wrong on our side.", code: "server_error" });
  });
});
// Expired sessions are cleaned up hourly.
setInterval(() => q("DELETE FROM sessions WHERE expires < ?").run(Date.now()), 3600_000).unref();
server.listen(PORT, () => console.log(`Tacit ${VERSION} on http://localhost:${PORT}  model=${MODEL}  ai=${aiConfigured() ? "on" : "off (set ANTHROPIC_API_KEY)"}`));

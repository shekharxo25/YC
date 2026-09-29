// Wren server. It serves the landing page and app, and runs accounts, sessions, child profiles and reading sessions.
// It has no dependencies and needs Node 22.13 or later, which has the built-in node:sqlite. The Claude story writer is optional.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createCore, ApiError, aiStoryPrompt } from "../public/core.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8790);
const PUBLIC_DIR = path.resolve(here, "..", "public");
const DB_FILE = process.env.WREN_DB || path.join(here, "data", "wren.db");
const COOKIE_SECURE = process.env.COOKIE_SECURE === "1";
const DEV = process.env.NODE_ENV !== "production";
const MODEL = process.env.WREN_MODEL || "claude-sonnet-5-5";
const SESSION_DAYS = 30;
const COOKIE = "wren_session";

/* ---------------- database ---------------- */
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL,
    created TEXT NOT NULL, onboarded INTEGER NOT NULL DEFAULT 0, consent_at TEXT, plan TEXT, trial_ends TEXT,
    audio_opt_in INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created TEXT NOT NULL, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS children (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, age INTEGER NOT NULL,
    pronoun TEXT, world TEXT, concern TEXT, avatar TEXT, state TEXT NOT NULL DEFAULT '{}', created TEXT NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0, last_day TEXT, feathers INTEGER NOT NULL DEFAULT 0, assessed INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS readings (
    id TEXT PRIMARY KEY, child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE, at TEXT NOT NULL, doc TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS readings_child ON readings(child_id, at);
  CREATE INDEX IF NOT EXISTS children_user ON children(user_id);
`);
const q = (sql) => db.prepare(sql);
const cols = (table) => new Set(q(`PRAGMA table_info(${table})`).all().map((c) => c.name));
const USER_COLS = cols("users");
const CHILD_COLS = cols("children");

function updater(table, allowed, jsonCols = []) {
  return async (id, patch) => {
    const keys = Object.keys(patch).filter((k) => allowed.has(k) && k !== "id");
    if (!keys.length) return;
    const vals = keys.map((k) => (jsonCols.includes(k) ? JSON.stringify(patch[k]) : patch[k]));
    q(`UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`).run(...vals, id);
  };
}
const rowChild = (r) => r && { ...r, state: JSON.parse(r.state || "{}") };
const store = {
  users: {
    byEmail: async (e) => q("SELECT * FROM users WHERE email = ?").get(e) || null,
    byId: async (id) => q("SELECT * FROM users WHERE id = ?").get(id) || null,
    insert: async (u) => { const k = Object.keys(u).filter((x) => USER_COLS.has(x)); q(`INSERT INTO users (${k}) VALUES (${k.map(() => "?")})`).run(...k.map((x) => u[x])); },
    update: updater("users", USER_COLS),
    remove: async (id) => { q("DELETE FROM users WHERE id = ?").run(id); },
  },
  children: {
    byUser: async (uid) => q("SELECT * FROM children WHERE user_id = ? ORDER BY created").all(uid).map(rowChild),
    byId: async (id) => rowChild(q("SELECT * FROM children WHERE id = ?").get(id)) || null,
    insert: async (c) => { const k = Object.keys(c).filter((x) => CHILD_COLS.has(x)); q(`INSERT INTO children (${k}) VALUES (${k.map(() => "?")})`).run(...k.map((x) => (x === "state" ? JSON.stringify(c[x]) : c[x]))); },
    update: updater("children", CHILD_COLS, ["state"]),
    remove: async (id) => { q("DELETE FROM children WHERE id = ?").run(id); },
  },
  readings: {
    byChild: async (cid, limit) => q("SELECT doc FROM readings WHERE child_id = ? ORDER BY at DESC LIMIT ?").all(cid, limit).map((r) => JSON.parse(r.doc)),
    insert: async (r) => { q("INSERT INTO readings (id, child_id, at, doc) VALUES (?,?,?,?)").run(r.id, r.child_id, r.at, JSON.stringify(r)); },
    removeByChild: async (cid) => { q("DELETE FROM readings WHERE child_id = ?").run(cid); },
  },
  resets: {
    insert: async (r) => { q("INSERT INTO resets VALUES (?,?,?,?)").run(r.token_hash, r.user_id, r.expires, r.used); },
    get: async (h) => q("SELECT * FROM resets WHERE token_hash = ?").get(h) || null,
    markUsed: async (h) => { q("UPDATE resets SET used = 1 WHERE token_hash = ?").run(h); },
  },
};

/* ---------------- crypto ---------------- */
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 }, (e, k) => (e ? rej(e) : res(k.toString("hex")))));
const cryptoImpl = {
  hashPassword: async (pw) => { const salt = crypto.randomBytes(16).toString("hex"); return { hash: await scrypt(pw, salt), salt }; },
  verifyPassword: async (pw, hash, salt) => {
    const a = Buffer.from(await scrypt(pw, salt), "hex"); const b = Buffer.from(hash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  randomToken: () => crypto.randomBytes(32).toString("base64url"),
  sha256: async (s) => sha256(s),
  id: (p) => p + crypto.randomBytes(9).toString("base64url"),
};

/* ---------------- optional Claude story writer ---------------- */
const aiKey = process.env.ANTHROPIC_API_KEY;
async function aiStory(ctx) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": aiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 900,
      system: "You write decodable early-reader stories for a children's reading tutor. Follow the phonics constraints exactly. Output JSON only.",
      messages: [{ role: "user", content: aiStoryPrompt(ctx) }],
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error("ai " + r.status);
  const j = await r.json();
  const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  return JSON.parse(text.slice(a, b + 1));
}

const core = createCore(store, cryptoImpl, {
  ai: aiKey ? aiStory : null,
  devResetLinks: DEV,
  onReset: (u, token) => { if (DEV) console.log(`[wren] password reset for ${u.email}: http://localhost:${PORT}/app.html#/reset/${token}`); },
});

/* ---------------- sessions ---------------- */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  q("INSERT INTO sessions VALUES (?,?,?,?)").run(sha256(token), userId, new Date().toISOString(), Date.now() + SESSION_DAYS * 864e5);
  return token;
}
const cookie = (v, maxAge) => `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${COOKIE_SECURE ? "; Secure" : ""}`;
function tokenOf(req) { const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]+)`).exec(req.headers.cookie || ""); return m ? m[1] : null; }
function currentUser(req) {
  const t = tokenOf(req);
  if (!t) return null;
  const s = q("SELECT * FROM sessions WHERE token_hash = ?").get(sha256(t));
  if (!s || s.expires < Date.now()) return null;
  return q("SELECT * FROM users WHERE id = ?").get(s.user_id) || null;
}

/* ---------------- rate limiting ---------------- */
const buckets = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const b = buckets.get(key) || { n: 0, reset: t + windowMs };
  if (t > b.reset) { b.n = 0; b.reset = t + windowMs; }
  b.n++; buckets.set(key, b);
  return b.n > max;
}
setInterval(() => { const t = Date.now(); for (const [k, b] of buckets) if (t > b.reset) buckets.delete(k); }, 60e3).unref();

/* ---------------- http ---------------- */
const SEC = {
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "SAMEORIGIN",
  "Permissions-Policy": "microphone=(self), camera=(), geolocation=()",
};
function sendJSON(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req, limit = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(new ApiError(413, "That request is too large.", "too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); } catch { reject(new ApiError(400, "Bad JSON.", "bad_json")); } });
    req.on("error", reject);
  });
}
const clientIp = (req) => (process.env.TRUST_PROXY === "1" && (req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";

// Cross-site request forgery guard. A state-changing request must come from this origin and must be JSON.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, tests)
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm", ".vtt": "text/vtt; charset=utf-8", ".ico": "image/x-icon", ".woff2": "font/woff2" };

function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel === "/app" || rel === "/signin" || rel === "/signup") rel = "/app.html";
  const file = path.resolve(PUBLIC_DIR, "." + rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return sendJSON(res, 403, { error: "Forbidden" });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { ...SEC, "Content-Type": "text/plain" }); return res.end("Not found"); }
    const type = MIME[path.extname(file)] || "application/octet-stream";
    const cache = /\.(mp4|webm|jpg|png|webp|woff2)$/.test(file) ? "public, max-age=86400" : "no-cache";
    const range = req.headers.range;
    if (range && /^bytes=\d*-\d*$/.test(range)) {
      // Range support lets the demo video seek on Safari and iOS.
      let [a, b] = range.slice(6).split("-").map((x) => (x === "" ? NaN : Number(x)));
      if (isNaN(a)) { a = st.size - b; b = st.size - 1; } else if (isNaN(b) || b >= st.size) b = st.size - 1;
      if (a > b || a < 0) { res.writeHead(416, { "Content-Range": `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { ...SEC, "Content-Type": type, "Content-Range": `bytes ${a}-${b}/${st.size}`, "Accept-Ranges": "bytes", "Content-Length": b - a + 1, "Cache-Control": cache });
      return fs.createReadStream(file, { start: a, end: b }).pipe(res);
    }
    res.writeHead(200, { ...SEC, "Content-Type": type, "Content-Length": st.size, "Accept-Ranges": "bytes", "Cache-Control": cache });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return sendJSON(res, 405, { error: "Method not allowed" });
    return serveStatic(req, res, url.pathname);
  }
  const route = url.pathname.slice(4);
  try {
    if (route === "/health") return sendJSON(res, 200, { ok: true, mode: "server", ai: !!aiKey, version: "1.0.0" });
    const mutating = req.method !== "GET";
    if (mutating) {
      if (!sameOrigin(req)) throw new ApiError(403, "Cross-site request blocked.", "csrf");
      if (!(req.headers["content-type"] || "").startsWith("application/json")) throw new ApiError(415, "Send JSON.", "content_type");
    }
    const ipKey = clientIp(req);
    if (/^\/auth\/(signin|signup|forgot|reset)$/.test(route) && limited("auth:" + ipKey, 20, 15 * 60e3)) throw new ApiError(429, "Too many attempts. Wait a few minutes and try again.", "rate_limited");
    if (route.endsWith("/story") && limited("story:" + ipKey, 30, 60 * 60e3)) throw new ApiError(429, "That's a lot of stories for one hour. Try again soon.", "rate_limited");
    const body = mutating ? await readBody(req) : {};
    const user = currentUser(req);
    const out = await core.handle(req.method, route, body, user);
    const headers = {};
    if (out.session) {
      const s = out.session;
      const current = tokenOf(req);
      if (s.revokeAll) q("DELETE FROM sessions WHERE user_id = ?").run(s.revokeAll);
      if (s.destroy) { if (current) q("DELETE FROM sessions WHERE token_hash = ?").run(sha256(current)); headers["Set-Cookie"] = cookie("", 0); }
      if (s.create) {
        const uid = s.create;
        if (s.revokeOthers) q("DELETE FROM sessions WHERE user_id = ?").run(uid);
        headers["Set-Cookie"] = cookie(createSession(uid), SESSION_DAYS * 86400);
      } else if (s.revokeOthers && user && current) {
        q("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?").run(user.id, sha256(current));
      }
    }
    sendJSON(res, out.status, out.body, headers);
  } catch (e) {
    if (e instanceof ApiError) return sendJSON(res, e.status, { error: e.message, code: e.code, field: e.field });
    console.error("[wren]", e);
    sendJSON(res, 500, { error: "Something went wrong on our side. Please try again.", code: "server" });
  }
});

setInterval(() => q("DELETE FROM sessions WHERE expires < ?").run(Date.now()), 3600e3).unref();

server.listen(PORT, () => {
  console.log(`[wren] http://localhost:${PORT}  (db: ${path.relative(process.cwd(), DB_FILE)}, stories: ${aiKey ? "Claude " + MODEL + " + engine check" : "engine"})`);
});

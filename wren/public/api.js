// Wren API client. With the Node server running, calls go to /api over an HttpOnly session cookie.
// When the page is opened as a static file (file://, GitHub Pages or a Claude artifact), the same core runs in
// the browser against localStorage. That "demo mode" keeps the whole sign-up flow working anywhere.
import { createCore, ApiError } from "./core.js";

let modePromise = null;
let local = null;

function detect() {
  if (location.protocol === "file:") return Promise.resolve("local");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 2500);
  return fetch("api/health", { signal: ctl.signal, cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => (j && j.mode === "server" ? "server" : "local"))
    .catch(() => "local")
    .finally(() => clearTimeout(t));
}
export const mode = () => (modePromise ||= detect());

/* ---------------- local (browser) backend ---------------- */
const DB_KEY = "wren.db.v1";
const TOKEN_KEY = "wren.session.v1";
const mem = { db: null, token: null };
function ls(op, k, v) {
  try { if (op === "get") return localStorage.getItem(k); if (op === "set") localStorage.setItem(k, v); if (op === "del") localStorage.removeItem(k); } catch { /* private mode */ }
  return null;
}
function load() {
  if (mem.db) return mem.db;
  let db = null;
  try { db = JSON.parse(ls("get", DB_KEY) || "null"); } catch {}
  mem.db = db && db.users ? db : { users: [], children: [], readings: [], resets: [], sessions: [] };
  return mem.db;
}
function save() { ls("set", DB_KEY, JSON.stringify(mem.db)); }
const table = (name) => load()[name];
const byKey = (name, k, v) => table(name).find((r) => r[k] === v) || null;

const localStore = {
  users: {
    byEmail: async (e) => byKey("users", "email", e),
    byId: async (id) => byKey("users", "id", id),
    insert: async (u) => { table("users").push(u); save(); },
    update: async (id, p) => { Object.assign(byKey("users", "id", id) || {}, p); save(); },
    remove: async (id) => { const db = load(); db.users = db.users.filter((u) => u.id !== id); db.sessions = db.sessions.filter((s) => s.user_id !== id); save(); },
  },
  children: {
    byUser: async (uid) => table("children").filter((c) => c.user_id === uid),
    byId: async (id) => byKey("children", "id", id),
    insert: async (c) => { table("children").push(c); save(); },
    update: async (id, p) => { Object.assign(byKey("children", "id", id) || {}, p); save(); },
    remove: async (id) => { const db = load(); db.children = db.children.filter((c) => c.id !== id); save(); },
  },
  readings: {
    byChild: async (cid, limit) => table("readings").filter((r) => r.child_id === cid).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit),
    insert: async (r) => { table("readings").push(r); save(); },
    removeByChild: async (cid) => { const db = load(); db.readings = db.readings.filter((r) => r.child_id !== cid); save(); },
  },
  resets: {
    insert: async (r) => { table("resets").push(r); save(); },
    get: async (h) => byKey("resets", "token_hash", h),
    markUsed: async (h) => { const r = byKey("resets", "token_hash", h); if (r) r.used = 1; save(); },
  },
};

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n) => { const a = new Uint8Array(n); crypto.getRandomValues(a); return a; };
const b64u = (a) => btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
async function pbkdf2(pw, saltHex) {
  const subtle = globalThis.crypto && crypto.subtle;
  if (!subtle) { let h = 2166136261; for (const ch of saltHex + pw) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return "weak" + (h >>> 0).toString(16); }
  const key = await subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(saltHex), iterations: 150000 }, key, 256);
  return hex(bits);
}
async function sha256(s) {
  if (!(globalThis.crypto && crypto.subtle)) return pbkdf2(s, "");
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));
}
const localCrypto = {
  hashPassword: async (pw) => { const salt = hex(rand(16)); return { hash: await pbkdf2(pw, salt), salt }; },
  verifyPassword: async (pw, hash, salt) => (await pbkdf2(pw, salt)) === hash,
  randomToken: () => b64u(rand(32)),
  sha256,
  id: (p) => p + b64u(rand(9)),
};

function localCore() {
  if (!local) local = createCore(localStore, localCrypto, { devResetLinks: true });
  return local;
}
async function localUser() {
  const t = mem.token || ls("get", TOKEN_KEY);
  if (!t) return null;
  const h = await sha256(t);
  const s = table("sessions").find((x) => x.token_hash === h);
  if (!s || s.expires < Date.now()) return null;
  return byKey("users", "id", s.user_id);
}
async function localCall(method, path, body) {
  const user = await localUser();
  try {
    const out = await localCore().handle(method, path, body ? JSON.parse(JSON.stringify(body)) : {}, user);
    const s = out.session;
    if (s) {
      const db = load();
      if (s.revokeAll) db.sessions = db.sessions.filter((x) => x.user_id !== s.revokeAll);
      if (s.destroy) { ls("del", TOKEN_KEY); mem.token = null; }
      if (s.create) {
        if (s.revokeOthers) db.sessions = db.sessions.filter((x) => x.user_id !== s.create);
        const token = b64u(rand(32));
        db.sessions.push({ token_hash: await sha256(token), user_id: s.create, expires: Date.now() + 30 * 864e5 });
        ls("set", TOKEN_KEY, token); mem.token = token;
      }
      save();
    }
    return out.body;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    console.error(e);
    throw new ApiError(500, "Something went wrong. Please try again.", "local");
  }
}

/* ---------------- public client ---------------- */
async function call(method, path, body) {
  if ((await mode()) === "local") return localCall(method, path, body);
  let r;
  try {
    r = await fetch("api" + path, {
      method, credentials: "same-origin", cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "We couldn't reach Wren. Check your connection and try again.", "network");
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, j.error || "Something went wrong.", j.code, j.field);
  return j;
}

export const api = {
  mode,
  get: (p) => call("GET", p),
  post: (p, b = {}) => call("POST", p, b),
  patch: (p, b = {}) => call("PATCH", p, b),
  del: (p, b = {}) => call("DELETE", p, b),
  health: async () => ((await mode()) === "server" ? fetch("api/health").then((r) => r.json()) : { ok: true, mode: "local", ai: false }),
};
export { ApiError };

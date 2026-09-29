// Wren application core: accounts, onboarding, child profiles, reading sessions and reports.
// The logic is independent of the transport. The Node server runs it against SQLite with scrypt, and the
// browser's demo mode runs it against localStorage with PBKDF2. Both share one set of rules.
import * as E from "./engine.js";

export class ApiError extends Error {
  constructor(status, message, code, field) { super(message); this.status = status; this.code = code; this.field = field; }
}

export const PLANS = {
  monthly: { id: "monthly", label: "Monthly", price: 29, per: "month", blurb: "$29 per month" },
  annual: { id: "annual", label: "Annual", price: 199, per: "year", blurb: "$199 per year, which works out to $16.58 a month" },
};
export const TRIAL_DAYS = 7;
export const WORLD_IDS = Object.keys(E.WORLDS);
const PRONOUNS = ["she", "he", "they"];
const CONCERNS = ["flagged", "starting", "homeschool", "ahead", "unsure"];
const AVATARS = ["sun", "leaf", "wave", "berry", "sky", "sand"];
const MIN_PW = 8;

const str = (v, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
export const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
const dayKey = (d) => new Date(d).toISOString().slice(0, 10);

export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PW) return `Use at least ${MIN_PW} characters.`;
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw) || ["password", "12345678", "123456789", "qwertyui", "iloveyou"].includes(pw.toLowerCase())) return "That password is too easy to guess.";
  return null;
}

export const publicUser = (u) => u && ({
  id: u.id, email: u.email, name: u.name, onboarded: !!u.onboarded, consentAt: u.consent_at || null,
  plan: u.plan || null, trialEnds: u.trial_ends || null, created: u.created, audioOptIn: !!u.audio_opt_in,
});

export function publicChild(c) {
  const state = c.state || {};
  const map = E.masteryMap(state);
  const level = E.readingLevel(map);
  return {
    id: c.id, name: c.name, age: c.age, pronoun: c.pronoun, world: c.world, concern: c.concern, avatar: c.avatar,
    created: c.created, streak: c.streak || 0, lastDay: c.last_day || null, feathers: c.feathers || 0,
    assessed: !!c.assessed, level, state,
  };
}

function cleanChild(input, partial = false) {
  const out = {};
  if (!partial || "name" in input) {
    const name = str(input.name, 40);
    if (!name) throw new ApiError(400, "Add your child's first name or a nickname.", "invalid", "name");
    out.name = name;
  }
  if (!partial || "age" in input) {
    const age = Number(input.age);
    if (!Number.isInteger(age) || age < 3 || age > 9) throw new ApiError(400, "Wren is built for ages 4 to 8.", "invalid", "age");
    out.age = age;
  }
  if (!partial || "world" in input) out.world = WORLD_IDS.includes(input.world) ? input.world : "dinos";
  if (!partial || "pronoun" in input) out.pronoun = PRONOUNS.includes(input.pronoun) ? input.pronoun : "they";
  if (!partial || "concern" in input) out.concern = CONCERNS.includes(input.concern) ? input.concern : "unsure";
  if (!partial || "avatar" in input) out.avatar = AVATARS.includes(input.avatar) ? input.avatar : "sun";
  return out;
}

/*
 store: async interface
   users:    byEmail(email) byId(id) insert(u) update(id, patch) remove(id)
   children: byUser(uid) byId(id) insert(c) update(id, patch) remove(id)
   readings: byChild(cid, limit) insert(r) removeByChild(cid)
   resets:   insert(r) get(tokenHash) markUsed(tokenHash)
 crypto: { hashPassword(pw) -> {hash, salt}, verifyPassword(pw, hash, salt) -> bool, randomToken() -> str, sha256(str) -> hex, id(prefix) -> str }
 opts:   { ai?: async ({child, map, targets}) -> {title, pages:[string]} | null, devResetLinks?: bool, now?: () => Date }
*/
export function createCore(store, crypto, opts = {}) {
  const now = () => (opts.now ? opts.now() : new Date());
  const iso = () => now().toISOString();

  async function ownChild(user, id) {
    const c = await store.children.byId(id);
    if (!c || c.user_id !== user.id) throw new ApiError(404, "We couldn't find that child profile.", "not_found");
    return c;
  }
  function need(user) { if (!user) throw new ApiError(401, "Please sign in first.", "unauthenticated"); return user; }

  async function childBundle(c) {
    const readings = await store.readings.byChild(c.id, 60);
    const pc = publicChild(c);
    const report = E.parentReport({ name: c.name, state: c.state || {}, sessions: readings, pronoun: c.pronoun });
    return { child: pc, readings, report: { ...report, map: undefined } };
  }

  const routes = {
    "POST /auth/signup": async ({ body }) => {
      const name = str(body.name, 80);
      const email = str(body.email, 200).toLowerCase();
      if (!name) throw new ApiError(400, "Tell us your name.", "invalid", "name");
      if (!validEmail(email)) throw new ApiError(400, "That email address doesn't look right.", "invalid", "email");
      const pwp = passwordProblem(body.password);
      if (pwp) throw new ApiError(400, pwp, "invalid", "password");
      if (!body.adult) throw new ApiError(400, "Accounts are for parents and guardians aged 18 or over.", "invalid", "adult");
      if (await store.users.byEmail(email)) throw new ApiError(409, "There's already an account with that email. Try signing in instead.", "exists", "email");
      const { hash, salt } = await crypto.hashPassword(body.password);
      const u = { id: crypto.id("u_"), email, name, pw_hash: hash, pw_salt: salt, created: iso(), onboarded: 0, consent_at: null, plan: null, trial_ends: null, audio_opt_in: 0 };
      await store.users.insert(u);
      return { status: 201, body: { user: publicUser(u), children: [] }, session: { create: u.id } };
    },

    "POST /auth/signin": async ({ body }) => {
      const email = str(body.email, 200).toLowerCase();
      const u = email ? await store.users.byEmail(email) : null;
      const ok = u ? await crypto.verifyPassword(String(body.password || ""), u.pw_hash, u.pw_salt) : (await crypto.hashPassword("x"), false);
      if (!ok) throw new ApiError(401, "That email and password don't match. Check them and try again.", "bad_credentials");
      const kids = await store.children.byUser(u.id);
      return { status: 200, body: { user: publicUser(u), children: kids.map(publicChild) }, session: { create: u.id } };
    },

    "POST /auth/signout": async () => ({ status: 200, body: { ok: true }, session: { destroy: true } }),

    "GET /auth/me": async ({ user }) => {
      if (!user) return { status: 200, body: { user: null, children: [] } };
      const kids = await store.children.byUser(user.id);
      return { status: 200, body: { user: publicUser(user), children: kids.map(publicChild) } };
    },

    "POST /auth/forgot": async ({ body }) => {
      const email = str(body.email, 200).toLowerCase();
      if (!validEmail(email)) throw new ApiError(400, "That email address doesn't look right.", "invalid", "email");
      const u = await store.users.byEmail(email);
      let devLink = null;
      if (u) {
        const token = crypto.randomToken();
        await store.resets.insert({ token_hash: await crypto.sha256(token), user_id: u.id, expires: now().getTime() + 3600e3, used: 0 });
        if (opts.onReset) await opts.onReset(u, token);
        if (opts.devResetLinks) devLink = `#/reset/${token}`;
      }
      // The reply is the same whether or not the account exists.
      return { status: 200, body: { ok: true, devLink } };
    },

    "POST /auth/reset": async ({ body }) => {
      const token = str(body.token, 200);
      const r = token ? await store.resets.get(await crypto.sha256(token)) : null;
      if (!r || r.used || r.expires < now().getTime()) throw new ApiError(400, "That reset link has expired or was already used. Ask for a new one.", "bad_token");
      const pwp = passwordProblem(body.password);
      if (pwp) throw new ApiError(400, pwp, "invalid", "password");
      const { hash, salt } = await crypto.hashPassword(body.password);
      await store.users.update(r.user_id, { pw_hash: hash, pw_salt: salt });
      await store.resets.markUsed(r.token_hash);
      const u = await store.users.byId(r.user_id);
      const kids = await store.children.byUser(u.id);
      return { status: 200, body: { user: publicUser(u), children: kids.map(publicChild) }, session: { create: u.id, revokeOthers: true } };
    },

    "POST /account/password": async ({ user, body }) => {
      need(user);
      if (!(await crypto.verifyPassword(String(body.current || ""), user.pw_hash, user.pw_salt))) throw new ApiError(400, "Your current password isn't right.", "invalid", "current");
      const pwp = passwordProblem(body.next);
      if (pwp) throw new ApiError(400, pwp, "invalid", "next");
      const { hash, salt } = await crypto.hashPassword(body.next);
      await store.users.update(user.id, { pw_hash: hash, pw_salt: salt });
      return { status: 200, body: { ok: true }, session: { revokeOthers: true } };
    },

    "PATCH /account": async ({ user, body }) => {
      need(user);
      const patch = {};
      if ("name" in body) { const n = str(body.name, 80); if (!n) throw new ApiError(400, "Name can't be empty.", "invalid", "name"); patch.name = n; }
      if ("plan" in body) { if (!PLANS[body.plan]) throw new ApiError(400, "Pick a plan.", "invalid", "plan"); patch.plan = body.plan; }
      if ("audioOptIn" in body) patch.audio_opt_in = body.audioOptIn ? 1 : 0;
      if (body.cancel === true) patch.plan = null;
      await store.users.update(user.id, patch);
      return { status: 200, body: { user: publicUser(await store.users.byId(user.id)) } };
    },

    "GET /account/export": async ({ user }) => {
      need(user);
      const kids = await store.children.byUser(user.id);
      const out = [];
      for (const c of kids) out.push({ ...publicChild(c), readings: await store.readings.byChild(c.id, 10000) });
      return { status: 200, body: { exported: iso(), parent: publicUser(user), children: out } };
    },

    "DELETE /account": async ({ user, body }) => {
      need(user);
      if (!(await crypto.verifyPassword(String(body.password || ""), user.pw_hash, user.pw_salt))) throw new ApiError(400, "Enter your password to confirm.", "invalid", "password");
      for (const c of await store.children.byUser(user.id)) { await store.readings.removeByChild(c.id); await store.children.remove(c.id); }
      await store.users.remove(user.id);
      return { status: 200, body: { ok: true }, session: { destroy: true, revokeAll: user.id } };
    },

    // Onboarding covers parental consent (COPPA), the first child profile and the plan with its trial.
    "POST /onboarding": async ({ user, body }) => {
      need(user);
      if (!body.consent) throw new ApiError(400, "We need a parent or guardian's consent before a child can use Wren.", "invalid", "consent");
      const plan = PLANS[body.plan] ? body.plan : "annual";
      const child = cleanChild(body.child || {});
      const c = { id: crypto.id("c_"), user_id: user.id, ...child, state: {}, created: iso(), streak: 0, last_day: null, feathers: 0, assessed: 0 };
      await store.children.insert(c);
      await store.users.update(user.id, {
        onboarded: 1, consent_at: iso(), plan, audio_opt_in: body.audioOptIn ? 1 : 0,
        trial_ends: new Date(now().getTime() + TRIAL_DAYS * 864e5).toISOString(),
      });
      const u = await store.users.byId(user.id);
      return { status: 201, body: { user: publicUser(u), child: publicChild(c) } };
    },

    "POST /children": async ({ user, body }) => {
      need(user);
      if (!user.consent_at) throw new ApiError(403, "Finish setup first.", "needs_onboarding");
      const kids = await store.children.byUser(user.id);
      if (kids.length >= 4) throw new ApiError(400, "One plan covers up to four children.", "limit");
      const c = { id: crypto.id("c_"), user_id: user.id, ...cleanChild(body), state: {}, created: iso(), streak: 0, last_day: null, feathers: 0, assessed: 0 };
      await store.children.insert(c);
      return { status: 201, body: { child: publicChild(c) } };
    },

    "GET /children/:id": async ({ user, params }) => {
      need(user);
      return { status: 200, body: await childBundle(await ownChild(user, params.id)) };
    },

    "PATCH /children/:id": async ({ user, params, body }) => {
      need(user);
      await ownChild(user, params.id);
      await store.children.update(params.id, cleanChild(body, true));
      return { status: 200, body: await childBundle(await store.children.byId(params.id)) };
    },

    "DELETE /children/:id": async ({ user, params }) => {
      need(user);
      await ownChild(user, params.id);
      await store.readings.removeByChild(params.id);
      await store.children.remove(params.id);
      return { status: 200, body: { ok: true } };
    },

    // A reading session. The client sends what it heard, and the server does the scoring. Audio is never uploaded.
    "POST /children/:id/readings": async ({ user, params, body }) => {
      need(user);
      const c = await ownChild(user, params.id);
      const kind = ["assessment", "story", "practice"].includes(body.kind) ? body.kind : "story";
      const parts = Array.isArray(body.passages) ? body.passages.slice(0, 12) : [];
      if (!parts.length) throw new ApiError(400, "Nothing was read.", "invalid");
      const seconds = Math.max(1, Math.min(3600, Number(body.seconds) || 60));
      const alignments = [];
      let evidence = [];
      for (const p of parts) {
        const text = str(p.text, 4000);
        const transcript = str(p.transcript, 8000);
        if (!text) continue;
        // Words after the point where the child stopped are left out, so they don't count as mistakes.
        const al = E.alignReading(text, transcript, { prefix: true }).filter((a) => a.status !== "pending");
        if (!al.length) continue;
        alignments.push(al);
        evidence = evidence.concat(E.evidenceFrom(al));
      }
      if (!alignments.length) throw new ApiError(400, "We didn't hear any reading. Try again.", "invalid");
      const before = E.masteryMap(c.state || {});
      const state = E.applyEvidence(c.state || {}, evidence, iso());
      const after = E.masteryMap(state);
      const newlySecure = Object.keys(after).filter((k) => after[k] === "secure" && before[k] !== "secure" && before[k] !== "inferred");
      const sum = E.summarizeAssessment(alignments, seconds);
      // Streak: one reading day in a row. Two days away breaks it, and one missed day is forgiven.
      const today = dayKey(now());
      let streak = c.streak || 0;
      if (c.last_day !== today) {
        const gap = c.last_day ? Math.round((new Date(today) - new Date(c.last_day)) / 864e5) : 99;
        streak = gap <= 2 ? streak + 1 : 1;
      }
      const feathers = (c.feathers || 0) + 1 + Math.min(3, newlySecure.length);
      await store.children.update(c.id, { state, streak, last_day: today, feathers, assessed: c.assessed || kind === "assessment" ? 1 : 0 });
      const errors = alignments.flat().filter((a) => a.status !== "correct").slice(0, 40).map((a) => ({ word: E.norm(a.word), heard: a.heard, status: a.status }));
      const reading = {
        id: crypto.id("r_"), child_id: c.id, at: iso(), kind, title: str(body.title, 120) || (kind === "assessment" ? "Reading check" : "Story"),
        minutes: +(seconds / 60).toFixed(1), words: sum.words, correct: sum.correct, accuracy: sum.accuracy, wcpm: sum.wcpm,
        errors, newlySecure,
      };
      await store.readings.insert(reading);
      const bundle = await childBundle(await store.children.byId(c.id));
      return { status: 201, body: { reading, alignments, ...bundle } };
    },

    "POST /children/:id/story": async ({ user, params, body }) => {
      need(user);
      const c = await ownChild(user, params.id);
      const map = E.masteryMap(c.state || {});
      const targets = E.pickTargets(map, c.state || {});
      const world = WORLD_IDS.includes(body.world) ? body.world : c.world;
      const day = Math.floor(now().getTime() / 864e5);
      let story = E.generateStory({ world, childName: c.name, map, targets, day });
      story.source = "engine";
      if (opts.ai && body.ai !== false) {
        try {
          const W = E.WORLDS[world];
          const ai = await opts.ai({ child: publicChild(c), world: W, map, targets, allowed: [...E.allowedSkills(map, targets)] });
          if (ai && Array.isArray(ai.pages) && ai.pages.length >= 3) {
            const text = ai.pages.join(" ");
            const chk = E.checkDecodable(text, map, targets, [W.hero, c.name]);
            if (chk.ok) {
              const allowed = E.allowedSkills(map, targets);
              const storyWords = new Set([E.norm(W.hero), E.norm(c.name)]);
              const pages = ai.pages.slice(0, 8).map((t) => E.annotate(String(t).slice(0, 300), allowed, new Set(targets), storyWords));
              const hunt = story.pages.find((p) => p.hunt);
              story = { ...story, title: str(ai.title, 80) || story.title, pages: hunt ? [...pages, hunt] : pages, decodability: chk.pct, source: "ai" };
            } else story.aiRejected = chk.bad.slice(0, 8);
          }
        } catch (e) { story.aiError = true; }
      }
      return { status: 200, body: { story, targets: targets.map((t) => E.SKILL_BY_ID[t]) } };
    },
  };

  const compiled = Object.entries(routes).map(([k, fn]) => {
    const [method, pattern] = k.split(" ");
    const names = [];
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, (_, n) => { names.push(n); return "([A-Za-z0-9_-]+)"; }) + "$");
    return { method, re, names, fn };
  });

  return {
    async handle(method, path, body, user) {
      for (const r of compiled) {
        if (r.method !== method) continue;
        const m = r.re.exec(path);
        if (!m) continue;
        const params = Object.fromEntries(r.names.map((n, i) => [n, m[i + 1]]));
        return r.fn({ user, body: body || {}, params });
      }
      throw new ApiError(404, "Not found.", "not_found");
    },
  };
}

export function aiStoryPrompt({ child, world, targets, allowed }) {
  const labels = (ids) => ids.map((id) => E.SKILL_BY_ID[id]).filter(Boolean).map((s) => (s.stage === 0 ? `"${s.label}"` : `${s.label} (${s.example})`));
  const phon = allowed.filter((id) => !id.startsWith("w:"));
  const sight = allowed.filter((id) => id.startsWith("w:")).map((id) => id.slice(2));
  return `Write a short decodable story for ${child.name}, age ${child.age}, who is learning to read.
World: ${world.name}. Hero: ${world.hero}, ${world.heroKind}.
The child can decode ONLY these phonics patterns: ${labels(phon).join(", ")}.
Tricky words the child knows: ${sight.join(", ") || "none"}.
Stretch targets to practise (use each 2 or 3 times): ${labels(targets).join(", ") || "none"}.
Rules: 6 or 7 pages. Each page has one or two short sentences of 4 to 9 words. Every word must be decodable from the patterns above or be a listed tricky word. The only exceptions are the names ${world.hero} and ${child.name}. Keep it warm and funny, with a tiny problem and a happy ending. No scary content.
Return JSON only: {"title": string, "pages": [string, ...]}`;
}

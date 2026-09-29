// Wren app: auth, onboarding, parent dashboard and kid mode (reading check + daily session).
import { api, ApiError } from "./api.js";
import * as E from "./engine.js";
import { wrenSVG, logoSVG, heroSVG, sceneSVG } from "./art.js";
import { PLANS, TRIAL_DAYS } from "./core.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $("#app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  sget(k, d = null) { try { const v = sessionStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  sset(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} },
  sdel(k) { try { sessionStorage.removeItem(k); } catch {} },
};
const S = { user: null, children: [], active: store.get("wren.active"), bundle: null, mode: "server", ai: false };
const AV = { sun: "#F2BD45", leaf: "#8FCB9B", wave: "#8DBDE6", berry: "#E8A0BF", sky: "#B7C4F2", sand: "#E9C99A" };
const firstName = (n) => String(n || "").split(" ")[0];
const pn = (c) => (c?.pronoun === "she" ? ["she", "her", "her"] : c?.pronoun === "he" ? ["he", "him", "his"] : ["they", "them", "their"]);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const fmtDay = (iso) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const go = (path) => { if (location.hash !== "#" + path) location.hash = path; else render(); };
const activeChild = () => S.children.find((c) => c.id === S.active) || S.children[0] || null;

/* ---------------- toasts, sheets ---------------- */
function toast(msg, ms = 3200) {
  $$(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function sheet(html, bind) {
  const back = document.createElement("div");
  back.className = "sheet-back";
  back.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  back.addEventListener("click", (e) => { if (e.target === back || e.target.closest("[data-close]")) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  const first = back.querySelector("input,button:not([data-close]),select");
  if (first) first.focus();
  bind && bind(back.querySelector(".sheet"), close);
  return close;
}
function confirmSheet({ title, body, ok = "Confirm", danger = false }) {
  return new Promise((res) => {
    sheet(`<h3>${esc(title)}</h3><p class="muted" style="margin-top:8px">${body}</p>
      <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:22px"><button class="btn btn-ghost" data-close>Cancel</button><button class="btn ${danger ? "btn-accent" : "btn-primary"}" data-ok>${esc(ok)}</button></div>`,
    (el, close) => {
      el.querySelector("[data-ok]").onclick = () => { close(); res(true); };
      el.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => res(false)));
    });
  });
}

/* ---------------- forms ---------------- */
function formData(form) {
  const d = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === "checkbox") d[el.name] = el.checked;
    else if (el.type === "radio") { if (el.checked) d[el.name] = el.value; }
    else d[el.name] = el.value;
  }
  return d;
}
function bindForm(form, handler) {
  const btn = form.querySelector('[type="submit"]');
  const alertEl = form.querySelector("[data-alert]");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    $$("[data-err]", form).forEach((x) => (x.textContent = ""));
    $$("[aria-invalid]", form).forEach((x) => x.removeAttribute("aria-invalid"));
    if (alertEl) alertEl.hidden = true;
    const label = btn?.innerHTML;
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2.5px;border-color:rgba(255,255,255,.4);border-top-color:currentColor"></span>`; }
    try { await handler(formData(form)); }
    catch (err) { showError(form, err); }
    finally { if (btn && btn.isConnected) { btn.disabled = false; btn.innerHTML = label; } }
  });
}
function showError(form, err) {
  const msg = err instanceof ApiError || err?.message ? err.message : "Something went wrong.";
  const field = err?.field;
  const slot = field && form.querySelector(`[data-err="${field}"]`);
  if (slot) {
    slot.textContent = msg;
    const input = form.querySelector(`[name="${field}"]`);
    if (input) { input.setAttribute("aria-invalid", "true"); input.focus(); }
  } else {
    const a = form.querySelector("[data-alert]");
    if (a) { a.textContent = msg; a.hidden = false; } else toast(msg);
  }
}
function pwScore(pw) {
  if (!pw) return 0;
  let s = pw.length >= 8 ? 1 : 0;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z0-9]/.test(pw)) s++;
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 16) s++;
  return pw.length < 8 ? 1 : Math.max(1, s);
}
function bindPw(root) {
  $$(".pw-toggle", root).forEach((b) => b.addEventListener("click", () => {
    const i = b.parentElement.querySelector("input");
    const show = i.type === "password";
    i.type = show ? "text" : "password"; b.textContent = show ? "Hide" : "Show"; b.setAttribute("aria-pressed", show);
  }));
  $$("[data-meter]", root).forEach((m) => {
    const i = root.querySelector(`[name="${m.dataset.meter}"]`);
    const lbl = root.querySelector(`[data-meter-label="${m.dataset.meter}"]`);
    i.addEventListener("input", () => {
      const s = pwScore(i.value); m.dataset.s = s;
      lbl.textContent = !i.value ? "At least 8 characters." : ["", "Too short", "Okay", "Good", "Strong"][s] + (i.value.length < 8 ? ` (${8 - i.value.length} more)` : "");
    });
  });
}
const pwField = (name, label, auto, meter = false) => `
  <div class="field"><label for="f-${name}">${label}</label>
    <div class="pw-wrap"><input class="input" id="f-${name}" name="${name}" type="password" autocomplete="${auto}" required minlength="${meter ? 8 : 1}"><button type="button" class="pw-toggle" aria-label="Show password" aria-pressed="false">Show</button></div>
    ${meter ? `<div class="meter" data-meter="${name}" data-s="0" aria-hidden="true"><i></i><i></i><i></i><i></i></div><div class="hint" data-meter-label="${name}">At least 8 characters.</div>` : ""}
    <div class="err" data-err="${name}"></div></div>`;

/* ---------------- speech ---------------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let voice = null;
function pickVoice() {
  if (!("speechSynthesis" in window)) return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /Samantha|Google US English|Jenny|Aria|Ava/i.test(v.name)) || vs.find((v) => /^en[-_]US/i.test(v.lang)) || vs.find((v) => /^en/i.test(v.lang)) || null;
}
if ("speechSynthesis" in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function say(text, { rate = 0.92, pitch = 1.08 } = {}) {
  return new Promise((res) => {
    if (!("speechSynthesis" in window) || store.get("wren.mute", false)) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = rate; u.pitch = pitch; u.lang = "en-US";
    u.onend = u.onerror = () => res();
    speechSynthesis.speak(u);
    setTimeout(res, 800 + text.length * 90);
  });
}
const inputMode = () => {
  const m = store.get("wren.input");
  if (m === "mic" && !SR) return "tap";
  return m || (SR ? "mic" : "tap");
};
const MODE_LABEL = { mic: "Microphone: Wren listens", tap: "Grown-up marks tricky words", demo: "Demo reader (simulated child)" };

/* ---------------- data ---------------- */
async function refreshMe() {
  const me = await api.get("/auth/me");
  S.user = me.user; S.children = me.children || [];
  if (!S.children.find((c) => c.id === S.active)) S.active = S.children[0]?.id || null;
  return me;
}
async function loadBundle(force = false) {
  const c = activeChild();
  if (!c) { S.bundle = null; return null; }
  if (!force && S.bundle && S.bundle.child.id === c.id) return S.bundle;
  S.bundle = await api.get(`/children/${c.id}`);
  const i = S.children.findIndex((x) => x.id === c.id);
  if (i >= 0) S.children[i] = S.bundle.child;
  return S.bundle;
}
function setActive(id) { S.active = id; store.set("wren.active", id); S.bundle = null; }

/* ---------------- router ---------------- */
const ROUTES = [
  [/^\/signin$/, viewSignin, "public"],
  [/^\/signup$/, viewSignup, "public"],
  [/^\/forgot$/, viewForgot, "public"],
  [/^\/reset\/([\w-]+)$/, viewReset, "any"],
  [/^\/onboarding$/, viewOnboarding, "onboarding"],
  [/^\/home$/, viewHome],
  [/^\/skills$/, viewSkills],
  [/^\/progress$/, viewProgress],
  [/^\/account$/, viewAccount],
  [/^\/add-child$/, viewAddChild],
  [/^\/check$/, viewCheckIntro],
  [/^\/results\/([\w-]+)$/, viewResults],
  [/^\/kid\/check$/, kidCheck],
  [/^\/kid\/session$/, kidSession],
];
function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs || "")) };
}
let renderSeq = 0;
async function render() {
  const seq = ++renderSeq;
  const { path, query } = parseHash();
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  stopListening();
  const hit = ROUTES.find(([re]) => re.test(path));
  const kind = hit?.[2];
  if (!S.user && kind !== "public" && kind !== "any") { if (path !== "/" && path !== "/signin") store.sset("wren.next", path); return go("/signin"); }
  if (S.user && kind === "public") return go(S.user.onboarded ? "/home" : "/onboarding");
  if (S.user && !S.user.onboarded && kind !== "onboarding" && kind !== "any") return go("/onboarding");
  if (S.user && S.user.onboarded && kind === "onboarding") return go("/home");
  if (!hit) return go(S.user ? "/home" : "/signin");
  document.body.classList.remove("kid-open");
  try {
    await hit[1]({ params: path.match(hit[0]).slice(1), query, seq });
  } catch (e) {
    if (seq !== renderSeq) return;
    if (e instanceof ApiError && e.status === 401) { S.user = null; return go("/signin"); }
    console.error(e);
    app.innerHTML = `<div class="boot"><div class="card pad" style="max-width:420px;text-align:center"><h3>That didn't load</h3><p class="muted" style="margin:8px 0 16px">${esc(e.message || "Please try again.")}</p><button class="btn btn-primary" onclick="location.reload()">Try again</button></div></div>`;
  }
  window.scrollTo(0, 0);
}
addEventListener("hashchange", render);

const demoBanner = () => (S.mode === "local"
  ? `<div class="demo-banner">Demo mode: accounts and progress are saved only in this browser. <a href="https://github.com/shekharxo25/YC/tree/claude/wren-reading-tutor/wren#run-it" target="_blank" rel="noopener">Run the server</a> to store them properly.</div>` : "");

/* ================================================================== */
/* AUTH                                                                */
/* ================================================================== */
const tickSVG = `<svg viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
function authShell(inner, { title = "Every child deserves a tutor who knows exactly what's next.", sub = "Wren listens as your child reads aloud, finds the exact sounds they're missing, and writes tomorrow's story around them." } = {}) {
  app.innerHTML = `${demoBanner()}<div class="auth">
    <aside class="auth-art">
      <a class="logo" href="index.html">${logoSVG()}Wren</a>
      <div class="wren-float">${wrenSVG({ size: 260 })}</div>
      <h2>${title}</h2>
      <p>${sub}</p>
      <ul><li>${tickSVG}The free 12-minute reading check</li><li>${tickSVG}A 7-day trial with no charge</li><li>${tickSVG}No ads. Audio isn't stored.</li></ul>
    </aside>
    <main class="auth-main">
      <div class="auth-top"><a class="logo" href="index.html" style="font-size:20px">${logoSVG()}Wren</a><a class="btn btn-quiet btn-sm" href="index.html">← Back to site</a></div>
      <div class="auth-form">${inner}</div>
    </main></div>`;
  bindPw(app);
}
async function afterAuth(res) {
  S.user = res.user; S.children = res.children || [];
  if (!S.children.find((c) => c.id === S.active)) setActive(S.children[0]?.id || null);
  const next = store.sget("wren.next"); store.sdel("wren.next");
  go(!S.user.onboarded ? "/onboarding" : next && !/^\/(signin|signup|forgot|reset)/.test(next) ? next : "/home");
}

function viewSignin() {
  authShell(`
    <h1>Welcome back</h1>
    <p class="sub">Sign in to see your reader's progress and today's story.</p>
    <form id="f" novalidate>
      <div class="alert alert-bad" data-alert hidden role="alert"></div>
      <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required><div class="err" data-err="email"></div></div>
      ${pwField("password", "Password", "current-password")}
      <div style="display:flex;justify-content:flex-end;margin:-6px 0 18px"><a href="#/forgot" class="small" style="font-weight:800">Forgot password?</a></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Sign in</button>
    </form>
    <p class="switch-line">New to Wren? <a href="#/signup">Create a free account</a></p>`);
  bindForm($("#f"), async (d) => {
    if (!d.email) throw new ApiError(400, "Enter your email.", "invalid", "email");
    if (!d.password) throw new ApiError(400, "Enter your password.", "invalid", "password");
    afterAuth(await api.post("/auth/signin", d));
  });
}

function viewSignup({ query }) {
  if (query.plan && PLANS[query.plan]) store.sset("wren.plan", query.plan);
  authShell(`
    <h1>Create your parent account</h1>
    <p class="sub">It takes a minute. Then your child can take the free reading check.</p>
    <form id="f" novalidate>
      <div class="alert alert-bad" data-alert hidden role="alert"></div>
      <div class="field"><label for="f-name">Your name</label><input class="input" id="f-name" name="name" autocomplete="name" required><div class="err" data-err="name"></div></div>
      <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" autocomplete="email" inputmode="email" required><div class="err" data-err="email"></div></div>
      ${pwField("password", "Password", "new-password", true)}
      <label class="check" style="margin:4px 0 6px"><input type="checkbox" name="adult"> <span>I'm a parent or legal guardian, and I'm 18 or older.</span></label>
      <div class="err" data-err="adult" style="margin-bottom:12px"></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Create account</button>
      <p class="hint" style="margin-top:12px;text-align:center">By creating an account you agree to our Terms and Privacy Policy. Children don't make accounts. You'll add your child next.</p>
    </form>
    <p class="switch-line">Already have an account? <a href="#/signin">Sign in</a></p>`, { title: "Start with a reading check that tells you something real." });
  bindForm($("#f"), async (d) => afterAuth(await api.post("/auth/signup", d)));
}

function viewForgot() {
  authShell(`
    <h1>Reset your password</h1>
    <p class="sub">Enter your account email. We'll send you a link to choose a new password.</p>
    <form id="f" novalidate>
      <div class="alert alert-bad" data-alert hidden role="alert"></div>
      <div class="field"><label for="f-email">Email</label><input class="input" id="f-email" name="email" type="email" autocomplete="email" required><div class="err" data-err="email"></div></div>
      <button class="btn btn-primary btn-lg btn-block" type="submit">Send reset link</button>
    </form>
    <div id="sent" hidden></div>
    <p class="switch-line"><a href="#/signin">← Back to sign in</a></p>`);
  bindForm($("#f"), async (d) => {
    const r = await api.post("/auth/forgot", d);
    $("#f").hidden = true;
    const box = $("#sent"); box.hidden = false;
    box.innerHTML = `<div class="alert alert-ok">If there's an account for ${esc(d.email)}, a reset link is on its way. It works for one hour.</div>
      ${r.devLink ? `<div class="alert alert-info" style="margin-top:12px">Demo build: no email is sent. <a href="${esc(r.devLink)}" style="font-weight:800">Open your reset link</a>.</div>` : S.mode === "server" ? `<p class="hint" style="margin-top:10px">Running locally? The link is printed in the server console.</p>` : ""}`;
  });
}

function viewReset({ params }) {
  authShell(`
    <h1>Choose a new password</h1>
    <p class="sub">Choose something you don't use anywhere else. This signs you out on your other devices.</p>
    <form id="f" novalidate>
      <div class="alert alert-bad" data-alert hidden role="alert"></div>
      ${pwField("password", "New password", "new-password", true)}
      <button class="btn btn-primary btn-lg btn-block" type="submit">Save and sign in</button>
    </form>`);
  bindForm($("#f"), async (d) => { const r = await api.post("/auth/reset", { token: params[0], password: d.password }); toast("Password updated."); afterAuth(r); });
}

/* ================================================================== */
/* ONBOARDING                                                          */
/* ================================================================== */
const OB_STEPS = ["welcome", "consent", "child", "world", "start", "plan"];
const CONCERN = {
  flagged: ["Flagged at a school screening", "Their school said reading needs attention"],
  starting: ["Just getting started", "Learning letters and first words"],
  homeschool: ["We homeschool", "I'm looking for a clear phonics path"],
  ahead: ["Reading already, wants more", "Ready for a challenge"],
  unsure: ["Not sure yet", "The reading check will show us"],
};
function viewOnboarding() {
  const ob = store.sget("wren.ob") || { step: 0, consent: false, audio: false, child: { name: "", age: 5, pronoun: "they", avatar: "sun", world: "dinos", concern: "unsure" }, plan: store.sget("wren.plan") || "annual" };
  const save = () => store.sset("wren.ob", ob);
  const step = OB_STEPS[ob.step];
  const c = ob.child;
  const nm = esc(c.name || "your child");
  let body = "";
  if (step === "welcome") body = `
    <div style="display:flex;justify-content:center;margin-bottom:10px">${wrenSVG({ size: 150, mood: "talk" })}</div>
    <h1 style="text-align:center">Hi ${esc(firstName(S.user.name))}! I'm Wren.</h1>
    <p class="sub" style="text-align:center">Let's set things up for your reader. It takes about two minutes. Then they can take the free reading check.</p>
    <div class="grid-3" style="margin-top:8px">
      <div class="card pad"><b>1. Your consent</b><p class="small muted" style="margin-top:4px">What we collect, and what we never do.</p></div>
      <div class="card pad"><b>2. Your reader</b><p class="small muted" style="margin-top:4px">A first name, an age and a favorite world.</p></div>
      <div class="card pad"><b>3. Free trial</b><p class="small muted" style="margin-top:4px">${TRIAL_DAYS} days free. Cancel anytime.</p></div>
    </div>`;
  if (step === "consent") body = `
    <h1>Before your child reads a word</h1>
    <p class="sub">Children under 13 are protected by COPPA. Here's exactly what Wren collects and why, in plain English.</p>
    <div class="consent-box" tabindex="0">
      <h4>What we collect about your child</h4><ul><li>A first name or nickname, and an age</li><li>Which words they read correctly during sessions, so we can pick the next story</li><li>Their chosen world and progress, such as streaks and feathers</li></ul>
      <h4>What happens to their voice</h4><ul><li>Speech is turned into words so Wren can follow along</li><li>By default the audio is thrown away right after. It is never sold or shared.</li></ul>
      <h4>What we never do</h4><ul><li>Show ads, use third-party trackers or sell data</li><li>Let your child contact anyone, or let anyone contact them</li><li>Ask your child for personal details</li></ul>
      <h4>Your rights</h4><ul><li>See, download or delete everything at any time from Account</li><li>Withdraw consent at any time. We'll then delete your child's data.</li></ul>
    </div>
    <label class="check" style="margin-top:18px"><input type="checkbox" id="ob-consent" ${ob.consent ? "checked" : ""}><span><b>I'm the parent or legal guardian</b>, and I consent to Wren collecting and using this information to teach my child to read.</span></label>
    <label class="check" style="margin-top:12px"><input type="checkbox" id="ob-audio" ${ob.audio ? "checked" : ""}><span>Optional: keep short audio clips to help Wren understand young voices better. You can turn this off later.</span></label>
    <div class="err" id="ob-err" style="margin-top:10px"></div>
    <p class="hint" style="margin-top:14px">In production, we'd verify parental consent with a method the FTC approves, such as a small card check. This demo build records your consent and the time you gave it.</p>`;
  if (step === "child") body = `
    <h1>Who's reading with Wren?</h1>
    <p class="sub">A first name or nickname is all we need.</p>
    <div class="field"><label for="ob-name">First name or nickname</label><input class="input" id="ob-name" maxlength="40" value="${esc(c.name)}" autocomplete="off" placeholder="e.g. Mia"><div class="err" id="ob-err"></div></div>
    <div class="field"><span class="label">Age</span><div class="age-row" role="radiogroup" aria-label="Age">${[4, 5, 6, 7, 8].map((a) => `<button type="button" class="choice" role="radio" aria-pressed="${c.age === a}" aria-checked="${c.age === a}" data-age="${a}">${a}</button>`).join("")}</div></div>
    <div class="field"><span class="label">In reports, call them</span><div class="age-row" role="radiogroup" aria-label="Pronoun">${["she", "he", "they"].map((p) => `<button type="button" class="choice" style="width:auto;padding:0 20px;font-family:var(--sans);font-size:16px" role="radio" aria-pressed="${c.pronoun === p}" aria-checked="${c.pronoun === p}" data-pro="${p}">${p}</button>`).join("")}</div></div>
    <div class="field"><span class="label">Pick a color</span><div class="avatars">${Object.entries(AV).map(([k, v]) => `<button type="button" aria-label="${k}" aria-pressed="${c.avatar === k}" data-av="${k}" style="background:${v}"></button>`).join("")}</div></div>`;
  if (step === "world") body = `
    <h1>Where should ${nm}'s stories happen?</h1>
    <p class="sub">Let ${nm} choose. It's more fun that way. You can change it later.</p>
    <div class="choice-grid cols-5">${Object.entries(E.WORLDS).map(([id, w]) => `<button type="button" class="choice world" aria-pressed="${c.world === id}" data-world="${id}"><div class="wimg" style="background:${id === "space" ? "#27336B" : w.sky}">${heroSVG(id, 100)}</div><div class="wlabel">${esc(w.name)}<small>with ${esc(w.hero)}</small></div></button>`).join("")}</div>`;
  if (step === "start") body = `
    <h1>Where is ${nm} with reading?</h1>
    <p class="sub">This helps us word your reports. The reading check does the real measuring.</p>
    <div class="choice-grid">${Object.entries(CONCERN).map(([k, [t, s]]) => `<button type="button" class="choice" aria-pressed="${c.concern === k}" data-concern="${k}"><div><b>${t}</b><small>${s}</small></div></button>`).join("")}</div>`;
  if (step === "plan") body = `
    <h1>Start your ${TRIAL_DAYS}-day free trial</h1>
    <p class="sub">The reading check is free either way. You won't be charged during the trial, and you can cancel from Account in two taps.</p>
    <div class="choice-grid">${Object.values(PLANS).map((p) => `<button type="button" class="choice" aria-pressed="${ob.plan === p.id}" data-plan="${p.id}" style="display:block">
      <div class="plan-opt"><div><b>${p.label}${p.id === "annual" ? ` <span class="pill pill-brand" style="margin-left:6px">Save 43%</span>` : ""}</b><small>${p.blurb}</small></div><div class="amt">$${p.price}<small class="muted" style="font-size:14px;font-family:var(--sans)">/${p.per === "year" ? "yr" : "mo"}</small></div></div></button>`).join("")}</div>
    <p class="hint" style="margin-top:14px">Demo build: there's no real billing. Your trial ends ${new Date(Date.now() + TRIAL_DAYS * 864e5).toLocaleDateString(undefined, { month: "long", day: "numeric" })}.</p>
    <div class="alert alert-bad" id="ob-alert" hidden style="margin-top:12px"></div>`;
  const pct = Math.round(((ob.step + 1) / OB_STEPS.length) * 100);
  app.innerHTML = `${demoBanner()}<div class="ob">
    <div class="ob-top"><span class="logo" style="font-size:20px">${logoSVG()}</span><div class="ob-progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Setup progress"><b style="width:${pct}%"></b></div><button class="btn btn-quiet btn-sm" id="ob-out">Sign out</button></div>
    <div class="ob-body"><div class="ob-card">${body}
      <div class="ob-actions">${ob.step > 0 ? `<button class="btn btn-ghost" id="ob-back">Back</button>` : "<span></span>"}<button class="btn btn-primary btn-lg" id="ob-next">${step === "plan" ? "Start free trial" : step === "welcome" ? "Let's go" : "Continue"}</button></div>
    </div></div></div>`;
  const rerender = () => { save(); viewOnboarding(); };
  $("#ob-out").onclick = signOut;
  $("#ob-back") && ($("#ob-back").onclick = () => { ob.step--; rerender(); });
  const pick = (attr, key, obj = c) => $$(`[data-${attr}]`).forEach((b) => (b.onclick = () => {
    obj[key] = attr === "age" ? Number(b.dataset[attr]) : b.dataset[attr];
    $$(`[data-${attr}]`).forEach((x) => { const on = x === b; x.setAttribute("aria-pressed", on); if (x.hasAttribute("aria-checked")) x.setAttribute("aria-checked", on); });
    save();
  }));
  pick("age", "age"); pick("pro", "pronoun"); pick("av", "avatar"); pick("world", "world"); pick("concern", "concern"); pick("plan", "plan", ob);
  const nameIn = $("#ob-name");
  if (nameIn) { nameIn.oninput = () => { c.name = nameIn.value; save(); }; nameIn.onkeydown = (e) => { if (e.key === "Enter") $("#ob-next").click(); }; setTimeout(() => nameIn.focus(), 50); }
  if ($("#ob-consent")) { $("#ob-consent").onchange = (e) => { ob.consent = e.target.checked; save(); }; $("#ob-audio").onchange = (e) => { ob.audio = e.target.checked; save(); }; }
  $("#ob-next").onclick = async () => {
    if (step === "consent" && !ob.consent) { $("#ob-err").textContent = "Please confirm you're the parent or guardian and give your consent to continue."; return; }
    if (step === "child" && !c.name.trim()) { $("#ob-err").textContent = "Add a first name or nickname."; nameIn.setAttribute("aria-invalid", "true"); nameIn.focus(); return; }
    if (step !== "plan") { ob.step++; return rerender(); }
    const btn = $("#ob-next"); btn.disabled = true; btn.textContent = "Setting up…";
    try {
      const r = await api.post("/onboarding", { consent: ob.consent, audioOptIn: ob.audio, plan: ob.plan, child: c });
      S.user = r.user; S.children = [r.child]; setActive(r.child.id);
      store.sdel("wren.ob"); store.sdel("wren.plan");
      viewReady(r.child);
    } catch (e) { btn.disabled = false; btn.textContent = "Start free trial"; const a = $("#ob-alert"); a.textContent = e.message; a.hidden = false; }
  };
}
function viewReady(child) {
  app.innerHTML = `${demoBanner()}<div class="ob"><div class="ob-body" style="align-items:center"><div class="ob-card" style="text-align:center">
    <div style="display:flex;justify-content:center">${heroSVG(child.world, 180)}</div>
    <h1 style="margin-top:8px">${esc(E.WORLDS[child.world].hero)} can't wait to meet ${esc(child.name)}!</h1>
    <p class="sub">Next: the free 12-minute reading check. ${esc(child.name)} reads three short passages aloud, and you get a report right away.</p>
    <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a class="btn btn-accent btn-lg" href="#/check">Start the reading check</a><a class="btn btn-ghost btn-lg" href="#/home">Do it later</a></div>
  </div></div></div>`;
}

/* ================================================================== */
/* SHELL                                                               */
/* ================================================================== */
const ICONS = {
  home: `<svg viewBox="0 0 24 24"><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  skills: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="4" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="4" y="13" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="7" height="7" rx="2" fill="currentColor"/></svg>`,
  progress: `<svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  account: `<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};
const avatar = (c, size = 32) => `<span class="av" style="background:${AV[c.avatar] || AV.sun};width:${size}px;height:${size}px">${esc((c.name || "?")[0].toUpperCase())}</span>`;
function shell(tab, inner) {
  const tabs = [["home", "Today", "/home"], ["skills", "Skills", "/skills"], ["progress", "Progress", "/progress"], ["account", "Account", "/account"]];
  const kids = S.children.length > 1
    ? S.children.map((c) => `<button class="kid-chip" data-kid="${c.id}" aria-pressed="${c.id === activeChild()?.id}">${avatar(c)}<span class="nm">${esc(c.name)}</span></button>`).join("")
    : S.children.map((c) => `<span class="kid-chip" style="cursor:default">${avatar(c)}<span class="nm">${esc(c.name)}</span></span>`).join("");
  app.innerHTML = `${demoBanner()}<div class="shell">
    <header class="topbar"><div class="topbar-in">
      <a class="logo" href="#/home" style="font-size:21px">${logoSVG()}<span>Wren</span></a>
      <nav class="tabs" aria-label="Main">${tabs.map(([k, l, h]) => `<a href="#${h}" ${k === tab ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
      <div class="kid-switch">${kids}<a class="btn btn-quiet btn-sm" href="#/add-child" title="Add a child" aria-label="Add a child" style="padding:0 10px;font-size:20px">+</a></div>
    </div></header>
    <main class="main" id="main">${inner}</main>
    <nav class="bottom-tabs" aria-label="Main">${tabs.map(([k, l, h]) => `<a href="#${h}" ${k === tab ? 'aria-current="page"' : ""}>${ICONS[k]}${l}</a>`).join("")}</nav>
  </div>`;
  $$("[data-kid]").forEach((b) => (b.onclick = () => { setActive(b.dataset.kid); render(); }));
}

/* ================================================================== */
/* HOME                                                                */
/* ================================================================== */
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
function weekDots(readings) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const on = readings.some((r) => new Date(r.at).toISOString().slice(0, 10) === key || sameLocalDay(r.at, d));
    days.push(`<div><i class="${on ? "on" : ""} ${i === 0 ? "today" : ""}"></i><small>${d.toLocaleDateString(undefined, { weekday: "narrow" })}</small></div>`);
  }
  return `<div class="week-row" aria-label="Days read this week">${days.join("")}</div>`;
}
const sameLocalDay = (iso, d) => { const x = new Date(iso); return x.getFullYear() === d.getFullYear() && x.getMonth() === d.getMonth() && x.getDate() === d.getDate(); };
const lvlMeter = (lvl) => `<div class="lvl-meter" aria-hidden="true">${E.LEVELS.map((l) => `<i class="${l.id <= lvl.id ? "on" : ""}"></i>`).join("")}</div>`;
const targetChip = (id) => { const k = E.SKILL_BY_ID[id]; return k ? `<span class="tchip">${esc(k.label)} <small>${k.stage === 0 ? "tricky word" : "as in " + esc(k.example)}</small></span>` : ""; };
function trialLine() {
  const u = S.user;
  if (!u.plan) return `<span class="pill pill-warn">No active plan</span>`;
  const left = Math.ceil((new Date(u.trialEnds) - Date.now()) / 864e5);
  return left > 0 ? `<span class="pill pill-brand">Trial: ${left} day${left === 1 ? "" : "s"} left</span>` : `<span class="pill pill-ok">${PLANS[u.plan].label} plan</span>`;
}
function rowFor(r) {
  const ic = r.kind === "assessment" ? ["var(--sky-soft)", "📋"] : ["var(--brand-soft)", "📖"];
  const errs = (r.errors || []).filter((e) => e.status === "error").slice(0, 4);
  return `<div class="row">
    <div class="ic" style="background:${ic[0]}" aria-hidden="true">${ic[1]}</div>
    <div class="grow"><b>${esc(r.title)}</b><span class="small muted">${fmtDate(r.at)} · ${r.words} words · ${r.minutes} min${r.newlySecure?.length ? ` · <span style="color:var(--ok);font-weight:800">+${r.newlySecure.length} secure</span>` : ""}</span>
      ${errs.length ? `<div class="errs">${errs.map((e) => `<span class="err-chip">${esc(e.word)} → <s>${esc(e.heard || "skipped")}</s></span>`).join("")}</div>` : ""}</div>
    <div style="text-align:right"><b class="tnum">${r.accuracy}%</b><div class="tiny faint">accuracy</div>${r.kind === "assessment" ? `<a class="tiny" href="#/results/${r.id}" style="font-weight:800">Report</a>` : ""}</div>
  </div>`;
}

async function viewHome() {
  const c = activeChild();
  if (!c) return viewAddChild({ first: true });
  const b = await loadBundle();
  const { child, readings, report } = b;
  const W = E.WORLDS[child.world];
  const secureCount = Object.values(E.masteryMap(child.state)).filter((s) => s === "secure" || s === "inferred").length;
  const readToday = readings.some((r) => sameLocalDay(r.at, new Date()));
  const todayCard = !child.assessed
    ? `<div class="card today"><div><span class="eyebrow" style="color:var(--sun)">Step one · free</span><h2 style="margin-top:6px">Start with ${esc(child.name)}'s reading check</h2>
        <p>Three short passages read aloud, about 12 minutes. You'll see ${esc(pn(child)[2])} exact phonics gaps right after.</p>
        <a class="btn btn-accent btn-lg" href="#/check">Start the reading check</a></div><div class="hero-art">${wrenSVG({ size: 190 })}</div></div>`
    : `<div class="card today"><div><span class="eyebrow" style="color:var(--sun)">${readToday ? "Done for today, but more is fine" : "Today's session · 15 min"}</span><h2 style="margin-top:6px">${readToday ? `Nice work, ${esc(child.name)}!` : `A new story in ${esc(W.name)} is ready`}</h2>
        <p>${readToday ? `${esc(child.name)} read today. Another story is always there if ${esc(pn(child)[0])} ask${child.pronoun === "they" ? "" : "s"} for one.` : `Tonight's story practices ${report.targets.map((t) => esc(E.SKILL_BY_ID[t].label)).join(", ") || "longer words"}, set with ${esc(W.hero)}.`}</p>
        <div class="meta"><span>🔥 ${child.streak}-day streak</span><span>🪶 ${child.feathers} feathers</span><span>${esc(report.level.name)}</span></div>
        <a class="btn btn-accent btn-lg" href="#/kid/session">${readToday ? "Read another story" : "Start today's session"}</a></div><div class="hero-art">${heroSVG(child.world, 200)}</div></div>`;
  shell("home", `
    <div class="page-head"><div><div class="muted" style="font-weight:700">${greeting()}, ${esc(firstName(S.user.name))}</div><h1>${esc(child.name)}'s reading</h1></div><div>${trialLine()}</div></div>
    ${todayCard}
    <div class="grid-2" style="margin-top:20px">
      <section class="card pad"><div class="section-title">This week, in plain English</div>
        ${child.assessed ? `<p style="font-size:17.5px">${esc(report.headline)}</p>${report.detail ? `<p class="muted" style="margin-top:10px">${esc(report.detail)}</p>` : ""}
        ${report.targets.length ? `<div class="target-chips">${report.targets.map(targetChip).join("")}</div>` : ""}
        <div class="bedtime"><b>Your 90-second bedtime thing</b>${esc(report.bedtime)}</div>`
        : `<div class="empty">${wrenSVG({ size: 90, mood: "sleepy" })}<p>After the reading check, this is where you'll read what ${esc(child.name)} has down, what's next, and one small thing to do at bedtime.</p></div>`}
      </section>
      <div style="display:grid;gap:20px;align-content:start">
        <section class="card pad"><div class="section-title">Reading level</div>
          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px"><b style="font-size:20px">${esc(report.level.name)}</b><span class="muted small">${esc(report.level.band)}</span></div>
          ${lvlMeter(report.level)}<p class="small muted" style="margin-top:10px">${esc(report.level.note)}</p>
          <div class="kv" style="margin-top:8px"><span>Skills secure</span><b>${secureCount} / ${E.SKILL_COUNT}</b></div>
          <a class="btn btn-ghost btn-sm" href="#/skills" style="margin-top:8px">See the skill map</a></section>
        <section class="card pad"><div class="section-title">Last 7 days</div>${weekDots(readings)}
          <div class="kv" style="margin-top:10px"><span>Sessions</span><b>${report.week.sessions}</b></div>
          <div class="kv"><span>Minutes reading aloud</span><b>${report.week.minutes}</b></div>
          <div class="kv"><span>Words read correctly</span><b>${report.week.wordsRead}</b></div></section>
      </div>
    </div>
    <section class="card pad" style="margin-top:20px"><div style="display:flex;justify-content:space-between;align-items:center"><div class="section-title" style="margin:0">Recent sessions</div><a class="small" href="#/progress" style="font-weight:800">All sessions</a></div>
      <div class="list" style="margin-top:6px">${readings.length ? readings.slice(0, 4).map(rowFor).join("") : `<div class="empty small">No sessions yet.</div>`}</div></section>`);
}

/* ================================================================== */
/* SKILLS                                                              */
/* ================================================================== */
async function viewSkills() {
  const c = activeChild(); if (!c) return go("/add-child");
  const { child, report } = await loadBundle();
  const map = E.masteryMap(child.state);
  const tset = new Set(report.targets);
  const lanes = [...E.STAGES, E.SIGHT_STAGE].map((st) => {
    const skills = E.SKILLS.filter((s) => s.stage === st.id);
    const sec = skills.filter((s) => map[s.id] === "secure" || map[s.id] === "inferred").length;
    const wk = skills.filter((s) => map[s.id] === "emerging" || map[s.id] === "learning").length;
    return `<section class="card lane"><div class="lane-head"><h3>${esc(st.name)}</h3><span class="small muted tnum">${sec} of ${skills.length} secure</span></div>
      <p class="small muted" style="margin-top:2px">${esc(st.blurb)}</p>
      <div class="lane-bar" aria-hidden="true"><b style="width:${(100 * sec) / skills.length}%"></b><i style="width:${(100 * wk) / skills.length}%"></i></div>
      <div class="chips">${skills.map((s) => `<button class="sk ${tset.has(s.id) ? "is-target" : ""}" data-s="${map[s.id]}" data-skill="${s.id}" title="${esc(s.group)}: ${esc(s.label)}">${esc(s.label)}</button>`).join("")}</div></section>`;
  }).join("");
  shell("skills", `
    <div class="page-head"><div><div class="muted" style="font-weight:700">${esc(child.name)} · ${esc(report.level.name)}</div><h1>Skill map</h1></div>
      <div class="key"><span><i style="background:var(--ok-soft);outline:2px solid var(--ok);outline-offset:-2px"></i>Secure</span><span><i style="background:var(--sun-soft);outline:2px solid var(--warn);outline-offset:-2px"></i>Getting there</span><span><i style="background:var(--accent-soft);outline:2px solid var(--accent);outline-offset:-2px"></i>Working on</span><span><i style="background:var(--idle-soft);outline:2px solid var(--idle);outline-offset:-2px"></i>Not seen yet</span><span><i style="box-shadow:0 0 0 2.5px var(--accent)"></i>This week's target</span></div></div>
    <p class="muted" style="margin:-8px 0 18px;max-width:720px">Every word ${esc(child.name)} reads aloud is evidence for or against the sounds inside it. Tap a sound to see why it's colored the way it is. Dashed chips are inferred from later skills and haven't been tested directly.</p>
    <div class="lanes">${lanes}</div>`);
  $$("[data-skill]").forEach((b) => (b.onclick = () => skillSheet(b.dataset.skill, child, map)));
}
function skillSheet(id, child, map) {
  const s = E.SKILL_BY_ID[id];
  const rec = child.state[id];
  const st = map[id];
  const words = E.WORD_BANK.filter((w) => E.parseWord(w).skills.includes(id)).slice(0, 8);
  const label = { secure: "Secure", inferred: "Secure (inferred)", emerging: "Getting there", learning: "Working on it", new: "Not seen yet" }[st];
  const pill = { secure: "pill-ok", inferred: "pill-ok", emerging: "pill-warn", learning: "pill-accent", new: "" }[st];
  sheet(`<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div><div class="section-title" style="margin:0">${esc(s.group)}</div><h3 style="font-family:var(--read);font-size:34px">${esc(s.label)}</h3></div><span class="pill ${pill}">${label}</span></div>
    <p class="muted" style="margin-top:6px">As in <b style="font-family:var(--read);color:var(--ink)">${esc(s.example)}</b>. <button class="btn btn-quiet btn-sm" data-hear>🔊 Hear it</button></p>
    ${rec ? `<div class="kv" style="margin-top:10px"><span>Read correctly</span><b>${rec.c.toFixed(1)}</b></div><div class="kv"><span>Missed</span><b>${rec.i.toFixed(1)}</b></div><div class="kv"><span>Last seen</span><b>${fmtDate(rec.last)}</b></div><p class="hint" style="margin-top:6px">Counts are weighted: recent reading counts more, and a skipped word counts half.</p>`
      : `<p class="small muted" style="margin-top:12px">${st === "inferred" ? `${esc(child.name)} is secure on harder skills that build on this one, so we're treating it as secure. It'll be checked directly when it comes up in a story.` : `This hasn't come up in ${esc(child.name)}'s reading yet.`}</p>`}
    ${words.length ? `<div class="section-title" style="margin-top:18px">Words to practice</div><div class="chips">${words.map((w) => `<span class="sk" data-s="new" style="cursor:default">${esc(w)}</span>`).join("")}</div>` : ""}
    <div style="text-align:right;margin-top:20px"><button class="btn btn-primary" data-close>Done</button></div>`,
  (el) => { el.querySelector("[data-hear]").onclick = () => say(`${s.example}. ${s.example}.`); });
}

/* ================================================================== */
/* PROGRESS                                                            */
/* ================================================================== */
async function viewProgress() {
  const c = activeChild(); if (!c) return go("/add-child");
  const { child, readings } = await loadBundle();
  const total = readings.reduce((a, r) => a + r.correct, 0);
  const mins = readings.reduce((a, r) => a + r.minutes, 0);
  const acc = readings.length ? Math.round(readings.slice(0, 5).reduce((a, r) => a + r.accuracy, 0) / Math.min(5, readings.length)) : 0;
  shell("progress", `
    <div class="page-head"><div><div class="muted" style="font-weight:700">${esc(child.name)}</div><h1>Progress</h1></div></div>
    <div class="grid-3">
      <div class="card pad"><div class="section-title">Streak</div><div class="bigstat">🔥 ${child.streak}</div><p class="small muted" style="margin-top:6px">Days in a row. Missing one day is forgiven.</p></div>
      <div class="card pad"><div class="section-title">Words read aloud</div><div class="bigstat tnum">${total}</div><p class="small muted" style="margin-top:6px">${Math.round(mins)} minutes across ${readings.length} sessions</p></div>
      <div class="card pad"><div class="section-title">Recent accuracy</div><div class="bigstat tnum">${acc}%</div><p class="small muted" style="margin-top:6px">Average of the last ${Math.min(5, readings.length) || 0} sessions</p></div>
    </div>
    <section class="card pad" style="margin-top:20px"><div class="section-title">Every session</div>
      <div class="list">${readings.length ? readings.map(rowFor).join("") : `<div class="empty">${wrenSVG({ size: 90, mood: "sleepy" })}<p>No sessions yet. Start with the <a href="#/check">free reading check</a>.</p></div>`}</div></section>`);
}

/* ================================================================== */
/* ACCOUNT                                                             */
/* ================================================================== */
async function viewAccount() {
  await refreshMe();
  const u = S.user;
  const left = u.trialEnds ? Math.ceil((new Date(u.trialEnds) - Date.now()) / 864e5) : 0;
  const mode = inputMode();
  shell("account", `
    <div class="page-head"><h1>Account</h1><button class="btn btn-ghost" id="signout">Sign out</button></div>
    <div class="grid-2">
      <div style="display:grid;gap:20px;align-content:start">
        <section class="card pad"><div class="section-title">You</div>
          <form id="f-name" novalidate style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap"><div class="field" style="flex:1;min-width:200px;margin:0"><label for="a-name">Name</label><input class="input" id="a-name" name="name" value="${esc(u.name)}" autocomplete="name"><div class="err" data-err="name"></div></div><button class="btn btn-ghost" type="submit">Save</button></form>
          <div class="kv" style="margin-top:12px"><span>Email</span><b>${esc(u.email)}</b></div>
          <div class="kv"><span>Parental consent given</span><b>${u.consentAt ? fmtDate(u.consentAt) : "Not yet"}</b></div>
        </section>
        <section class="card pad"><div class="section-title">Children</div>
          <div class="list">${S.children.map((c) => `<div class="row">${avatar(c, 40)}<div class="grow"><b>${esc(c.name)}</b><span class="small muted">Age ${c.age} · ${esc(E.WORLDS[c.world]?.name || "")} · ${esc(c.level.name)}</span></div><button class="btn btn-quiet btn-sm" data-edit="${c.id}">Edit</button></div>`).join("")}</div>
          ${S.children.length < 4 ? `<a class="btn btn-ghost btn-sm" href="#/add-child" style="margin-top:10px">+ Add a child</a>` : `<p class="hint">One plan covers up to four children.</p>`}
        </section>
        <section class="card pad"><div class="section-title">Reading on this device</div>
          <p class="small muted" style="margin-bottom:12px">How Wren follows along when your child reads. This setting only applies to this device.</p>
          <div class="choice-grid">${["mic", "tap", "demo"].map((m) => `<label class="choice"><input type="radio" name="imode" value="${m}" ${mode === m ? "checked" : ""} ${m === "mic" && !SR ? "disabled" : ""}><div><b>${MODE_LABEL[m]}</b><small>${m === "mic" ? (SR ? "Best on Chrome, Edge and Safari. It needs microphone permission." : "This browser doesn't support speech recognition.") : m === "tap" ? "Works everywhere. You listen, and tap any word that was tricky." : "For trying Wren without a child: a simulated five-year-old reads."}</small></div></label>`).join("")}</div>
          <label class="check" style="margin-top:14px"><input type="checkbox" id="mute" ${store.get("wren.mute", false) ? "checked" : ""}><span>Mute Wren's voice</span></label>
        </section>
      </div>
      <div style="display:grid;gap:20px;align-content:start">
        <section class="card pad"><div class="section-title">Plan</div>
          ${u.plan ? `<div style="display:flex;justify-content:space-between;align-items:baseline"><b style="font-size:20px">${PLANS[u.plan].label}</b><span class="muted">$${PLANS[u.plan].price}/${PLANS[u.plan].per}</span></div>
            <p class="small muted" style="margin-top:4px">${left > 0 ? `Free trial: ${left} day${left === 1 ? "" : "s"} left. The first charge would be on ${fmtDate(u.trialEnds)}.` : "Renews automatically."} Billing is simulated in this demo.</p>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${u.plan === "monthly" ? `<button class="btn btn-primary btn-sm" data-plan="annual">Switch to annual and save 43%</button>` : `<button class="btn btn-ghost btn-sm" data-plan="monthly">Switch to monthly</button>`}<button class="btn btn-quiet btn-sm" id="cancel">Cancel plan</button></div>`
          : `<p class="muted">No active plan. The reading check stays free.</p><div style="display:flex;gap:8px;margin-top:12px"><button class="btn btn-primary btn-sm" data-plan="annual">Annual: $199/yr</button><button class="btn btn-ghost btn-sm" data-plan="monthly">Monthly: $29/mo</button></div>`}
        </section>
        <section class="card pad"><div class="section-title">Privacy</div>
          <label class="check"><input type="checkbox" id="audio" ${u.audioOptIn ? "checked" : ""}><span>Keep short audio clips to improve accuracy for young voices. <span class="muted">Off by default. In this build, audio never leaves the device either way.</span></span></label>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px"><button class="btn btn-ghost btn-sm" id="export">Download my family's data</button><button class="btn btn-quiet btn-sm" id="delete" style="color:var(--bad)">Delete account…</button></div>
        </section>
        <section class="card pad"><div class="section-title">Change password</div>
          <form id="f-pw" novalidate><div class="alert alert-bad" data-alert hidden></div>${pwField("current", "Current password", "current-password")}${pwField("next", "New password", "new-password", true)}<button class="btn btn-ghost" type="submit">Update password</button></form>
        </section>
      </div>
    </div>`);
  bindPw(app);
  $("#signout").onclick = signOut;
  bindForm($("#f-name"), async (d) => { const r = await api.patch("/account", { name: d.name }); S.user = r.user; toast("Saved."); });
  bindForm($("#f-pw"), async (d) => { await api.post("/account/password", d); $("#f-pw").reset(); toast("Password updated. Other devices were signed out."); });
  $$("[data-plan]").forEach((b) => (b.onclick = async () => { const r = await api.patch("/account", { plan: b.dataset.plan }); S.user = r.user; toast(`You're on the ${PLANS[b.dataset.plan].label.toLowerCase()} plan.`); viewAccount(); }));
  $("#cancel") && ($("#cancel").onclick = async () => {
    if (!(await confirmSheet({ title: "Cancel your plan?", body: "Daily stories stop at the end of the current period. Your child's progress is kept, and the reading check stays free.", ok: "Cancel plan", danger: true }))) return;
    const r = await api.patch("/account", { cancel: true }); S.user = r.user; toast("Plan cancelled."); viewAccount();
  });
  $$('[name="imode"]').forEach((r) => (r.onchange = () => { store.set("wren.input", r.value); toast(MODE_LABEL[r.value]); }));
  $("#mute").onchange = (e) => store.set("wren.mute", e.target.checked);
  $("#audio").onchange = async (e) => { const r = await api.patch("/account", { audioOptIn: e.target.checked }); S.user = r.user; toast(e.target.checked ? "Audio clips will be kept." : "Audio clips won't be kept."); };
  $("#export").onclick = async () => {
    const data = await api.get("/account/export");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    a.download = `wren-data-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $("#delete").onclick = () => sheet(`<h3>Delete your account?</h3><p class="muted" style="margin-top:8px">This permanently erases your account, every child profile and every reading session. It can't be undone.</p>
    <form id="f-del" novalidate style="margin-top:16px"><div class="alert alert-bad" data-alert hidden></div>${pwField("password", "Enter your password to confirm", "current-password")}
    <div style="display:flex;gap:10px;justify-content:flex-end"><button type="button" class="btn btn-ghost" data-close>Keep my account</button><button class="btn btn-accent" type="submit">Delete everything</button></div></form>`,
  (el) => { bindPw(el); bindForm(el.querySelector("#f-del"), async (d) => { await api.del("/account", d); S.user = null; S.children = []; setActive(null); location.href = "index.html"; }); });
  $$("[data-edit]").forEach((b) => (b.onclick = () => editChild(S.children.find((c) => c.id === b.dataset.edit))));
}
function childFields(c = {}) {
  return `<div class="field"><label for="c-name">First name or nickname</label><input class="input" id="c-name" name="name" maxlength="40" value="${esc(c.name || "")}" required><div class="err" data-err="name"></div></div>
    <div class="field"><label for="c-age">Age</label><select class="input" id="c-age" name="age">${[4, 5, 6, 7, 8].map((a) => `<option ${Number(c.age || 5) === a ? "selected" : ""}>${a}</option>`).join("")}</select><div class="err" data-err="age"></div></div>
    <div class="field"><label for="c-world">World</label><select class="input" id="c-world" name="world">${Object.entries(E.WORLDS).map(([id, w]) => `<option value="${id}" ${c.world === id ? "selected" : ""}>${esc(w.name)} (with ${esc(w.hero)})</option>`).join("")}</select></div>
    <div class="field"><label for="c-pro">In reports, call them</label><select class="input" id="c-pro" name="pronoun">${["she", "he", "they"].map((p) => `<option ${(c.pronoun || "they") === p ? "selected" : ""}>${p}</option>`).join("")}</select></div>
    <div class="field"><span class="label">Color</span><div class="avatars">${Object.entries(AV).map(([k, v]) => `<label style="position:relative"><input type="radio" name="avatar" value="${k}" ${(c.avatar || "sun") === k ? "checked" : ""} style="position:absolute;opacity:0"><span class="av" style="background:${v};width:44px;height:44px;cursor:pointer;box-shadow:inset 0 0 0 2px rgba(0,0,0,.06)"></span></label>`).join("")}</div></div>`;
}
function bindAvatarRadios(root) {
  const upd = () => $$('[name="avatar"]', root).forEach((i) => (i.nextElementSibling.style.outline = i.checked ? "3px solid var(--ink)" : "none"));
  $$('[name="avatar"]', root).forEach((i) => (i.onchange = upd)); upd();
}
function editChild(c) {
  sheet(`<h3>Edit ${esc(c.name)}</h3><form id="f-ed" novalidate style="margin-top:14px"><div class="alert alert-bad" data-alert hidden></div>${childFields(c)}
    <div style="display:flex;gap:10px;justify-content:space-between;flex-wrap:wrap"><button type="button" class="btn btn-quiet" id="rm" style="color:var(--bad)">Remove profile</button><div style="display:flex;gap:10px"><button type="button" class="btn btn-ghost" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div></div></form>`,
  (el, close) => {
    bindAvatarRadios(el);
    bindForm(el.querySelector("#f-ed"), async (d) => { await api.patch(`/children/${c.id}`, { ...d, age: Number(d.age) }); S.bundle = null; await refreshMe(); close(); toast("Saved."); render(); });
    el.querySelector("#rm").onclick = async () => {
      close();
      if (!(await confirmSheet({ title: `Remove ${c.name}?`, body: `This deletes ${esc(c.name)}'s profile, skill map and every session. It can't be undone.`, ok: "Remove", danger: true }))) return;
      await api.del(`/children/${c.id}`); S.bundle = null; await refreshMe(); if (S.active === c.id) setActive(S.children[0]?.id || null); toast("Profile removed."); render();
    };
  });
}
function viewAddChild(opts = {}) {
  shell("account", `<div style="max-width:560px;margin:0 auto"><div class="page-head"><h1>${opts.first ? "Add your reader" : "Add a child"}</h1></div>
    <form class="card pad" id="f-add" novalidate><div class="alert alert-bad" data-alert hidden></div>${childFields({ age: 5, world: "dinos", pronoun: "they", avatar: "leaf" })}
    <div style="display:flex;gap:10px;justify-content:flex-end">${opts.first ? "" : `<a class="btn btn-ghost" href="#/account">Cancel</a>`}<button class="btn btn-primary" type="submit">Add child</button></div></form></div>`);
  bindAvatarRadios(app);
  bindForm($("#f-add"), async (d) => { const r = await api.post("/children", { ...d, age: Number(d.age) }); await refreshMe(); setActive(r.child.id); toast(`${r.child.name} added.`); go("/check"); });
}
async function signOut() {
  try { await api.post("/auth/signout"); } catch {}
  S.user = null; S.children = []; S.bundle = null; store.sdel("wren.ob");
  go("/signin");
}

/* ================================================================== */
/* READING CHECK: parent intro + results                               */
/* ================================================================== */
function viewCheckIntro() {
  const c = activeChild(); if (!c) return go("/add-child");
  const mode = inputMode();
  shell("home", `<div style="max-width:720px;margin:0 auto">
    <div class="page-head"><div><div class="muted" style="font-weight:700">Free reading check</div><h1>Before you hand over the tablet</h1></div></div>
    <div class="card pad">
      <ol style="margin:0;padding-left:22px;display:grid;gap:10px;font-size:16.5px">
        <li><b>Find a quiet spot.</b> A TV in the background makes it harder to hear ${esc(c.name)}.</li>
        <li><b>${esc(c.name)} reads three short passages aloud</b>, each harder than the last. It takes about 12 minutes, and less if Wren stops early.</li>
        <li><b>Let ${esc(pn(c)[1])} try on ${esc(pn(c)[2])} own.</b> If ${esc(pn(c)[0])} get${c.pronoun === "they" ? "" : "s"} stuck, ${esc(pn(c)[0])} can tap a word to hear it. Please don't help, or the report won't be accurate.</li>
        <li><b>Your report appears</b> as soon as ${esc(pn(c)[0])} finish${c.pronoun === "they" ? "" : "es"}.</li>
      </ol>
    </div>
    <div class="card pad" style="margin-top:16px"><div class="section-title">How should Wren follow along?</div>
      <div class="choice-grid">${["mic", "tap", "demo"].map((m) => `<label class="choice"><input type="radio" name="imode" value="${m}" ${mode === m ? "checked" : ""} ${m === "mic" && !SR ? "disabled" : ""}><div><b>${MODE_LABEL[m]}</b><small>${m === "mic" ? (SR ? "Wren hears each word. Your browser will ask for microphone access." : "Not supported in this browser. Try Chrome, Edge or Safari.") : m === "tap" ? "You sit nearby and tap any word that was tricky." : "No child handy? Watch a simulated five-year-old read, with typical mistakes."}</small></div></label>`).join("")}</div>
      <div id="demo-prof" ${mode === "demo" ? "" : "hidden"} style="margin-top:12px"><label class="label" for="prof">Simulated reader</label><select class="input" id="prof" style="margin-top:6px">${Object.entries(E.DEMO_PROFILES).map(([k, p]) => `<option value="${k}" ${store.get("wren.demoProfile", "typical5") === k ? "selected" : ""}>${esc(p.label)}</option>`).join("")}</select></div>
      <div id="mic-test" class="alert alert-info" hidden style="margin-top:12px"></div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:12px;margin-top:20px"><a class="btn btn-ghost btn-lg" href="#/home">Not now</a><button class="btn btn-accent btn-lg" id="go">Hand to ${esc(c.name)} →</button></div>
  </div>`);
  $$('[name="imode"]').forEach((r) => (r.onchange = () => { store.set("wren.input", r.value); $("#demo-prof").hidden = r.value !== "demo"; }));
  $("#prof").onchange = (e) => store.set("wren.demoProfile", e.target.value);
  $("#go").onclick = async () => {
    if (inputMode() === "mic") {
      const ok = await micPermission();
      if (!ok) { const m = $("#mic-test"); m.hidden = false; m.textContent = "Wren couldn't use the microphone. Allow access in your browser settings, or choose \"Grown-up marks tricky words.\""; return; }
    }
    go("/kid/check");
  };
}
async function micPermission() {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); return true; } catch { return false; }
}

async function viewResults({ params }) {
  const c = activeChild(); if (!c) return go("/home");
  const { child, readings, report } = await loadBundle(true);
  const r = readings.find((x) => x.id === params[0]) || readings.find((x) => x.kind === "assessment");
  if (!r) return go("/home");
  const map = E.masteryMap(child.state);
  // Group this session's misses by the skill that was blamed.
  const bySkill = {};
  for (const e of r.errors || []) {
    const ev = E.evidenceFrom([{ word: e.word, heard: e.heard, status: e.status }]).filter((x) => !x.ok);
    for (const x of ev) (bySkill[x.skill] ||= []).push(e);
  }
  const gaps = (report.targets.length ? report.targets : Object.keys(bySkill)).slice(0, 3);
  const prog = E.stageProgress(map).filter((p) => p.id >= 1);
  const secure = E.secureStageNames(map);
  const summary = `${child.name}'s reading check (${fmtDay(r.at)}): ${report.level.name} (${report.level.band}). Accuracy ${r.accuracy}% over ${r.words} words. Working on: ${gaps.map((g) => E.SKILL_BY_ID[g].label).join(", ")}. ${report.headline}`;
  shell("home", `<div style="max-width:880px;margin:0 auto">
    <div class="page-head"><div><div class="muted" style="font-weight:700">Reading check · ${fmtDay(r.at)}</div><h1>${esc(child.name)}'s report</h1></div>
      <div class="no-print" style="display:flex;gap:8px"><button class="btn btn-ghost btn-sm" id="copy">Copy for teacher</button><button class="btn btn-ghost btn-sm" onclick="print()">Print</button></div></div>
    <div class="card res-hero">
      <div><div class="section-title">Level</div><b style="font-size:19px">${esc(report.level.name)}</b><div class="small muted">${esc(report.level.band)}</div>${lvlMeter(report.level)}</div>
      <div><div class="section-title">Accuracy</div><div class="bigstat tnum">${r.accuracy}%</div><div class="small muted">${r.correct} of ${r.words} words</div></div>
      <div><div class="section-title">Words per minute</div><div class="bigstat tnum">${r.wcpm ?? "–"}</div><div class="small muted">read correctly</div></div>
      <div><div class="section-title">Secure stages</div><b style="font-size:17px">${secure.length ? esc(secure.join(", ")) : "Building letter sounds"}</b></div>
    </div>
    <section class="card pad" style="margin-top:18px"><div class="section-title">In plain English</div><p style="font-size:18px">${esc(report.headline)}</p>${report.detail ? `<p class="muted" style="margin-top:8px">${esc(report.detail)}</p>` : ""}</section>
    <section class="card pad" style="margin-top:18px"><div class="section-title">The three things to work on</div>
      ${gaps.length ? gaps.map((g, i) => { const k = E.SKILL_BY_ID[g]; const ex = (bySkill[g] || []).slice(0, 3); return `<div class="gap-row"><div><span class="muted tnum" style="font-weight:800;margin-right:8px">${i + 1}</span><b>${esc(k.label)}</b> <span class="muted small">${k.stage === 0 ? "tricky word" : `${esc(k.group.toLowerCase())}, as in ${esc(k.example)}`}</span></div><div class="errs" style="margin:0">${ex.length ? ex.map((e) => `<span class="err-chip">${esc(e.word)} → <s>${esc(e.heard || "skipped")}</s></span>`).join("") : `<span class="err-chip">next up</span>`}</div></div>`; }).join("") : `<p class="muted">No gaps found in these passages. Daily stories will move on to harder patterns.</p>`}
      <div class="bedtime"><b>Tonight, 90 seconds</b>${esc(report.bedtime)}</div>
    </section>
    <section class="card pad" style="margin-top:18px"><div class="section-title">Where ${esc(child.name)} is on the map</div>
      ${prog.map((p) => `<div class="kv"><span>${esc(p.name)}</span><span style="display:flex;align-items:center;gap:10px;min-width:180px"><span class="lane-bar" style="flex:1;margin:0"><b style="width:${p.pct}%"></b><i style="width:${(100 * p.working) / p.total}%"></i></span><b class="tnum small" style="width:38px;text-align:right">${p.pct}%</b></span></div>`).join("")}
    </section>
    <div class="card pad no-print" style="margin-top:18px;display:flex;gap:16px;align-items:center;justify-content:space-between;flex-wrap:wrap;background:var(--brand-soft);border-color:transparent">
      <div><b style="font-size:18px">Tomorrow's story is already written around these gaps.</b><p class="muted small">It takes 15 minutes a day, and your trial covers it.</p></div>
      <div style="display:flex;gap:10px"><a class="btn btn-ghost" href="#/skills">Skill map</a><a class="btn btn-primary" href="#/kid/session">Start the first story</a></div></div>
    <p class="hint" style="margin-top:14px">This check screens phonics skills from a short sample. It isn't a diagnosis. If you're worried about dyslexia or a speech or hearing difference, talk to your child's school or pediatrician.</p>
  </div>`);
  $("#copy").onclick = async () => { try { await navigator.clipboard.writeText(summary); toast("Copied. Paste it into an email to the teacher."); } catch { toast("Couldn't copy on this device."); } };
}

/* ================================================================== */
/* KID MODE                                                            */
/* ================================================================== */
let rec = null; let recActive = false;
function stopListening() { recActive = false; if (rec) { try { rec.onend = null; rec.abort(); } catch {} rec = null; } }

function kidFrame(child, stepsTotal, stepNow, inner) {
  document.body.classList.add("kid-open");
  const steps = Array.from({ length: stepsTotal }, (_, i) => `<i class="${i < stepNow ? "done" : i === stepNow ? "now" : ""}"></i>`).join("");
  app.innerHTML = `<div class="kid w-${child.world}" id="kid">
    <div class="kid-top"><span style="width:112px"></span><div class="kid-steps" aria-label="Progress: step ${stepNow + 1} of ${stepsTotal}">${steps}</div>
      <button class="gate" id="gate" aria-label="Grown-ups: press and hold to leave"><b></b><span>Grown-ups: hold</span></button></div>
    <div class="kid-body" id="kid-body">${inner}</div></div>`;
  bindGate();
  return $("#kid-body");
}
function bindGate() {
  const g = $("#gate"); if (!g) return;
  const fill = g.querySelector("b");
  let t0 = 0, raf = 0;
  const stop = () => { cancelAnimationFrame(raf); fill.style.width = "0"; t0 = 0; };
  const loop = () => {
    const p = Math.min(1, (performance.now() - t0) / 1600);
    fill.style.width = p * 100 + "%";
    if (p >= 1) { stop(); stopListening(); exitKid(); return; }
    raf = requestAnimationFrame(loop);
  };
  g.addEventListener("pointerdown", (e) => { e.preventDefault(); t0 = performance.now(); loop(); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => g.addEventListener(ev, stop));
  g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); exitKid(); } });
}
async function exitKid() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  const ok = await confirmSheet({ title: "Leave kid mode?", body: "This story won't be saved if you leave now.", ok: "Leave" });
  if (ok) { stopListening(); go("/home"); }
}
const micIcon = `<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0012 0M12 17v4" stroke="currentColor" stroke-width="2.2" fill="none" stroke-linecap="round"/></svg>`;
const featherSVG = (c) => `<svg class="feather" viewBox="0 0 48 48" aria-hidden="true"><path d="M40 6C22 6 10 18 8 40c6-10 14-16 24-18-6 4-12 8-16 16 14-2 24-14 24-32z" fill="${c}"/><path d="M8 40L30 16" stroke="#fff" stroke-width="2" opacity=".6"/></svg>`;

// Reads one page aloud. Resolves with { transcript, seconds, alignment }.
function readPage(host, { text, child, annot = null, scene = "", hunt = false, prompt = "", big = false }) {
  return new Promise((resolve) => {
    const toks = E.tokensOf(text);
    const mode = inputMode();
    const wordsHTML = toks.map((t, i) => {
      const a = annot?.words?.[i];
      const cls = ["w", a?.target ? "tgt" : "", a && !a.decodable ? "wren-reads" : ""].join(" ");
      return `<span class="${cls}" data-i="${i}" role="button" tabindex="0">${esc(t)}</span>`;
    }).join(" ");
    const W = E.WORLDS[child.world];
    host.innerHTML = `
      ${prompt ? `<p class="say" style="margin:0 0 14px">${prompt}</p>` : ""}
      <div class="page-card">${scene}
        <div class="reader ${hunt ? "hunt" : ""} ${toks.length > 22 ? "long" : ""}" style="${big ? "font-size:clamp(44px,8vw,80px);text-align:center" : ""}" id="reader">${wordsHTML}</div>
        <div class="reader-bar">
          <div class="wren-talk"><div style="width:64px;flex:none" id="wren-face">${wrenSVG({ size: 64, listening: mode !== "tap" })}</div><div class="bub" id="bub">${mode === "tap" ? `Read it out loud to your grown-up!` : `Tap the button, then read out loud!`}</div></div>
          ${mode === "tap" ? `<div class="mode-note" style="flex-basis:100%;order:3">Grown-up: tap any word ${esc(child.name)} found tricky, then press Done.</div>` : ""}
          ${mode !== "tap" ? `<button class="mic" id="mic" aria-label="Start listening">${micIcon}</button>` : ""}
          <button class="btn btn-primary btn-lg" id="done" ${mode !== "tap" ? "hidden" : ""}>Done</button>
        </div>
      </div>`;
    const spans = $$("#reader .w", host);
    const bub = $("#bub", host);
    const t0 = performance.now();
    let finals = "", interim = "", finished = false, flagged = new Set(), autoTimer = 0;

    const paint = (al) => {
      let last = -1;
      al.forEach((a) => { if (a.status === "correct" || a.status === "error") last = Math.max(last, a.i); });
      spans.forEach((s, i) => {
        const a = al[i];
        s.classList.toggle("read", i <= last && a?.status === "correct");
        s.classList.toggle("miss", i <= last && a?.status === "error");
        s.classList.toggle("now", i === last + 1);
      });
      return last + 1;
    };
    const current = () => (finals + " " + interim).trim();
    const onHeard = () => {
      const progress = paint(E.alignReading(text, current(), { prefix: true }));
      if (progress >= toks.length) { clearTimeout(autoTimer); autoTimer = setTimeout(finish, interim ? 1200 : 600); }
      else if (progress > 0) { $("#done", host).hidden = false; bub.textContent = progress > toks.length / 2 ? "Keep going!" : "I'm listening…"; }
    };
    const finish = () => {
      if (finished) return; finished = true;
      clearTimeout(autoTimer); stopListening();
      const seconds = (performance.now() - t0) / 1000;
      let transcript = current();
      if (mode === "tap") transcript = toks.filter((_, i) => !flagged.has(i)).join(" ");
      const alignment = E.alignReading(text, transcript, { prefix: true }).filter((a) => a.status !== "pending");
      resolve({ transcript, seconds, alignment: alignment.length ? alignment : E.alignReading(text, transcript) });
    };
    $("#done", host).onclick = finish;

    // Tap a word: in tap mode it flags the word; otherwise Wren says it.
    spans.forEach((s) => {
      const act = () => {
        const i = Number(s.dataset.i);
        if (mode === "tap") { flagged.has(i) ? flagged.delete(i) : flagged.add(i); s.classList.toggle("flag"); return; }
        s.classList.add("help"); say(E.norm(toks[i]) || toks[i], { rate: 0.8 });
      };
      s.addEventListener("click", act);
      s.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } });
    });

    const mic = $("#mic", host);
    if (!mic) return;
    if (mode === "demo") {
      mic.onclick = () => {
        mic.classList.add("on"); mic.disabled = true; bub.textContent = "I'm listening…";
        const heard = E.tokensOf(E.simulateReading(text, store.get("wren.demoProfile", "typical5"), (Date.now() / 1000) | 0));
        let k = 0;
        const step = () => {
          if (finished || !document.body.contains(host)) return;
          if (k >= heard.length) { finals = heard.join(" "); interim = ""; onHeard(); setTimeout(finish, 700); return; }
          k++; finals = heard.slice(0, k).join(" "); onHeard();
          setTimeout(step, 330 + Math.random() * 260);
        };
        setTimeout(step, 500);
      };
      return;
    }
    // Real speech recognition
    mic.onclick = () => {
      if (recActive) { finish(); return; }
      try {
        rec = new SR();
        rec.lang = "en-US"; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          interim = "";
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const r = e.results[i];
            if (r.isFinal) finals += " " + r[0].transcript; else interim += " " + r[0].transcript;
          }
          onHeard();
        };
        rec.onerror = (e) => {
          if (e.error === "not-allowed" || e.error === "service-not-allowed") { bub.textContent = "I can't hear you. A grown-up can allow the microphone, or switch to tapping in Account."; recActive = false; mic.classList.remove("on"); }
        };
        rec.onend = () => { if (recActive && !finished) { try { rec.start(); } catch {} } };
        recActive = true; rec.start();
        mic.classList.add("on"); mic.setAttribute("aria-label", "Stop listening"); bub.textContent = "I'm listening…";
        $("#done", host).hidden = false;
      } catch { bub.textContent = "The microphone isn't working here. Ask a grown-up to switch to tapping."; }
    };
  });
}

// After a page: specific praise, or one gentle "let's try it together".
async function feedback(host, { alignment, child, targets = [] }) {
  const errs = alignment.filter((a) => a.status === "error");
  const tset = new Set(targets);
  const praiseWord = alignment.find((a) => a.status === "correct" && E.parseWord(a.word).skills.some((k) => tset.has(k)));
  const allRight = alignment.every((a) => a.status === "correct");
  const pick = errs.find((a) => !E.parseWord(a.word).sight) || errs[0];
  if (!pick || inputMode() === "tap") {
    const line = allRight ? "You read every single word!" : praiseWord ? `You read “${E.norm(praiseWord.word)}”. Great sounding out!` : "Great reading!";
    const b = $("#bub", host); if (b) b.textContent = line;
    await say(line);
    await wait(500);
    return;
  }
  const p = E.parseWord(pick.word);
  const blamed = new Set(E.evidenceFrom([pick]).filter((x) => !x.ok).map((x) => x.skill));
  const chips = p.sight ? `<span class="hot">${esc(p.word)}</span>` : p.units.map((u) => `<span class="${blamed.has(u.skill) ? "hot" : ""}">${esc(u.g.replace("_", ""))}</span>`).join("");
  const opener = praiseWord ? `Nice work on “${E.norm(praiseWord.word)}”! ` : "Good reading! ";
  host.insertAdjacentHTML("beforeend", `<div class="page-card" id="fb" style="margin-top:16px;padding:18px 20px;text-align:center">
    <div style="font-weight:800;font-size:19px">${esc(opener)}Let's try this one together.</div>
    <div class="phon">${chips}</div>
    <div class="kid-actions" style="margin-top:12px"><button class="btn btn-ghost btn-lg" id="again">🔊 Hear it again</button><button class="btn btn-primary btn-lg" id="next">Next →</button></div></div>`);
  $("#fb", host).scrollIntoView({ behavior: "smooth", block: "nearest" });
  const sayIt = async () => {
    if (p.sight) { await say(`This is a tricky word. ${p.word}. ${p.word}.`); return; }
    await say(`${opener} This word is ${p.word}.`);
    for (const u of p.units) { await say(u.g.replace("_", "").replace(/(.)\1/, "$1"), { rate: 0.7 }); await wait(120); }
    await say(`${p.word}!`);
  };
  sayIt();
  $("#again", host).onclick = sayIt;
  await new Promise((res) => ($("#next", host).onclick = res));
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function kidHello(body, child, line, btn = "Let's read!") {
  const W = E.WORLDS[child.world];
  body.innerHTML = `<div style="display:flex;gap:10px;align-items:flex-end;justify-content:center">${wrenSVG({ size: 170, mood: "talk" })}${heroSVG(child.world, 170)}</div>
    <h1 style="margin-top:10px">${esc(line)}</h1>
    <p class="say">${esc(W.hero)} and I are so happy you're here.</p>
    <div class="kid-actions"><button class="btn btn-primary kid-big" id="go">${esc(btn)}</button></div>`;
  say(`${line}`);
  await new Promise((res) => ($("#go").onclick = res));
}

async function kidCheck() {
  const child = activeChild(); if (!child) return go("/home");
  const P = E.PASSAGES;
  const total = P.length + 2;
  let body = kidFrame(child, total, 0, "");
  await kidHello(body, child, `Hi ${child.name}! I'm Wren. Will you read to me?`);
  const results = [];
  let seconds = 0;
  for (let i = 0; i < P.length; i++) {
    body = kidFrame(child, total, i + 1, "");
    const scene = sceneSVG(["dinos", "ocean", "forest"][i], i + 1);
    const r = await readPage(body, { text: P[i].text, child, scene, prompt: `Story ${i + 1} of ${P.length}: <b>${esc(P[i].title)}</b>` });
    if (!document.body.contains(body)) return;
    results.push({ text: P[i].text, transcript: r.transcript });
    seconds += r.seconds;
    const acc = r.alignment.filter((a) => a.status === "correct").length / r.alignment.length;
    const bub = $("#bub", body);
    const line = acc > 0.9 ? "Wow, super reading!" : acc > 0.6 ? "Great job! You worked so hard." : "Thank you for reading to me!";
    if (bub) bub.textContent = line;
    await say(line); await wait(700);
    if (acc < 0.4) break; // stop early rather than frustrate
  }
  body = kidFrame(child, total, total - 1, `<div class="celebrate" style="text-align:center">${wrenSVG({ size: 170, mood: "talk" })}</div>
    <h1>All done! You're a super reader!</h1><p class="say">Please give the tablet back to your grown-up.</p>
    <div class="kid-actions"><button class="btn btn-ghost kid-big" id="saving" disabled>Saving…</button></div>`);
  say(`All done, ${child.name}! You're a super reader! Please give the tablet back to your grown-up.`);
  try {
    const out = await api.post(`/children/${child.id}/readings`, { kind: "assessment", title: "Free reading check", passages: results, seconds });
    S.bundle = null;
    const b = $("#saving"); b.disabled = false; b.textContent = "I'm the grown-up: show the report";
    b.onclick = () => go(`/results/${out.reading.id}`);
  } catch (e) { const b = $("#saving"); b.textContent = "Couldn't save. Tap to retry"; b.disabled = false; b.onclick = () => kidCheck(); toast(e.message); }
}

async function kidSession() {
  const child = activeChild(); if (!child) return go("/home");
  if (!child.assessed) return go("/check");
  let body = kidFrame(child, 4, 0, `<div class="spinner"></div><p class="say">Wren is getting your story ready…</p>`);
  const [{ story }, bundle] = await Promise.all([api.post(`/children/${child.id}/story`, { world: child.world }), loadBundle(true)]);
  const map = E.masteryMap(bundle.child.state);
  const allowed = E.allowedSkills(map, []);
  // Warm-up: five secure words, read fast.
  const r = Math.random;
  const pool = E.WORD_BANK.filter((w) => E.isDecodable(w, allowed));
  const warm = [];
  while (pool.length && warm.length < 5) warm.push(pool.splice(Math.floor(r() * pool.length), 1)[0]);
  const pages = story.pages;
  const total = 2 + pages.length + 1;
  let step = 0;
  body = kidFrame(child, total, step, "");
  await kidHello(body, child, `Hi ${child.name}! Ready for a new story?`, "I'm ready!");
  const passages = [];
  let seconds = 0;
  if (warm.length) {
    body = kidFrame(child, total, ++step, "");
    const res = await readPage(body, { text: warm.join(" "), child, hunt: true, prompt: "<b>Warm-up!</b> Read these words as fast as you can." });
    if (!document.body.contains(body)) return;
    passages.push({ text: warm.join(" "), transcript: res.transcript }); seconds += res.seconds;
    await feedback(body, { alignment: res.alignment, child, targets: story.targets });
  }
  body = kidFrame(child, total, ++step, `<div class="page-card" style="max-width:720px">${sceneSVG(story.world, 0)}<div style="padding:26px;text-align:center"><div class="eyebrow">Today's story</div><h1 style="margin-top:6px">${esc(story.title)}</h1><p class="say">Look for the <span style="text-decoration:underline;text-decoration-color:#D8662F;text-decoration-thickness:4px;text-underline-offset:6px">underlined</span> words. They have your new sounds!</p><div class="kid-actions"><button class="btn btn-primary kid-big" id="go">Open the book</button></div></div></div>`);
  say(`Today's story is called ${story.title}.`);
  await new Promise((res) => ($("#go").onclick = res));
  for (let i = 0; i < pages.length; i++) {
    const pg = pages[i];
    body = kidFrame(child, total, ++step, "");
    const res = await readPage(body, {
      text: pg.text, child, annot: pg, hunt: !!pg.hunt,
      scene: pg.hunt ? "" : sceneSVG(story.world, i),
      prompt: pg.hunt ? `<b>Word hunt!</b> These words have your new sounds.` : "",
    });
    if (!document.body.contains(body)) return;
    passages.push({ text: pg.text, transcript: res.transcript }); seconds += res.seconds;
    await feedback(body, { alignment: res.alignment, child, targets: story.targets });
  }
  body = kidFrame(child, total, total - 1, `<div class="spinner"></div>`);
  let out;
  try { out = await api.post(`/children/${child.id}/readings`, { kind: "story", title: story.title, passages, seconds }); }
  catch (e) { toast(e.message); return go("/home"); }
  S.bundle = null;
  const c2 = out.child;
  const earned = 1 + Math.min(3, out.reading.newlySecure.length);
  const cols = ["#D8662F", "#F2BD45", "#2E5E4E", "#6FA9D8"];
  const newSk = out.reading.newlySecure.map((id) => E.SKILL_BY_ID[id]?.label).filter(Boolean).slice(0, 3);
  body = kidFrame(child, total, total, `<div class="celebrate" style="text-align:center">${wrenSVG({ size: 160, mood: "talk" })}</div>
    <h1>You did it, ${esc(child.name)}!</h1>
    <div class="feathers">${Array.from({ length: earned }, (_, i) => `<span style="animation-delay:${i * 0.18}s">${featherSVG(cols[i % 4])}</span>`).join("")}</div>
    <p class="say">You earned ${earned} feather${earned > 1 ? "s" : ""} for Wren's nest. 🔥 ${c2.streak}-day streak!${newSk.length ? `<br>New sounds you've got: <b>${newSk.map(esc).join(", ")}</b>` : ""}</p>
    <div class="kid-actions"><button class="btn btn-primary kid-big" id="bye">Bye, Wren!</button></div>`);
  say(`You did it, ${child.name}! You earned ${earned} feather${earned > 1 ? "s" : ""}. See you tomorrow!`);
  $("#bye").onclick = () => { toast(`${child.name} finished "${story.title}". 🪶`); go("/home"); };
}

/* ================================================================== */
/* BOOT                                                                */
/* ================================================================== */
(async function boot() {
  try {
    S.mode = await api.mode();
    const h = await api.health().catch(() => ({}));
    S.ai = !!h.ai;
    await refreshMe();
  } catch (e) { console.error(e); }
  // Handles /signin and /signup links from the landing page when the server rewrites them.
  if (!location.hash) {
    const p = location.pathname;
    history.replaceState(null, "", "#" + (/signup$/.test(p) ? "/signup" : /signin$/.test(p) ? "/signin" : S.user ? "/home" : "/signin"));
  }
  render();
})();

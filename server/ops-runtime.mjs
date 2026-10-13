// Tacit procedure runtime: executes an Open Procedure Schema (OPS 0.3) bundle against a ticket.
// This one file is the single source of truth. The server imports it, and the web app inlines the same code
// (the build step in tools/sync-runtime.mjs copies it in), so the in-app API console and POST /api/v1/resolve
// always give the same answer.
export function opsResolve(bundle, input) {
  const procs = (bundle && Array.isArray(bundle.procedures)) ? bundle.procedures : [];
  const text = ((input.subject || "") + " " + (input.message || "")).toLowerCase();
  const facts = Object.assign({}, input.facts || {});
  // 1. Route the ticket to a procedure, unless the caller named one.
  let proc = null, score = 0, hits = [];
  if (input.procedure_id) {
    proc = procs.find((p) => p.id === input.procedure_id) || null;
    if (!proc) return { outcome: "error", error: `No procedure with id "${input.procedure_id}".` };
    score = 99;
  } else {
    for (const p of procs) {
      const sig = (p.trigger && p.trigger.signals) || [];
      const h = sig.filter((s) => s && text.includes(String(s).toLowerCase()));
      let sc = h.length;
      const only = p.trigger && p.trigger.customer;
      if (only) { if (String(facts.customer || "").toLowerCase() !== String(only).toLowerCase()) continue; sc += 2; }
      if (sc > score) { proc = p; score = sc; hits = h; }
    }
    if (score < 2) proc = null;
  }
  if (!proc) return { outcome: "handoff", reason: "No procedure matches this ticket closely enough. Hand it to a person.", match: { score } };
  // 2. Walk the steps, testing each condition against the facts.
  const plan = [], decisions = [], missing = [];
  const coerce = (x, v) => (typeof v === "number" ? Number(x) : typeof v === "boolean" ? (x === true || x === "true" || x === "yes") : String(x).toLowerCase());
  const test = (c) => {
    const x = facts[c.field];
    if (x === undefined || x === null || x === "") return { r: false, missing: true };
    const v = c.value;
    switch (c.op) {
      case "eq": return { r: coerce(x, v) === (typeof v === "string" ? v.toLowerCase() : v) };
      case "neq": return { r: coerce(x, v) !== (typeof v === "string" ? v.toLowerCase() : v) };
      case "lte": return { r: Number(x) <= Number(v) };
      case "lt": return { r: Number(x) < Number(v) };
      case "gt": return { r: Number(x) > Number(v) };
      case "in": return { r: (v || []).map((y) => String(y).toLowerCase()).includes(String(x).toLowerCase()) };
      default: return { r: false };
    }
  };
  (function walk(steps) {
    for (const s of steps || []) {
      if (s.if) {
        const t = test(s.if);
        decisions.push({ condition: s.label || `${s.if.field} ${s.if.op} ${JSON.stringify(s.if.value)}`, field: s.if.field, result: t.missing ? null : t.r });
        // A missing fact leaves this decision open: ask for it rather than guessing down either branch.
        if (t.missing) { missing.push(s.if.field); plan.push({ kind: "pending", text: `Decide: ${s.label || s.if.field} (needs ${s.if.field})` }); continue; }
        walk(t.r ? s.then : s.else);
      } else {
        const kind = s.check ? "check" : s.do ? "do" : s.escalate ? "escalate" : "reply";
        plan.push({ id: s.id, kind, text: s.check || s.do || s.escalate || s.reply, ...(s.owner ? { owner: s.owner } : {}) });
      }
    }
  })(proc.steps);
  const conf = proc.provenance && typeof proc.provenance.confidence === "number" ? proc.provenance.confidence : null;
  const esc = plan.filter((p) => p.kind === "escalate");
  let outcome = "resolve";
  if (conf !== null && conf < 0.6) outcome = "handoff";
  else if (missing.length) outcome = "ask";
  else if (esc.length) outcome = "escalate";
  return {
    outcome,
    procedure: { id: proc.id, name: proc.name, version: proc.version, confidence: conf, owner: proc.owner || null },
    match: { score, signals: hits },
    missing_facts: [...new Set(missing)],
    decisions,
    plan,
    escalate_to: [...new Set(esc.map((e) => e.owner).filter(Boolean))],
    guardrails: proc.guardrails || [],
    ...(outcome === "handoff" ? { reason: "Confidence is below 0.60, so a person should handle this." } : {}),
    ...(outcome === "ask" ? { reason: "Ask the customer for the missing facts first; the procedure depends on them." } : {}),
  };
}

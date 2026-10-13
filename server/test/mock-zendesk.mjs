// A stand-in for the parts of the Zendesk Support API Tacit uses, built from the documented response shapes:
//   GET /api/v2/search.json?query=type:ticket status:solved [updated>YYYY-MM-DD]
//   GET /api/v2/tickets/{id}/comments.json
//   GET /api/v2/users/show_many.json?ids=1,2
//   GET /api/v2/ticket_fields.json
// Paths are prefixed by the subdomain (/{subdomain}/api/v2/...) so the server's TACIT_ZENDESK_BASE can point here.
// Test control: POST /_add {rows:[...]} adds solved tickets; GET /_calls returns the request log.
import http from "node:http";

export function startMockZendesk({ subdomain = "acme", email = "agent@acme.io", token = "zd-token", rows = [] } = {}) {
  const FIELDS = ["plan", "arr", "seats", "amount", "days_since_renewal", "bank_status", "hours_to_payroll", "idp", "requester_is_admin", "forms_filed", "new_state", "employees"];
  const fieldId = (n) => 360000 + FIELDS.indexOf(n);
  const users = new Map(); let nextUser = 9000;
  const userId = (name) => { if (!users.has(name)) users.set(name, nextUser++); return users.get(name); };
  const tickets = []; const comments = new Map(); const calls = [];
  function add(r) {
    const id = Number(String(r.ticket_id || "").replace(/\D/g, "")) || 100000 + tickets.length;
    const assignee = userId(r.agent || "Agent");
    const created = (r.created || "2026-01-01") + "T10:00:00Z";
    tickets.push({ id, subject: r.subject, description: r.message, status: "solved", priority: "normal", created_at: created, updated_at: created, assignee_id: assignee, requester_id: 1,
      via: { channel: "email" }, custom_fields: FIELDS.map((n) => ({ id: fieldId(n), value: r[n] === undefined || r[n] === "" ? null : r[n] })) });
    comments.set(id, [
      { id: id * 10 + 1, public: true, author_id: 1, body: r.message, plain_body: r.message },
      { id: id * 10 + 2, public: false, author_id: assignee, body: r.internal_note, plain_body: r.internal_note },
    ]);
  }
  rows.forEach(add);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    if (req.method === "POST" && url.pathname === "/_add") { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { JSON.parse(b).rows.forEach(add); json(200, { ok: true, total: tickets.length }); }); return; }
    if (url.pathname === "/_calls") return json(200, calls);
    const m = new RegExp(`^/${subdomain}/api/v2/(.+)$`).exec(url.pathname);
    if (!m) return json(404, { error: "RecordNotFound" });
    calls.push(m[1] + url.search);
    if (req.headers.authorization !== "Basic " + Buffer.from(`${email}/token:${token}`).toString("base64")) return json(401, { error: "Couldn't authenticate you" });
    const p = m[1];
    if (p === "search.json") {
      const qy = url.searchParams.get("query") || ""; const since = /updated>(\d{4}-\d{2}-\d{2})/.exec(qy);
      let list = tickets.filter((t) => t.status === "solved" && (!since || t.updated_at.slice(0, 10) > since[1]));
      list = list.slice().sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
      const page = Number(url.searchParams.get("page") || 1), per = Number(url.searchParams.get("per_page") || 100);
      const slice = list.slice((page - 1) * per, page * per);
      const next = page * per < list.length ? `http://${req.headers.host}/${subdomain}/api/v2/search.json?${new URLSearchParams({ ...Object.fromEntries(url.searchParams), page: String(page + 1) })}` : null;
      return json(200, { results: slice, count: list.length, next_page: next });
    }
    const cm = /^tickets\/(\d+)\/comments\.json$/.exec(p);
    if (cm) return json(200, { comments: comments.get(Number(cm[1])) || [], next_page: null });
    if (p === "users/show_many.json") { const ids = (url.searchParams.get("ids") || "").split(",").map(Number); return json(200, { users: [...users].filter(([, id]) => ids.includes(id)).map(([name, id]) => ({ id, name })) }); }
    if (p === "ticket_fields.json") return json(200, { ticket_fields: FIELDS.map((n) => ({ id: fieldId(n), title: n.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), type: "text" })), next_page: null });
    return json(404, { error: "RecordNotFound" });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}`, subdomain, email, token, add, calls })));
}

// Run standalone for manual or browser testing: node test/mock-zendesk.mjs <csv> [port]
if (process.argv[1] && process.argv[1].endsWith("mock-zendesk.mjs")) {
  const fs = await import("node:fs");
  const file = process.argv[2];
  const parse = (text) => { const [head, ...lines] = text.trim().split("\n"); const cols = head.split(","); return lines.map((l) => { const out = []; let f = "", qd = false; for (let i = 0; i < l.length; i++) { const c = l[i]; if (qd) { if (c === '"') { if (l[i + 1] === '"') { f += '"'; i++; } else qd = false; } else f += c; } else if (c === '"') qd = true; else if (c === ",") { out.push(f); f = ""; } else f += c; } out.push(f); return Object.fromEntries(cols.map((c, i) => [c, out[i] ?? ""])); }); };
  const z = await startMockZendesk({ rows: file ? parse(fs.readFileSync(file, "utf8")) : [] });
  if (process.argv[3]) { z.server.close(); z.server.listen(Number(process.argv[3]), "127.0.0.1"); }
  console.log(`mock Zendesk on ${process.argv[3] ? "http://127.0.0.1:" + process.argv[3] : z.base}  subdomain=acme email=agent@acme.io token=zd-token`);
}

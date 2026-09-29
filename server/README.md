# Tacit server

This server runs the full Tacit product. The page is the same one published at the live link, and when the server serves it, the page switches from browser-only storage to these real components:

| Component | What it does |
|---|---|
| **Accounts & sessions** | Sign-up and sign-in. Passwords are salted and hashed with scrypt. Sessions use an HttpOnly, SameSite=Lax cookie lasting 30 days, stored as a SHA-256 hash. Sign-in is rate-limited per IP. |
| **Database** | SQLite through Node's built-in `node:sqlite` (WAL mode). It stores users, sessions, workspaces (the uploaded export and every edit), AI usage and the pilot waitlist. |
| **AI** | `POST /api/ai` calls Claude through the official `@anthropic-ai/sdk`, using model `claude-opus-5-5` with server-side refusal fallback (`fallbacks: "default"`). It only works when signed in, and it's metered per user per day. It powers "Polish with Claude", reply drafting, help-article checks, "Ask the brain" and "Teach it from a thread". |
| **Zendesk import** | `POST /api/connectors/zendesk/import` reads solved tickets, their comments, assignees and custom fields through the Zendesk API with an API token. The token is used once and never stored. |
| **Lead capture** | `POST /api/waitlist` stores "Book a pilot" requests and connector waitlist sign-ups. |

It uses one dependency (`@anthropic-ai/sdk`) and needs Node 22.13 or later.

## Run it

```bash
cd server
npm install
export ANTHROPIC_API_KEY=sk-ant-...     # without it, everything works except the AI features
npm start                                # http://localhost:8787
```

Open http://localhost:8787, create an account, then upload a CSV or import from Zendesk.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | HTTP port |
| `ANTHROPIC_API_KEY` | – | Enables AI (the SDK also accepts `ANTHROPIC_AUTH_TOKEN`) |
| `TACIT_MODEL` | `claude-opus-5-5` | Claude model for every AI feature |
| `TACIT_AI_DAILY_LIMIT` | `200` | AI requests per user per day |
| `TACIT_DB` | `server/data/tacit.db` | SQLite file |
| `COOKIE_SECURE` | – | Set to `1` behind HTTPS |

## Deploy

```bash
docker build -f server/Dockerfile -t tacit .          # from the repo root
docker run -p 8787:8787 -v tacit-data:/data -e ANTHROPIC_API_KEY=sk-ant-... -e COOKIE_SECURE=1 tacit
```

This works on any container host with a persistent volume, such as Fly.io, Render or Railway. Put it behind HTTPS and set `COOKIE_SECURE=1`.

## Test

```bash
npm test
```

This starts a stand-in Anthropic API and the server on random ports, then runs 15 checks: sign-up and login, sessions, workspace storage, the request-forgery guard, the AI request shape (model, fallback), JSON parsing, refusal handling, metering, Zendesk input validation and the waitlist. It needs no API key or network.

## API

All mutating requests need the header `X-Tacit: 1`, which blocks cross-site form posts.

```
GET    /api/health                       { ok, ai, model, version }
POST   /api/auth/signup                  { name, email, company?, password }
POST   /api/auth/login                   { email, password }
POST   /api/auth/logout
GET    /api/me                           user, workspaces, AI usage
PATCH  /api/me                           { name?, company?, onboarded? }
DELETE /api/me                           deletes the account and its data
POST   /api/workspaces                   { id?, name, csv, source? }
GET    /api/workspaces/:id               includes csv and saved state
PUT    /api/workspaces/:id/state         { state }
PATCH  /api/workspaces/:id               { name }
DELETE /api/workspaces/:id
POST   /api/ai                           { input: string | turns[], json?, effort? }
POST   /api/connectors/zendesk/import    { subdomain, email, token, limit? } -> { csv, rows }
POST   /api/waitlist                     { email, name?, company?, team_size?, helpdesk?, source? }
```

## Not built yet

- Email verification and password reset (these need an email provider)
- Team workspaces shared between several users, and roles
- Scheduled re-sync from Zendesk (today it's a one-time import you can repeat)
- Intercom and Freshdesk connectors (use their CSV exports for now)

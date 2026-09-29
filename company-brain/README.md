# Tacit: a company brain for support teams

A working prototype of YC Request for Startups #17, "Company Brain". Tacit reads the record of real support work (resolved tickets, Slack threads, call notes, the help center). It turns that record into **executable procedures**: structured objects with conditions and branches, provenance and confidence. It also flags **drift** when behavior stops matching the docs or the procedures.

> Demo build. Quillfield, a payroll company, and all of its customers and tickets are fictional. The 118 tickets are generated from a fixed seed, so every load is identical.

## Real components
The same page runs in two places:

| | Live link (inside Claude) | Tacit server (`server/`) |
|---|---|---|
| Accounts | Email and password saved in this browser, or **Continue with Claude**, which uses your real Claude identity | Real accounts in SQLite, scrypt password hashing, HttpOnly session cookies |
| Data | This browser's storage | Server database; your workspaces follow you to any device |
| AI (Claude) | Runs on the viewer's Claude account | Runs on the server's `ANTHROPIC_API_KEY` (`claude-opus-5-5`, metered per user) |
| Zendesk | Upload a CSV export | Live read-only import with an API token |
| Book a pilot | Leads to sign-up | Saved to the server's waitlist table |
| Downloads | The viewer's save prompt | Normal browser downloads |

**AI features:** Polish with Claude (rewrites procedure names and steps in plain language, keeping the rules), reply drafting in Agent test, the help-article check in Knowledge audit, Ask the brain, and Teach it from a thread. When AI isn't available, each one says why and the rule-based engine keeps working.

See `server/README.md` to run or deploy the server, and `marketing/launch-kit.md` for positioning, pricing message, objection handling, a cold email sequence and launch copy.

## Product flow
- **Landing page** (`#home`). It has **Sign in** and **Get started free** in the header, plus buttons that open the demo workspace without an account.
- **Sign up / Sign in** (`#signup`, `#signin`). Fields are validated, and passwords are salted and hashed with SHA-256. *Prototype only:* accounts live in this browser's localStorage, so there is no email and no password reset.
- **Onboarding** (`#onboard`). You name a workspace, then upload or paste a helpdesk CSV, or start from the Quillfield demo. The engine builds the workspace in about a second.
- **The app** (`#overview` and the sidebar). The overview dashboard greets you and lists what needs attention (drift, low confidence, unconfirmed procedures), a getting-started checklist and every procedure. The sidebar has Knowledge audit, Procedures, Drift, Agent test, Ask, Export, Learn from data and Settings (profile, workspaces, connections waitlist, sign out, delete account). App pages send signed-out visitors to sign-in, then return them to the page they wanted.
- **Guest mode** (`#demo`). You explore the Quillfield workspace without an account.
- A workspace built from your own CSV runs through every tool. Procedures, confidence, drift, evidence, owner check-ins, the agent test, Ask and SKILL.md export all work on your data.

## The live engine (How it works tab)
This is the real pipeline, running in the browser with no pre-written output. It starts from a raw helpdesk export (125 tickets, notes written by six people in their own styles, sparse custom fields, some one-off tickets) and works in six steps:

1. **Read the notes.** It splits notes into phrases and merges phrases that mean the same action (token Jaccard ≥ 0.6), producing 341 phrases → 43 actions.
2. **Group the situations.** Average-linkage clustering on TF-IDF of the customer text plus the overlap of actions taken finds 10 situations. Groups under 4 tickets are kept aside.
3. **Learn the rules.** Common actions become fixed steps. Actions that never happen together become one either/or decision, and each decision gets a small decision tree over the export's columns. A split must explain at least 2 tickets, which prevents coincidental rules. A change-point scan then finds when the team started deciding differently: it detects the refund change (between Feb 12 and Mar 21) and the duplicate-charge approval moving from about $400 to $250 (between Jul 12 and Aug 11). It also notices that one situation only ever happens for Brightwater Clinics.
4. **Check the help center.** It matches each article to a situation and compares the article's numbers and instructions with what people did. The 14-day refund article comes out as out of date, 3 articles as not followed, 1 as unused and the W-2 article as still right.
5. **Write it down.** Each situation becomes a SKILL.md file.
6. **Try it.** A new ticket is routed to the closest situation, its facts are filled in, and the rules run. The page asks for any missing fact, and hands off when nothing matches.

**Paste your own CSV** to run it on your data. It needs a message column (`subject`/`message`) and a notes column (`internal_note`/`resolution`). Every other column is treated as a fact the rules can use.

## Screens

| Screen | What it shows |
|---|---|
| **Product** | The landing page: the thesis, how it works, the free-audit wedge, and pricing with a live ROI calculator ($3k to $15k a month) |
| **Audit** | The free knowledge audit. It lists procedures the team follows that aren't written down, help articles nobody follows (one is a privacy risk), and drift. Turn sources off and re-run it. |
| **Procedures** | The library. Each procedure is a flow of checks, actions, escalations and replies, with evidence counts per step. Thresholds are editable: change one and confidence is recalculated against the ticket evidence. **Extract from a thread** turns a pasted Slack thread into a draft procedure. |
| **Drift** | Two real detections. (1) KB-112 still says 14 days, but the team has refunded up to 30 days since Mar 9. (2) The *brain itself* drifted: the duplicate-charge procedure says $500, but recent tickets follow a $250 rule. Tacit searches thresholds, proposes $250, and **Accept** bumps it to v2. |
| **Agent test** | Seven incoming tickets, each run by two agents: one grounded in the help center, and one running Tacit procedures against the customer record. The Tacit side shows the facts it pulled, the conditions it tested and its plan. You can also write your own ticket. |
| **Schema** | Every procedure exports as a `SKILL.md` for agents, and as portable Open Procedure Schema JSON, one procedure or the full bundle. |
| **Ask** | Q&A grounded only in the procedures, with citations. Inside Claude it uses the viewer's Claude account; outside Claude it answers from the best-matching procedure. |

## How the engine works
- **Classification**: weighted keyword signals per procedure, plus customer-specific matches (the Brightwater exception).
- **Execution**: `run(procedure, facts)` walks the step tree and returns the executed steps, the trace of conditions it tested, and any missing inputs.
- **Confidence**: agreement between the current version and every ticket since the version took effect, scaled by evidence volume and corroborating sources. Agents hand off below 60%.
- **Drift**: if agreement over the last 60 days falls below 75%, Tacit tries candidate thresholds for each numeric condition and proposes the one that explains recent tickets. It also dates the start of the new behavior.

## Run it
It's one self-contained HTML file with no build step. State is saved in the browser's localStorage. Use **Procedures → Reset demo data** to restore the seeded state.

```bash
cd company-brain && python3 -m http.server 8080   # open http://localhost:8080
```

## 3-minute walkthrough
1. **Product**: read the hero ticket turning into a procedure, then drag the ROI sliders.
2. **Audit**: 5 undocumented procedures and 4 ignored articles. Open "Data export for a leaving customer".
3. **Agent test**: step through #5012 to #5018. The help-center agent gets 1 of 7 right; Tacit gets 6, and hands the 401(k) ticket to a person.
4. **Drift**: accept the $250 change, then open the procedure to see v2 and its changelog.
5. **Procedures**: set the refund window back to 14 and watch confidence fall. The evidence disagrees.
6. **Schema**: copy the SKILL.md an agent would load.

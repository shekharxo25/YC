# Tacit: a company brain for support teams

A working prototype of YC Request for Startups #17, "Company Brain". Tacit reads the record of real support work (resolved tickets, Slack threads, call notes, the help center). It turns that record into **executable procedures**: structured objects with conditions and branches, provenance and confidence. It also flags **drift** when behavior stops matching the docs or the procedures.

> Demo build. Quillfield, a payroll company, and all of its customers and tickets are fictional. The 118 tickets are generated from a fixed seed, so every load is identical.

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

# Tacit launch kit

Ready-to-use messaging for selling Tacit. Every number in this kit comes from the product or from YC RFS #17. Replace the demo figures (Quillfield, 31% → 58%) with your first real customer's results as soon as you have them.

---

## Positioning

**Category:** A company brain for customer support.

**One-liner:** Tacit learns how your support team actually handles each situation from resolved tickets, and turns it into procedures your AI agent can follow.

**For:** VPs of Support and Heads of CX at 200–2,000 person companies that have deployed, or tried to deploy, an AI support agent and watched its resolution rate stall.

**The problem:** The agent is capable, but it doesn't know how *this* company does things: the exceptions, the approval thresholds, the customer who gets special treatment. That knowledge lives in people's heads, old Slack threads and tickets nobody rereads. Agents can't act on vague.

**The promise:** Within a week, see what your team really knows. Then keep it written down, current, and executable.

**Why we're different (not a wiki, not a chatbot over docs):**
1. **It learns from what people did, not what was written.** Procedures come from resolved tickets and internal notes.
2. **It notices change.** When the team starts handling something differently, Tacit flags it, dates it and proposes the update.
3. **Every step shows its evidence:** the tickets, the people and a confidence score. Below 60%, the agent hands off instead of guessing.
4. **Agents can execute it.** It exports as skills files and JSON, and people read and edit the same thing in plain language.
5. **A named owner confirms every change.** Trust is the product.

**Proof points available today (demo workspace):** 5 procedures nobody wrote down, 4 help articles the team ignores, 2 rule changes detected with their dates, and 6 of 7 test tickets handled correctly compared with 1 of 7 for a help-center-only agent.

---

## Pricing message

- The knowledge audit is free.
- After that, $3,000 to $15,000 a month by ticket volume and sources.
- The frame that sells: *"Your agent resolves 31% of tickets today. What is it worth at 58%?"* Show the ROI calculator on the landing page.

---

## Objection handling

| Objection | Answer |
|---|---|
| "We'll build this in-house." | You can build the retrieval. The hard part is extracting procedures with conditions, keeping them current as behavior drifts, and attaching evidence to every step. That's the whole product, and the audit shows it on your own data in a week. |
| "A wrong procedure is worse than none." | Agreed. That's why every step shows its tickets, rules need at least two supporting tickets, agents hand off below 60% confidence, and owners confirm changes. |
| "Our search or assistant vendor will add this." | They index documents. Tacit learns from behavior and detects drift, which is a different kind of product. The format it produces is portable, so it works with whichever agent you run. |
| "Security?" | Import is read-only, API tokens aren't stored, and AI runs through Anthropic's API, which doesn't train on API data by default. |

---

## Cold email sequence (Head of CX)

**Email 1 (subject: your agent's 30-day refund problem)**
> Hi {first name}, most support agents we look at give the wrong answer on the same kind of ticket: the one where the team quietly changed the rule and the help center never caught up. Tacit reads your resolved tickets and shows you exactly where that's happening, usually within a week. It's free for the first audit. Worth 20 minutes?

**Email 2, three days later (subject: what your team knows that your agent doesn't)**
> One team we tested with had 5 procedures their people followed every week that existed nowhere in writing, and 4 help articles nobody followed anymore. Their agent was reading those 4. Happy to run the same audit on your tickets. Upload a CSV or connect Zendesk read-only.

**Email 3, a week later (subject: close the loop?)**
> Last note from me. If improving your agent's resolution rate is on the plan for this half, the audit takes one upload and shows the gaps on your own data. If the timing's wrong, just say so and I'll stop writing.

---

## LinkedIn launch post

> Every support team we've talked to hit the same wall with AI agents: the agent is smart, but it wasn't in the Slack thread where the refund rule changed, and it didn't hear the call where a big customer asked for a second review.
>
> So we built Tacit. It reads your resolved tickets, works out how your team actually handles each situation, and writes it down as procedures your agent can follow. Every step shows its evidence and has an owner who confirms it. When your team changes how they work, Tacit notices.
>
> The first knowledge audit is free. Link in the comments.

---

## Product Hunt

- **Tagline:** The company brain your support agent was missing
- **Description:** Tacit learns how your support team handles each situation from resolved tickets and turns it into procedures an AI agent can follow, with evidence, confidence and drift detection. Import from Zendesk or any CSV. AI by Claude.
- **First comment:** Why we built it, the wedge (the free audit), and a request: "Tell us the one rule your team follows that isn't written down anywhere."

---

## 30-second pitch

> AI support agents stalled in 2026 for one reason: they don't know how the company actually works. That knowledge was never written down. Tacit reads the record of real work (resolved tickets, internal notes, escalation threads) and extracts procedures, not documents: conditions, thresholds and owners, with the evidence behind every step. It detects when the team's behavior drifts from the docs, and it exports a format agents execute directly. We start with a free knowledge audit that shows a Head of CX the 20 procedures their team follows that exist nowhere, then sell the ongoing system at $3k–15k a month.

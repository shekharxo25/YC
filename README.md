> This branch also contains **[Wren](wren/)**, a voice-first reading tutor for ages 4 to 8, with a landing page, demo video, auth and onboarding.

# Nof1 Oncology

**One patient. One protocol.** A working demo of a physician-reviewed precision-oncology second-opinion service for non-small-cell lung cancer (NSCLC). It's based on YC Request for Startups #16, "AI Personalized Medicine".

A patient, family member or oncologist submits pathology, genomic sequencing, treatment history and current status. The system reasons across the full record and drafts a structured report. A board-certified oncologist then verifies each claim and signs the report before it is released.

> Demo build. All patients are fictional. Trial listings are illustrative. This is decision support for physicians, not a diagnosis.

## What's in the demo

| Screen | What it shows |
|---|---|
| **Home** | Patient-facing landing page, how the service works, pricing ($1,950 cash-pay; $3–8k/month for practices) |
| **New case** | A 4-step intake: patient → diagnosis and genomics → treatment history → review and consent. Paste an NGS report and tap **Detect alterations** to parse EGFR, ALK, ROS1, KRAS, BRAF, MET, RET, NTRK, HER2, NRG1, TP53, STK11, KEAP1 and more, plus PD-L1 and TMB. Three example cases load with one tap. |
| **Analysis** | A step-by-step, traceable pipeline: parse, classify, reconcile history, match therapies, screen trials, draft, queue for review |
| **Report** | Molecular findings (driver, resistance or co-mutation), therapies ranked with ESMO ESCAT evidence tier, regulatory status and source trial, clinical considerations, trials with a per-criterion eligibility check and distance to the nearest site, and questions to ask your oncologist |
| **Review console** | The moat: the oncologist verifies, edits or withholds each claim. A timer tracks review time, and signing is blocked until every claim is checked. Withheld items never reach the patient. |
| **Investors** | Pilot telemetry (reviewer agreement rate, average review time), a live unit-economics model with sliders, milestones, why now, and the regulatory posture |

### Live AI (when opened as a Claude artifact)
When the page runs inside Claude, three more features switch on:
- **Extract with AI**: reads free-text NGS reports.
- **Second-reader reasoning**: a live model challenges the rule-based draft before sign-off.
- **Ask about this case**: Q&A for the reviewing oncologist, with the full case in context.

Outside Claude, these features stay hidden and the deterministic engine runs on its own.

## Run it

It's one self-contained file with no build step and no backend. Data stays in the browser's localStorage.

- **Phone or laptop, quickest:** open `index.html` directly in a browser.
- **Phone on the same Wi-Fi as your laptop:**
  ```bash
  python3 -m http.server 8080
  # then on your phone open http://<your-laptop-LAN-IP>:8080
  ```
- **Public link:** enable GitHub Pages for this repo (Settings → Pages → deploy from this branch, root folder).

Use **Reports → Reset demo data** to restore the seeded cases before a pitch.

## Suggested 3-minute investor walkthrough
1. **Home**: the thesis, the price, and the fact that every report is physician-signed.
2. **New case → "EGFR · progressed on osimertinib" → Submit.** Watch the pipeline run, then read the report. MET amplification is identified as the resistance mechanism, and the report surfaces a matched MET-combination trial near Boston.
3. **Review**: verify a few claims, edit one, withhold one, then sign. Show the released report and the "withheld by reviewer" note.
4. **Investors**: drag review time from 60 to 20 minutes. Gross margin moves from about 65% to about 78%, which is the automation story.

## Engine notes
- The knowledge base covers approved and investigational NSCLC therapies across EGFR (sensitizing, T790M, C797S, exon 20), ALK (including resistance mutations such as G1202R), ROS1, KRAS G12C, BRAF V600E, MET (exon 14 and amplification), RET, NTRK, HER2 and NRG1. It also covers the no-driver immunotherapy pathway. Each entry cites its source trial.
- Treatment-line logic comes from the submitted history. For example, prior osimertinib moves EGFR options to the post-osimertinib setting.
- Evidence tiers use ESCAT. In production, trial listings would sync from ClinicalTrials.gov, and every recommendation would need clinical validation and regulatory counsel before launch.

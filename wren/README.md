# Wren

**A reading tutor that listens.** Wren is a voice-first reading tutor for ages 4 to 8. It's built around the "Primer" idea from YC's Request for Startups: tutor-quality teaching of reading, writing and arithmetic at consumer scale, starting with phonics-to-reading.

A child reads a short story aloud. Wren follows along word by word, works out which phonics sub-skill caused each mistake (the *st-* in "stop", the silent *e* in "rode"), and writes tomorrow's decodable story around those gaps, set in the world the child picked. Parents get a plain-English weekly note with one 90-second bedtime activity.

## What's here

| Part | Where | What it does |
|---|---|---|
| **Landing page** | `public/index.html` | Parent-facing page with the thesis, the embedded demo video (with chapters and captions), how it works, the free reading check, a sample report, worlds, habit design, privacy (COPPA), pricing ($29/mo or $199/yr with a 7-day trial) and FAQ. Once you're signed in, "Sign in" becomes "Open Wren". |
| **Demo video** | `public/media/wren-demo.mp4` | A 1:15, 1080p narrated product video with a music bed, WebVTT captions and a poster frame. It's reproducible: see `video/`. |
| **Auth** | `public/app.html#/signup`, `#/signin`, `#/forgot`, `#/reset/…` | Parent accounts with scrypt-hashed passwords, HttpOnly SameSite session cookies, same-origin and JSON-only checks on every write, rate limits on auth routes, single-use reset tokens that expire in 1 hour, and signing out other devices on password change. "Forgot password" never reveals whether an account exists. |
| **Onboarding** | `#/onboarding` | Six steps: welcome, COPPA consent (with an optional audio opt-in), child profile, world, starting point, then plan and trial. After that, the free reading check. |
| **Reading check** | `#/check` → kid mode | Three passages of rising difficulty. It stops early if the child is struggling, and gives an instant report with the reading level, accuracy, words correct per minute, the three gaps with the words that showed them, and a bedtime activity. You can copy the report for a teacher. |
| **Daily session** | `#/kid/session` | Warm-up words, then tonight's decodable story, then a word hunt for stretch sounds, then feathers and the streak. After each page Wren gives specific praise or one gentle "let's try this one together", sounding the word out grapheme by grapheme. |
| **Parent app** | `#/home`, `#/skills`, `#/progress`, `#/account` | The weekly report, a 134-skill map with evidence counts per skill, session history, and account controls: up to 4 children, plan, audio opt-in, JSON data export, password change and account deletion. |
| **Kid mode** | full screen | Big literacy-friendly type (Andika). Tap any word to hear it. A grown-up gate (press and hold) guards the way out. |

### How Wren follows the reading
Pick this per device in Account or before the check:
- **Microphone.** Uses the browser's speech recognition (Chrome, Edge or Safari). Wren aligns what it hears against the known text in real time, so it only judges "did they read *stop*?".
- **Grown-up marks tricky words.** Works everywhere: a parent taps any word the child stumbled on.
- **Demo reader.** A simulated child (three profiles) makes realistic errors, such as dropping blend consonants, ignoring magic e or misreading tricky words. It's handy for pitching.

## The engine (`public/engine.js`)
This is pure logic with no DOM, shared by the browser and the server:
- **Grapheme parser.** Splits a word into consonants, short vowels, digraphs, initial and final blends, magic e (split digraphs), vowel teams, bossy r, endings (-s, -ed, -ing) and 48 tricky words. That's 134 sub-skills in 7 stages plus sight words.
- **Error attribution.** Aligns the passage with the transcript (word level, prefix-aware while the child is still reading), then aligns letters inside each misread word and blames the grapheme that broke. For example, "stop" read as "top" blames `st-`, "rode" as "rod" blames `o–e`, and "rain" as "ran" blames `ai`.
- **Mastery model.** Keeps decayed success and miss counts per skill. It infers earlier-stage skills only when the observed skills in that stage are mostly secure. It picks 2 to 3 stretch targets, preferring skills the child actually missed.
- **Story writer.** Chooses the hardest decodable sentence for each page of an arc in each of five worlds, then adds a word hunt page for the targets. With `ANTHROPIC_API_KEY` set, the server asks Claude for a fresh story and **checks every word for decodability** before using it. If it fails the check, the engine's story is used instead.
- **Report writer.** Produces plain-English headlines, the three gaps and a target-specific bedtime activity.

## Run it

**With the server** (real accounts, SQLite, microphone). Needs Node 22.13 or later and has no npm dependencies:
```bash
cd wren
npm start            # http://localhost:8790
npm test             # 32 engine + API checks
```
Environment variables: `PORT`, `WREN_DB` (default `server/data/wren.db`), `COOKIE_SECURE=1` behind HTTPS, `TRUST_PROXY=1` behind a proxy, `NODE_ENV=production` (hides dev reset links), `ANTHROPIC_API_KEY` and `WREN_MODEL` for Claude-written stories. In development, password-reset links are printed to the console.

**Without a server** (GitHub Pages or any static host). Serve `wren/public/` as static files. The app detects that there's no `/api` and runs the same core (`public/core.js`) in the browser against localStorage, using PBKDF2 for passwords, and shows a "Demo mode" banner. It needs `http(s)://`, because ES modules don't load from `file://`.

## Rebuild the video
```bash
pip install kokoro-onnx soundfile numpy imageio-ffmpeg
# Put kokoro-v1.0.int8.onnx and voices-v1.0.bin (from github.com/thewh1teagle/kokoro-onnx releases) in $KOKORO_DIR
KOKORO_DIR=/path/to/models python3 video/build.py
```
Edit `video/narration.json` to change what's said. Scene timing follows the narration automatically. `video/scenes.html` is the animation, and it's rendered frame by frame through `video/render.cjs`.

## Notes and limits
- Billing is simulated (no payment provider). Parental consent is recorded with a timestamp. Production would add an FTC-approved verifiable consent method.
- Audio never leaves the device in this build. The browser's speech engine produces text, and only text is sent to the server.
- The reading check is a phonics screen from a short sample, not a diagnosis. The UI says so.
- The sample report on the landing page and the child in the video are illustrative.

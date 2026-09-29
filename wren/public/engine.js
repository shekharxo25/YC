// Wren reading engine. It is pure logic with no DOM and no network, so the browser app and the server share it.
// It does four jobs:
//   1. It parses a word into graphemes and tags each one with the phonics sub-skill it exercises.
//   2. It aligns what the child said against the text and blames errors on the exact grapheme.
//   3. It keeps a per-skill mastery model, infers the reading level and picks the next stretch targets.
//   4. It writes a decodable story from secure skills plus stretch targets, set in the child's world.

/* ------------------------------------------------------------------ */
/* Skill catalog                                                       */
/* ------------------------------------------------------------------ */

export const STAGES = [
  { id: 1, key: "sounds", name: "Letter sounds", blurb: "Hearing and saying the sound each letter makes." },
  { id: 2, key: "digraphs", name: "Digraphs", blurb: "Two letters, one sound: sh, ch, th, ck, ng." },
  { id: 3, key: "blends", name: "Blends", blurb: "Two consonants side by side, each still heard: st, fl, nd." },
  { id: 4, key: "magic_e", name: "Magic e", blurb: "A silent e at the end makes the vowel say its name: cap to cape." },
  { id: 5, key: "teams", name: "Vowel teams", blurb: "Two vowels working together: ai, ee, oa, igh." },
  { id: 6, key: "bossy_r", name: "Bossy r", blurb: "An r changes the vowel before it: car, for, her." },
  { id: 7, key: "endings", name: "Endings", blurb: "Adding -s, -ed and -ing to words the child already knows." },
];
// Sight words are learned alongside the stages. They get their own lane in the skill map.
export const SIGHT_STAGE = { id: 0, key: "sight", name: "Tricky words", blurb: "Common words that don't follow the rules yet: the, said, was." };

const CONSONANTS = ["s", "t", "p", "n", "m", "d", "g", "c", "k", "r", "h", "b", "f", "l", "j", "v", "w", "x", "y", "z", "qu"];
const SHORT_VOWELS = ["a", "i", "o", "e", "u"];
const DIGRAPHS = ["sh", "ch", "th", "wh", "ck", "ng", "nk", "ll", "ss", "ff", "zz"];
const INITIAL_BLENDS = ["st", "sp", "sn", "sl", "sm", "sk", "sw", "bl", "cl", "fl", "gl", "pl", "br", "cr", "dr", "fr", "gr", "tr"];
const FINAL_BLENDS = ["nd", "nt", "mp", "st", "sk", "ft", "lt", "lk", "sp"];
const MAGIC_E = ["a_e", "i_e", "o_e", "u_e", "e_e"];
const TEAMS = ["ai", "ay", "ee", "ea", "oa", "ow", "igh", "oo", "ue"];
const BOSSY_R = ["ar", "or", "er", "ir", "ur"];
const ENDINGS = ["-s", "-ed", "-ing"];
export const SIGHT_WORDS = [
  "the", "a", "i", "to", "is", "was", "said", "you", "he", "she", "we", "me", "be", "my", "of", "are", "they",
  "what", "do", "go", "no", "so", "here", "there", "where", "one", "come", "some", "have", "put", "all", "look",
  "into", "out", "down", "saw", "little", "very", "friend", "your", "now", "how", "by", "for", "could", "would", "want", "two",
];

const EXAMPLES = {
  s: "sun", t: "top", p: "pig", n: "net", m: "map", d: "dog", g: "gum", c: "cat", k: "kid", r: "red", h: "hat", b: "bat",
  f: "fan", l: "log", j: "jam", v: "van", w: "web", x: "fox", y: "yes", z: "zip", qu: "quit",
  a: "cat", i: "pig", o: "hot", e: "bed", u: "sun",
  sh: "ship", ch: "chip", th: "thin", wh: "when", ck: "duck", ng: "ring", nk: "pink", ll: "bell", ss: "kiss", ff: "puff", zz: "buzz",
  "a_e": "cake", "i_e": "bike", "o_e": "bone", "u_e": "cube", "e_e": "these",
  ai: "rain", ay: "play", ee: "tree", ea: "sea", oa: "boat", ow: "snow", igh: "night", oo: "moon", ue: "blue",
  ar: "car", or: "fork", er: "her", ir: "bird", ur: "fur", "-s": "cats", "-ed": "jumped", "-ing": "jumping",
};
const BLEND_EX = {
  st: "stop", sp: "spin", sn: "snap", sl: "sled", sm: "smell", sk: "skip", sw: "swim", bl: "black", cl: "clap", fl: "flag",
  gl: "glad", pl: "plum", br: "brick", cr: "crab", dr: "drum", fr: "frog", gr: "grin", tr: "trip",
};
const FBLEND_EX = { nd: "hand", nt: "tent", mp: "jump", st: "nest", sk: "desk", ft: "gift", lt: "belt", lk: "milk", sp: "wasp" };

function mk(id, stage, label, example, group) { return { id, stage, label, example, group }; }
export const SKILLS = [
  ...CONSONANTS.map((g) => mk("c:" + g, 1, g, EXAMPLES[g], "Consonants")),
  ...SHORT_VOWELS.map((g) => mk("v:" + g, 1, "short " + g, EXAMPLES[g], "Short vowels")),
  ...DIGRAPHS.map((g) => mk("d:" + g, 2, g, EXAMPLES[g], ["ll", "ss", "ff", "zz"].includes(g) ? "Double letters" : "Digraphs")),
  ...INITIAL_BLENDS.map((g) => mk("b:" + g, 3, g + "-", BLEND_EX[g], g[0] === "s" ? "s-blends" : g[1] === "l" ? "l-blends" : "r-blends")),
  ...FINAL_BLENDS.map((g) => mk("f:" + g, 3, "-" + g, FBLEND_EX[g], "Final blends")),
  ...MAGIC_E.map((g) => mk("m:" + g, 4, g.replace("_", "–"), EXAMPLES[g], "Magic e")),
  ...TEAMS.map((g) => mk("t:" + g, 5, g, EXAMPLES[g], "Vowel teams")),
  ...BOSSY_R.map((g) => mk("r:" + g, 6, g, EXAMPLES[g], "Bossy r")),
  ...ENDINGS.map((g) => mk("e:" + g, 7, g, EXAMPLES[g], "Endings")),
  ...SIGHT_WORDS.map((w) => mk("w:" + w, 0, w === "i" ? "I" : w, w === "i" ? "I" : w, "Tricky words")),
];
export const SKILL_BY_ID = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const SKILL_COUNT = SKILLS.length;

/* ------------------------------------------------------------------ */
/* Word parsing                                                        */
/* ------------------------------------------------------------------ */

const MULTI = ["igh", "sh", "ch", "th", "wh", "ck", "ng", "nk", "qu", "ai", "ay", "ee", "ea", "oa", "ow", "oo", "ue", "ar", "or", "er", "ir", "ur", "ll", "ss", "ff", "zz"];
const VOWEL = /[aeiou]/;
const isVowelLetter = (ch) => !!ch && "aeiou".includes(ch);
const SINGLE_CONS = new Set("bcdfghjklmnpqrstvwxyz".split(""));

export const norm = (w) => String(w || "").toLowerCase().replace(/[’']/g, "'").replace(/[^a-z']/g, "").replace(/'s$/, "").replace(/'/g, "");

function skillForGrapheme(g, pos, word) {
  if (g === "y") return pos === 0 ? "c:y" : null; // y as a vowel is out of scope for ages 4–6
  if (CONSONANTS.includes(g)) return "c:" + g;
  if (SHORT_VOWELS.includes(g)) return "v:" + g;
  if (DIGRAPHS.includes(g)) return "d:" + g;
  if (TEAMS.includes(g)) return "t:" + g;
  if (BOSSY_R.includes(g)) return "r:" + g;
  return null;
}

function tokenize(w) {
  const out = [];
  let i = 0;
  while (i < w.length) {
    let hit = null;
    for (const m of MULTI) {
      if (w.startsWith(m, i)) {
        // "er"/"ar"/"or" only counts as bossy r when it isn't followed by a vowel (e.g. "very" is v-e-r-y).
        if (BOSSY_R.includes(m) && isVowelLetter(w[i + 2] || "")) continue;
        // A vowel team only counts when it doesn't start a split: "hoped" isn't o-e.
        hit = m; break;
      }
    }
    const g = hit || w[i];
    out.push({ g, start: i, end: i + g.length });
    i += g.length;
  }
  return out;
}

// Returns { word, units:[{g, start, end, skill}], skills:[...], sight:boolean }
const parseCache = new Map();
export function parseWord(raw) {
  const word = norm(raw);
  if (parseCache.has(word)) return parseCache.get(word);
  let res;
  if (!word) res = { word, units: [], skills: [], sight: false };
  else if (SIGHT_WORDS.includes(word)) res = { word, units: [{ g: word, start: 0, end: word.length, skill: "w:" + word }], skills: ["w:" + word], sight: true };
  else res = parsePhonetic(word);
  parseCache.set(word, res);
  return res;
}

function parsePhonetic(word) {
  // Inflected endings: strip them, parse the base, then add the ending skill.
  const infl = inflection(word);
  if (infl) {
    const base = parseWord(infl.base);
    const units = base.units.map((u) => ({ ...u }));
    units.push({ g: infl.suffix.replace("-", ""), start: word.length - infl.len, end: word.length, skill: "e:" + infl.suffix });
    return { word, units, skills: uniq([...base.skills, "e:" + infl.suffix]), sight: false };
  }
  // Magic e: consonant(s) + single vowel + single consonant + e, e.g. cake, bike, these, stone.
  const me = /^([^aeiou]*)([aeiou])([^aeiou]{1,2}?)e$/.exec(word);
  if (me && word.length >= 4 && !/^(.*)(ee|ue)$/.test(word) && me[3].length === 1) {
    const [, onset, v, coda] = me;
    const units = consonantUnits(onset, 0, true);
    const vStart = onset.length;
    const u = { g: v + "_e", start: vStart, end: word.length, skill: "m:" + v + "_e", split: [vStart, word.length - 1] };
    units.push(u);
    units.push(...consonantUnits(coda, vStart + 1, false));
    return finish(word, units);
  }
  const toks = tokenize(word);
  const units = [];
  toks.forEach((t, idx) => units.push({ ...t, skill: skillForGrapheme(t.g, idx, word) }));
  mergeBlends(units, word);
  return finish(word, units);
}

function consonantUnits(str, offset, initial) {
  if (!str) return [];
  const toks = tokenize(str).map((t) => ({ g: t.g, start: t.start + offset, end: t.end + offset, skill: skillForGrapheme(t.g, t.start + offset, str) }));
  mergeBlends(toks, str, initial ? "initial" : "final");
  return toks;
}

function mergeBlends(units, word, only) {
  // initial blend: first two units are single consonants forming a known blend
  if (only !== "final" && units.length >= 2 && units[0].g.length === 1 && units[1].g.length === 1) {
    const b = units[0].g + units[1].g;
    if (INITIAL_BLENDS.includes(b) && SINGLE_CONS.has(units[0].g) && SINGLE_CONS.has(units[1].g)) {
      units.splice(0, 2, { g: b, start: units[0].start, end: units[1].end, skill: "b:" + b });
    }
  }
  // final blend: last two units are single consonants forming a known final blend
  if (only !== "initial") {
    const n = units.length;
    if (n >= 3 && units[n - 1].g.length === 1 && units[n - 2].g.length === 1) {
      const b = units[n - 2].g + units[n - 1].g;
      if (FINAL_BLENDS.includes(b)) units.splice(n - 2, 2, { g: b, start: units[n - 2].start, end: units[n - 1].end, skill: "f:" + b });
    }
  }
}

function finish(word, units) {
  return { word, units, skills: uniq(units.map((u) => u.skill).filter(Boolean)), sight: false };
}

const INFL_EXCEPT = new Set(["this", "bus", "yes", "gas", "his", "has", "is", "was", "red", "bed", "fed", "led", "sled", "shed", "wed", "king", "ring", "sing", "wing", "thing", "bring", "sting", "swing", "spring", "string", "ding", "less", "kiss", "moss", "boss", "miss", "mess", "dress", "grass", "glass", "class", "cross", "press", "chess", "hiss", "toss", "fuss", "us", "plus", "bees", "needs", "seed", "feed", "need", "weed", "reed", "speed", "bled", "fled", "sped", "shred", "sees"]);
function inflection(word) {
  if (INFL_EXCEPT.has(word) || word.length < 4) return null;
  if (word.endsWith("ing") && word.length >= 5) {
    let base = word.slice(0, -3);
    if (/([bcdfgklmnprtvz])\1$/.test(base) && !/(ll|ss|ff|zz)$/.test(base)) base = base.slice(0, -1);
    else if (/^[^aeiou]*[aeiou][^aeiou]$/.test(base) && WORD_SET.has(base + "e")) base = base + "e";
    if (VOWEL.test(base)) return { base, suffix: "-ing", len: 3 };
  }
  if (word.endsWith("ed") && word.length >= 5) {
    let base = word.slice(0, -2);
    if (/([bcdfgklmnprtvz])\1$/.test(base) && !/(ll|ss|ff|zz)$/.test(base)) base = base.slice(0, -1);
    else if (WORD_SET.has(base + "e") && !WORD_SET.has(base)) base = base + "e";
    if (VOWEL.test(base)) return { base, suffix: "-ed", len: 2 };
  }
  if (word.endsWith("s") && !/(ss|us|is)$/.test(word)) {
    const base = word.slice(0, -1);
    if (WORD_SET.has(base) || SIGHT_WORDS.includes(base)) return { base, suffix: "-s", len: 1 };
  }
  return null;
}

const uniq = (a) => [...new Set(a)];

/* ------------------------------------------------------------------ */
/* Word bank (used for word hunts, warm-ups and story vocabulary)      */
/* ------------------------------------------------------------------ */

export const WORD_BANK = (
  "cat hat mat bat rat cap map pan van bag rag jam ham dad man can ran sat had tap nap wag fan tan pat " +
  "pig wig pin bin lid kid zip lip hip dig hid sit fit bit big win fix mix six sip tip " +
  "dog log fog pot top mop box fox hop got hot not nod jog cot " +
  "sun bun bug rug mug cup pup hut nut bus run hug cut dug fun tug mud gum jug " +
  "bed red hen pen ten net jet leg web wet get let set fed yes vet " +
  "ship shop fish dish wish shed shut chip chop chin much rich thin this that then them with bath path moth when whip " +
  "duck sock rock back pack kick sick neck luck ring sing king long song bang wing thing pink sink wink bell hill doll kiss puff buzz fill well " +
  "stop step spot spin sled slip slam snap snack snug swim swam flag flap flip frog from drum drip trip trap truck crab crib club clap plan plum grin grab glad black skip skin smell brick " +
  "jump bump camp lamp hand sand band pond bend land tent went hunt belt milk gift raft soft best nest rest fast last must just desk mask ask " +
  "cake lake make game came name gate late cave wave tape bike hike like time ride hide kite five line pine home bone rope nose rode hole cute tube mule these stone smile shine " +
  "rain tail wait sail snail day play stay way say may tree see bee feet green sleep deep sea eat read team boat road coat goat snow grow slow low show night light right high moon soon food zoo cool room spoon blue true glue " +
  "car star park dark farm far jar for corn horn fork storm short her fern bird girl first dirt fur turn hurt burn"
).split(/\s+/);
const WORD_SET = new Set(WORD_BANK);

/* ------------------------------------------------------------------ */
/* Assessment passages                                                  */
/* ------------------------------------------------------------------ */

export const PASSAGES = [
  {
    id: "p1", title: "Sam and the Pup", level: 1,
    text: "Sam has a red cap. Sam can run and hop. A pup sat on the mat. The pup is big. Sam and the pup had fun in the sun.",
  },
  {
    id: "p2", title: "The Fish Shop", level: 2,
    text: "Beth and Chip went to the fish shop. They got a crab and a snack. Stop, said Beth. The bus is here! Chip ran fast and did a big jump.",
  },
  {
    id: "p3", title: "Jake at the Lake", level: 3,
    text: "Jake rode his bike to the lake. The rain came down, so he hid under a tree. Soon the sun came out. Jake and his dog had a picnic by the boat.",
  },
];

export const tokensOf = (text) => String(text).split(/\s+/).filter(Boolean);

/* ------------------------------------------------------------------ */
/* Alignment and error attribution                                      */
/* ------------------------------------------------------------------ */

function lev(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d;
}

// Letter-level alignment: returns the set of expected-letter indices that were wrong or missing.
function wrongLetters(expected, heard) {
  const d = lev(expected, heard);
  let i = expected.length, j = heard.length;
  const bad = new Set();
  const insertedBefore = new Set();
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + (expected[i - 1] === heard[j - 1] ? 0 : 1)) {
      if (expected[i - 1] !== heard[j - 1]) bad.add(i - 1);
      i--; j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + 1) { bad.add(i - 1); i--; }
    else { insertedBefore.add(Math.max(0, i - 1)); j--; }
  }
  for (const k of insertedBefore) bad.add(Math.min(k, expected.length - 1));
  return bad;
}

// Word-level alignment of the passage against the transcript.
// Returns [{ i, word, heard, status: 'correct'|'error'|'skipped'|'pending' }]
// With { prefix: true } the transcript is treated as a reading in progress. Words after the last one reached are 'pending', not skipped.
export function alignReading(passageText, transcript, { prefix = false } = {}) {
  const exp = tokensOf(passageText);
  const expN = exp.map(norm);
  const got = tokensOf(transcript).map(norm).filter(Boolean);
  const m = expN.length, n = got.length;
  const simCache = new Map();
  const sim = (a, b) => {
    if (a === b) return 0;
    const k = a + "|" + b;
    if (simCache.has(k)) return simCache.get(k);
    const dd = lev(a, b)[a.length][b.length];
    const v = dd / Math.max(a.length, b.length) <= 0.67 ? 0.6 : 1.2; // near miss vs unrelated
    simCache.set(k, v);
    return v;
  };
  const D = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) D[i][0] = i;
  for (let j = 1; j <= n; j++) D[0][j] = j * 0.5; // extra words cost little (repeats, "um")
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) D[i][j] = Math.min(D[i - 1][j - 1] + sim(expN[i - 1], got[j - 1]), D[i - 1][j] + 1, D[i][j - 1] + 0.5);
  let end = m;
  if (prefix) { end = 0; for (let i = 1; i <= m; i++) if (D[i][n] < D[end][n] - 1e-9) end = i; }
  const out = [];
  for (let k = m; k > end; k--) out.push({ i: k - 1, word: exp[k - 1], heard: "", status: "pending" });
  let i = end, j = n;
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  while (i > 0) {
    // Ties go to "skipped" so a child who stopped early is scored as stopping, not as jumping ahead.
    if (eq(D[i][j], D[i - 1][j] + 1) && !(j > 0 && eq(D[i][j], D[i - 1][j - 1] + sim(expN[i - 1], got[j - 1])) && sim(expN[i - 1], got[j - 1]) === 0)) {
      out.push({ i: i - 1, word: exp[i - 1], heard: "", status: "skipped" }); i--;
    } else if (j > 0 && eq(D[i][j], D[i - 1][j - 1] + sim(expN[i - 1], got[j - 1]))) {
      const s = sim(expN[i - 1], got[j - 1]);
      out.push({ i: i - 1, word: exp[i - 1], heard: got[j - 1], status: s === 0 ? "correct" : s < 1 ? "error" : "skipped" });
      i--; j--;
    } else if (j > 0) j--;
    else { out.push({ i: i - 1, word: exp[i - 1], heard: "", status: "skipped" }); i--; }
  }
  return out.reverse();
}

// Turns an alignment into per-skill evidence: [{ skill, ok:boolean, word, weight }]
export function evidenceFrom(alignment) {
  const ev = [];
  for (const a of alignment) {
    const p = parseWord(a.word);
    if (!p.units.length) continue;
    if (a.status === "correct") { for (const s of p.skills) ev.push({ skill: s, ok: true, word: p.word, weight: 1 }); continue; }
    if (a.status === "skipped") {
      const hardest = [...p.skills].sort((x, y) => stageRank(y) - stageRank(x))[0];
      if (hardest) ev.push({ skill: hardest, ok: false, word: p.word, weight: 0.5 });
      continue;
    }
    if (p.sight) { ev.push({ skill: p.skills[0], ok: false, word: p.word, heard: a.heard, weight: 1 }); continue; }
    const bad = wrongLetters(p.word, norm(a.heard));
    for (const u of p.units) {
      if (!u.skill) continue;
      const covers = u.split ? [u.split[0], u.split[1]] : range(u.start, u.end);
      const wrong = covers.some((k) => bad.has(k));
      ev.push({ skill: u.skill, ok: !wrong, word: p.word, heard: a.heard, weight: wrong ? 1 : 0.5 });
    }
  }
  return ev;
}
const range = (a, b) => Array.from({ length: b - a }, (_, k) => a + k);
const stageRank = (id) => { const s = SKILL_BY_ID[id]; return s ? (s.stage === 0 ? 2.5 : s.stage) : 0; };

/* ------------------------------------------------------------------ */
/* Mastery model                                                        */
/* ------------------------------------------------------------------ */

// state: { [skillId]: { c: number, i: number, last: iso } }
export function applyEvidence(state, evidence, when = new Date().toISOString()) {
  const next = { ...state };
  const touched = new Set(evidence.map((e) => e.skill));
  // Older evidence counts for a little less, so a skill can recover.
  for (const id of touched) if (next[id]) next[id] = { ...next[id], c: next[id].c * 0.9, i: next[id].i * 0.8 };
  for (const e of evidence) {
    const cur = next[e.skill] || { c: 0, i: 0 };
    next[e.skill] = { c: +(cur.c + (e.ok ? e.weight : 0)).toFixed(3), i: +(cur.i + (e.ok ? 0 : e.weight)).toFixed(3), last: when };
  }
  return next;
}

export function skillStatus(rec) {
  if (!rec) return "new";
  const n = rec.c + rec.i;
  if (n < 0.5) return "new";
  if (rec.i < 0.25 && rec.c >= 0.5) return "secure"; // read correctly and never missed
  const p = (rec.c + 1) / (n + 2);
  if (p >= 0.8 && rec.c >= 2) return "secure";
  if (p >= 0.55) return "emerging";
  return "learning";
}

// Full picture: status per skill, with inference for unobserved skills in earlier stages.
export function masteryMap(state) {
  const map = {};
  for (const s of SKILLS) map[s.id] = skillStatus(state[s.id]);
  // If a child is secure on most observed skills in a later stage, earlier unobserved phonics skills are inferred secure.
  let topSecureStage = 0;
  for (const st of STAGES) {
    const obs = SKILLS.filter((s) => s.stage === st.id && map[s.id] !== "new");
    if (obs.length >= 2 && obs.filter((s) => map[s.id] === "secure").length / obs.length >= 0.7) topSecureStage = st.id;
  }
  // Letter sounds that didn't show up in the passages are inferred once most observed letter sounds are secure.
  const obs1 = SKILLS.filter((s) => s.stage === 1 && map[s.id] !== "new");
  const sec1 = obs1.filter((s) => map[s.id] === "secure").length;
  if (obs1.length >= 8 && sec1 / obs1.length >= 0.75) topSecureStage = Math.max(topSecureStage, 1.5);
  // Never infer inside a stage where the observed skills are mostly shaky.
  const stageOk = {};
  for (const st of STAGES) {
    const obs = SKILLS.filter((s) => s.stage === st.id && map[s.id] !== "new");
    stageOk[st.id] = !obs.length || obs.filter((s) => map[s.id] === "secure").length / obs.length >= 0.7;
  }
  for (const s of SKILLS) if (map[s.id] === "new" && s.stage >= 1 && s.stage < topSecureStage && stageOk[s.stage]) map[s.id] = "inferred";
  return map;
}

export function stageProgress(map) {
  return [...STAGES, SIGHT_STAGE].map((st) => {
    const skills = SKILLS.filter((s) => s.stage === st.id);
    const secure = skills.filter((s) => map[s.id] === "secure" || map[s.id] === "inferred").length;
    const working = skills.filter((s) => map[s.id] === "emerging" || map[s.id] === "learning").length;
    return { ...st, total: skills.length, secure, working, pct: Math.round((100 * secure) / skills.length) };
  });
}

// A stage counts as secure when at least 80% of its skills are secure and none are still being worked on.
export function secureStageNames(map) {
  return stageProgress(map).filter((p) => p.id >= 1 && p.pct >= 80 && p.working === 0).map((p) => p.name);
}

export const LEVELS = [
  { id: 0, name: "Getting ready", band: "Pre-K", note: "Learning letter sounds." },
  { id: 1, name: "Early reader", band: "Kindergarten", note: "Blends three sounds into short words like cat and sun." },
  { id: 2, name: "Building reader", band: "Late kindergarten", note: "Reading digraphs and blends: ship, frog, jump." },
  { id: 3, name: "Growing reader", band: "Early 1st grade", note: "Reading magic-e words: cake, bike, home." },
  { id: 4, name: "Confident reader", band: "Late 1st grade", note: "Reading vowel teams and bossy r: rain, boat, star." },
  { id: 5, name: "Fluent reader", band: "2nd grade", note: "Reading longer words and endings with ease." },
];

export function readingLevel(map) {
  const prog = Object.fromEntries(stageProgress(map).map((p) => [p.key, p.pct]));
  if (prog.sounds < 60) return LEVELS[0];
  if (prog.digraphs < 50 && prog.blends < 50) return LEVELS[1];
  if (prog.magic_e < 50) return LEVELS[2];
  if (prog.teams < 50 && prog.bossy_r < 50) return LEVELS[3];
  if (prog.endings < 60 || prog.teams < 80) return LEVELS[4];
  return LEVELS[5];
}

// Picks two or three stretch targets: the skills that tripped the child up in the lowest open stage first,
// then the next new skills in that stage, then one tricky word.
export function pickTargets(map, state = {}, max = 3) {
  const order = (s) => (s.stage === 0 ? 2.5 : s.stage);
  const errs = (id) => (state[id] ? state[id].i : 0);
  const open = (s) => map[s.id] !== "secure" && map[s.id] !== "inferred";
  const phon = SKILLS.filter((s) => s.stage >= 1);
  const struggling = phon.filter((s) => (map[s.id] === "learning" || map[s.id] === "emerging") && errs(s.id) > 0)
    .sort((a, b) => order(a) - order(b) || errs(b.id) - errs(a.id));
  const picks = [];
  if (struggling.length) {
    const low = struggling[0].stage;
    picks.push(...struggling.filter((s) => s.stage === low).slice(0, 2));
    if (picks.length < 2) picks.push(...struggling.filter((s) => s.stage > low).sort((a, b) => errs(b.id) - errs(a.id)).slice(0, 2 - picks.length));
  }
  if (picks.length < 2) {
    const firstOpen = phon.sort((a, b) => order(a) - order(b)).find(open);
    if (firstOpen) picks.push(...phon.filter((s) => s.stage === firstOpen.stage && map[s.id] === "new" && !picks.includes(s)).slice(0, 2 - picks.length));
  }
  const sight = SKILLS.filter((s) => s.stage === 0 && (map[s.id] === "learning" || map[s.id] === "emerging") && errs(s.id) > 0).sort((a, b) => errs(b.id) - errs(a.id));
  if (sight.length) picks.push(sight[0]);
  return uniq(picks.map((s) => s.id)).slice(0, max);
}

export function allowedSkills(map, targets) {
  const ok = new Set(targets);
  for (const [id, st] of Object.entries(map)) if (st === "secure" || st === "inferred" || st === "emerging") ok.add(id);
  return ok;
}

export function isDecodable(word, allowed) {
  const p = parseWord(word);
  if (!p.units.length) return true;
  return p.skills.length > 0 && p.skills.every((s) => allowed.has(s)) && p.units.every((u) => u.skill);
}

export function summarizeAssessment(alignments, seconds) {
  const all = alignments.flat();
  const correct = all.filter((a) => a.status === "correct").length;
  const total = all.length || 1;
  return { words: total, correct, accuracy: Math.round((100 * correct) / total), wcpm: seconds > 0 ? Math.round((correct / seconds) * 60) : null };
}

/* ------------------------------------------------------------------ */
/* Simulated reader (demo mode, no microphone)                          */
/* ------------------------------------------------------------------ */

function prng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }
export const DEMO_PROFILES = {
  emerging: { label: "Just starting (secure on some letter sounds)", weak: ["d:", "b:", "f:", "m:", "t:", "r:", "e:", "w:said", "w:they", "w:was", "c:qu", "c:x", "v:e", "v:u"] },
  typical5: { label: "Typical 5-year-old (secure on CVC, shaky on blends and magic e)", weak: ["b:st", "b:sn", "b:cr", "f:nd", "f:mp", "f:st", "m:", "t:", "r:", "w:said", "w:they", "d:th"] },
  strong6: { label: "Strong 6-year-old (working on vowel teams)", weak: ["t:ai", "t:oa", "t:igh", "r:ir", "r:ur", "e:-ed"] },
};

export function simulateReading(passageText, profileKey = "typical5", seed = 7) {
  const prof = DEMO_PROFILES[profileKey] || DEMO_PROFILES.typical5;
  const rnd = prng(seed);
  const weak = (sk) => prof.weak.some((w) => sk === w || (w.endsWith(":") && sk.startsWith(w)));
  const out = [];
  for (const tok of tokensOf(passageText)) {
    const p = parseWord(tok);
    const w = p.word;
    const weakUnit = p.units.find((u) => u.skill && weak(u.skill));
    if (!weakUnit || rnd() > 0.72) { out.push(w); continue; }
    if (rnd() < 0.12) continue; // skipped
    out.push(misread(w, weakUnit, rnd));
  }
  return out.join(" ");
}

function misread(w, u, rnd) {
  const sk = u.skill;
  const SIGHT_ERR = { said: "sad", was: "saw", they: "the", the: "a", you: "yo", are: "ear", of: "off", here: "her", come: "comb", some: "same", what: "wat" };
  if (sk.startsWith("w:")) return SIGHT_ERR[w] || w.slice(0, -1);
  if (sk.startsWith("m:")) return w.slice(0, -1); // rode -> rod, came -> cam
  if (sk.startsWith("b:")) return w.slice(0, u.start) + w.slice(u.start + 1); // stop -> top
  if (sk.startsWith("f:")) return w.slice(0, u.start + 1) + w.slice(u.end); // jump -> jum... hand -> han
  if (sk === "d:th") return w.replace("th", "t");
  if (sk === "d:sh") return w.replace("sh", "s");
  if (sk === "d:ch") return w.replace("ch", "c");
  if (sk.startsWith("d:")) return w.slice(0, u.start) + u.g[0] + w.slice(u.end);
  if (sk.startsWith("t:")) return w.slice(0, u.start) + u.g[0] + w.slice(u.end); // rain -> ran, boat -> bot
  if (sk.startsWith("r:")) return w.slice(0, u.start) + u.g[0] + "t" + w.slice(u.end);
  if (sk.startsWith("e:")) return w.slice(0, u.start);
  if (sk.startsWith("v:")) { const vs = "aeiou".replace(u.g, ""); return w.slice(0, u.start) + vs[Math.floor(rnd() * 4)] + w.slice(u.end); }
  if (sk.startsWith("c:")) { const cs = "bdpt".replace(u.g, ""); return w.slice(0, u.start) + cs[Math.floor(rnd() * cs.length)] + w.slice(u.end); }
  return w;
}

/* ------------------------------------------------------------------ */
/* Worlds and decodable story generation                                */
/* ------------------------------------------------------------------ */

export const WORLDS = {
  dinos: { name: "Dino Valley", hero: "Rex", heroKind: "a little green dinosaur", color: "#6BA368", sky: "#F7E3B5" },
  space: { name: "Moon Base", hero: "Kip", heroKind: "a small robot", color: "#6C7BD9", sky: "#1F2A55" },
  ocean: { name: "Shell Bay", hero: "Fin", heroKind: "a bright orange fish", color: "#2E9CCA", sky: "#BFE6F2" },
  forest: { name: "Fox Wood", hero: "Pip", heroKind: "a quick red fox", color: "#D9733B", sky: "#DDEFD5" },
  trucks: { name: "Big Dig Town", hero: "Tug", heroKind: "a strong yellow truck", color: "#E2B23A", sky: "#DCEBF7" },
};

// Each page of an arc has sentence options from easiest to hardest. {H} is the hero and {C} is the child.
const ARCS = {
  dinos: {
    title: ["{H} and the Egg", "{H} and the Big Egg", "{H} Saves the Nest"],
    pages: [
      ["{H} is a dino. {H} has a red hat.", "{H} is a dino with a red hat and a long tail.", "{H} is a dino. He likes to stomp and play by the lake."],
      ["{H} can run. {H} can hop.", "{H} can run fast and jump on the big rock.", "{H} rode up the hill to see the sun shine."],
      ["{H} got an egg. The egg is big.", "{H} spots an egg in the nest.", "In the nest sat a big green egg. It was still."],
      ["The egg can tip. Tip, tip, tip!", "The egg rocks and cracks. Crack, crack!", "The egg began to shake. Then came a crack!"],
      ["A pup? No! It is a dino!", "Out pops a little dino. It is pink!", "Out came a baby dino. She gave a sleepy yawn."],
      ["{H} and the dino had fun.", "{H} and the pink dino swim in the pond.", "{H} and the baby dino play all day by the lake."],
      ["{C} met {H}. The end.", "{C} and {H} sat in the sun. The end.", "At night, they sleep by the tree. The end."],
    ],
  },
  space: {
    title: ["{H} on the Moon", "{H} and the Lost Rock", "{H} Finds a Star"],
    pages: [
      ["{H} is a bot. {H} can zip.", "{H} is a bot with a black hat.", "{H} is a robot who lives on a base on the moon."],
      ["{H} got in a pod. Up, up, up!", "{H} jumps in his ship. Blast off!", "{H} flew his ship up high in the dark night."],
      ["{H} sat on the moon. It is hot.", "{H} lands on the moon with a thud.", "The moon was gray and still. {H} made his way to a crater."],
      ["{H} can dig in the sand.", "{H} digs and digs. What is in the pit?", "Deep in the dust, {H} saw a light."],
      ["It is a gem! It is red.", "It is a rock that glints! It is pink.", "It was a star that fell. It was so bright!"],
      ["{H} had fun on the moon.", "{H} brings the rock back to the ship.", "{H} gave the star a home in his ship."],
      ["{C} and {H} can nap. The end.", "{C} and {H} went back home. The end.", "Then they flew home to sleep. The end."],
    ],
  },
  ocean: {
    title: ["{H} the Fish", "{H} and the Crab", "{H} and the Deep Sea"],
    pages: [
      ["{H} is a fish. {H} can swim.", "{H} is a fish with a big red fin.", "{H} is a fish who lives by the reef in the sea."],
      ["{H} has a pal. It is a bug.", "{H} has a pal. His pal is a crab.", "His best pal is a crab named Dee."],
      ["The crab sat in a pit. Sob, sob!", "The crab is stuck in a net! Help!", "One day, Dee got stuck in a net. She was sad."],
      ["{H} can tug the net.", "{H} grabs the net and tugs and tugs.", "{H} swam up fast to help his friend."],
      ["The net is cut! The crab is up!", "Snap! The net splits. The crab is free.", "He bit the rope, and the net came free!"],
      ["{H} and the crab had fun.", "{H} and the crab swim and splash.", "Dee gave {H} a big hug. They played in the waves."],
      ["{C} and {H} sat in the sun. The end.", "{C} and {H} rest on a rock. The end.", "At night, they sleep by the reef. The end."],
    ],
  },
  forest: {
    title: ["{H} the Fox", "{H} and the Lost Hat", "{H} in the Wood"],
    pages: [
      ["{H} is a fox. {H} is red.", "{H} is a red fox with a soft tail.", "{H} is a fox who lives in a den by a pine tree."],
      ["{H} has a hat. It is his hat.", "{H} has a hat with a big black band.", "{H} likes his hat. It is the best hat."],
      ["The wind is up! The hat is not on {H}!", "A gust of wind! The hat flips off!", "One day, the wind came and took the hat away!"],
      ["{H} ran and ran. Is it in a log?", "{H} runs past the pond and the stumps.", "{H} ran by the lake and up the hill to look."],
      ["A hen had the hat! It sat in it.", "A frog sits in the hat. It is his bed!", "He saw a snail inside his hat. It made it a home."],
      ["{H} got a hat for the hen.", "{H} lets the frog keep the hat.", "{H} gave the snail his hat. That was kind."],
      ["{C} and {H} had fun. The end.", "{C} and {H} went back to the den. The end.", "Then he went home to sleep. The end."],
    ],
  },
  trucks: {
    title: ["{H} the Truck", "{H} and the Big Dig", "{H} Makes a Road"],
    pages: [
      ["{H} is a truck. {H} is big.", "{H} is a truck with six big wheels.", "{H} is a truck who likes to dig and haul all day."],
      ["{H} can dig. Dig, dig, dig!", "{H} digs in the sand and dumps it.", "Today, {H} will make a road to the lake."],
      ["The mud is wet. {H} is stuck!", "Uh oh! {H} is stuck in the mud!", "The rain came down, and {H} got stuck in the mud."],
      ["A van can tug. Tug, tug!", "A big crane lifts and pulls.", "His friend the crane came to help."],
      ["{H} is up! {H} is not stuck!", "Pop! {H} is out of the mud!", "With one big pull, {H} was free!"],
      ["{H} and the van dig and dig.", "{H} and the crane finish the job.", "Then they made the road and the path to the lake."],
      ["{C} and {H} had fun. The end.", "{C} and {H} rest at the camp. The end.", "At night, the trucks sleep. The end."],
    ],
  },
};

const BEDTIME = {
  sounds: (n) => `Play "I spy" with sounds, not letters: "I spy something that starts with /m/." Let ${n} guess, then swap.`,
  digraphs: (n, k) => `"${k.label}" is two letters that make one sound. Say "${k.example}" slowly together, then hunt the house for three more things with that sound. ${n} gets to be the detective.`,
  blends: (n, k) => `Stretch "${k.example}" like a rubber band, one sound at a time, then snap it together fast. Let ${n} be the one who snaps it.`,
  magic_e: (n, k) => `Write "cap" on paper, then add an e and read "cape." Let ${n} turn kit into kite and hop into hope. The e is magic because it makes the vowel say its name.`,
  teams: (n) => `Say "When two vowels go walking, the first one does the talking." Read rain, boat and tree together.`,
  bossy_r: (n) => `Growl like a pirate: "Arrr!" Then read car, star and farm in your best pirate voice.`,
  endings: (n) => `Jump once for "jump." Then jump again and say "jumping!" Try hop and hopping, and play and played.`,
  sight: (n) => `Put three tricky words on sticky notes by the bed. ${n} reads one before lights out, then gets to "switch off" the word.`,
};

// Makes a decodable story. Returns { title, world, pages:[{text, words:[{t, decodable, target}]}], targets, decodability }
export function generateStory({ world = "dinos", childName = "Mia", map = {}, targets = [], day = 0 }) {
  const W = WORLDS[world] || WORLDS.dinos;
  const arc = ARCS[world] || ARCS.dinos;
  const allowed = allowedSkills(map, targets);
  const targetSet = new Set(targets);
  const fill = (s) => s.replace(/\{H\}/g, W.hero).replace(/\{C\}/g, childName);
  const story = new Set([norm(W.hero), norm(childName)]);
  const scoreSentence = (s) => {
    const toks = tokensOf(fill(s)).map(norm).filter((w) => w && !story.has(w));
    const dec = toks.filter((w) => isDecodable(w, allowed)).length;
    const hitsTarget = toks.some((w) => parseWord(w).skills.some((k) => targetSet.has(k)));
    return { frac: toks.length ? dec / toks.length : 1, hitsTarget };
  };
  // Pick the hardest option on each page where at least 80% of words are decodable. Prefer options that hit a target.
  const pages = arc.pages.map((opts, pi) => {
    let best = 0;
    for (let k = opts.length - 1; k >= 0; k--) {
      const sc = scoreSentence(opts[k]);
      if (sc.frac >= 0.88 && (sc.hitsTarget || k === 0 || scoreSentence(opts[k - 1]).frac < 0.88)) { best = k; break; }
      if (sc.frac >= 0.95) { best = k; break; }
    }
    return fill(opts[best]);
  });
  const titleIdx = Math.max(0, Math.min(2, Math.round(pages.reduce((a, p, i) => a + arc.pages[i].map(fill).indexOf(p), 0) / pages.length)));
  // A word-hunt page makes sure each target shows up several times.
  const hunt = [];
  for (const t of targets) {
    const sk = SKILL_BY_ID[t];
    if (!sk) continue;
    const words = WORD_BANK.filter((w) => parseWord(w).skills.includes(t) && isDecodable(w, allowed));
    const r = prng(day * 31 + t.length * 7 + 3);
    const picked = [];
    while (words.length && picked.length < 3) picked.push(words.splice(Math.floor(r() * words.length), 1)[0]);
    if (sk.stage === 0 && !picked.length) picked.push(sk.label);
    hunt.push(...picked);
  }
  const allPages = pages.map((text) => annotate(text, allowed, targetSet, story));
  if (hunt.length) allPages.push({ ...annotate(uniq(hunt).join(" "), allowed, targetSet, story), hunt: true });
  const words = allPages.flatMap((p) => p.words).filter((w) => !w.story);
  const decodability = words.length ? Math.round((100 * words.filter((w) => w.decodable).length) / words.length) : 100;
  return { title: fill(arc.title[titleIdx]), world, hero: W.hero, pages: allPages, targets, decodability };
}

export function annotate(text, allowed, targetSet = new Set(), storyWords = new Set()) {
  return {
    text,
    words: tokensOf(text).map((t) => {
      const n = norm(t);
      const p = parseWord(n);
      return { t, n, story: storyWords.has(n), decodable: storyWords.has(n) || isDecodable(n, allowed), target: p.skills.some((k) => targetSet.has(k)) };
    }),
  };
}

// Checks a story written somewhere else, such as by an LLM. It reports the words that aren't decodable.
export function checkDecodable(text, map, targets, storyWords = []) {
  const allowed = allowedSkills(map, targets);
  const sw = new Set(storyWords.map(norm));
  const bad = uniq(tokensOf(text).map(norm).filter((w) => w && !sw.has(w) && !isDecodable(w, allowed)));
  const total = tokensOf(text).length || 1;
  return { ok: bad.length / total <= 0.1, pct: Math.round(100 * (1 - bad.length / total)), bad };
}

/* ------------------------------------------------------------------ */
/* Parent report                                                        */
/* ------------------------------------------------------------------ */

const skillList = (ids) => ids.map((id) => SKILL_BY_ID[id]?.label).filter(Boolean);
const joinNice = (a) => (a.length <= 1 ? a.join("") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1]);

export function parentReport({ name = "your child", state = {}, sessions = [], pronoun = "they" }) {
  const map = masteryMap(state);
  const level = readingLevel(map);
  const prog = stageProgress(map);
  const targets = pickTargets(map, state);
  const secureStages = secureStageNames(map).map((n) => n.toLowerCase());
  const tStage = targets.length ? SKILL_BY_ID[targets[0]].stage : null;
  const tStageObj = [...STAGES, SIGHT_STAGE].find((s) => s.id === tStage);
  const weekAgo = Date.now() - 7 * 864e5;
  const week = sessions.filter((s) => new Date(s.at).getTime() >= weekAgo);
  const minutes = Math.round(week.reduce((a, s) => a + (s.minutes || 0), 0));
  const wordsRead = week.reduce((a, s) => a + (s.correct || 0), 0);
  const strugglers = Object.entries(state)
    .filter(([id]) => map[id] === "learning")
    .sort((a, b) => b[1].i - a[1].i)
    .slice(0, 3)
    .map(([id]) => id);
  const P = pronoun === "she" ? ["she", "her", "She"] : pronoun === "he" ? ["he", "his", "He"] : ["they", "their", "They"];
  const secureLine = secureStages.length
    ? `${name} is secure on ${joinNice(secureStages)}.`
    : `${name} is building ${P[1]} first letter sounds.`;
  const describe = (id) => { const k = SKILL_BY_ID[id]; return k.stage === 0 ? `the tricky word "${k.label}"` : `${k.label} (as in ${k.example})`; };
  const workLine = targets.length
    ? `This week we're working on ${joinNice(targets.map(describe))}.`
    : `${name} has cleared every skill in this early-reading map. Next up are longer words and fluency.`;
  const strugLine = strugglers.length ? `The sounds that tripped ${P[1] === "their" ? "them" : P[1] === "her" ? "her" : "him"} up most were ${joinNice(skillList(strugglers))}. That's normal at this stage, and tomorrow's story practices them.` : "";
  return {
    level, targets, map, prog,
    headline: `${secureLine} ${workLine}`,
    detail: strugLine,
    bedtime: tStageObj ? BEDTIME[tStageObj.key](name, SKILL_BY_ID[targets[0]]) : BEDTIME.sight(name),
    week: { sessions: week.length, minutes, wordsRead },
  };
}

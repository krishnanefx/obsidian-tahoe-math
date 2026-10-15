/*
 * Tahoe Math — answers as you type, for Obsidian.
 *
 *   x = 12              defines a variable
 *   x * 3.5 =           shows 42 right after the "="
 *   5 km + 300 m =      5.3 km          (units)
 *   3 ft to cm =        91.44 cm        (conversions)
 *   20% of 80 =         16              (percentages)
 *   $12 * 3 =           $36.00          (currency)
 *   f(t) = t^2 + 1      then f(4) = → 17
 *   daysUntil("Oct 14") = → 9 days      (dates)
 *   days until Oct 14 =  → 9 days        (plain English, with Tahoe Intelligence)
 *
 * Results appear as you type; click one (or press Tab at the end of the
 * line) to write it into the note. Works on Mac, iPhone and iPad.
 */

import { Plugin, PluginSettingTab, Setting, editorInfoField } from "obsidian";
import { ViewPlugin, Decoration, WidgetType, keymap } from "@codemirror/view";
import { EditorState, Prec, RangeSetBuilder } from "@codemirror/state";

// mathjs (about 1 MB) loads the first time it's needed, in idle time after
// Obsidian opens, so starting Obsidian never waits for it. Until it has, there
// are simply no answers yet. `math` stands in for it.
let mathjs = null;
let evaluateFn = null;
let loading = null;
export function loadEngine() {
  if (!loading)
    loading = import("mathjs").then(({ create, all }) => {
      const m = create(all);
      mathjs = m;
      setUp(m);
      return m;
    });
  return loading;
}
function engine() {
  if (!mathjs) throw new Error("Tahoe Math: the maths engine hasn't loaded yet");
  return mathjs;
}
const math = new Proxy({}, { get: (_, key) => engine()[key] });

/* ---- Dates: "Oct 14", "Friday", "next Monday", "2026-12-25", "12/25" ---- */
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function startOfToday() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// US holidays by name. Some move: Thanksgiving is the 4th Thursday of November.
function nthWeekday(y, month, weekday, n) {
  if (n < 0) {
    const last = new Date(y, month + 1, 0);
    return new Date(y, month, last.getDate() - ((last.getDay() - weekday + 7) % 7));
  }
  return new Date(y, month, 1 + ((weekday - new Date(y, month, 1).getDay() + 7) % 7) + 7 * (n - 1));
}
function easter(y) {
  // Anonymous Gregorian algorithm.
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const h = (19 * a + b - Math.floor(b / 4) - Math.floor((b - Math.floor((b + 8) / 25) + 1) / 3) + 15) % 30;
  const l = (32 + 2 * (b % 4) + 2 * Math.floor(c / 4) - h - (c % 4)) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1);
}
const fixed = (month, day) => (y) => new Date(y, month, day);
const HOLIDAYS = {
  christmas: fixed(11, 25), "christmas day": fixed(11, 25), "christmas eve": fixed(11, 24),
  "new years": fixed(0, 1), "new years day": fixed(0, 1), "new year": fixed(0, 1), "new years eve": fixed(11, 31),
  halloween: fixed(9, 31), "valentines day": fixed(1, 14), "valentines": fixed(1, 14), "st patricks day": fixed(2, 17),
  "independence day": fixed(6, 4), "fourth of july": fixed(6, 4), "4th of july": fixed(6, 4), "july 4th": fixed(6, 4),
  juneteenth: fixed(5, 19), "veterans day": fixed(10, 11),
  thanksgiving: (y) => nthWeekday(y, 10, 4, 4), "labor day": (y) => nthWeekday(y, 8, 1, 1), "memorial day": (y) => nthWeekday(y, 4, 1, -1),
  "mothers day": (y) => nthWeekday(y, 4, 0, 2), "fathers day": (y) => nthWeekday(y, 5, 0, 3),
  "mlk day": (y) => nthWeekday(y, 0, 1, 3), "martin luther king day": (y) => nthWeekday(y, 0, 1, 3), "presidents day": (y) => nthWeekday(y, 1, 1, 3),
  easter, "easter sunday": easter,
};

// past: a date without a year is the most recent one ("since Sep 1"); otherwise the next one.
function parseDate(input, past = false) {
  const p = String(input == null ? "" : input).toLowerCase().replace(/[’'.]/g, "").replace(/^(?:the|my|our|this|next)\s+/, "").replace(/\s+/g, " ").trim();
  const base = startOfToday();
  const add = (n) => new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
  let m;
  if (!p || p === "today" || p === "now") return base;
  if ((m = /^(.+?)(?: (\d{4}))?$/.exec(p)) && HOLIDAYS[m[1]]) {
    const on = HOLIDAYS[m[1]];
    if (m[2]) return on(+m[2]);
    let d = on(base.getFullYear());
    if (!past && d < base) d = on(base.getFullYear() + 1);
    if (past && d > base) d = on(base.getFullYear() - 1);
    return d;
  }
  if (p === "tomorrow") return add(1);
  if (p === "yesterday") return add(-1);
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(p))) return new Date(+m[1], +m[2] - 1, +m[3]);
  if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(p))) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : base.getFullYear();
    let d = new Date(y, +m[1] - 1, +m[2]);
    if (!m[3] && !past && d < add(-30)) d = new Date(y + 1, +m[1] - 1, +m[2]);
    if (!m[3] && past && d > base) d = new Date(y - 1, +m[1] - 1, +m[2]);
    return d;
  }
  for (let i = 0; i < 12; i++) {
    const re = new RegExp(`\\b(?:${MONTHS[i]}|${MONTHS[i].slice(0, 3)}\\.?)\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS[i]}|${MONTHS[i].slice(0, 3)})(?:,?\\s+(\\d{4}))?\\b`);
    if ((m = re.exec(p))) {
      const day = +(m[1] || m[3]);
      const year = m[2] || m[4];
      let d = new Date(year ? +year : base.getFullYear(), i, day);
      if (!year && !past && d < add(-30)) d = new Date(base.getFullYear() + 1, i, day);
      if (!year && past && d > base) d = new Date(base.getFullYear() - 1, i, day);
      return d;
    }
  }
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b${WEEKDAYS[i]}\\b|\\b${WEEKDAYS[i].slice(0, 3)}\\b`).test(p)) {
      if (past) {
        const back = (base.getDay() - i + 7) % 7 || (/\blast\b/.test(p) ? 7 : 0);
        return add(-back);
      }
      let ahead = (i - base.getDay() + 7) % 7;
      if (ahead === 0 && /\bnext\b/.test(p)) ahead = 7;
      return add(ahead);
    }
  }
  if (/\bnext week\b/.test(p)) return add(((8 - base.getDay()) % 7) || 7);
  throw new Error(`Not a date: ${input}`);
}

const dayDiff = (a, b) => Math.round((b - a) / 86400000);
const showDate = (d) => d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });

function setUp(math) {
  // Everyday names mathjs doesn't know.
  math.createUnit({ pound: { definition: "1 lbm", aliases: ["pounds"] }, mph: "1 mi/hr", kph: { definition: "1 km/hr", aliases: ["kmh"] } });

  // mathjs functions, available in notes (and to plain-English rewrites).
  math.import(
    {
      daysUntil: (d) => math.unit(dayDiff(startOfToday(), parseDate(d)), "day"),
      daysSince: (d) => math.unit(dayDiff(parseDate(d, true), startOfToday()), "day"),
      daysBetween: (a, b) => math.unit(Math.abs(dayDiff(parseDate(a), parseDate(b))), "day"),
      weeksUntil: (d) => math.unit(Math.round((dayDiff(startOfToday(), parseDate(d)) / 7) * 10) / 10, "week"),
      weekday: (d) => parseDate(d).toLocaleDateString("en-US", { weekday: "long" }),
      dateOf: (d) => showDate(parseDate(d)),
      dateIn: (n) => {
        const days = typeof n === "object" && n && n.isUnit ? n.toNumber("day") : Number(n);
        const d = startOfToday();
        d.setDate(d.getDate() + Math.round(days));
        return showDate(d);
      },
    },
    { override: true }
  );

  // Note text is user input: keep the evaluator to pure maths (mathjs's
  // recommended hardening — expressions can't reach these functions).
  evaluateFn = math.evaluate;
  const disabled = (name) => () => {
    throw new Error(`${name} is disabled`);
  };
  math.import(
    {
      import: disabled("import"),
      createUnit: disabled("createUnit"),
      evaluate: disabled("evaluate"),
      parse: disabled("parse"),
      simplify: disabled("simplify"),
      derivative: disabled("derivative"),
      compile: disabled("compile"),
      resolve: disabled("resolve"),
    },
    { override: true }
  );
}
const limitedEvaluate = (expr, scope) => (engine(), evaluateFn(expr, scope));

const DEFAULT_SETTINGS = {
  enabled: true,
  onlyTagged: false, // only notes with `math: true` in their properties
  precision: 10,
  plainEnglish: true, // "days until Oct 14 =" with Tahoe Intelligence
  words: {}, // question → expression, from Tahoe Intelligence (synced, so iPhone shows answers too)
};

// Common questions in words, rewritten exactly — no model needed, works on iPhone.
const FRACTIONS = { half: "/ 2", "a half": "/ 2", "a third": "/ 3", "one third": "/ 3", "a quarter": "/ 4", "one quarter": "/ 4", "a fifth": "/ 5", double: "* 2", twice: "* 2", triple: "* 3" };

const isUnit = (name) => {
  try {
    return math.unit(1, name.replace(/s$/, "")) && true;
  } catch {
    try {
      return math.unit(1, name) && true;
    } catch {
      return false;
    }
  }
};

function ruleRewrite(question) {
  const q = question.toLowerCase().replace(/[?!.]+$/, "").replace(/\s+/g, " ").trim();
  const date = (d) => JSON.stringify(d.trim().replace(/^(the|my|our)\s+/, ""));
  let m;
  if ((m = /^(?:when|what date) is (?!in \d)(.+?)(?: this year)?$/.exec(q))) return `dateOf(${date(m[1])})`;
  if ((m = /^(?:how many |number of )?days? (?:are )?(?:left )?(?:until|till|til|to|before) (.+)$/.exec(q))) return `daysUntil(${date(m[1])})`;
  if ((m = /^(?:how many |number of )?days? (?:has it been )?since (.+)$/.exec(q))) return `daysSince(${date(m[1])})`;
  if ((m = /^(?:how many |number of )?weeks? (?:are )?(?:left )?(?:until|till|to|before) (.+)$/.exec(q))) return `weeksUntil(${date(m[1])})`;
  if ((m = /^(?:how many )?days? between (.+?) and (.+)$/.exec(q))) return `daysBetween(${date(m[1])}, ${date(m[2])})`;
  if ((m = /^what (?:day|weekday)(?: of the week)? (?:is|was|will be|does) (.+?)(?: (?:fall|land) on)?$/.exec(q))) return `weekday(${date(m[1])})`;
  if ((m = /^(?:what(?:'s| is) the date |what date is |date )in (\d+) (days?|weeks?)$/.exec(q))) return `dateIn(${m[1]} ${m[2]})`;
  if ((m = /^(?:how many |number of )?([a-z]+) (?:are )?(?:in|per) (?:an? |one )?([a-z]+)$/.exec(q)) && isUnit(m[1]) && isUnit(m[2])) return `1 ${m[2]} to ${m[1]}`;
  if ((m = /^(?:how (?:far|much|long|heavy|big|tall|hot|cold) is |what is |what's |convert )?(-?[\d.,]+ ?[a-z°]+[a-z0-9^]*) (?:in|to|into|as) ([a-z°][a-z0-9^ ]*)$/.exec(q))) return `${m[1].replace(/,/g, "")} to ${m[2].trim()}`;
  if ((m = /^(half|a half|a third|one third|a quarter|one quarter|a fifth|double|twice|triple) (?:of )?(?:the |my |our )?(.+)$/.exec(q))) return `(${m[2]}) ${FRACTIONS[m[1]]}`;
  return null;
}

// Lines in words ("days until oct 14") rather than maths.
const looksLikeWords = (expr) => /[a-z]{2,}\s+[a-z]{2,}/i.test(expr) && expr.length <= 200;
const wordsKey = (expr) => expr.toLowerCase().replace(/\s+/g, " ").trim();

// A model's rewrite may only use what the question says: its numbers (plus
// everyday factors like 60 or 100, and multipliers like 1.2 for "20% more"),
// its dates, and the note's variables it names. Catches "$86 / 3" for "split
// rent between 3 people", where $86 came from somewhere else.
const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50, hundred: 100, thousand: 1000, dozen: 12, half: 2, third: 3, quarter: 4, double: 2, twice: 2, triple: 3, pair: 2, couple: 2 };
const EVERYDAY = new Set([1, 2, 7, 10, 12, 24, 52, 60, 100, 365, 1000, 3600]);
function grounded(question, expr, variables = []) {
  const q = question.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  const said = new Set((q.match(/\d+(?:\.\d+)?/g) || []).map(Number));
  for (const w of q.match(/[a-z]+/g) || []) if (NUMBER_WORDS[w]) said.add(NUMBER_WORDS[w]);
  const e = expr.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  for (const s of e.match(/\d+(?:\.\d+)?/g) || []) {
    const n = Number(s);
    if (!said.has(n) && !EVERYDAY.has(n) && !(n > 0 && n < 2)) return false;
  }
  // Dates in quotes come from the question ("Oct" for "October" is fine).
  for (const [, inner] of e.matchAll(/"([^"]*)"/g)) for (const t of inner.match(/[a-z]+|\d+/g) || []) if (!q.includes(t)) return false;
  for (const v of variables) if (v.length >= 3 && new RegExp(`\\b${v.toLowerCase()}\\b`).test(q) && !new RegExp(`\\b${v}\\b`).test(expr)) return false;
  return true;
}

/* ------------------------------------------------------------------------ */
/* Parsing a note into maths                                                 */
/* ------------------------------------------------------------------------ */

const LINE_PREFIX = /^(\s*(?:>\s*)*(?:[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?)/;
const DEFINITION = /^([A-Za-z_À-ɏ][\wÀ-ɏ]*(?:\([^()]*\))?)\s*=\s*([^=].*?)\s*$/;
const CURRENCY = /[$€£¥]/;

function preprocess(expr) {
  let e = expr
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/(\d),(?=\d{3}\b)/g, "$1"); // 1,234 → 1234
  // "20% of 80" → 0.2 * (80)
  e = e.replace(/(\d+(?:\.\d+)?)\s*%\s*of\s+/gi, "($1/100) * ");
  // "80 + 15%" → 80 * (1 + 0.15)   (Apple Notes and calculators work this way)
  e = e.replace(/^(.+?)\s*([+-])\s*(\d+(?:\.\d+)?)\s*%\s*$/, (_, base, op, pct) => `(${base}) * (1 ${op} ${pct}/100)`);
  // any other "15%" → 0.15
  e = e.replace(/(\d+(?:\.\d+)?)\s*%/g, "($1/100)");
  // currency symbols are carried through formatting, not maths
  e = e.replace(/[$€£¥]\s*/g, "");
  return e;
}

// "9 day" → "9 days"
function pluralUnits(text) {
  return text.replace(/^(-?[\d.,]+(?:e[+-]?\d+)?) (second|minute|hour|day|week|month|year)$/, (m, n, u) => (Number(n.replace(/,/g, "")) === 1 ? m : `${n} ${u}s`));
}

function formatValue(value, { currency, precision }) {
  if (value == null) return null;
  if (typeof value === "function") return null;
  if (typeof value === "string") return value.length <= 80 ? value : null;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!isFinite(value)) return null;
    if (currency) return `${currency}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const abs = Math.abs(value);
    if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) return math.format(value, { notation: "exponential", precision: 6 });
    return value.toLocaleString(undefined, { maximumSignificantDigits: Math.min(precision + 2, 21), maximumFractionDigits: precision });
  }
  if (value && typeof value === "object") {
    if (value.isUnit) {
      // "6.048e+5 seconds" → "604,800 seconds" (exponents only for huge or tiny values)
      const text = math.format(value, { precision: Math.min(precision, 5) }).replace(/^(-?\d+(?:\.\d+)?e[+-]?\d+)(?= )/, (n) => {
        const x = Number(n);
        return Math.abs(x) < 1e15 && Math.abs(x) >= 1e-6 ? x.toLocaleString(undefined, { maximumSignificantDigits: Math.min(precision, 8) }) : n;
      });
      return pluralUnits(text);
    }
    if (value.isComplex || value.isFraction || value.isBigNumber) return math.format(value, { precision });
    if (value.isMatrix || Array.isArray(value)) return math.format(value, { precision });
    if (value.isResultSet) return formatValue(value.entries[value.entries.length - 1], { currency, precision });
  }
  return null;
}

function tryEvaluate(expr, scope) {
  try {
    return { ok: true, value: limitedEvaluate(preprocess(expr), scope) };
  } catch {
    return { ok: false };
  }
}

// "Total cost: 3 * $12" — find the longest tail that is maths.
function evaluateTail(expr, scope) {
  const whole = tryEvaluate(expr, scope);
  if (whole.ok) return { ...whole, expr };
  const cuts = [];
  for (let i = 1; i < expr.length; i++) {
    const prev = expr[i - 1];
    if (prev === ":" || prev === " " || prev === "\t") cuts.push(i);
  }
  for (const i of cuts.slice(0, 24)) {
    const tail = expr.slice(i).trim();
    if (!tail) continue;
    // A word only starts the maths if it's a variable or a function ("… leaves at 14" isn't).
    const word = /^[A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F]*/.exec(tail);
    const isVariable = word && word[0] in scope;
    if (word && !isVariable && !/^[A-Za-z_]\w*\s*\(/.test(tail)) continue;
    if (!isVariable && !/[\d(]/.test(tail)) continue;
    // "… my midterm on Oct 14" — a lone number after words isn't a calculation.
    if (/^-?[\d.,]+$/.test(tail)) continue;
    const r = tryEvaluate(tail, scope);
    if (r.ok) return { ...r, expr: tail };
  }
  return { ok: false };
}

/**
 * Walks the note top to bottom. Returns results keyed by line number:
 *   { line, from, to, text } — `to` is the position just after the "=".
 * Code blocks, front matter, maths blocks and setext underlines are skipped.
 */
const IDENT = /[A-Za-z_\u00C0-\u024F][\w\u00C0-\u024F]*/g;

function analyse(lines, settings) {
  const scope = {};
  const currencyOf = {}; // variable → currency symbol it was defined with
  const currencyIn = (text) => {
    const direct = (CURRENCY.exec(text) || [null])[0];
    if (direct) return direct;
    for (const name of text.match(IDENT) || []) if (currencyOf[name]) return currencyOf[name];
    return null;
  };
  const results = [];
  results.unresolved = []; // lines in words that might be worked out by Tahoe Intelligence
  let inFence = null;
  let inMath = false;
  let inFrontmatter = lines[0] && lines[0].trim() === "---";
  let offset = 0;

  for (let n = 0; n < lines.length; n++) {
    const raw = lines[n];
    const lineStart = offset;
    offset += raw.length + 1;

    if (inFrontmatter) {
      if (n > 0 && /^(---|\.\.\.)\s*$/.test(raw)) inFrontmatter = false;
      continue;
    }
    const fence = /^\s*(?:>\s*)*(`{3,}|~{3,})/.exec(raw);
    if (fence) {
      if (!inFence) inFence = fence[1];
      else if (fence[1][0] === inFence[0] && fence[1].length >= inFence.length) inFence = null;
      continue;
    }
    if (inFence) continue;
    const trimmed = raw.trim();
    if (trimmed.startsWith("$$")) {
      const oneLine = trimmed.length >= 4 && trimmed.endsWith("$$") && trimmed !== "$$";
      if (!oneLine) inMath = !inMath;
      continue;
    }
    if (inMath || !raw.includes("=") || /^\s*=+\s*$/.test(raw) || /^\s*\|/.test(raw)) continue;

    const prefix = (LINE_PREFIX.exec(raw) || ["", ""])[1];
    let body = raw.slice(prefix.length).replace(/^#{1,6}\s+/, "");
    const currency = currencyIn(body);

    const endsWithEquals = /=\s*$/.test(body) && !/[=!<>]=\s*$/.test(body);
    if (endsWithEquals) {
      const eqIndex = raw.lastIndexOf("=");
      let expr = body.replace(/=\s*$/, "").trim();
      // "total = x * 3 =" defines total and shows the value
      const def = DEFINITION.exec(expr);
      let r = { ok: false };
      let interpreted = null;
      if (def) {
        r = tryEvaluate(expr, scope);
        if (!r.ok) r = evaluateTail(def[2], scope);
      } else if (settings.plainEnglish !== false && looksLikeWords(expr)) {
        // Maths that only looks like words ("3 ft to cm") is just maths.
        r = tryEvaluate(expr, scope);
        if (!r.ok) {
          // A question in words: the exact rules first, then the rewrite Tahoe Intelligence made.
          const saved = settings.words && settings.words[wordsKey(expr)];
          for (const rewritten of [ruleRewrite(expr), saved]) {
            if (!rewritten) continue;
            r = tryEvaluate(rewritten, scope);
            if (r.ok) {
              interpreted = rewritten;
              break;
            }
          }
          if (!r.ok) r = evaluateTail(expr, scope);
          if (!r.ok && !saved) results.unresolved.push({ line: n, expr, variables: Object.keys(scope).filter((k) => typeof scope[k] !== "function"), scope: Object.assign({}, scope) });
        }
      } else r = evaluateTail(expr, scope);
      if (r.ok) {
        const text = formatValue(r.value, { currency: currency || currencyIn(interpreted || ""), precision: settings.precision });
        if (text != null) results.push({ line: n, from: lineStart, to: lineStart + eqIndex + 1, lineEnd: lineStart + raw.length, text, interpreted });
      }
      continue;
    }

    // Definitions: "x = 12", "rate = 3.5 km/h", "f(t) = t^2 + 1"
    const def = DEFINITION.exec(body.trim());
    if (def && tryEvaluate(body.trim(), scope).ok) {
      const name = def[1].replace(/\(.*$/, "");
      const sym = currencyIn(def[2]);
      if (sym) currencyOf[name] = sym;
      else delete currencyOf[name];
    }
  }
  return results;
}

/* ------------------------------------------------------------------------ */
/* Editor                                                                    */
/* ------------------------------------------------------------------------ */

class ResultWidget extends WidgetType {
  constructor(text, at, spaced, interpreted) {
    super();
    this.text = text;
    this.at = at;
    this.spaced = spaced; // the line already ends in a space
    this.interpreted = interpreted; // the expression a question in words became
  }

  eq(other) {
    return other.text === this.text && other.at === this.at && other.spaced === this.spaced && other.interpreted === this.interpreted;
  }

  toDOM(view) {
    const el = createSpan({ cls: `tahoe-math-result${this.interpreted ? " is-interpreted" : ""}` });
    if (!this.spaced) el.append(" ");
    if (this.interpreted) el.append(createSpan({ cls: "tahoe-math-spark", text: "✦" }), " ");
    el.append(this.text);
    el.setAttribute("aria-label", this.interpreted ? `Worked out as ${this.interpreted} — click or press Tab to insert` : "Click or press Tab to insert");
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ changes: { from: this.at, insert: this.spaced ? this.text : ` ${this.text}` } });
    });
    return el;
  }

  ignoreEvent() {
    return false;
  }
}

function mathPlugin(plugin) {
  return ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.results = [];
        this.decorations = this.build(view);
      }

      update(update) {
        if (update.docChanged || this.wordsVersion !== plugin.wordsVersion || update.transactions.some((tr) => tr.reconfigured)) this.decorations = this.build(update.view);
      }

      build(view) {
        this.wordsVersion = plugin.wordsVersion;
        const builder = new RangeSetBuilder();
        if (!plugin.activeFor(view)) {
          this.results = [];
          return builder.finish();
        }
        if (!mathjs) {
          plugin.warmEngine();
          this.results = [];
          return builder.finish();
        }
        const doc = view.state.doc;
        this.results = analyse(doc.toString().split("\n"), plugin.settings);
        for (const r of this.results) {
          const line = doc.line(r.line + 1);
          // Only show a result where nothing has been typed after the "=" yet.
          if (doc.sliceString(r.to, line.to).trim()) continue;
          builder.add(line.to, line.to, Decoration.widget({ widget: new ResultWidget(r.text, line.to, /\s$/.test(line.text), r.interpreted), side: 1 }));
        }
        if (this.results.unresolved.length) plugin.askForWords(this.results.unresolved);
        return builder.finish();
      }
    },
    { decorations: (v) => v.decorations }
  );
}

// Obsidian pairs a typed * as ** for emphasis, so "rate * 4 =" became
// "rate * 4 =*", with no answer. In a line of maths, a typed * stays one *.
function singleStar(plugin) {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged || !tr.isUserEvent("input.type") || tr.startState.selection.ranges.length !== 1) return tr;
    let typed = null;
    tr.changes.iterChanges((fromA, toA, fromB, toB, text) => {
      typed = typed === null ? { from: fromA, to: toA, text: text.toString() } : false;
    });
    if (!typed || typed.text !== "**" || typed.from !== typed.to || !plugin.activeForState(tr.startState)) return tr;
    if (!inMathsLine(tr.startState, typed.from)) return tr;
    return { changes: { from: typed.from, insert: "*" }, selection: { anchor: typed.from + 1 }, userEvent: "input.type", scrollIntoView: true };
  });
}

// Multiplication rather than emphasis: after a number, ) or %, in a line that
// defines something, or after a variable the note defines above.
function inMathsLine(state, pos) {
  const doc = state.doc;
  const line = doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);
  const last = before.replace(/\s+$/, "");
  if (!last || insideFence(doc, line.number)) return false;
  if (/[\d)\]%]$/.test(last)) return true;
  if (DEFINITION.test(before)) return true;
  const word = /([\p{L}_][\p{L}\p{N}_]*)$/u.exec(last);
  if (!word) return false;
  const above = doc.sliceString(0, line.from);
  return new RegExp(`^[ \\t>*-]*${word[1]}\\s*(?:\\([^)]*\\))?\\s*=`, "m").test(above);
}

function insideFence(doc, lineNumber) {
  let open = false;
  for (let n = 1; n < lineNumber; n++) if (/^\s*(```|~~~)/.test(doc.line(n).text)) open = !open;
  return open;
}

// Tab at the end of a line with a result writes the result into the note.
function acceptKeymap(plugin) {
  return Prec.high(
    keymap.of([
      {
        key: "Tab",
        run: (view) => {
          if (!plugin.activeFor(view) || !mathjs) return false;
          const head = view.state.selection.main;
          if (!head.empty) return false;
          const line = view.state.doc.lineAt(head.head);
          if (head.head !== line.to) return false;
          const results = analyse(view.state.doc.toString().split("\n"), plugin.settings);
          const r = results.find((x) => x.line === line.number - 1);
          if (!r || view.state.doc.sliceString(r.to, line.to).trim()) return false;
          view.dispatch({ changes: { from: line.to, insert: `${/\s$/.test(line.text) ? "" : " "}${r.text}` }, selection: { anchor: line.to + r.text.length + (/\s$/.test(line.text) ? 0 : 1) } });
          return true;
        },
      },
    ])
  );
}

/* ------------------------------------------------------------------------ */
/* Plugin                                                                    */
/* ------------------------------------------------------------------------ */

export default class TahoeMathPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    // Drop saved rewrites from before the checks above.
    const words = this.settings.words || {};
    for (const [q, expr] of Object.entries(words)) if (!grounded(q, expr) || ruleRewrite(q)) delete words[q];
    this.addSettingTab(new TahoeMathSettingTab(this.app, this));
    this.registerEditorExtension([mathPlugin(this), acceptKeymap(this), singleStar(this)]);
    this.registerMarkdownPostProcessor((el, ctx) => this.decorateReadingView(el, ctx));

    this.addCommand({
      id: "insert-results",
      name: "Write all answers into this note",
      editorCallback: async (editor) => {
        await loadEngine();
        const lines = editor.getValue().split("\n");
        const results = analyse(lines, this.settings).filter((r) => !lines[r.line].slice(r.to - offsetOf(lines, r.line)).trim());
        for (const r of results.reverse()) {
          const text = lines[r.line];
          editor.replaceRange(`${/\s$/.test(text) ? "" : " "}${r.text}`, { line: r.line, ch: text.length });
        }
      },
    });
  }

  /* ---------- plain English, via Tahoe Intelligence (on the Mac) ---------- */

  // Questions in words: ask after a pause, check the rewrite really works, keep it.
  askForWords(items) {
    if (!this.settings.plainEnglish) return;
    const ai = this.app.plugins.getPlugin("tahoe-intelligence");
    if (!ai || !ai.api || !ai.api.translateMath) return;
    this.wordsQueue = items;
    window.clearTimeout(this.wordsTimer);
    this.wordsTimer = window.setTimeout(() => this.runWords(ai.api), 900);
  }

  async runWords(api) {
    if (this.wordsBusy) return;
    this.wordsBusy = true;
    this.tried = this.tried || new Set();
    let changed = false;
    try {
      for (const item of (this.wordsQueue || []).slice(0, 4)) {
        const key = wordsKey(item.expr);
        if (this.tried.has(key) || (this.settings.words && this.settings.words[key])) continue;
        this.tried.add(key);
        let expr = null;
        try {
          expr = await api.translateMath(item.expr, { variables: item.variables });
        } catch {
          continue;
        }
        if (!expr || /=/.test(expr.replace(/[<>!]=/g, "")) || !grounded(item.expr, expr, item.variables)) continue;
        // Keep only rewrites the calculator can really work out.
        if (!tryEvaluate(expr, Object.assign({}, item.scope)).ok) continue;
        this.settings.words = this.settings.words || {};
        this.settings.words[key] = expr;
        // Keep the list tidy: the 300 most recent.
        const keys = Object.keys(this.settings.words);
        if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete this.settings.words[k];
        changed = true;
      }
    } finally {
      this.wordsBusy = false;
    }
    if (changed) {
      await this.saveData(this.settings);
      this.refreshEditors();
    }
    // More questions may be waiting.
    if ((this.wordsQueue || []).some((i) => !this.tried.has(wordsKey(i.expr)))) this.wordsTimer = window.setTimeout(() => this.runWords(this.app.plugins.getPlugin("tahoe-intelligence").api), 200);
  }

  // Set up mathjs when Obsidian has a moment, then show the answers.
  warmEngine() {
    if (this.warming) return;
    this.warming = true;
    const go = () => {
      loadEngine().then(() => this.refreshEditors());
    };
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 2000 });
    else window.setTimeout(go, 300);
  }

  // Show new answers in open notes straight away.
  refreshEditors() {
    this.wordsVersion = (this.wordsVersion || 0) + 1;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const cm = leaf.view && leaf.view.editor && leaf.view.editor.cm;
      if (cm && cm.dispatch) cm.dispatch({});
    });
  }

  activeFor(view) {
    return this.activeForState(view.state);
  }

  activeForState(state) {
    if (!this.settings.enabled) return false;
    if (!this.settings.onlyTagged) return true;
    const info = state.field(editorInfoField, false);
    const file = info && info.file;
    if (!file) return false;
    const fm = this.app.metadataCache.getFileCache(file);
    return !!(fm && fm.frontmatter && (fm.frontmatter.math === true || fm.frontmatter.math === "true"));
  }

  // Reading view: results after "=" in paragraphs and list items.
  async decorateReadingView(el, ctx) {
    if (!this.settings.enabled) return;
    if (!el.textContent.includes("=")) return;
    const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!file || file.extension !== "md") return;
    if (this.settings.onlyTagged) {
      const fm = ctx.frontmatter;
      if (!(fm && (fm.math === true || fm.math === "true"))) return;
    }
    const info = ctx.getSectionInfo(el);
    const lines = (info ? info.text : await this.app.vault.cachedRead(file)).split("\n");
    await loadEngine();
    const results = analyse(lines, this.settings).filter((r) => !info || (r.line >= info.lineStart && r.line <= info.lineEnd));
    if (!results.length) return;
    const pending = results.filter((r) => !lines[r.line].slice(r.to - offsetOf(lines, r.line)).trim());
    const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement && node.parentElement.closest("code, pre, .math")) continue;
      if (/=\s*$/.test(node.textContent)) targets.push(node);
    }
    targets.slice(0, pending.length).forEach((textNode, i) => {
      const span = createSpan({ cls: `tahoe-math-result${pending[i].interpreted ? " is-interpreted" : ""}`, text: pending[i].interpreted ? " " : ` ${pending[i].text}` });
      if (pending[i].interpreted) span.append(createSpan({ cls: "tahoe-math-spark", text: "✦" }), ` ${pending[i].text}`);
      if (pending[i].interpreted) span.setAttribute("aria-label", `Worked out as ${pending[i].interpreted}`);
      textNode.parentNode.insertBefore(span, textNode.nextSibling);
    });
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.app.workspace.updateOptions();
  }
}

function offsetOf(lines, n) {
  let o = 0;
  for (let i = 0; i < n; i++) o += lines[i].length + 1;
  return o;
}

class TahoeMathSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.icon = "calculator";
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Answers as you type")
      .setDesc("Type an expression ending in = and the answer appears. Define variables as you go, such as rate = 12, and later lines can use them.")
      .addToggle((t) => t.setValue(s.enabled).onChange(async (v) => ((s.enabled = v), await this.plugin.saveSettings())));

    new Setting(containerEl)
      .setName("Only in notes marked for maths")
      .setDesc("Only show answers in notes whose properties include “math: true”.")
      .addToggle((t) => t.setValue(s.onlyTagged).onChange(async (v) => ((s.onlyTagged = v), await this.plugin.saveSettings())));

    new Setting(containerEl)
      .setName("Precision")
      .setDesc("Significant digits shown in results.")
      .addDropdown((d) => {
        for (const v of ["4", "6", "8", "10", "14"]) d.addOption(v, v);
        d.setValue(String(s.precision)).onChange(async (v) => ((s.precision = Number(v)), await this.plugin.saveSettings()));
      });

    const hasAI = !!this.app.plugins.getPlugin("tahoe-intelligence");
    new Setting(containerEl)
      .setName("Questions in words")
      .setDesc(
        hasAI
          ? "Type “days until Oct 14 =” or “20% tip on $86 split 3 ways =”. Apple Intelligence turns the question into a calculation, and Tahoe Math works it out exactly. Answers sync to iPhone."
          : "Needs Tahoe Intelligence on your Mac. Questions already worked out there still show here."
      )
      .addToggle((t) => t.setValue(s.plainEnglish).onChange(async (v) => ((s.plainEnglish = v), await this.plugin.saveSettings())));

    const examples = containerEl.createDiv({ cls: "tahoe-math-examples" });
    examples.createEl("div", { cls: "setting-item-name", text: "Try it" });
    const pre = examples.createEl("pre");
    pre.setText(["rent = 1800", "people = 3", "rent / people =", "", "5 km + 300 m =", "3 ft to cm =", "20% of 80 =", "$12.50 * 4 =", "f(t) = t^2 + 1", "f(4) =", "", 'daysUntil("Oct 14") =', "days until Oct 14 ="].join("\n"));
  }
}

// For tests.
export { analyse, inMathsLine };

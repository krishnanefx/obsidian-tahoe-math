# Tahoe Math: design notes

These notes describe how Tahoe Math works as of 1.0.5. Everything lives in one file, `src/main.js`, which esbuild bundles together with math.js into `main.js`.

## How a line becomes an answer

**Reading the note.** `analyse(lines, settings)` walks the whole note from top to bottom, with one scope object that holds every variable and function defined so far. Variables carry down the note because each definition is evaluated into that shared scope. A line can only use what is defined above it. On the way down it skips front matter, fenced code blocks (``` or ~~~, closed by a fence of the same character that is at least as long), `$$` maths blocks, table rows that start with `|`, and setext underlines. List markers, task boxes, blockquote markers and heading hashes are removed before the line is read.

**Which lines get an answer.** A line gets one if it ends in `=` but not in `==`, `!=`, `<=` or `>=`. Before the `=` there are a few cases:

- `total = x * 3 =` defines `total` and shows its value.
- Plain maths is passed to math.js after the text rewrites described below (percentages, currency symbols, `×÷−`, thousands separators).
- If the whole line fails, `evaluateTail` looks for the longest tail that works, cutting after a space, tab or colon, so `Total cost: 3 * $12 =` still works. It tries at most 24 cuts. A tail may only start with a word if that word is a variable or a function call, and a lone number after some words doesn't count. This keeps `my midterm on Oct 14 =` from showing `14`.
- Lines that look like words go to the plain-English path (below).

**Showing the answer in Live Preview.** The editor side is a CodeMirror 6 `ViewPlugin`. It builds a decoration set with one `Decoration.widget` (a `ResultWidget`) placed at the end of each line that has an answer. A widget is only added when nothing has been typed after the `=` yet, so once you write an answer in, the ghost answer goes away. The answer is styled with the theme's `--text-accent` colour. Nothing is written to the note until you ask for it.

**Writing it in.** There are three ways:

- Clicking the widget dispatches an insert at the end of the line.
- Tab, bound through a `Prec.high` keymap, does the same thing when the cursor sits at the end of a line that has an answer. Anywhere else it returns `false`, so Tab keeps its normal behaviour.
- The *Write all answers into this note* command fills in every pending answer, working from the bottom up so earlier positions don't shift.

**Reading view.** A Markdown post-processor runs `analyse` over the whole note's source, so variables defined above still count, and keeps the answers that fall inside the section being drawn. It finds the text nodes that end in `=` (outside `code`, `pre` and `.math`) and adds an answer span after each one, matching them up in order.

## Maths: math.js, units, currency, percentages, dates

**The engine.** All the arithmetic is done by math.js (Apache 2.0, pinned to 15.2.0). I create it with `create(all)`, add a few units it doesn't have (`pound`, `mph`, `kph`/`kmh`), and import the date functions as math.js functions, so they work inside ordinary expressions. Then I lock the evaluator down following the math.js security guide: I keep a private reference to `evaluate`, then override `import`, `createUnit`, `reviver`, `evaluate`, `parse`, `simplify`, `derivative`, `compile` and `resolve` so that note text can't call them (`reviver` was added to that list in 1.0.5). math.js brings units, conversions and user-defined functions with it.

**Units and conversions** are math.js units: `5 km + 300 m`, `3 ft to cm`, `72 degF to degC`. When formatting units I round to at most 5 significant digits, write math.js's exponent form out in full for everyday sizes (`604,800 seconds` rather than `6.048e+5 seconds`), and add the plural for time units (`9 day` becomes `9 days`).

**Percentages** are rewritten as text before math.js sees them:

- `20% of 80` becomes `(20/100) * 80`.
- A trailing `+ 15%` or `- 15%` becomes `(base) * (1 ± 15/100)`. That's the way calculators treat it.
- Any other `15%` becomes `(15/100)`.

The same step also turns `×`, `÷` and `−` into operators and drops thousands separators (`1,234`).

**Currency.** Currency is formatting, not maths. The symbols `$ € £ ¥` are removed before evaluation, so math.js only ever sees numbers. While walking the note, I remember which symbol each variable was defined with, taken from the right-hand side of its definition; that includes a definition that also shows its value (`total = x * 3 =`), since 1.0.5. If a variable is later redefined without a symbol, I forget it. A line's answer gets a currency symbol if the line contains one directly, or if it uses a variable that was defined with one. That is how `flights = $420` … `flights + hotel + food =` shows `$960.00`. If a line mixes currencies, a symbol typed in the line wins; otherwise the first variable with a currency decides. Nothing is converted. Currency answers always show two decimal places.

**Precision.** The setting is 4, 6, 8, 10 or 14 (10 by default), in significant digits:

- Plain numbers are rounded to that many significant digits, but never fewer than the whole-number part has, so `1/3 =` shows `0.3333333333` at 10 and `0.3333` at 4, and `123456789.123 =` shows `123,456,789` at 4.
- Unit answers use the setting but never more than 5 significant digits, so `72 degF to degC` shows `22.222 degC` (`22.22 degC` at 4).
- Currency always shows two decimal places.
- Plain numbers of 10^15 or more, or below 10^-6 (other than 0), switch to exponent notation with 6 significant digits (`1.00000e+15`).
- Complex numbers, fractions and matrices use exactly the setting.

Before 1.0.5, plain numbers got two more significant digits than the setting said.

**Dates.** The date code is my own and does not use a date library. `parseDate` understands:

- `today`, `tomorrow` and `yesterday`
- ISO dates and `M/D[/Y]`
- month names, weekday names (`next Thursday` on a Thursday is a week away), `next week` (next Monday)
- a table of US holidays. Fixed dates are stored directly, moving ones are computed: Thanksgiving is the 4th Thursday of November, and Easter uses the Anonymous Gregorian algorithm.

A date without a year is taken as the next one, except that a month-and-day up to 30 days ago still counts as this year's; when the question is about the past (`daysSince`), it's the most recent one. Holidays and weekdays are always the next one. The date functions available in notes are `daysUntil`, `daysSince`, `daysBetween`, `weeksUntil`, `weekday`, `dateOf` and `dateIn`.

**Questions in words.** A line counts as words if it has two words of two or more letters in a row and is at most 200 characters long. It is handled in five steps, in order:

1. Try it as maths first. This was added in 1.0.3, so `3 ft to cm` stays maths and isn't treated as a question.
2. Try fixed regex rewrites (`days until X`, `how many X in a Y`, `half of X`, …). These need no model, so they work on phones.
3. Try a rewrite saved earlier.
4. Look for the longest tail that is maths, as above (`rent for three people 1800 / 3 =` gives `600`).
5. Ask the optional Tahoe Intelligence plugin, if it's installed and *Questions in words* is on, and nothing else worked.

A model's rewrite is only kept if all of these hold:

- It contains no `=` other than in `<=`, `>=` or `!=`.
- It is *grounded*: its numbers come from the question (or a small set of everyday factors such as 60, 100 and 365, any multiplier between 0 and 2, and numbers written as words like `three` or `dozen`), its quoted dates come from the question, and it uses the note's variables that the question names. A code comment gives the case this catches: `$86 / 3` for "split rent between 3 people".
- It actually evaluates.

Kept rewrites are saved in the plugin's data (the 300 most recent), and answers worked out from words get a ✦.

## Performance and scope

- **When it re-analyses.** It re-analyses the whole note when the document changes, when a new plain-English rewrite arrives, or when the editor is reconfigured. Before 1.0.1 it also re-analysed on every selection change and every viewport change, which meant every click and scroll. I dropped those. There's no debouncing and no incremental re-analysis: each edit re-reads the whole note. Measured on an M4 Pro Mac with Node 20 (the analysis only, not drawing the answers), on generated notes where 30% of lines have answers: when the note reuses a few variable names, about 1 ms for 100 lines, 4 ms for 500, 14 ms for 2,000 and 42 ms for 5,000; when every block defines new variables, roughly twice that (about 30 ms at 2,000 lines). A frame is about 16 ms, so past a couple of thousand lines, or a few hundred definitions, typing can miss frames. Re-reading only from the edited line down would be the fix.
- **Loading math.js lazily.** Since 1.0.2, math.js (about 0.8 MB minified) isn't set up while the plugin loads. It loads with a dynamic `import()` in `requestIdleCallback` (with a 2 s timeout; where that isn't available, a 300 ms timer) as soon as an editor where Tahoe Math is active is drawn, usually just after Obsidian opens; Reading view and the *Write all answers* command load it straight away if it isn't ready. Then the open editors are refreshed. Until it has loaded, there are simply no answers. The commit that made this change recorded 72 ms off Obsidian's startup.
- **Asking the model.** Requests to the model are debounced by 900 ms after the last edit. Each run asks at most 4 questions, and a question is never asked twice in a session.
- **Which notes it runs in.** With *Only in notes marked for maths* on, it runs only in notes whose properties include `math: true`. The editor reads this from Obsidian's metadata cache, and Reading view reads it from the post-processor context. The main toggle turns everything off, including the *Write all answers* command (since 1.0.5; before, the command ignored both settings).
- **Bundle size.** Minifying takes the bundle from about 2.2 MB to about 0.8 MB. Nearly all of that is math.js; the plugin's own code is about 20 KB minified.

## What changed along the way

- **`*` turning into `**`.** Obsidian's *Auto pair Markdown* pairs a typed `*` for emphasis. So typing `rate * 4 =` produced `rate * 4 =*`, and the answer disappeared. In 1.0.4 I added a transaction filter that turns a typed `**` back into a single `*`, but only on a line that reads as maths: the `*` comes after a number, `)`, `]` or `%`, the line is a definition, or the `*` comes after a variable defined higher up in the note. Prose and code blocks keep Obsidian's pairing.
- **Words that were really maths.** Up to 1.0.2, a line that looked like words went to the fixed rewrites before being tried as maths, so `3 ft to cm` came back with a ✦ as if it were a question. Since 1.0.3, a line is tried as maths first.
- **Re-analysing on clicks and scrolls.** I removed this in 1.0.1 (see above).
- **Loading math.js at startup.** This was replaced by idle-time loading in 1.0.2. In 1.0.3 it moved from `require()` to a dynamic `import()` when the source became an ES module to pass Obsidian's lint.
- **Model rewrites that aren't grounded.** Since 1.0.0, the first recorded version, saved rewrites that fail the grounding check, or that a fixed rule now covers, are deleted when the plugin loads rather than trusted.
- **1.0.5.** Precision now means significant digits for plain numbers too (whole numbers are never rounded); `reviver` is disabled as the math.js security guide recommends; `next week` and `next Thursday` work; *Write all answers* respects the main toggle and *Only in notes marked for maths*; a definition that shows its value keeps the right currency.
- **No calculation blocks.** Answers work in ordinary text: ending a line with `=` is all it takes, with no block to open first.

My development repository's history starts at a snapshot of 1.0.0, so anything I tried before that isn't recorded; this public repository starts at 1.0.3.

## Testing

The tests live in my development repository, not in this one:

- `tests/unit/plugins.test.cjs` runs in plain Node, with stand-ins for Obsidian and CodeMirror. It loads the built `main.js`, waits for math.js, and checks the following:
  - currency carried through variables (`$960.00`)
  - units and conversions, including `72 degF to degC`
  - percentages
  - functions
  - that a question in words (`how many seconds in a week`) gets `604,800 seconds` with a ✦
  - that `$$` and code blocks give no answers
  - which lines keep a single `*`
- The Obsidian scenarios (a hidden test copy of Obsidian driven over its remote-debugging port) only check that Tahoe Math is enabled.
- `perf.py` measures what each plugin costs by turning them off one at a time, and Tahoe Math is one of them.

There are no tests for Reading view, the Tab key or the date parser.

# Tahoe Math: design notes

These notes describe how Tahoe Math works as of 1.0.4. Everything lives in one file, `src/main.js`, which esbuild bundles together with math.js into `main.js`.

## How a line becomes an answer

**Reading the note.** `analyse(lines, settings)` walks the whole note from top to bottom, with one scope object that holds every variable and function defined so far. Variables carry down the note because each definition is evaluated into that shared scope. A line can only use what is defined above it. On the way down it skips front matter, fenced code blocks (``` or ~~~, closed by a fence of the same character that is at least as long), `$$` maths blocks, tables, and setext underlines. List markers, task boxes, blockquote markers and heading hashes are removed before the line is read.

**Which lines get an answer.** A line gets one if it ends in `=` but not in `==`, `!=`, `<=` or `>=`. Before the `=` there are a few cases:

- `total = x * 3 =` defines `total` and shows its value.
- Plain maths is passed to math.js as it is.
- If the whole line fails, `evaluateTail` looks for the longest tail that works, cutting after a space, tab or colon, so `Total cost: 3 * $12 =` still works. It tries at most 24 cuts. A tail may only start with a word if that word is a variable or a function call, and a lone number after some words doesn't count. This keeps `my midterm on Oct 14 =` from showing `14`.
- Lines that look like words go to the plain-English path (below).

**Showing the answer in Live Preview.** The editor side is a CodeMirror 6 `ViewPlugin`. It builds a decoration set with one `Decoration.widget` (a `ResultWidget`) placed at the end of each line that has an answer. A widget is only added when nothing has been typed after the `=` yet, so once you write an answer in, the ghost answer goes away. The answer is styled with the theme's `--text-accent` colour. Nothing is written to the note until you ask for it.

**Writing it in.** There are three ways:

- Clicking the widget dispatches an insert at the end of the line.
- Tab, bound through a `Prec.high` keymap, does the same thing when the cursor sits at the end of a line that has an answer. Anywhere else it returns `false`, so Tab keeps its normal behaviour.
- The *Write all answers into this note* command fills in every pending answer, working from the bottom up so earlier positions don't shift.

**Reading view.** A Markdown post-processor runs `analyse` over the section's source lines. It finds the text nodes that end in `=` (outside `code`, `pre` and `.math`) and adds an answer span after each one, matching them up in order.

## Maths: math.js, units, currency, percentages, dates

**The engine.** All the arithmetic is done by math.js (Apache 2.0, pinned to 15.2.0). I create it with `create(all)`, add a few units it doesn't have (`pound`, `mph`, `kph`/`kmh`), and import the date functions as math.js functions, so they work inside ordinary expressions. Then I lock the evaluator down the way the math.js docs recommend: I keep a private reference to `evaluate`, then override `import`, `createUnit`, `evaluate`, `parse`, `simplify`, `derivative`, `compile` and `resolve` so that note text can't call them. math.js brings units, conversions and user-defined functions with it, which covers most of what the plugin needs.

**Units and conversions** are math.js units: `5 km + 300 m`, `3 ft to cm`, `72 degF to degC`. The only thing I add when formatting is the plural for time units (`9 day` becomes `9 days`).

**Percentages** are rewritten as text before math.js sees them:

- `20% of 80` becomes `(20/100) * 80`.
- A trailing `+ 15%` or `- 15%` becomes `(base) * (1 ± 15/100)`. A code comment says this is how Apple Notes and calculators behave.
- Any other `15%` becomes `(15/100)`.

The same step also turns `×`, `÷` and `−` into operators and drops thousands separators (`1,234`).

**Currency.** Currency is formatting, not maths. The symbols `$ € £ ¥` are removed before evaluation, so math.js only ever sees numbers. While walking the note, I remember which symbol each variable was defined with. If a variable is later redefined without a symbol, I forget it. A line's answer gets a currency symbol if the line contains one directly, or if it uses a variable that was defined with one. That is how `flights = $420` … `flights + hotel + food =` shows `$960.00`. If a line mixes currencies, the first symbol found is used, and nothing is converted. Currency answers always show two decimal places.

**Precision.** The setting goes from 4 to 14 (10 by default). How it's applied depends on the kind of answer:

- Plain numbers use it as the maximum number of fraction digits, and use precision + 2 as the maximum number of significant digits (at most 21).
- Unit answers are capped at 5 significant digits whatever the setting is. That is why `72 degF to degC` shows `22.222 degC`.
- Values of 10^15 or more, or below 10^-6, switch to exponent notation with 6 digits.

Five significant digits is plenty for everyday conversions and keeps unit answers short. One quirk: the setting's description says "significant digits", which is true for unit answers but not for plain numbers, where it's the number of decimal places.

**Dates.** The date code is my own and does not use a date library. `parseDate` understands:

- `today`, `tomorrow` and `yesterday`
- ISO dates and `M/D[/Y]`
- month names, weekday names, `next week`
- a table of US holidays. Fixed dates are stored directly, moving ones are computed: Thanksgiving is the 4th Thursday of November, and Easter uses the Anonymous Gregorian algorithm.

A date without a year is taken as the next one, or as the most recent one when the question is about the past (`daysSince`). The date functions available in notes are `daysUntil`, `daysSince`, `daysBetween`, `weeksUntil`, `weekday`, `dateOf` and `dateIn`.

**Questions in words.** A line counts as words if it has two words of two or more letters in a row and is at most 200 characters long. It is handled in four steps, in order:

1. Try it as maths first. This was added in 1.0.3, so `3 ft to cm` stays maths and isn't treated as a question.
2. Try fixed regex rewrites (`days until X`, `how many X in a Y`, `half of X`, …). These need no model, so they work on phones.
3. Try a rewrite saved earlier.
4. Ask the optional Tahoe Intelligence plugin, if it is installed.

A model's rewrite is only kept if all of these hold:

- It contains no `=`.
- It is *grounded*: its numbers come from the question (or a small set of everyday factors such as 60, 100 and 365), its quoted dates come from the question, and it uses the note's variables that the question names. A code comment gives the case this catches: `$86 / 3` for "split rent between 3 people".
- It actually evaluates.

Kept rewrites are saved in the plugin's data (the 300 most recent), and answers worked out from words get a ✦.

## Performance and scope

- **When it re-analyses.** It re-analyses the whole note when the document changes, when a new plain-English rewrite arrives, or when the editor is reconfigured. Before 1.0.1 it also re-analysed on every selection change and every viewport change, which meant every click and scroll. I dropped those. There's no debouncing and no incremental re-analysis: each edit re-reads the whole note. I measured how long that pass takes on my Mac, with the same Node setup as the unit tests (the analysis only, not drawing the answers), on notes that mix prose with answers: about 1 ms for 100 lines, 3.5 ms for 500, 12 ms for 2,000 lines with 600 answers, and 32 ms for 5,000. A frame is about 16 ms, so typing stays smooth up to roughly 2,000 lines. Past that, re-reading only from the edited line down would be the fix.
- **Loading math.js lazily.** Since 1.0.2, math.js (about 1 MB) isn't set up while the plugin loads. It loads with a dynamic `import()` in `requestIdleCallback` (with a 2 s timeout; where that isn't available, a 300 ms timer) the first time a note needs it. Then the open editors are refreshed. Until it has loaded, there are simply no answers. The commit that made this change recorded 72 ms off Obsidian's startup.
- **Asking the model.** Requests to the model are debounced by 900 ms after the last edit. Each run asks at most 4 questions, and a question is never asked twice in a session.
- **Which notes it runs in.** With *Only in notes marked for maths* on, it runs only in notes whose properties include `math: true`. The editor reads this from Obsidian's metadata cache, and Reading view reads it from the post-processor context. The main toggle turns everything off.
- **Bundle size.** In my build script, Tahoe Math is the only one of my plugins whose bundle is minified. math.js is about 1 MB, far more than the plugin's own code, so this is where minifying saves the most.

## What changed along the way

- **`*` turning into `**`.** Obsidian's *Auto pair Markdown* pairs a typed `*` for emphasis. So typing `rate * 4 =` produced `rate * 4 =*`, and the answer disappeared. In 1.0.4 I added a transaction filter that turns a typed `**` back into a single `*`, but only on a line that reads as maths: the `*` comes after a number, `)`, `]` or `%`, the line is a definition, or the `*` comes after a variable defined higher up in the note. Prose and code blocks keep Obsidian's pairing.
- **Words that were really maths.** Up to 1.0.2, any line that looked like words went straight to the question path, so `3 ft to cm` got a ✦ and could be sent to the model. Since 1.0.3, a line is tried as maths first.
- **Re-analysing on clicks and scrolls.** I removed this in 1.0.1 (see above).
- **Loading math.js at startup.** This was replaced by idle-time loading in 1.0.2. In 1.0.3 it moved from `require()` to a dynamic `import()` when the source became an ES module to pass Obsidian's lint.
- **Model rewrites that weren't grounded.** On load, saved rewrites that fail the grounding check, or that a fixed rule now covers, are deleted ("Drop saved rewrites from before the checks above"). So rewrites from before the check existed are thrown away rather than trusted.
- **No calculation blocks.** Answers work in ordinary text: ending a line with `=` is all it takes, with no block to open first.

My git history for Tahoe Math starts at a snapshot of version 1.0.0, so anything I tried before that isn't recorded here.

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
- The Obsidian scenarios (a hidden test copy of Obsidian driven over its remote-debugging port) only check that Tahoe Math loads.
- `perf.py` measures what each plugin costs by turning them off one at a time, and Tahoe Math is one of them.

There are no tests for Reading view, the Tab key or the date parser.

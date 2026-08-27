# Integrity Bench: results data

Per-question results for every model on Integrity Bench, a benchmark measuring whether an AI
model's stated confidence matches how often it is actually right. Each model answers questions
across 10 domains, each built as 8 ordered difficulty levels with 10 "scout" questions per
level (800 questions), plus 20 extra questions per level at the 3 consecutive levels where
that model's accuracy is closest to 50% (its difficulty band, which the headline calibration
score is measured on). Alongside every answer the model states a confidence from 0 to 100.

Layout: one folder per benchmark variant, then one folder per model, then one JSON per domain
(`<variant>/<model>/<domain>.json`). The variants: `no_tools` is the headline run (answer and
confidence in a single reply), `no_tools_confidence` asks the model to only forecast its
confidence before attempting the question, `tools` gives it a sandboxed tool environment, the
`_high` variants are the same at high reasoning effort, and `no_tools_are_you_sure`,
`no_tools_pressure` and `no_tools_brier_told` are prompt ablations.

Each file's `tasks` list has one entry per question the model was actually run on: status
"done" carries the outcome (`score` is mean correct over epochs 0..1, `confidence_mean` 0..100,
plus cost, timing and per-epoch detail), while status "excluded" marks a question the model
attempted but returned no usable answer for (a refusal or content-filter block, or a reply
truncated at the output cap); excluded questions never count against accuracy. Questions a
model was never run on are simply absent. `index.json` is the machine-readable manifest
(models, domains, the canonical question list with difficulty levels, and per-cell rollups);
`cached/` holds slim per-model files the website loads for speed. The question bank itself
stays private to keep the benchmark uncontaminated, so only question ids, difficulty levels
and outcomes appear here.

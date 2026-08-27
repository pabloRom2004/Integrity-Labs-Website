/* ============================================================
   data.js — load the raw benchmark export and compute metrics.

   The site is a pure consumer of the export folder produced by
   results/scripts/export_site_data.py:
     data/index.json                          metadata + per-cell grid
     data/<model>/<domain>/<variant>.json     per-task detail (lazy)

   Nothing here is hardcoded about which models/domains exist — it all
   comes from index.json, so new runs appear automatically.
   ============================================================ */

const DATA_DIR = 'data';

const Data = (() => {
  let index = null;                 // parsed index.json
  const taskCache = {};             // `${model}/${domain}/${variant}` -> Promise<tasks[]>

  // Prettier model labels than the auto title-case in the export.
  const DISPLAY_OVERRIDE = {
    'claude-fable-5':        'Claude Fable 5',
    'claude-opus-4-8':       'Claude Opus 4.8',
    'claude-opus-5':         'Claude Opus 5',
    'claude-sonnet-4-6':     'Claude Sonnet 4.6',
    'claude-sonnet-5':       'Claude Sonnet 5',
    'deepseek-v4-flash':     'DeepSeek V4 Flash',
    'deepseek-v4-pro':       'DeepSeek V4 Pro',
    'gemini-3.1-pro-preview':'Gemini 3.1 Pro',
    'gemini-3.5-flash':      'Gemini 3.5 Flash',
    'glm-5.2':               'GLM 5.2',
    'gpt-5.4-mini':          'GPT-5.4 Mini',
    'gpt-5.5':               'GPT-5.5',
    'gpt-5.6-luna':          'GPT-5.6 Luna',
    'gpt-5.6-terra':         'GPT-5.6 Terra',
    'gpt-5.6-sol':           'GPT-5.6 Sol',
    'qwen3.6-35b-a3b':       'Qwen 3.6',
    'gemma-4-26b-a4b-it':    'Gemma 4 26B',
    'grok-4.5':              'Grok 4.5',
    'grok-4.6':              'Grok 4.6',
    'muse-spark-1.1':        'Muse Spark 1.1',
    'muse-spark-1.2':        'Muse Spark 1.2',
    'muse-glimmer-30b':      'Muse Glimmer 30B',
    'gpt-3.5-turbo':         'GPT-3.5 Turbo',
    'gpt-4o':                'GPT-4o',
    'gemini-3.6-flash':      'Gemini 3.6 Flash',
    'gemini-3.7-flash':      'Gemini 3.7 Flash',
  };

  async function load() {
    const logos = preloadLogos();
    index = await fetch(`${DATA_DIR}/index.json`).then(r => r.json());
    await logos;
    return index;
  }

  // Prettier domain labels than the auto title-case.
  const DOMAIN_OVERRIDE = {
    reasoning_puzzles: 'Reasoning Puzzles', obscure_questions: 'Obscure Questions',
    '3d_shapes': '3D Shapes',
    code_trace: 'Code Trace', computer_use: 'Computer Use', belief_tracking: 'Belief Tracking',
    string_rules: 'String Rules', chess_puzzles: 'Chess Puzzles',
    spatial_reasoning_exp: 'Spatial Reasoning', object_counting: 'Object Counting',
  };

  // Bar colour by provider — matches the reference palette (Google blue, Anthropic terracotta,
  // OpenAI green); open-source models get their own distinct hues.
  const PROVIDER_COLORS = {
    google:    '#2E6FE6',   // Gemini — blue
    anthropic: '#E2772F',   // Claude / Fable — the site's original orange
    openai:    '#3DA17E',   // GPT — green
    deepseek:  '#212d9c',   // indigo
    qwen:      '#7C3AED',   // purple
    glm:       '#C9407A',   // magenta
    xai:       '#111111',   // Grok — black
    moonshot:  '#4D4D4D',   // Kimi — dark grey (distinct from Grok's black; different companies)
    meta:      '#0EA5E9',   // Muse Spark — sky blue
    thinkmach: '#D0342C',   // Inkling — red
    other:     '#B9AB98',   // neutral fallback
  };
  function providerKey(slug) {
    const s = (slug || '').toLowerCase();
    if (s.includes('gemini') || s.includes('gemma')) return 'google';
    if (s.includes('claude') || s.includes('fable') || s.includes('opus') || s.includes('sonnet') || s.includes('haiku'))
      return 'anthropic';
    if (s.includes('gpt')) return 'openai';
    if (s.includes('deepseek')) return 'deepseek';
    if (s.includes('qwen')) return 'qwen';
    if (s.includes('glm')) return 'glm';
    if (s.includes('grok')) return 'xai';
    if (s.includes('kimi') || s.includes('moonshot')) return 'moonshot';
    if (s.includes('muse') || s.includes('llama')) return 'meta';
    if (s.includes('inkling')) return 'thinkmach';
    return 'other';
  }
  const providerColor = slug => PROVIDER_COLORS[providerKey(slug)];

  // Provider logos (assets/logos/) shown above each model's axis label. Preloaded as data
  // URIs in load() because the chart's PNG export rasterises the SVG through an <img>,
  // where external file references are dropped.
  const LOGO_FILES = {
    google: 'google.svg', anthropic: 'anthropic.svg', openai: 'openai.svg',
    deepseek: 'deepseek.svg', qwen: 'qwen.png', glm: 'zai.svg', xai: 'xai.svg',
    moonshot: 'kimi.jpg', meta: 'meta.svg', thinkmach: 'thinkingmachines.svg',
  };
  const logoData = {};              // provider key -> data URI (missing = no logo drawn)
  function preloadLogos() {
    return Promise.all(Object.entries(LOGO_FILES).map(async ([key, file]) => {
      try {
        const r = await fetch(`assets/logos/${file}`);
        if (!r.ok) return;
        const blob = await r.blob();
        logoData[key] = await new Promise(res => {
          const fr = new FileReader();
          fr.onload = () => res(fr.result);
          fr.onerror = () => res(null);
          fr.readAsDataURL(blob);
        });
      } catch { /* chart falls back to name-only labels */ }
    }));
  }
  const providerLogo = slug => logoData[providerKey(slug)] || null;

  const models  = () => index.models.map(m => m.slug);
  // The fixed chart line-up from model_api_names.txt (each {slug, text_only, has_data}); falls
  // back to the data-having models if an older export has no roster.
  const roster  = () => index.roster || index.models.map(m => ({ slug: m.slug, text_only: !!m.text_only, has_data: true }));
  const imageDomainSet = () => new Set(index.image_domains || []);
  const domains = () => index.domains;                 // [{name, display, n_tasks, tasks}]
  const display = slug => DISPLAY_OVERRIDE[slug]
    || (index.models.find(m => m.slug === slug)?.display)
    || (index.roster || []).find(m => m.slug === slug)?.display
    || slug;
  const domainDisplay = name => DOMAIN_OVERRIDE[name] || (index.domains.find(d => d.name === name)?.display) || name;
  const generatedAt = () => index.generated_at;

  // A model needs a minimum number of scored tasks to earn a bar — otherwise a
  // model with a single fluke task distorts the whole axis. Looser per-domain
  // (domains can be as small as 4 tasks) than for the pooled "overall" view.
  const minSamples = sel => sel.domain === 'overall' ? 8 : 2;

  const cell = (model, domain, variant) => index.grid?.[model]?.[domain]?.[variant] || null;

  // Which export variant supplies accuracy vs confidence for a given selection.
  function variants(sel) {
    // The high/max reasoning arm is its own export variant (fed by real_runs_high/ logs). There
    // is no high-arm tools or prospective-confidence run, so those selections stay on the low arm.
    const answer = sel.tools ? 'tools' : sel.effort === 'high' ? 'no_tools_high' : 'no_tools';
    const conf = sel.timing === 'proactive' ? 'no_tools_confidence' : answer;
    return { answer, conf };
  }

  const domainNames = sel =>
    sel.domain === 'overall' ? index.domains.map(d => d.name) : [sel.domain];

  /* ---- grid-based metrics (instant, no extra fetch) ---- */
  // n_done-weighted accuracy% and confidence% for one model under a selection.
  function modelMeans(model, sel) {
    const { answer, conf } = variants(sel);
    let accNum = 0, accDen = 0, confNum = 0, confDen = 0;
    for (const d of domainNames(sel)) {
      const a = cell(model, d, answer);
      if (a && a.mean_score != null && a.n_done) { accNum += a.mean_score * 100 * a.n_done; accDen += a.n_done; }
      const c = cell(model, d, conf);
      if (c && c.mean_confidence != null && c.n_done) { confNum += c.mean_confidence * c.n_done; confDen += c.n_done; }
    }
    return {
      accuracy:   accDen ? accNum / accDen : null,
      confidence: confDen ? confNum / confDen : null,
      nAcc: accDen, nConf: confDen,
    };
  }

  // Cost ($) and wall-time for the WORK a model did under a selection — summed from the grid
  // cells of the answer variant (the run that actually solved the task), across the selected
  // domains. Used to enrich every hover with price + time.
  function modelCostTime(model, sel) {
    const { answer } = variants(sel);
    let cost = 0, time = 0, nDone = 0;
    for (const d of domainNames(sel)) {
      const a = cell(model, d, answer);
      if (!a) continue;
      cost  += a.cost_usd     || 0;
      time  += a.time_seconds || 0;
      nDone += a.n_done       || 0;
    }
    return { cost, time, nDone, avgTime: nDone ? time / nDone : null };
  }

  /* ---- formatting helpers shared by the tooltips ---- */
  const fmtCost = c => c == null ? '—'
    : c >= 1 ? '$' + c.toFixed(2)
    : c >= 0.1 ? '$' + c.toFixed(3)
    : '$' + c.toFixed(4);
  const fmtTime = s => s == null ? '—'
    : s < 90 ? Math.round(s) + 's'
    : s < 3600 ? (s / 60).toFixed(1) + ' min'
    : (s / 3600).toFixed(1) + ' h';
  // One extra tooltip block: avg time / task · total cost · tasks. '' if no cost data.
  function metaRow(r) {
    const warn = r && r.extrapolated
      ? `<div class="tt-warn">Extrapolated from pre-ban model runs, not full data.</div>` : '';
    if (!r || r.nDone == null || !r.nDone) return warn;
    return `${warn}<div class="tt-meta">${fmtTime(r.avgTime)}/task · ${fmtCost(r.cost)} total · ${r.nDone} sample${r.nDone === 1 ? '' : 's'}</div>`;
  }

  /* ---- per-task fetch (only needed for RMS) ---- */
  // Slim pre-computed cache written by export_site_data.py (data/cached/<model>.json):
  // the scout no_tools rows every visible component reads, ONE small fetch per model
  // instead of ten full per-task files. Missing/stale cache falls through to the full
  // files below, so numbers can never differ — only arrive slower.
  const slimCache = {};   // model -> Promise<{domains: {domain: rows[]}} | null>
  function loadSlim(model) {
    if (!(model in slimCache)) {
      slimCache[model] = fetch(`${DATA_DIR}/cached/${model}.json`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null);
    }
    return slimCache[model];
  }

  // Prospective (confidence-only) rows for a model+domain, from the same slim cache file:
  // [id, difficulty, confidence]. Falls back to the full variant file if the cache predates
  // the `conf` key, so numbers can never differ — only arrive slower.
  // `variant` selects the arm: the low-effort prospective run (default) or the high-effort one
  // (no_tools_confidence_high). The slim cache only carries the low arm, so the high variant
  // always reads its full file.
  function loadProspective(model, domain, variant = 'no_tools_confidence') {
    const key = `${model}/${domain}/pros/${variant}`;
    if (!taskCache[key]) {
      taskCache[key] = (async () => {
        if (variant === 'no_tools_confidence') {
          const slim = await loadSlim(model);
          if (slim && slim.conf) {
            const rows = slim.conf[domain] || [];
            return rows.map(r => ({ id: r[0], difficulty: r[1], confidence: r[2] }));
          }
        }
        const tasks = await loadTasks(model, domain, variant);
        return tasks.filter(t => t.status === 'done' && t.confidence_mean != null)
          .map(t => ({ id: t.id, difficulty: t.difficulty, confidence: t.confidence_mean }));
      })();
    }
    return taskCache[key];
  }

  function loadTasks(model, domain, variant) {
    const key = `${model}/${domain}/${variant}`;
    if (!taskCache[key]) {
      taskCache[key] = (async () => {
        const fromRows = rows => rows.map(r => ({
          id: r[0], difficulty: r[1], status: 'done',
          score: r[2], confidence_mean: r[3], cost_usd: r[4], time_seconds: r[5],
        }));
        const slim = await loadSlim(model);
        if (variant === 'no_tools') {
          const rows = slim?.domains?.[domain];
          if (rows) return fromRows(rows);
        } else if (slim?.variants) {
          // A new-format cache carries EVERY variant's done rows, so one cached fetch
          // per model replaces the dozens of per-cell task-file fetches the ablation
          // tables and the high arm used to make. A domain absent from it means "no
          // data" (the export writes rows for every non-empty cell) — don't fall back.
          return fromRows(slim.variants[variant]?.[domain] || []);
        }
        // variant-rooted tree (data/<variant>/<model>/<domain>.json); a cell the model
        // never ran has no file at all, so a 404 here simply means "no tasks"
        return fetch(`${DATA_DIR}/${variant}/${model}/${domain}.json`)
          .then(r => r.ok ? r.json() : { tasks: [] })
          .then(j => j.tasks || [])
          .catch(() => []);
      })();
    }
    return taskCache[key];
  }

  // Mean confidence on the tasks the model got WRONG (want='wrong') or RIGHT (want='right').
  // Wrong → ideal is 0 (this number is the overconfidence-when-wrong); right → ideal is 100
  // (confidence the model had when it was actually correct, higher is better).
  async function modelOutcomeConf(model, sel, want) {
    const { answer, conf } = variants(sel);
    let sum = 0, n = 0;
    for (const d of domainNames(sel)) {
      const [confTasks, accTasks] = await Promise.all([
        loadTasks(model, d, conf),
        conf === answer ? null : loadTasks(model, d, answer),
      ]);
      const accById = {};
      if (accTasks) for (const t of accTasks) accById[t.id] = t;
      for (const t of confTasks) {
        if (t.status !== 'done' || t.confidence_mean == null) continue;
        const correct = (conf === answer) ? t.score : accById[t.id]?.score;
        if (correct == null) continue;
        const isRight = correct >= 0.5;
        if (want === 'right' ? !isRight : isRight) continue;   // keep only the requested outcome
        sum += t.confidence_mean; n++;
      }
    }
    return n ? { value: sum / n, n } : { value: null, n: 0 };
  }

  // RMS of (confidence − 100·correct) pooled over every matched task.
  async function modelRMS(model, sel) {
    const { answer, conf } = variants(sel);
    let sq = 0, n = 0;
    for (const d of domainNames(sel)) {
      const [confTasks, accTasks] = await Promise.all([
        loadTasks(model, d, conf),
        conf === answer ? null : loadTasks(model, d, answer),
      ]);
      const accById = {};
      if (accTasks) for (const t of accTasks) accById[t.id] = t;
      for (const t of confTasks) {
        if (t.status !== 'done' || t.confidence_mean == null) continue;
        const correct = (conf === answer) ? t.score : accById[t.id]?.score;
        if (correct == null) continue;
        const err = t.confidence_mean - 100 * correct;
        sq += err * err; n++;
      }
    }
    return n ? { value: Math.sqrt(sq / n), n } : { value: null, n: 0 };
  }

  /* ---- assemble the chart series for a selection ---- */
  // metric: 'gap' | 'accuracy' | 'confidence' | 'both'
  // scoring: 'signed' | 'rms'  (gap only)
  async function series(sel) {
    const imgSet = imageDomainSet();
    const domainIsImage = sel.domain !== 'overall' && imgSet.has(sel.domain);
    // looser min for the outcome views (their population is just the failed / passed tasks)
    const outcome = sel.metric === 'wrong' || sel.metric === 'right';
    const minN = outcome ? (sel.domain === 'overall' ? 4 : 1) : minSamples(sel);

    const dataRows = [];        // models with a real bar, sorted by metric
    const placeholderRows = []; // "No data yet" / "Text only model", kept in roster order

    for (const rm of roster()) {
      const m = rm.slug;
      const base = { slug: m, display: display(m), textOnly: !!rm.text_only, extrapolated: !!rm.extrapolated, color: providerColor(m) };

      // A text-only model physically can't run an image domain → labelled bar, not a value.
      if (rm.text_only && domainIsImage) { placeholderRows.push({ ...base, placeholder: 'Text only model' }); continue; }
      // No live-bank run for this model yet.
      if (!rm.has_data)                  { placeholderRows.push({ ...base, placeholder: 'No data yet' }); continue; }

      const mm = modelMeans(m, sel);
      const ct = modelCostTime(m, sel);
      const row = {
        ...base,
        accuracy: mm.accuracy, confidence: mm.confidence,
        cost: ct.cost, time: ct.time, nDone: ct.nDone, avgTime: ct.avgTime,
        value: null, value2: null, n: 0, placeholder: null,
      };
      if (sel.metric === 'accuracy') { row.value = mm.accuracy; row.n = mm.nAcc; }
      else if (sel.metric === 'confidence') { row.value = mm.confidence; row.n = mm.nConf; }
      else if (sel.metric === 'both') { row.value = mm.accuracy; row.value2 = mm.confidence; row.n = mm.nAcc; }
      else if (sel.metric === 'wrong') { const r = await modelOutcomeConf(m, sel, 'wrong'); row.value = r.value; row.n = r.n; }
      else if (sel.metric === 'right') { const r = await modelOutcomeConf(m, sel, 'right'); row.value = r.value; row.n = r.n; }
      else if (sel.scoring === 'rms') { const r = await modelRMS(m, sel); row.value = r.value; row.n = r.n; }
      else { // signed gap
        row.value = (mm.accuracy != null && mm.confidence != null) ? mm.confidence - mm.accuracy : null;
        row.n = mm.nConf;
      }

      // has data overall but nothing for THIS selection (e.g. tools variant not run) → placeholder
      const empty = sel.metric === 'both' ? (row.value == null && row.value2 == null) : (row.value == null);
      if (empty || row.n < minN) placeholderRows.push({ ...base, placeholder: 'No data yet' });
      else dataRows.push(row);
    }

    if (sel.metric === 'accuracy' || sel.metric === 'confidence' || sel.metric === 'right')
      dataRows.sort((a, b) => b.value - a.value);              // higher is better → best first
    else if (sel.metric === 'both')
      dataRows.sort((a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1));
    else                                                       // gap (signed & rms): best calibrated first
      dataRows.sort((a, b) => a.value - b.value);

    return [...dataRows, ...placeholderRows];                  // placeholders parked at the end
  }

  /* ---- accuracy/confidence table (per-sample, optional scout filter) ---- */
  // One row per model that has data (roster has_data). accuracy% + confidence% over the
  // no_tools (merged, retrospective) samples of the selected domain(s). scouts=false drops
  // the scout samples (item index ≤ 10), leaving only the held-out band samples — which
  // shifts accuracy. 'No data' when a model has nothing for the selection (e.g. Fable in a
  // domain it never ran). New models appear automatically via the roster.
  // The 3 consecutive levels whose mean accuracy is closest to 50% (tie → lower start).
  // Mirrors results/scripts/select_band.py. `lacc` is {level: acc%}.
  function pickBand(lacc) {
    const levels = Object.keys(lacc).map(Number).sort((a, b) => a - b);
    let best = null, bestKey = null;
    for (const start of levels) {
      const w = [start, start + 1, start + 2];
      if (w.some(l => !(l in lacc))) continue;
      const mean = w.reduce((s, l) => s + lacc[l], 0) / 3;
      const key = [Math.round(Math.abs(mean - 50) * 1e6), start];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { bestKey = key; best = w; }
    }
    return best;
  }

  // effort: 'low' (default) or 'high' — which reasoning arm's run supplies every column.
  async function tableRows({ domain, scouts, earlyStop, effort }) {
    const doms = domain === 'overall' ? index.domains.map(d => d.name) : [domain];
    const answerVariant = variants({ effort }).answer;
    // A model belongs to the high arm in one of TWO ways, and they store data differently:
    // a separate high-effort re-run (real_runs_high/ → the no_tools_high variant), or a model
    // whose ONLY run is already max-effort because its reasoning can't be lowered (Kimi K3),
    // which lives in the ordinary no_tools variant. Fall back for the second kind, or its row
    // fetches a file that was never written and renders as "No data".
    // n_done > 0, not mere existence: the export writes an all-unfinished no_tools_high cell for
    // every model, so a truthy cell proves nothing.
    const hasHighVariant = m => doms.some(d => (cell(m, d, 'no_tools_high')?.n_done || 0) > 0);
    // Same test for the PROSPECTIVE high arm. Until that run exists the high row borrows the low
    // arm's prospective (see tableRowsAll); once real no_tools_confidence_high logs land, the
    // borrow stops on its own and each arm scores its own before-answering measurement.
    const hasHighConf = m => doms.some(d => (cell(m, d, 'no_tools_confidence_high')?.n_done || 0) > 0);
    const rows = [];
    for (const rm of roster()) {
      if (!rm.has_data) continue;
      // Only score a model on an arm it was actually RUN at, in both directions: without this,
      // the high arm invents rows for low-only models and the low arm invents them for Kimi K3,
      // whose reasoning is mandatory-max and has no low run. The fetch would return an empty
      // task list and the row would render as a data-less placeholder.
      if (!(rm.arms || ['low']).includes(effort || 'low')) continue;
      const m = rm.slug;
      const mVariant = effort === 'high' && !hasHighVariant(m) ? 'no_tools' : answerVariant;
      // On the high arm, prefer that model's OWN high-effort prospective run when it exists;
      // otherwise fall through to the low one (tableRowsAll's borrow marks it as reused).
      const confVariant = effort === 'high' && hasHighConf(m)
        ? 'no_tools_confidence_high' : 'no_tools_confidence';
      let accN = 0, accD = 0, confN = 0, confD = 0;
      let allD = 0;   // every answered question incl. the band widening (_011-_030)
      let costSum = 0, tSum = 0, tN = 0, tMin = Infinity, tMax = -Infinity;
      let crN = 0, crD = 0, crSq = 0, cwN = 0, cwD = 0, cwSq = 0;   // confidence when right / wrong (+ sum of squares for SE)
      let rmsSq = 0, rmsN = 0;                                       // band RMS: pooled Σ(conf−100·correct)² over scout-band samples
      let brierSum = 0, brierSq2 = 0;                                // per-sample squared errors in 0..1 Brier units (+ Σx² for the SE)
      let brierAllSum = 0, brierAllN = 0;                            // Brier over EVERY answered scout sample (no band filter)
      let prosSq = 0, prosN = 0, prosSq2 = 0;                        // PROSPECTIVE Brier: forecast-before-solving vs the merged run's outcome (+Σx² for the SE)
      const domAcc = [];   // early-stop accuracy: per-domain mean over the 8 levels, dropped tail = 0%
      // Early stop needs per-level accuracy to locate the zero, so it never applies to
      // extrapolated models (too few samples per level).
      const stopEarly = !!earlyStop && !rm.extrapolated;
      for (const d of doms) {
        // Text-only models have no image-domain files at all — skip the fetch (a 404 is
        // handled, but it costs a round trip and noise in the console on every load).
        if (rm.text_only && imageDomainSet().has(d)) continue;
        const tasks = await loadTasks(m, d, mVariant);
        // levelHits/domScout: scout only (per-level accuracy + band pick). domAll: scout plus
        // the band-widening items, used for the band RMS and the total sample count.
        const levelHits = {}, domScout = [], domAll = [];
        for (const t of tasks) {
          if (t.status !== 'done' || t.score == null) continue;
          // SCOUT (_001-_010, all 8 levels) vs the band widening (_011-_030, band levels only).
          // Accuracy/confidence columns and the band PICK use scout alone so every level carries
          // the same n; the band RMS below pools both, because more samples at the band levels is
          // exactly what the widening is for. `scout` comes from the export; the id parse is a
          // fallback for data written before that field existed.
          const isScout = t.scout != null
            ? t.scout : parseInt(String(t.id).split('_').pop(), 10) <= 10;
          domAll.push(t);
          if (!isScout) continue;
          (levelHits[t.difficulty] ??= []).push(t.score * 100);
          domScout.push(t);
        }
        const lacc = {}; for (const l in levelHits) lacc[l] = levelHits[l].reduce((a, b) => a + b, 0) / levelHits[l].length;
        // Early stop: the run halts at the FIRST level where the model scores 0% — deeper levels
        // are dropped from every column and counted as 0% accuracy (the run never reaches them).
        let stop = null;
        if (stopEarly)
          for (const l of Object.keys(lacc).map(Number).sort((a, b) => a - b))
            if (lacc[l] === 0) { stop = l; break; }
        const kept = stop == null ? domScout : domScout.filter(t => t.difficulty <= stop);
        for (const t of kept) {
          accN += t.score * 100; accD++;
          if (t.confidence_mean != null) {
            confN += t.confidence_mean; confD++;
            if (t.score >= 0.5) { crN += t.confidence_mean; crD++; crSq += t.confidence_mean ** 2; }
            else                { cwN += t.confidence_mean; cwD++; cwSq += t.confidence_mean ** 2; }
            brierAllSum += ((t.confidence_mean - 100 * t.score) / 100) ** 2; brierAllN++;
          }
          if (t.cost_usd != null) costSum += t.cost_usd;
          if (t.time_seconds != null) {
            tSum += t.time_seconds; tN++;
            if (t.time_seconds < tMin) tMin = t.time_seconds;
            if (t.time_seconds > tMax) tMax = t.time_seconds;
          }
        }
        // Plus the money billed on attempts that never produced a usable answer for this arm
        // (truncations, filter blocks, empty replies — from the export's cost_failed_usd).
        // Real spend, so it belongs in the run's total even though no task shows for it.
        costSum += cell(m, d, mVariant)?.cost_failed_usd || 0;
        // Early-stop accuracy is a per-LEVEL mean so the dropped tail counts as 0% instead of
        // silently inflating the score (a sample-mean over kept tasks would jump ~4pts).
        if (stopEarly && domScout.length) {
          const per = [];
          for (let l = 1; l <= 8; l++) {
            if (stop != null && l > stop) per.push(0);
            else if (l in lacc) per.push(lacc[l]);
          }
          if (per.length) domAcc.push(per.reduce((a, b) => a + b, 0) / per.length);
        }
        allD += domAll.length;
        // RMS over the 3 consecutive scout levels nearest 50% accuracy (this domain's band —
        // always at/below the first zero level, so early stop never moves it). Pools domAll, so
        // the band-widening items (_011-_030) count here: same questions, same 3 levels, 3x the n.
        const band = pickBand(lacc);
        if (band) for (const t of domAll) {
          if (band.includes(t.difficulty) && t.confidence_mean != null) {
            rmsSq += (t.confidence_mean - 100 * t.score) ** 2; rmsN++;
            const x = ((t.confidence_mean - 100 * t.score) / 100) ** 2;
            brierSum += x; brierSq2 += x * x;
          }
        }
        // PROSPECTIVE Brier — the confidence-only arm forecasts BEFORE solving, so it has no
        // outcome of its own: each forecast is scored against whether the model got that same
        // question right in the merged run (paired by id), over the same band.
        if (band) {
          const outcome = {};
          for (const t of domAll) outcome[t.id] = t.score;
          for (const c of await loadProspective(m, d, confVariant)) {
            if (!band.includes(c.difficulty) || c.confidence == null) continue;
            const got = outcome[c.id];
            if (got == null) continue;
            const px = (c.confidence / 100 - got) ** 2;
            prosSq += px; prosSq2 += px * px; prosN++;
          }
        }
      }
      const accuracy = stopEarly
        ? (domAcc.length ? domAcc.reduce((a, b) => a + b, 0) / domAcc.length : null)
        : (accD ? accN / accD : null);
      const confidence = confD ? confN / confD : null;
      // standard errors (in percentage points): binomial SE for the accuracy proportion,
      // SE of the mean (sample std / √n) for the confidence columns.
      const pp = accuracy != null ? accuracy / 100 : null;
      const accuracySe = (accD > 0 && pp != null) ? Math.sqrt(pp * (1 - pp) / accD) * 100 : null;
      const seMean = (sum, sumsq, nn) => {
        if (nn <= 1) return 0;
        const mean = sum / nn;
        const variance = Math.max((sumsq - nn * mean * mean) / (nn - 1), 0);
        return Math.sqrt(variance / nn);
      };
      rows.push({
        slug: m, display: display(m), color: providerColor(m), extrapolated: !!rm.extrapolated,
        textOnly: !!rm.text_only,
        note: rm.note || null,
        reasoning: rm.reasoning || null,
        arms: rm.arms || ['low'],
        accuracy, confidence, accuracySe,
        n: accD, nAll: allD,
        costTotal: costSum, costAvg: accD ? costSum / accD : null,
        // How many scout questions this arm COULD have answered (8 levels x 10 items per domain
        // it runs; image domains dropped for text-only models). Lets a consumer see that a run
        // is partial — which matters most for cost, since a run that didn't finish is cheaper.
        nExpected: doms.filter(d => !(rm.text_only && imageDomainSet().has(d))).length * 80,
        // What a COMPLETE run is for this model: 140 per domain it can run — 80 scout (8 levels
        // x 10) plus 60 band widening (3 band levels x 20). 1400 for a model that runs all ten
        // domains, 980 for a text-only one that skips the three image domains. Kept separate from
        // nExpected above, which is scout-only and drives the chart's "partial run" caveat: a
        // model that finished its scout but hasn't been widened is not a partial run in that sense.
        nExpectedFull: doms.filter(d => !(rm.text_only && imageDomainSet().has(d))).length * 140,
        timeAvg: tN ? tSum / tN : null, timeMin: tN ? tMin : null, timeMax: tN ? tMax : null,
        confRight: crD ? crN / crD : null, confRightSe: crD ? seMean(crN, crSq, crD) : null, nRight: crD,
        confWrong: cwD ? cwN / cwD : null, confWrongSe: cwD ? seMean(cwN, cwSq, cwD) : null, nWrong: cwD,
        bandRms: rmsN ? Math.sqrt(rmsSq / rmsN) : null, bandN: rmsN,
        // What a COMPLETE band is for this model: 90 per domain on the LOW arm (3 band
        // levels x 30 — the 10 scouts that located the band plus the 20 widening items;
        // 900 across ten domains, 630 text-only) but only 30 per domain on the HIGH arm,
        // which runs the scout band alone with no widening (300 / 210).
        bandNExpected: doms.filter(d => !(rm.text_only && imageDomainSet().has(d))).length
          * (effort === 'high' ? 30 : 90),
        prosBrier: prosN ? prosSq / prosN : null, prosN,
        // Which arm's forecasts produced prosBrier. 'low' on a HIGH row means no high-effort
        // prospective run exists, so loadProspective fell back to the low file — that pairs a
        // low-effort forecast against high-effort outcomes, which is the confound the borrow in
        // tableRowsAll replaces. Only a 'high' value is a real high-arm measurement.
        prosArm: confVariant === 'no_tools_confidence_high' ? 'high' : 'low',
        prosBrierSe: prosN ? seMean(prosSq, prosSq2, prosN) : null,
        // HEADLINE: the mean of the two Brier scores (before answering + after), 0-100.
        // Deliberately excludes accuracy — the band already judges every model at the edge
        // of its own ability. Falls back to whichever arm exists if only one has run.
        ...(() => {
          const after = rmsN ? (Math.sqrt(rmsSq / rmsN) / 100) ** 2 : null;
          const before = prosN ? prosSq / prosN : null;
          const parts = [after, before].filter(v => v != null);
          if (!parts.length) return { score: null, scoreSe: null };
          const aSe = rmsN ? seMean(brierSum, brierSq2, rmsN) : null;
          const bSe = prosN ? seMean(prosSq, prosSq2, prosN) : null;
          const ses = [after != null ? aSe : null, before != null ? bSe : null].filter(v => v != null);
          const se = ses.length ? Math.sqrt(ses.reduce((s, x) => s + x * x, 0)) / ses.length : null;
          return { score: 100 * parts.reduce((s, x) => s + x, 0) / parts.length,
                   scoreSe: se != null ? 100 * se : null, scoreArms: parts.length };
        })(),
        brierSe: rmsN ? seMean(brierSum, brierSq2, rmsN) : null,
        brierAll: brierAllN ? brierAllSum / brierAllN : null,
        placeholder: accD ? null
          : (rm.text_only && domain !== 'overall' && imageDomainSet().has(domain)
             ? 'Model does not support images' : 'No data'),
      });
    }
    // extrapolated models (e.g. Fable) always render first; then lowest RMS (best calibrated) first, No-data last
    rows.sort((a, b) => {
      if (!!a.extrapolated !== !!b.extrapolated) return a.extrapolated ? -1 : 1;
      return (a.bandRms ?? Infinity) - (b.bandRms ?? Infinity);
    });
    return rows;
  }

  // One row per (model, reasoning arm) — a model run at both efforts appears twice, tagged by
  // `arm`, so the single table can rank low- and high-effort runs against each other instead of
  // hiding half of them behind a toggle. Each arm is scored from its own run; the per-arm guard
  // in tableRows() means a model only appears on arms it was actually run at.
  async function tableRowsAll(opts) {
    const perArm = await Promise.all(['low', 'high'].map(async arm =>
      (await tableRows({ ...opts, effort: arm })).map(r => ({ ...r, arm }))));
    const rows = perArm.flat();

    // The prospective ("before answering") half of the headline has no high-effort run yet —
    // the confidence-only eval has only ever been run at low effort. Recomputing it on a high
    // row pairs a LOW-effort forecast with HIGH-effort outcomes over a band the high run moved,
    // which is not a measurement of anything: it made Opus 5 look worse at high effort (0.273 →
    // 0.354) purely because high effort raised its accuracy past what the low forecast expected.
    // Until the high-effort forecast arm runs, a high row simply CARRIES OVER its model's
    // low-arm prospective number, and `prosFromLowArm` marks it as borrowed.
    const lowBySlug = {};
    for (const r of rows) if (r.arm === 'low') lowBySlug[r.slug] = r;
    for (const r of rows) {
      if (r.arm !== 'high') continue;
      // A high row that scored its OWN high-effort prospective run keeps it. Testing prosBrier
      // alone is NOT enough: with no high-effort run, loadProspective falls back to the low file
      // and produces a value by pairing low-effort forecasts against high-effort outcomes — the
      // crossed comparison this borrow exists to avoid. Only prosArm === 'high' is a real one.
      if (r.prosArm === 'high' && r.prosBrier != null && r.prosN > 0) continue;
      const lo = lowBySlug[r.slug];
      if (!lo || lo.prosBrier == null) continue;
      r.prosBrier = lo.prosBrier;
      r.prosN = lo.prosN;
      r.prosBrierSe = lo.prosBrierSe;
      r.prosFromLowArm = true;
      const after = r.bandRms != null ? (r.bandRms / 100) ** 2 : null;
      const parts = [after, r.prosBrier].filter(v => v != null);
      const ses = [after != null ? r.brierSe : null, r.prosBrierSe].filter(v => v != null);
      r.score = parts.length ? 100 * parts.reduce((s, x) => s + x, 0) / parts.length : null;
      r.scoreSe = ses.length
        ? 100 * Math.sqrt(ses.reduce((s, x) => s + x * x, 0)) / ses.length : null;
      r.scoreArms = parts.length;
    }
    return rows.sort((a, b) => {
      if (!!a.extrapolated !== !!b.extrapolated) return a.extrapolated ? -1 : 1;
      return (a.bandRms ?? Infinity) - (b.bandRms ?? Infinity);
    });
  }

  // Per-level curve for one (model, domain): scout samples, no_tools variant. Returns the
  // per-level accuracy/confidence points plus the 3-level transition band (accuracy closest
  // to 50%), that band's mean accuracy, and the RMS confidence error pooled over its samples.
  async function levelCurve(model, domain) {
    // 'overall' pools every domain's samples at each level — same raw pooling the table's
    // overall accuracy uses, so the two agree. A text-only model simply contributes the
    // domains it can run.
    const doms = domain === 'overall'
      ? (() => {
          const textOnly = !!(roster().find(r => r.slug === model) || {}).text_only;
          const img = imageDomainSet();
          return index.domains.map(d => d.name).filter(d => !(textOnly && img.has(d)));
        })()
      : [domain];
    const byLevel = {};
    for (const d of doms) {
      for (const t of await loadTasks(model, d, 'no_tools')) {
        if (t.status !== 'done' || t.score == null) continue;
        const item = parseInt(String(t.id).split('_').pop(), 10);
        if (item > 10) continue;                     // scout samples only, same as the table
        (byLevel[t.difficulty] ??= []).push(t);
      }
    }
    const levels = [], lacc = {};
    for (let l = 1; l <= 8; l++) {
      const ts = byLevel[l];
      if (!ts) continue;
      const acc = ts.reduce((s, t) => s + t.score * 100, 0) / ts.length;
      lacc[l] = acc;
      const confs = ts.filter(t => t.confidence_mean != null).map(t => t.confidence_mean);
      levels.push({
        level: l, acc, n: ts.length,
        conf: confs.length ? confs.reduce((s, v) => s + v, 0) / confs.length : null,
        confMin: confs.length ? Math.min(...confs) : null,
        confMax: confs.length ? Math.max(...confs) : null,
      });
    }
    const band = pickBand(lacc);
    let rms = null, rmsN = 0, bandAcc = null;
    if (band) {
      let sq = 0;
      for (const l of band) for (const t of byLevel[l] || []) {
        if (t.confidence_mean != null) { sq += (t.confidence_mean - 100 * t.score) ** 2; rmsN++; }
      }
      rms = rmsN ? Math.sqrt(sq / rmsN) : null;
      bandAcc = band.reduce((s, l) => s + lacc[l], 0) / band.length;
    }
    // Prospective (asked before answering) confidence — only ever run over the band, so it
    // attaches to those levels alone and the curve is drawn as a short overlay there.
    if (band && doms.length === 1) {          // prospective is per-domain; skip for Overall
      const byPros = {};
      for (const d of doms) {
        for (const c of await loadProspective(model, d)) {
          if (!band.includes(c.difficulty) || c.confidence == null) continue;
          (byPros[c.difficulty] ??= []).push(c.confidence);
        }
      }
      for (const pt of levels) {
        const v = byPros[pt.level];
        if (v && v.length) {
          pt.pros = v.reduce((s, x) => s + x, 0) / v.length;
          pt.prosN = v.length;
        }
      }
    }
    return { levels, band, rms, rmsN, bandAcc };
  }

  // Every scout (confidence, correct) pair for one model over a domain or 'overall' —
  // the raw samples behind the calibration curve. no_tools variant, scout filter as the table.
  async function samplePairs(model, domain) {
    const doms = domain === 'overall'
      ? (() => {
          const textOnly = !!(roster().find(r => r.slug === model) || {}).text_only;
          const img = imageDomainSet();
          return index.domains.map(d => d.name).filter(d => !(textOnly && img.has(d)));
        })()
      : [domain];
    const out = [];
    for (const d of doms) {
      const tasks = await loadTasks(model, d, 'no_tools');
      for (const t of tasks) {
        if (t.status !== 'done' || t.score == null || t.confidence_mean == null) continue;
        const item = parseInt(String(t.id).split('_').pop(), 10);
        if (item > 10) continue;                     // scout samples only, same as the table
        out.push({ conf: t.confidence_mean, correct: t.score >= 0.5 ? 1 : 0 });
      }
    }
    return out;
  }

  // ARE-YOU-SURE ablation join for one model: every challenged answer paired with the same
  // question's original low-arm answer, by sample id, across all domains. Before = the
  // original merged run; after = the reply to "Are you sure?". Null when the model has no
  // ablation data (only a few models have been run).
  async function areYouSure(model, variant = 'no_tools_are_you_sure', opts = {}) {
    const doms = index.domains.map(d => d.name);
    // The grid already says which (model, domain) cells have ablation data — consult it
    // instead of fetching ~180 variant files (most empty or absent) on every page load.
    if (!doms.some(d => cell(model, d, variant)?.n_done)) return null;
    let n = 0, accB = 0, accA = 0, brB = 0, brA = 0, confB = 0, confA = 0, flips = 0;
    // per-pair values, kept for standard errors and paired deltas
    const pairBrB = [], pairBrA = [], pairAccB = [], pairAccA = [];
    for (const d of doms) {
      if (!cell(model, d, variant)?.n_done) continue;
      let after;
      try { after = await loadTasks(model, d, variant); }
      catch { continue; }
      const before = await loadTasks(model, d, 'no_tools');
      // opts.band: keep only this domain's difficulty band (the 3 consecutive levels whose
      // scout accuracy is nearest 50%, same pick as the headline table). Used by ablations
      // that re-ran ALL levels (brier_told), so their tables read on the same scale as the
      // replay ablations, whose pairs are band-only by construction.
      let band = null;
      if (opts.band) {
        const lacc = {};
        for (let l = 1; l <= 8; l++) {
          const rows = before.filter(t => t.status === 'done' && t.score != null
            && t.difficulty === l && parseInt(String(t.id).split('_').pop(), 10) <= 10);
          if (rows.length) lacc[l] = 100 * rows.reduce((s2, t) => s2 + t.score, 0) / rows.length;
        }
        band = pickBand(lacc);
      }
      const byId = {};
      for (const t of before)
        if (t.status === 'done' && t.score != null && t.confidence_mean != null) byId[t.id] = t;
      for (const t of after) {
        if (t.status !== 'done' || t.score == null || t.confidence_mean == null) continue;
        if (band && !band.includes(t.difficulty)) continue;
        const b = byId[t.id];
        if (!b) continue;
        n++;
        accB += b.score * 100; accA += t.score * 100;
        const sqB = ((b.confidence_mean - 100 * b.score) / 100) ** 2;
        const sqA = ((t.confidence_mean - 100 * t.score) / 100) ** 2;
        brB += sqB; brA += sqA;
        pairBrB.push(sqB); pairBrA.push(sqA);
        pairAccB.push(b.score); pairAccA.push(t.score);
        confB += b.confidence_mean; confA += t.confidence_mean;
        if ((b.score >= 0.5) !== (t.score >= 0.5)) flips++;
      }
    }
    if (!n) return null;
    const seMean = arr => {
      if (arr.length <= 1) return 0;
      const m = arr.reduce((x, y) => x + y, 0) / arr.length;
      const v = arr.reduce((x, y) => x + (y - m) ** 2, 0) / (arr.length - 1);
      return Math.sqrt(v / arr.length);
    };
    const dBrArr = pairBrA.map((v, i) => v - pairBrB[i]);
    const dAccArr = pairAccA.map((v, i) => v - pairAccB[i]);
    return { n, flips, accBefore: accB / n, accAfter: accA / n,
             brierBefore: brB / n, brierAfter: brA / n,
             confBefore: confB / n, confAfter: confA / n,
             brierBeforeSe: seMean(pairBrB), brierAfterSe: seMean(pairBrA),
             accBeforeSe: seMean(pairAccB) * 100, accAfterSe: seMean(pairAccA) * 100,
             // paired deltas (after minus before) with their own SEs — tighter than
             // differencing the two column SEs, because the pairing removes question noise
             dBrier: dBrArr.reduce((x, y) => x + y, 0) / n, dBrierSe: seMean(dBrArr),
             dAcc: dAccArr.reduce((x, y) => x + y, 0) / n * 100, dAccSe: seMean(dAccArr) * 100 };
  }

  // Domains that actually have any done data for the current answer/conf variant
  // (used to dim empty domain pills).
  function domainHasData(domainName, sel) {
    const { answer, conf } = variants(sel);
    return models().some(m => {
      const a = cell(m, domainName, answer);
      const c = cell(m, domainName, conf);
      return (a && a.n_done) || (c && c.n_done);
    });
  }

  return { load, models, domains, display, domainDisplay, generatedAt, series, domainHasData, variants, metaRow, tableRows, tableRowsAll, levelCurve, roster, samplePairs, providerColor, providerLogo, areYouSure };
})();

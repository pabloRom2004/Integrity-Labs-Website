/* ============================================================
   timeplot.js — the hero "Chart" view (Table ⇄ Chart tabs). One
   dot per model, y = the SAME headline band Brier the table ranks
   by (low arm, overall). The x axis is selectable (release date,
   accuracy, total run cost, estimated model size); a "Legacy models"
   toggle (default OFF) hides pre-2026 models. Provider colours,
   least-squares trend, hover tooltips (names live there only);
   hovering highlights the provider family. Release dates are
   duplicated from results/scripts/plot_overconfidence_vs_release.py
   — keep the two in sync.
   ============================================================ */

window.TimePlot = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  // view: 'bar' | 'time'; x drives the Chart scatter; order sorts the bar view
  // ('brier' | 'accuracy' | 'date'); all=false caps the bar view at the best TOP_N models
  // (legacy applies to the scatter only).
  // exclEst (model-size axis only, default off = estimates included): hide models whose
  // size is a community estimate rather than an official published figure.
  const st = { x: 'date', legacy: false, all: false, order: 'brier', view: 'bar', errbars: false, exclEst: false };
  const TOP_N = 22;
  let wired = false;

  // slug -> release date (announcement / public availability), verified 2026-07-25
  const RELEASE = {
    'gpt-3.5-turbo':          '2023-03-01',
    'gpt-4o':                 '2024-05-13',
    'gemini-3.1-pro-preview': '2026-02-19',
    'gemma-4-26b-a4b-it':     '2026-04-02',
    'qwen3.6-35b-a3b':        '2026-04-16',
    'gpt-5.5':                '2026-04-23',
    'deepseek-v4-pro':        '2026-04-24',
    'gemini-3.5-flash':       '2026-05-19',
    'claude-opus-4-8':        '2026-05-28',
    'claude-fable-5':         '2026-06-09',
    'claude-fable-5-1':       '2026-08-28',
    'glm-5.2':                '2026-06-13',
    'glm-5.3-flash':          '2026-08-26',
    'claude-sonnet-5':        '2026-06-30',
    'grok-4.5':               '2026-07-08',
    'grok-4.6':               '2026-08-12',
    'gpt-5.6-luna':           '2026-07-09',
    'gpt-5.6-terra':          '2026-07-09',
    'gpt-5.6-sol':            '2026-07-09',
    'muse-spark-1.1':         '2026-07-09',
  'muse-spark-1.2': '2026-08-05',
  'muse-spark-1.3': '2026-09-02',
    'muse-glimmer-30b':       '2026-08-10',
    'inkling':                '2026-07-15',
    'kimi-k3':                '2026-07-16',   // launch; open weights followed 2026-07-26
    'gemini-3.6-flash':       '2026-07-21',
    'gemini-3.7-flash':       '2026-08-13',
    'claude-opus-5':          '2026-07-24',
  };
  const LEGACY_CUTOFF = new Date('2026-01-01');

  // slug -> estimated parameter count: t = total (billions), a = active per token (MoE, null
  // when unknown/dense), c = the provenance tag shown in the tooltip. Researched 2026-08-17.
  // Open-weights rows are official figures (HF model cards / provider blogs). Closed rows are
  // community/analyst estimates: 'community estimate' = a circulating number with real analysis
  // behind it, 'speculative guess' = inferred here from pricing/lineage. Order-of-magnitude only.
  const PARAMS = {
    'gpt-3.5-turbo':          { t: 20,    a: null, c: 'community estimate' },  // Microsoft CodeFusion paper leak (redacted)
    'gpt-4o':                 { t: 200,   a: null, c: 'community estimate' },  // Epoch AI speed/cost analysis, stated +/-2x
    'gpt-5.5':                { t: 2000,  a: null, c: 'speculative guess' },   // viral IKP ~9.7T debunked (LessWrong correction ~1.5T, PI 256B-8.3T); InferenceBench 700B; ~2T judgment
    'gpt-5.6-sol':            { t: 4000,  a: 150,  c: 'community estimate' },  // X analyst wafer-count reasoning, 2-4T / ~150B active
    'gpt-5.6-terra':          { t: 1500,  a: 75,   c: 'speculative guess' },   // no public estimate; half Sol's pricing, same distilled family
    'gpt-5.6-luna':           { t: 400,   a: 30,   c: 'speculative guess' },   // no public estimate; nano-tier pricing (1/5 of Sol)
    'claude-opus-4-8':        { t: 5000,  a: 150,  c: 'community estimate' },  // Musk's leaked ratio -> ~5T; active from throughput reverse-engineering
    'claude-sonnet-5':        { t: 1000,  a: null, c: 'community estimate' },  // same Musk ratio (Sonnet = 1/5 Opus); press says 1-2T
    'claude-opus-5':          { t: 5000,  a: 750,  c: 'speculative guess' },   // forum "5T MoE, 500B-1T active" claim, inherited from the 4.x anchor
    'claude-fable-5':         { t: 10000, a: 1000, c: 'community estimate' },  // Mythos 5 press consensus ~10T (LifeArchitect dissents at ~6T)
    'gemini-3.1-pro-preview': { t: 2000,  a: 65,   c: 'speculative guess' },   // estimates span 1-7.5T; midpoint judgment
    'gemini-3.5-flash':       { t: 275,   a: 13,   c: 'community estimate' },  // TPU memory/throughput calc (250-300B / 10-16B), widely reported
    'gemini-3.6-flash':       { t: 275,   a: 13,   c: 'speculative guess' },   // model card says based on 3.5 Flash; its estimate carried forward
    'gemini-3.7-flash':       { t: 275,   a: 13,   c: 'speculative guess' },   // model card says based on 3.6 Flash; same base assumed
    'gemma-4-26b-a4b-it':     { t: 25.2,  a: 3.8,  c: 'official' },            // Google model card
    'deepseek-v4-pro':        { t: 1600,  a: 49,   c: 'official' },            // HF model card
    'glm-5.2':                { t: 744,   a: 40,   c: 'official' },            // Z.ai figure (HF safetensors counts 753B)
    'qwen3.6-35b-a3b':        { t: 35,    a: 3,    c: 'official' },            // Alibaba blog
    'kimi-k3':                { t: 2800,  a: 104,  c: 'official' },            // Moonshot open-weights release
    'grok-4.5':               { t: 1500,  a: null, c: 'community estimate' },  // Musk's "V9-Medium, 1.5T"; not in xAI docs, active undisclosed
    'grok-4.6':               { t: 1500,  a: null, c: 'community estimate' },  // same V9 base as 4.5 (gains are post-training, not scale)
    'muse-spark-1.1':         { t: 1000,  a: 40,   c: 'speculative guess' },   // Meta discloses nothing; open-flagship-class MoE guess from pricing
    'muse-spark-1.2':         { t: 1000,  a: 40,   c: 'speculative guess' },   // same base as 1.1 (coding-focused update, same pricing)
    'muse-spark-1.3':         { t: 1000,  a: 40,   c: 'speculative guess' },   // same pricing as 1.2 again; Meta discloses nothing
    'muse-glimmer-30b':       { t: 29.6,  a: null, c: 'official' },            // HF card: dense, incl. ~1.8B vision encoder
    'inkling':                { t: 975,   a: 41,   c: 'official' },            // Thinking Machines model card
  };

  const fmtCost = c => c >= 1 ? '$' + c.toFixed(2) : c >= 0.1 ? '$' + c.toFixed(2) : c >= 0.01 ? '$' + c.toFixed(3) : '$' + c.toFixed(4);
  const fmtDate = d => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const fmtParams = v => v >= 1000 ? (v % 1000 ? (v / 1000).toFixed(1) : v / 1000) + 'T' : v + 'B';

  /* X-axis options: val() may return null (point dropped); log = log10 scale. */
  const AXES = {
    bar:       { label: 'Bar chart',               title: 'AI models, best calibration first',
                 val: p => p.brier, fmt: v => '', phrase: 'its calibration rank' },
    date:      { label: 'Release date',            title: 'Model release date',
                 val: p => p.date.getTime(), fmt: v => '', phrase: 'its release date' },
    accuracy:  { label: 'Accuracy',                title: 'Overall accuracy (%)',
                 val: p => p.accuracy, fmt: v => Math.round(v) + '%', phrase: 'its overall accuracy' },
    // Total spend for the run, INCLUDING attempts that were billed but produced no usable
    // answer (truncations, filter blocks, empty replies — the export's cost_failed_usd, folded
    // into costTotal by data.js). Without it a run with many failed attempts plotted as
    // artificially cheap — Muse's high arm looked cheaper than its low arm.
    cost:      { label: 'Cost to run',             title: 'Total cost to run the benchmark, incl. failed attempts (list price, log scale)',
                 val: p => p.costTotal > 0 ? p.costTotal : null, fmt: fmtCost, log: true,
                 phrase: 'what the full run cost, failed attempts included' },
    // TOTAL parameter count, billions (MoE active counts live in the tooltip). By default
    // every sized model plots, closed-model community estimates included; the "Exclude
    // estimated models" pill restricts it to official published sizes (the open-weights
    // ones). Integrity-score outliers below -100 are always dropped (render()).
    params:    { label: 'Model size',              title: 'Total parameters (log scale; closed-model sizes are community estimates)',
                 titleOfficial: 'Total parameters, open-weights models only (log scale)',
                 val: p => PARAMS[p.slug] ? PARAMS[p.slug].t : null, fmt: fmtParams, log: true,
                 phrase: 'its parameter count' },
  };

  /* ---- shared tooltip (same element + classes as the table), centred just above the cursor ---- */
  const tipEl = document.getElementById('tooltip');
  function showTip(html, e) {
    tipEl.innerHTML = html; tipEl.hidden = false;
    const pad = 12, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = e.clientX - w / 2, y = e.clientY - h - pad;
    if (y < 8) y = e.clientY + pad;   // no room above → flip below
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  const hideTip = () => { tipEl.hidden = true; };

  function el(tag, attrs = {}, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  /* "nice" ticks for a linear range; {1,2,5}×10^k ticks for a log range */
  function linTicks(lo, hi, want = 5) {
    const span = hi - lo || 1;
    const step0 = span / want, mag = 10 ** Math.floor(Math.log10(step0));
    const step = [1, 2, 5, 10].map(m => m * mag).find(s => span / s <= want) || 10 * mag;
    const t = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) t.push(v);
    return t;
  }
  function logTicks(lo, hi) {
    const t = [];
    for (let k = Math.floor(Math.log10(lo)); k <= Math.ceil(Math.log10(hi)); k++)
      for (const m of [1, 2, 5]) { const v = m * 10 ** k; if (v >= lo * 0.99 && v <= hi * 1.01) t.push(v); }
    return t;
  }
  function dateTicks(t0, t1) {
    const months = (t1 - t0) / (1000 * 60 * 60 * 24 * 30.44);
    const every = months <= 9 ? 1 : 6;                       // monthly when zoomed to 2026, else Jan+Jul
    const d0 = new Date(t0); d0.setDate(1);
    const out = [];
    for (const d = new Date(d0); d.getTime() <= t1; d.setMonth(d.getMonth() + 1)) {
      if (every === 1 || d.getMonth() % 6 === 0) out.push(new Date(d));
    }
    return out.filter(d => d.getTime() >= t0);
  }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /* The "New" pill drawn on the bar chart: a dark rounded rect + white text, centred on cx
     with its MIDDLE at yMid. Mirrors the table's .m-new badge and bake_chart's version. */
  function newBadge(cx, yMid) {
    const w = 24, h = 10.5;   // 20% smaller than the table badge
    const g = el('g', { class: 'lp-new' });
    g.appendChild(el('rect', { x: cx - w / 2, y: yMid - h / 2, width: w, height: h, rx: 4,
      class: 'lp-new-box' }));
    g.appendChild(el('text', { x: cx, y: yMid + 2.9, 'text-anchor': 'middle', class: 'lp-new-text' }, 'NEW'));
    return g;
  }

  /* ---- render ---- */
  async function render() {
    const mount = document.getElementById('time-plot-mount');
    if (!mount) return;
    if (!mount.querySelector('svg')) mount.innerHTML = '<div class="table-loading">Loading…</div>';

    // Same selection as the table: overall, scouts included, EVERY (model, arm) row. A model
    // run at both efforts contributes two points joined by a dotted line, so the segment is the
    // effect of more reasoning on calibration; a model run at only one effort is a lone point
    // (Kimi K3 is high-only — its reasoning cannot be lowered).
    const mode = st.view === 'bar' ? 'bar' : st.x;
    const ax = AXES[mode];
    // the "Exclude estimated models" pill only makes sense on the model-size axis
    const exWrap = document.getElementById('tp-exclest-wrap');
    if (exWrap) exWrap.hidden = mode !== 'params';
    const toPt = r => ({ ...r, date: new Date(RELEASE[r.slug]), brier: (r.bandRms / 100) ** 2,
                     integrity: 100 - 400 * (r.bandRms / 100) ** 2 });
    let pts = (await Data.tableRowsAll({ domain: 'overall', scouts: true }))
      .filter(r => !r.placeholder && r.bandRms != null && RELEASE[r.slug]).map(toPt);
    // The scatter hides legacy models behind its toggle; the bar view instead shows the best
    // TOP_N models (by Brier) unless "Include all models" is on.
    if (mode !== 'bar' && !st.legacy) pts = pts.filter(p => p.date >= LEGACY_CUTOFF);
    // The bar chart and the release-date/model-size axes show the LOW arm only, matching the
    // table — mixing arms on those views made the results confusing (and both arms share one
    // size, so they'd stack vertically). The accuracy and cost axes separate the arms on
    // their own, so both are shown there, joined by a dotted link.
    if (mode === 'bar' || mode === 'date' || mode === 'params') pts = pts.filter(p => p.arm !== 'high');
    // Model-size axis: drop Integrity-score outliers below -100; the "Exclude estimated
    // models" pill further restricts to official published sizes (= the open-weights models).
    if (mode === 'params')
      pts = pts.filter(p => PARAMS[p.slug] && p.integrity >= -100
        && (!st.exclEst || PARAMS[p.slug].c === 'official'));
    pts = pts.filter(p => ax.val(p) != null).sort((a, b) => ax.val(a) - ax.val(b));
    if (mode === 'bar' && !st.all) pts = pts.slice(0, TOP_N);   // already brier-sorted asc
    if (!pts.length) { mount.innerHTML = '<div class="plot-empty">No data for this selection.</div>'; return; }
    const highBySlug = {};
    for (const p of pts) if (p.arm === 'high') highBySlug[p.slug] = p;
    const lowBySlug = {};
    for (const p of pts) if (p.arm === 'low') lowBySlug[p.slug] = p;

    // geometry — viewBox units; scales responsively like the level plot. Bar mode carries
    // per-model logo + name labels under the axis, so it gets a deeper bottom margin.
    const W = 860, mL = 84, mR = 20, mT = 16, mB = mode === 'bar' ? 151 : 72;
    const H = 398 + mT + mB;
    const iw = W - mL - mR, ih = H - mT - mB;
    const scale = v => ax.log ? Math.log10(v) : v;
    // The range spans BOTH arms: a high run has its own accuracy and its own cost, and fitting
    // the axis to the low arm alone pushed those points off the right edge of the plot.
    const xs = pts.map(p => scale(ax.val(p)));
    let lo = Math.min(...xs), hi = Math.max(...xs);
    const pad = (hi - lo || 1) * 0.05; lo -= pad; hi += pad;
    const X = v => mL + (((ax.log ? Math.log10(v) : v) - lo) / (hi - lo)) * iw;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'level-plot-svg', role: 'img' });

    // The bar view's Order-by control can change what the y axis means: 'accuracy' shows
    // accuracy bars on a 0-100% axis. Everything else shows the Integrity (BSS) score,
    // where 100 is perfect, 0 is the coin-flip hedger and NEGATIVE scores (worse than a
    // coin flip) hang below the zero line.
    const accOrder = mode === 'bar' && st.order === 'accuracy';
    const yHi = 100;   // the top anchor: kept at 100 so the headroom above today's best shows
    // floor: ~8 score-units of breathing room under the worst bar (its value label sits
    // below the bar tip), rounded down to a 5-step so the floor never lands on the label
    const yLo = accOrder ? 0
      : Math.min(0, Math.floor((Math.min(...pts.map(p => p.integrity)) - 8) / 5) * 5);
    const Y = v => mT + ((yHi - v) / (yHi - yLo)) * ih;

    // gridlines + y labels (Integrity score, or % when the axis is accuracy)
    for (const v of linTicks(yLo, yHi, 6)) {
      svg.appendChild(el('line', { x1: mL, y1: Y(v), x2: W - mR, y2: Y(v), class: 'lp-grid' }));
      svg.appendChild(el('text', { x: mL - 8, y: Y(v) + 4, class: 'lp-axis', 'text-anchor': 'end' },
        accOrder ? v + '%' : String(v)));
    }
    // the coin-flip baseline: emphasised in the bar view only (bars hang from it); the
    // scatter keeps the plain gridline linTicks already draws at zero
    if (yLo < 0 && mode === 'bar')
      svg.appendChild(el('line', { x1: mL, y1: Y(0), x2: W - mR, y2: Y(0), class: 'lp-grid-50' }));
    // x ticks
    if (mode === 'date') {
      for (const d of dateTicks(lo, hi)) {
        const lbl = MONTHS[d.getMonth()] + ' ' + d.getFullYear();
        svg.appendChild(el('text', { x: X(d.getTime()), y: H - mB + 24, class: 'lp-axis', 'text-anchor': 'middle' }, lbl));
      }
    } else if (mode !== 'bar') {
      const ticks = ax.log ? logTicks(10 ** lo, 10 ** hi) : linTicks(lo, hi);
      for (const v of ticks)
        svg.appendChild(el('text', { x: X(v), y: H - mB + 24, class: 'lp-axis', 'text-anchor': 'middle' }, ax.fmt(v)));
    }
    if (mode !== 'bar')
      svg.appendChild(el('text', { x: mL + iw / 2, y: H - 8, class: 'lp-axis lp-axis-title', 'text-anchor': 'middle' },
        mode === 'params' && st.exclEst ? ax.titleOfficial : ax.title));
    // y-axis title, rotated up the left edge — follows what the bars are showing
    const yTitle = accOrder ? 'Accuracy (%)' : 'Integrity Score';
    const ySub = accOrder ? '(higher is better)' : '(higher means more calibrated)';
    const yt = el('text', { x: 0, y: 0, class: 'lp-axis lp-axis-title', 'text-anchor': 'middle',
      transform: `translate(16 ${mT + ih / 2}) rotate(-90)` }, yTitle);
    svg.appendChild(yt);
    svg.appendChild(el('text', { x: 0, y: 0, class: 'lp-axis lp-y-sub', 'text-anchor': 'middle',
      transform: `translate(30 ${mT + ih / 2}) rotate(-90)` }, ySub));

    // least-squares trend in x-scale space (log space for the cost axis); not on the bar chart
    if (mode !== 'bar' && pts.length > 2) {
      const ys = pts.map(p => p.integrity);
      const n = pts.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
      const sxy = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0);
      const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
      const syy = ys.reduce((a, y) => a + (y - my) ** 2, 0);
      if (sxx > 0 && syy > 0) {
        const slope = sxy / sxx, r = sxy / Math.sqrt(sxx * syy);
        const y0 = my + slope * (Math.min(...xs) - mx), y1 = my + slope * (Math.max(...xs) - mx);
        const px = v => mL + ((v - lo) / (hi - lo)) * iw;
        svg.appendChild(el('line', {
          x1: px(Math.min(...xs)), y1: Y(y0), x2: px(Math.max(...xs)), y2: Y(y1),
          stroke: '#C6B79F', 'stroke-width': 2.5, 'stroke-dasharray': '8 6',
        }));
      }
    }

    // dots + tooltips; hovering one highlights its provider family, fades the rest
    const dots = [];
    const highlight = color => {
      for (const { node, fill } of dots)
        node.style.opacity = color == null || fill === color ? '1' : '0.22';
    };
    // Both arms get the SAME tooltip fields, distinguished only by the effort tag. EVERY model
    // is tagged, not just the ones with two arms: the chart mixes arms, and a reader comparing
    // an off-reasoning model against a high-reasoning one needs to see that from the tooltip.
    // The label is the model's own (off / low / high / max — Kimi is mandatory-max, GLM and
    // Qwen have no low setting so their low arm is thinking OFF), not the arm's name.
    const tipFor = (pt) => {
      const effort = (pt.reasoning && pt.reasoning[pt.arm]) || pt.arm;
      const pr = PARAMS[pt.slug];
      const xRow = mode === 'params' && pr
        ? `<div class="tt-row">Size: <b>${fmtParams(pr.t)}${pr.a && pr.a !== pr.t ? ' total, ' + fmtParams(pr.a) + ' active' : ''}</b> (${pr.c})</div>`
        : mode === 'bar' || mode === 'date' || mode === 'accuracy' ? ''
        : `<div class="tt-row">${ax.label}: <b>${ax.fmt(ax.val(pt))}</b></div>`;
      // A run that didn't finish is CHEAPER in total, because the attempts that returned nothing
      // were never billed (verified against provider records). On the cost axis that reads as
      // "more reasoning was cheaper", so say plainly why the total is low.
      // Only a MATERIAL shortfall is worth a caveat (>5% of the bank missing). A low arm that
      // dropped 2 of 800 to a filter block isn't a partial run in any meaningful sense.
      const partial = pt.nExpected && pt.n < pt.nExpected * 0.95;
      const cov = partial
        ? `<div class="tt-row">Coverage: <b>${pt.n} of ${pt.nExpected}</b> questions</div>` : '';
      const costCaveat = partial && mode === 'cost'
        ? '<div class="tt-warn">Partial run: the questions it never answered were not billed, so '
          + 'this total is lower than a complete run at the same effort would be.</div>' : '';
      // The Brier rests on the BAND questions (3 levels x 30 per domain = 900 over ten
      // domains, 630 for a text-only model), not the scout count — show that denominator
      // in its own footer section, and flag loudly when the model couldn't run all of them.
      // Per-model causes for the missing questions (excluded, never guessed) — keep these in
      // step with MODEL_NOTES in export_site_data.py, which carries the full table version.
      const MISSING_WHY = {
        'claude-opus-5':      "All code-trace questions hit Anthropic's safety filter; a few more thought past the output cap.",
        'claude-fable-5':     "Blocked by Anthropic's safety filter on some questions; others thought past the output cap.",
        'claude-sonnet-5':    "A few answers lost to Anthropic's safety filter or the output cap.",
        'kimi-k3':            'Some answers never arrived (dropped provider streams).',
        'muse-spark-1.1':     'A few answers never arrived (hung provider streams).',
        'muse-spark-1.2':     'Some answers never arrived (hung provider streams).',
        'muse-spark-1.3':     'Some answers never arrived (hung provider streams).',
        'gemini-3.5-flash':   "A few answers were discarded by Google's batch API.",
        'gemma-4-26b-a4b-it': 'Frequently returns unparseable answers.',
        'glm-5.2':            'Some questions returned no parseable answer.',
        'glm-5.3-flash':      'The provider ended the stream without an answer whenever it reasoned for a long time, so the missing questions are the hardest ones.',
        'qwen3.6-35b-a3b':    'Some questions returned no parseable answer.',
        'gpt-3.5-turbo':      'A few questions returned no parseable answer.',
      };
      const textOnlyNote = pt.textOnly
        ? `<div class="tt-warn">Not the full ${pt.arm === 'high' ? 300 : 900}: this model is text-only, and the image-based questions don't apply.</div>` : '';
      const highNote = pt.arm === 'high'
        ? '<div class="tt-warn">High-effort runs cover the 10 scout questions per band level only (30 per domain), without the extra 20-question widening the low arm gets.</div>' : '';
      const foot = pt.bandN != null && pt.bandNExpected
        ? `<div class="tt-foot"><div class="tt-row"><b>${pt.bandN} of ${pt.bandNExpected}</b> questions</div>`
          + textOnlyNote
          + (pt.bandN < pt.bandNExpected
            ? `<div class="tt-warn tt-warn-strong">${MISSING_WHY[pt.slug]
                || 'Questions with no usable answer are excluded rather than guessed.'}</div>` : '')
          + highNote
          + '</div>' : '';
      const fmtT = s => s == null ? null
        : s < 90 ? s.toFixed(1) + 's'
        : s < 3600 ? (s / 60).toFixed(1) + ' min'
        : (s / 3600).toFixed(1) + ' h';
      const costRow = pt.costTotal > 0
        ? `<div class="tt-row">Cost to run: <b>${fmtCost(pt.costTotal)}</b></div>` : '';
      const timeRow = pt.timeAvg != null
        ? `<div class="tt-row">Avg time per question: <b>${fmtT(pt.timeAvg)}</b></div>` : '';
      return `<div class="tt-title">${pt.display} (reasoning: ${effort})</div>
         <div class="tt-row">Released: <b>${fmtDate(pt.date)}</b></div>
         <div class="tt-row">Integrity Score: <b>${pt.integrity.toFixed(1)}</b></div>
         <div class="tt-row">Confidence error (Brier): <b>${pt.brier.toFixed(3)}</b></div>
         <div class="tt-row">Accuracy: <b>${pt.accuracy == null ? '—' : pt.accuracy.toFixed(1) + '%'}</b></div>
         ${costRow}${timeRow}${xRow}${cov}${costCaveat}${foot}`;
    };
    const addDot = (cx, cy, fill, html, cls) => {
      const dot = el('circle', { cx, cy, r: 5, fill, class: cls });
      dot.style.transition = 'opacity .15s';
      dot.addEventListener('mousemove', e => { showTip(html, e); highlight(fill); });
      dot.addEventListener('pointerdown', e => { showTip(html, e); highlight(fill); });
      dot.addEventListener('mouseleave', () => { hideTip(); highlight(null); });
      dots.push({ node: dot, fill });
      return dot;
    };
    if (mode === 'bar') {
      // Bar chart: one bar per model, best calibration (lowest Brier) on the left.
      // Labels follow the Artificial Analysis look — score above the bar, provider logo
      // under the axis, model name angled below the logo.
      const clip = el('clipPath', { id: 'tp-logo-clip', clipPathUnits: 'objectBoundingBox' });
      clip.appendChild(el('rect', { width: 1, height: 1, rx: 0.18 }));
      const defs = el('defs');
      defs.appendChild(clip);
      svg.appendChild(defs);
      // reading aid, centred in the plot (vertically near the middle, above the mid bars):
      // caption over a narrow arrow sloping gently down-left (deliberately not level)

      // ordering: Calibration sorts by Brier (best Integrity first); Accuracy by accuracy
      const ordered = [...pts].sort(
        st.order === 'accuracy'
          ? (a, b) => (b.accuracy ?? -1) - (a.accuracy ?? -1)
          : (a, b) => a.brier - b.brier);
      const slot = iw / ordered.length;
      const bw = Math.min(30, slot * 0.7);
      ordered.forEach((p, i) => {
        const cx = mL + slot * (i + 0.5);
        const fill = Data.providerColor(p.slug);
        // no provider-family highlight here (unlike the scatter): the bars are per-model
        // and hover should not group models that merely share a company
        // bars grow from the ZERO baseline: a negative Integrity score hangs below it
        const v = accOrder ? (p.accuracy ?? 0) : p.integrity;
        const bar = el('rect', {
          x: cx - bw / 2, y: Y(Math.max(0, v)), width: bw,
          height: Math.max(1.2, Math.abs(Y(v) - Y(0))), fill, rx: 3, class: 'lp-bar has-tip',
        });
        svg.appendChild(bar);
        // ±1 SE error bar (toggle): the bar metric's own SE — Brier's rescaled ×400 on the
        // Integrity axis, the accuracy SE on the accuracy axis
        const se = accOrder ? p.accuracySe : (p.brierSe != null ? 400 * p.brierSe : null);
        if (st.errbars && se != null) {
          const yTopE = Y(v + se), yBotE = Y(v - se), capW = Math.min(10, bw * 0.5);
          for (const [x1, y1, x2, y2] of [
            [cx, yTopE, cx, yBotE],
            [cx - capW / 2, yTopE, cx + capW / 2, yTopE],
            [cx - capW / 2, yBotE, cx + capW / 2, yBotE],
          ]) svg.appendChild(el('line', { x1, y1, x2, y2, class: 'lp-errbar' }));
        }
        // the value label steps out of the way of the error bar when it's shown
        const labelEdge = st.errbars && se != null ? se : 0;
        svg.appendChild(el('text', {
          x: cx, y: v >= 0 ? Y(v + labelEdge) - 7 : Y(v - labelEdge) + 15,
          class: 'lp-bar-value', 'text-anchor': 'middle',
        }, accOrder ? Math.round(p.accuracy ?? 0) + '%' : v.toFixed(1)));
        // "New" pill: above the percentage on the accuracy axis; on the Integrity axis just
        // past the zero line on the side the bar does NOT occupy.
        if (p.isNew) {
          // sits with the score, just beyond it on the side away from the bar, so it never
          // overlaps either the bar or the number itself
          // the accuracy axis gets a wider gap between the % and the pill than the
          // Integrity axis, where the numbers are shorter and sit tighter to the bar
          // Integrity axis: a positive bar carries its number above it, so the pill goes
          // BELOW the bar, just under the zero line; a negative bar keeps the pill beyond
          // its number. Accuracy axis: above the percentage.
          const yMid = accOrder
            ? Y(v + labelEdge) - 30
            : (v >= 0 ? Y(0) + 9.5 : Y(v - labelEdge) + 27);
          svg.appendChild(newBadge(cx, yMid));
        }
        // an invisible hit area carries the tooltip: the bar PLUS its value label — it
        // extends only on the side the number sits (past the error bar when shown), so even
        // a sliver of a bar near zero is easy to hover
        const padLbl = 20;   // covers the value label beyond the bar tip
        const hitTop = v >= 0 ? Y(v + labelEdge) - padLbl : Y(0);
        const hitBot = v >= 0 ? Y(0) : Y(v - labelEdge) + padLbl;
        const hw = Math.max(bw, 34);   // at least as wide as the printed number
        const hit = el('rect', {
          x: cx - hw / 2, y: hitTop,
          width: hw, height: Math.max(1.2, hitBot - hitTop),
          fill: 'transparent', class: 'lp-hit',
        });
        hit.addEventListener('mousemove', e => { showTip(tipFor(p), e); bar.classList.add('is-hover'); });
        hit.addEventListener('pointerdown', e => { showTip(tipFor(p), e); bar.classList.add('is-hover'); });
        hit.addEventListener('mouseleave', () => { hideTip(); bar.classList.remove('is-hover'); });
        svg.appendChild(hit);

        const logo = Data.providerLogo(p.slug);
        let labelY = mT + ih + 8;
        if (logo) {
          const ls = Math.min(18, slot * 0.54);
          svg.appendChild(el('image', {
            href: logo, x: cx - ls / 2, y: labelY, width: ls, height: ls,
            'clip-path': 'url(#tp-logo-clip)', preserveAspectRatio: 'xMidYMid slice',
          }));
          labelY += ls + 6;
        }
        labelY += 12;   // name baseline sits under the logo
        svg.appendChild(el('text', {
          class: 'lp-model', x: cx, y: labelY,
          'text-anchor': 'end', transform: `rotate(-58 ${cx} ${labelY})`,
        }, p.display));
      });
    } else {
      // links first, so every dot paints on top of them (accuracy/cost axes only — the
      // release-date axis is low-arm only, so there is nothing to link)
      if (mode !== 'date') {
        for (const p of pts) {
          if (p.arm !== 'low') continue;
          const hp = highBySlug[p.slug];
          if (!hp || ax.val(hp) == null) continue;
          const fill = Data.providerColor(p.slug);
          const link = el('line', {
            x1: X(ax.val(p)), y1: Y(p.integrity), x2: X(ax.val(hp)), y2: Y(hp.integrity),
            stroke: fill, 'stroke-width': 2, 'stroke-dasharray': '3 4', opacity: 0.75,
            class: 'lp-arm-link',
          });
          link.style.transition = 'opacity .15s';
          dots.push({ node: link, fill });
          svg.appendChild(link);
        }
      }
      for (const p of pts) {
        // both arms use the model's own colour; the tooltip's effort tag carries the distinction
        svg.appendChild(addDot(X(ax.val(p)), Y(p.integrity), Data.providerColor(p.slug), tipFor(p),
          p.arm === 'high' ? 'lp-dot lp-dot-high has-tip' : 'lp-dot has-tip'));
      }
    }

    mount.innerHTML = '';
    mount.appendChild(svg);
  }

  /* ---- controls: Table ⇄ Chart tabs + x-axis dropdown + legacy toggle ---- */
  function wireControls() {
    if (wired) return;
    wired = true;
    const items = Object.entries(AXES).filter(([value]) => value !== 'bar').map(([value, a]) => ({ value, display: a.label }));
    LevelPlot.buildDropdown('tp-x-dd', items, st.x, v => { st.x = v; render(); });
    const legacy = document.getElementById('tp-legacy');
    if (legacy) legacy.onchange = () => { st.legacy = legacy.checked; render(); };
    const exclEst = document.getElementById('tp-exclest');
    if (exclEst) exclEst.onchange = () => { st.exclEst = exclEst.checked; render(); };
    const all = document.getElementById('tp-all');
    if (all) all.onchange = () => { st.all = all.checked; render(); };
    const eb = document.getElementById('tp-errbars');
    if (eb) eb.onchange = () => { st.errbars = eb.checked; render(); };
    document.querySelectorAll('#tp-order .arm-opt').forEach(btn => {
      btn.onclick = () => {
        const slider = btn.closest('.arm-slider');
        slider.querySelectorAll('.arm-opt').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        const idx = [...slider.querySelectorAll('.arm-opt')].indexOf(btn);
        slider.classList.remove('pos-0', 'pos-1', 'pos-2');
        slider.classList.add('pos-' + idx);
        st.order = btn.dataset.value;
        render();
      };
    });
  }

  function wire() {
    document.querySelectorAll('[data-control="heroview"] button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-control="heroview"] button').forEach(b => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        const v = btn.dataset.value;
        // slide the three-position thumb
        const slider = btn.closest('.arm-slider');
        if (slider) {
          const idx = ['bar', 'table', 'time'].indexOf(v);
          slider.classList.remove('pos-0', 'pos-1', 'pos-2');
          slider.classList.add('pos-' + idx);
        }
        document.getElementById('table-view').hidden = v !== 'table';
        document.getElementById('time-view').hidden = v === 'table';
        // One shared controls row: the View switch is always first; every other group is
        // tagged (space-separated) with the views it belongs to and shown only there.
        document.querySelectorAll('.table-controls [data-when-view]')
          .forEach(g => { g.hidden = !g.dataset.whenView.split(' ').includes(v); });
        if (v !== 'table') { st.view = v; wireControls(); render(); }
        // same jump-to-top the reasoning slider used to do, so the switched view is in frame
        const startY = window.scrollY;
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // some renderers never run smooth-scroll animations — if the scroll hasn't moved at
        // all, jump instead ('instant' overrides the stylesheet's global scroll-behavior:
        // smooth; plain scrollTo would defer to it and animate — i.e. also never move there)
        setTimeout(() => {
          if (startY > 5 && window.scrollY >= startY - 5) window.scrollTo({ top: 0, behavior: 'instant' });
        }, 450);
      };
    });
  }

  function init() {
    wire();
    // The Bar view is the landing default: show its controls, hide the Chart-only ones.
    document.querySelectorAll('.table-controls [data-when-view]')
      .forEach(g => { g.hidden = !g.dataset.whenView.split(' ').includes('bar'); });
    wireControls();
    render();
  }
  return { init, render };
})();

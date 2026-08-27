/* ============================================================
   app.js — wire the controls to the data + chart layers.
   ============================================================ */

// On touch devices a tap simulates hover (pointerdown shows the shared
// tooltip); scrolling anywhere dismisses it, since touch has no mouseleave.
for (const evt of ['scroll', 'touchmove'])
  addEventListener(evt, () => { document.getElementById('tooltip').hidden = true; },
    { capture: true, passive: true });

const state = {
  metric:  'gap',        // gap | wrong | accuracy | confidence | both
  scoring: 'rms',        // rms | signed   (gap only) — RMS is the headline
  timing:  'retro',      // retro | proactive
  tools:   'no',         // no | yes | compare
  domain:  'overall',
};

// Bold title above the chart, so a bare screenshot says what it shows.
const TITLES = {
  gaprms:     'Confidence miscalibration',
  gapsigned:  'Calibration gap',
  wrong:      'Average overconfidence when wrong',
  right:      'Average confidence when right',
  accuracy:   'Accuracy',
  confidence: 'Stated confidence',
  both:       'Accuracy vs stated confidence',
};

// Casual one-liner under the title, explaining the current view in plain English.
const SUBTITLES = {
  gaprms:     "How far each model's confidence drifts from how often it's actually right — lower is better.",
  gapsigned:  'The average gap between confidence and accuracy — positive means overconfident, negative underconfident.',
  wrong:      'When a model gets an answer wrong, how sure it still was — the ideal is zero.',
  right:      "When a model gets an answer right, how sure it was — higher is better.",
  accuracy:   "How often each model answers correctly — raw capability, not calibration.",
  confidence: "How confident each model claims to be, whether or not it's right.",
  both:       'Each model\'s accuracy next to its stated confidence — the gap between them is the miscalibration.',
};

const chartsEl   = document.getElementById('charts');
const noteEl     = document.getElementById('chart-note');
const headingEl  = document.getElementById('chart-heading');
const subtitleEl = document.getElementById('chart-subtitle');
let renderToken = 0;

/* ---------- selection helpers ---------- */
const selFor = toolsBool => ({
  metric: state.metric, scoring: state.scoring,
  timing: state.timing, tools: toolsBool, domain: state.domain,
});

/* ---------- explanatory notes ---------- */
const NOTES = {
  gapsigned: 'Each bar is <b>mean(confidence − 100·correct)</b> in percentage points, pooled over every scored task. <b>Positive means overconfident</b>, negative means underconfident, and zero is perfect calibration. Sorted best-calibrated → worst — note how poorly raw ability predicts where a model lands.',
  gaprms: 'Root-mean-square of (confidence − 100·correct): the error is squared first, so over- and under-confidence can no longer cancel out. <b>Lower is better.</b> A model can sit near zero on the signed gap yet rank badly here if it is wildly off on individual tasks in opposite directions.',
  accuracy: 'Mean accuracy — percent of tasks answered correctly — pooled across the selected domains. This is raw capability, shown for contrast: it is <b>not</b> what the benchmark scores models on.',
  confidence: 'Mean stated confidence (0–100) pooled across the selected domains, regardless of whether the answer was right. High bars here are only a problem when accuracy is low.',
  both: 'Accuracy (teal) next to stated confidence (amber) for each model; the number on top is their difference, the calibration gap. When the amber bar towers over the teal one, the model is confidently wrong.',
  wrong: 'Among <b>only the tasks each model got wrong</b>, this is the confidence it still claimed. The ideal is 0 — be unsure when you fail — so <b>shorter bars are better</b>, and a tall bar means the model was sure of answers that were actually wrong. (On a wrong answer there is no underconfidence; the only failure mode is overconfidence.)',
  right: 'Among <b>only the tasks each model got right</b>, this is the confidence it claimed. The ideal is 100 — be sure when you succeed — so <b>taller bars are better</b>. A short bar means the model was needlessly unsure of answers that were actually correct (underconfidence).',
};
const noteKey = () => state.metric === 'gap' ? 'gap' + state.scoring : state.metric;

/* ---------- chart options per metric ---------- */
function optsFor(allRows) {
  const vals = allRows.map(r => r.value).filter(v => v != null);
  const both = allRows.flatMap(r => [r.accuracy, r.confidence]).filter(v => v != null);

  if (state.metric === 'wrong' || state.metric === 'right') {
    const right = state.metric === 'right';
    return {
      mode: state.metric, yDomain: [0, 100],
      yLabel: right ? 'Avg confidence when right (%)' : 'Avg overconfidence when wrong (%)',
      tickFmt: t => t,
      color: () => right ? Charts.COLOR.under : Charts.COLOR.over, fmt: v => v.toFixed(2),
      emptyText: right ? 'No correct answers recorded for this selection yet.'
                       : 'No wrong answers recorded for this selection yet.',
      tip: r => `<div class="tt-title">${r.display}</div>
        <div class="tt-row">Confidence when ${right ? 'right' : 'wrong'}: <b>${Math.round(r.value)}%</b></div>
        <div class="tt-row">over ${r.n} ${right ? 'correct' : 'wrong'} answer${r.n === 1 ? '' : 's'}</div>${Data.metaRow(r)}`,
    };
  }
  if (state.metric === 'accuracy' || state.metric === 'confidence') {
    const color = state.metric === 'accuracy' ? Charts.COLOR.acc : Charts.COLOR.conf;
    const lbl = state.metric === 'accuracy' ? 'Accuracy' : 'Confidence';
    return {
      mode: state.metric, yDomain: [0, 100], yLabel: lbl + ' (%)',
      tickFmt: t => t, color: () => color, fmt: v => v.toFixed(2),
      emptyText: 'No scored runs for this selection yet.',
      tip: r => `<div class="tt-title">${r.display}</div>
        <div class="tt-row">${lbl}: <b>${Math.round(r.value)}%</b></div>
        <div class="tt-row">n = ${r.n}</div>${Data.metaRow(r)}`,
    };
  }
  if (state.metric === 'both') {
    return {
      mode: 'both', yDomain: [0, 100], yLabel: 'Percent (%)', tickFmt: t => t,
      emptyText: 'No scored runs for this selection yet.',
    };
  }
  // gap
  if (state.scoring === 'rms') {
    return {
      mode: 'gaprms', yDomain: [0, 100],
      yLabel: 'RMS error (%)', tickFmt: t => t,
      color: () => Charts.COLOR.accent, fmt: v => v.toFixed(2),
      emptyText: 'Per-task confidence not available for this selection yet.',
      tip: r => `<div class="tt-title">${r.display}</div>
        <div class="tt-row">RMS error: <b>${Math.round(r.value)} pp</b></div>
        <div class="tt-row">n = ${r.n} tasks</div>${Data.metaRow(r)}`,
    };
  }
  // signed — always run the axis up to 100 so views are comparable and not truncated
  const dmin = vals.length ? Math.min(...vals) : 0;
  const lo = dmin < 0 ? dmin - 6 : 0;
  return {
    mode: 'gapsigned', yDomain: [lo, 100], yLabel: 'Overconfidence (%)',
    tickFmt: t => (t > 0 ? '+' : '') + t,
    color: v => v >= 0 ? Charts.COLOR.over : Charts.COLOR.under,
    fmt: v => (v > 0 ? '+' : '') + v.toFixed(2),
    emptyText: 'No scored runs for this selection yet.',
    tip: r => `<div class="tt-title">${r.display}</div>
      <div class="tt-row">Gap: <b>${(r.value > 0 ? '+' : '') + Math.round(r.value)} pp</b></div>
      <div class="tt-row">Confidence <b>${Math.round(r.confidence)}%</b> · Accuracy <b>${Math.round(r.accuracy)}%</b></div>
      <div class="tt-row">n = ${r.n}</div>${Data.metaRow(r)}`,
  };
}

/* ---------- render ---------- */
async function render() {
  const token = ++renderToken;
  const toolsModes = state.tools === 'compare' ? [false, true] : [state.tools === 'yes'];

  const panels = await Promise.all(toolsModes.map(async tb => ({
    tb, rows: await Data.series(selFor(tb)),
  })));
  if (token !== renderToken) return;                 // a newer render superseded us

  const opts = optsFor(panels.flatMap(p => p.rows));
  chartsEl.className = 'charts' + (toolsModes.length > 1 ? ' compare' : '');
  chartsEl.innerHTML = '';

  for (const p of panels) {
    const card = document.createElement('div');
    card.className = 'chart-card';

    // only label the panels when comparing tools side by side
    if (toolsModes.length > 1) {
      const title = document.createElement('p');
      title.className = 'chart-title';
      title.textContent = p.tb ? 'With tools' : 'No tools';
      card.appendChild(title);
    }

    const mount = document.createElement('div');
    card.appendChild(mount);
    Charts.render(mount, p.rows, opts);

    if (state.metric === 'both' && p.rows.length) card.appendChild(legend());
    chartsEl.appendChild(card);
  }

  if (headingEl)  headingEl.textContent  = TITLES[noteKey()] || '';
  if (subtitleEl) subtitleEl.textContent = SUBTITLES[noteKey()] || '';
  noteEl.innerHTML = NOTES[noteKey()];
}

function legend() {
  const l = document.createElement('div');
  l.className = 'legend';
  l.innerHTML =
    `<span><i style="background:${Charts.COLOR.acc}"></i>Accuracy</span>
     <span><i style="background:${Charts.COLOR.conf}"></i>Stated confidence</span>`;
  return l;
}

/* ---------- the ten-domain list (name + one-line gist, no scaling detail) ---------- */
// Deliberately high-level — enough to picture the task, nothing about how difficulty scales.
const DOMAIN_DESC = {
  reasoning_puzzles:     'Inferring hidden rules from a handful of input-output 2D grid examples.',
  belief_tracking:       'Following what each person in a scene believes about the world as different events unfold.',
  chess_puzzles:         'Constructing a board position that satisfies a precise set of conditions.',
  code_trace:            'Working out what a program returns without the model being able to run the code.',
  obscure_questions:     'Factual question answering with a single, obscure answer without internet access.',
  spatial_reasoning_exp: 'Text-based spatial reasoning puzzles with common objects.',
  string_rules:          'Inferring hidden rules from a handful of input-output 1D string examples.',
  '3d_shapes':           'Understanding a 3D scene by integrating several distinct viewpoints of the scene.',
  object_counting:       'Counting how many of a certain object appear in a complex 3D rendered scene.',
  computer_use:          'Navigating a computer using screenshots.',
};
function buildDomainList() {
  const ul = document.getElementById('domain-list');
  if (!ul) return;
  // Text domains first, the three image domains grouped at the end of the 2×5 grid.
  const ordered = [...Data.domains()].sort((a, b) => (a.image ? 1 : 0) - (b.image ? 1 : 0));
  ul.innerHTML = ordered.map(d => {
    const img = d.image ? '<span class="domain-tag">image</span>' : '';
    const desc = DOMAIN_DESC[d.name] || '';
    return `<li>
        <div class="domain-name">${Data.domainDisplay(d.name)}${img}</div>
        <p class="domain-desc">${desc}</p>
      </li>`;
  }).join('');
}

/* ---------- domain dropdown (custom, not a native select) ---------- */
function buildDomainDropdown() {
  const dd = document.getElementById('domain-dd');
  const items = [{ name: 'overall', display: 'Overall' },
    ...Data.domains().map(d => ({ name: d.name, display: Data.domainDisplay(d.name) }))];
  const current = items.find(it => it.name === state.domain) || items[0];

  dd.innerHTML =
    `<button type="button" class="dd-toggle" aria-haspopup="listbox" aria-expanded="false">
       <span class="dd-label">${current.display}</span>
       <svg class="dd-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
         <path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
       </svg>
     </button>
     <ul class="dd-menu" role="listbox">${
       items.map(it => `<li role="option" data-domain="${it.name}" class="${it.name === state.domain ? 'selected' : ''}">${it.display}</li>`).join('')
     }</ul>`;

  const toggle = dd.querySelector('.dd-toggle');
  const menu = dd.querySelector('.dd-menu');
  const label = dd.querySelector('.dd-label');
  const close = () => { dd.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); };

  toggle.onclick = e => {
    e.stopPropagation();
    const open = dd.classList.toggle('open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  };
  menu.querySelectorAll('li').forEach(li => {
    li.onclick = () => {
      state.domain = li.dataset.domain;
      label.textContent = li.textContent;
      menu.querySelectorAll('li').forEach(x => x.classList.toggle('selected', x === li));
      close();
      render();
    };
  });
  document.addEventListener('click', e => { if (!dd.contains(e.target)) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}
// dim domains that have no data under the current variant choice
function refreshDomainDropdown() {
  const sel = selFor(state.tools === 'yes');
  document.querySelectorAll('#domain-dd li').forEach(li => {
    if (li.dataset.domain === 'overall') return;
    li.classList.toggle('empty', !Data.domainHasData(li.dataset.domain, sel));
  });
}

/* ---------- controls ---------- */
function wireControls() {
  // scoped to the chart view so it doesn't grab the table/view toggles (wired in table.js)
  document.querySelectorAll('#chart-view .segmented').forEach(seg => {
    const ctrl = seg.dataset.control;
    seg.querySelectorAll('button').forEach(btn => {
      btn.onclick = () => {
        seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === btn));
        state[ctrl] = btn.dataset.value;
        if (ctrl === 'metric') syncMetricUI();
        if (ctrl === 'tools' || ctrl === 'timing') refreshDomainDropdown();
        render();
      };
    });
  });
}

// show the Scoring control only when metric === gap
function syncMetricUI() {
  document.querySelectorAll('[data-when-metric]').forEach(g => {
    g.dataset.hidden = (g.dataset.whenMetric !== state.metric).toString();
  });
}

/* ---------- download the chart (with title + subtitle) as a PNG ---------- */
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
// chart styles inlined (CSS vars resolved) so the standalone SVG rasterises correctly
const EXPORT_CSS = `
  text{font-family:${FONT}}
  .axis-text{fill:#9A8F80;font-size:17px}
  .axis-text.model{fill:#6B6155;font-weight:600;font-size:16px}
  .axis-text.model-sub{fill:#9A8F80;font-weight:500;font-size:12px}
  .placeholder-col{fill:#F4EBDF;stroke:#E1D5C3;stroke-width:1.5;stroke-dasharray:5 5}
  .placeholder-text{fill:#9A8F80;font-size:16px;font-weight:600}
  .bar-label{fill:#6B6155;font-size:12px;font-weight:700}
  .y-title{fill:#9A8F80;font-size:17px;font-weight:600}
  .grid-line{stroke:#ECE2D4;stroke-width:1}
  .zero-line{stroke:#9A8F80;stroke-width:1.4}
  .bar-est{fill-opacity:.42;stroke-width:2.5;stroke-dasharray:6 4}
  svg{overflow:visible}`;

const escXml = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function wrapText(s, maxChars) {
  const lines = []; let cur = '';
  for (const w of s.split(' ')) {
    if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; }
    else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

function downloadChart() {
  const svgEl = chartsEl.querySelector('svg.chart-svg');
  if (!svgEl) return;
  const title = (headingEl?.textContent || '').trim();
  const subtitle = (subtitleEl?.textContent || '').trim();

  const [, , W, H] = svgEl.getAttribute('viewBox').split(/\s+/).map(Number);
  const PAD = 30, titleSize = 30, subSize = 17, subLineH = 23;
  const subLines = wrapText(subtitle, 72);
  const headerH = PAD + titleSize + 14 + subLines.length * subLineH + 16;
  const totalH = headerH + H;

  const inner = svgEl.cloneNode(true);
  inner.removeAttribute('class'); inner.removeAttribute('style');
  inner.setAttribute('x', 0); inner.setAttribute('y', headerH);
  inner.setAttribute('width', W); inner.setAttribute('height', H);
  inner.setAttribute('viewBox', `0 0 ${W} ${H}`);

  const subSvg = subLines.map((l, i) =>
    `<text x="${W / 2}" y="${PAD + titleSize + 14 + i * subLineH + subSize}" text-anchor="middle" font-size="${subSize}" fill="#6B6155">${escXml(l)}</text>`).join('');

  const outer =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${totalH}" width="${W * 2}" height="${totalH * 2}">
       <style>${EXPORT_CSS}</style>
       <rect width="${W}" height="${totalH}" fill="#FFFFFF"/>
       <text x="${W / 2}" y="${PAD + titleSize - 4}" text-anchor="middle" font-size="${titleSize}" font-weight="800" fill="#1F1B16" font-family='${FONT}'>${escXml(title)}</text>
       ${subSvg}
       ${new XMLSerializer().serializeToString(inner)}
     </svg>`;

  const url = URL.createObjectURL(new Blob([outer], { type: 'image/svg+xml;charset=utf-8' }));
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = W * 2; canvas.height = totalH * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob(b => {
      const a = document.createElement('a');
      a.download = `integrity-bench-${noteKey()}.png`;
      a.href = URL.createObjectURL(b);
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }, 'image/png');
  };
  img.onerror = () => { URL.revokeObjectURL(url); alert("Sorry — couldn't generate the image."); };
  img.src = url;
}

/* ---------- overconfidence example browser: domain filter + prev/next pager ---------- */
(() => {
  const cards = [...document.querySelectorAll('.example-card')];
  const domBtns = [...document.querySelectorAll('[data-control="example-domain"] button')];
  const prev = document.getElementById('ex-prev');
  const next = document.getElementById('ex-next');
  const counter = document.getElementById('ex-counter');
  if (!cards.length || !prev) return;
  let domain = 'counting', idx = 0;

  function render() {
    const pool = cards.filter(c => c.dataset.domain === domain);
    cards.forEach(c => { c.hidden = true; });
    if (pool.length) pool[idx].hidden = false;
    counter.textContent = `${pool.length ? idx + 1 : 0} / ${pool.length}`;
    prev.disabled = idx <= 0;
    next.disabled = idx >= pool.length - 1;
  }
  domBtns.forEach(b => {
    b.onclick = () => {
      domBtns.forEach(x => x.classList.toggle('active', x === b));
      domain = b.dataset.value;
      idx = 0;
      render();
    };
  });
  prev.onclick = () => { if (idx > 0) { idx--; render(); } };
  next.onclick = () => {
    if (idx < cards.filter(c => c.dataset.domain === domain).length - 1) { idx++; render(); }
  };
  render();
})();

/* ---------- boot ---------- */
(async function init() {
  try {
    await Data.load();
  } catch (e) {
    chartsEl.innerHTML = `<div class="chart-empty">Couldn't load <code>data/index.json</code>.<br>Run the site over a local server (e.g. <code>python3 -m http.server</code>).</div>`;
    return;
  }
  buildDomainList();
  buildDomainDropdown();
  refreshDomainDropdown();
  wireControls();
  syncMetricUI();
  const dl = document.getElementById('download-btn');
  if (dl) dl.onclick = downloadChart;
  await render();
  if (window.Table) await Table.init();   // default view: the accuracy/confidence table
  if (window.TimePlot) TimePlot.init();   // hero toggle: overconfidence-through-time scatter
  if (window.LevelPlot) await LevelPlot.init();   // per-level plot in the methodology section
  if (window.CalPlot) await CalPlot.init();       // calibration curve between examples and methodology
  syncArmThumbs();
})();

/* ---------- arm-slider thumbs ----------
   The options are content-sized, NOT equal thirds ("Calibration + Accuracy" is far wider
   than "Accuracy"), so the CSS 33%-width thumb lands mid-word. Size and place the thumb
   to the ACTIVE option instead, for every .arm-slider on the page. Re-runs after any
   option click (which includes view switches that unhide a slider), on resize, and once
   fonts land (widths shift when the webfont swaps in). */
function syncArmThumbs() {
  document.querySelectorAll('.arm-slider').forEach(s => {
    const active = s.querySelector('.arm-opt.active');
    const thumb = s.querySelector('.arm-thumb');
    if (!active || !thumb || !active.offsetWidth) return;   // hidden slider: sync when shown
    thumb.style.width = active.offsetWidth + 'px';
    thumb.style.transform = `translateX(${active.offsetLeft - 3}px)`;
  });
}
// setTimeout, not requestAnimationFrame: rAF stalls in background/hidden tabs, leaving a
// stale thumb when the tab is refocused. Bubble-phase + timeout also guarantees the
// clicked option's .active class has been toggled by its own handler first.
addEventListener('click', e => {
  if (e.target.closest('.arm-opt')) setTimeout(syncArmThumbs, 0);
});
addEventListener('resize', syncArmThumbs);
if (document.fonts?.ready) document.fonts.ready.then(syncArmThumbs);

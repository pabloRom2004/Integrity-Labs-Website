/* ============================================================
   table.js — the default view: a per-model accuracy vs stated-confidence
   table. Its own domain dropdown (Overall = all tasks) and an Include/Exclude
   scout-samples toggle that recomputes accuracy. Models come from the roster,
   so new runs appear automatically; a model with nothing for the selection
   shows "No data". The bar-chart view (app.js) is opt-in via the view switch.
   ============================================================ */

window.Table = (() => {
  const st = {
    domain: 'overall', scouts: 'include',
    effort: 'low',    // reasoning arm: 'low' (off/low) or 'high' (high/max) — the slider below the table
    // which metric columns are shown — toggled from the Advanced panel (rms/conf/cost default off)
    // Default view is the CONFIDENCE ERROR (Brier score) ALONE — everything else, the headline
    // Overconfidence score and accuracy included, is opt-in from the Advanced panel. Keep this in
    // sync with bake_table() in export_site_data.py, which pre-renders the same default columns:
    // if the two disagree the page visibly flashes as the live re-render replaces the baked HTML.
    // (The ablation tables build their own columns explicitly, so they are unaffected.)
    cols: { integrity: true, score: false, accuracy: true, brier: false, prosBrier: false, brierAll: false, rms: false, right: false, wrong: false, conf: false, cost: false, time: false },
    errbars: false,   // show ± standard errors on table values (Advanced toggle; CSS-gated)
    sortKey: null,    // header-click sort: a COLS key, or null = default (left-most visible metric)
  };
  let renderToken = 0;   // guards against a slow fetch overwriting a newer selection

  // one-line description of the selected domain, taken from the cards below (app.js)
  function setBlurb() {
    const el = document.getElementById('table-domain-blurb');
    if (!el) return;
    el.textContent = st.domain === 'overall'
      ? '10 novel domains created specifically for this benchmark.'
      : (typeof DOMAIN_DESC !== 'undefined' && DOMAIN_DESC[st.domain]) || '';
  }

  /* ---- domain dropdown (same custom control as the chart's) ---- */
  function buildDropdown() {
    const dd = document.getElementById('table-domain-dd');
    const items = [{ name: 'overall', display: 'Overall (all tasks)' },
      ...Data.domains().map(d => ({ name: d.name, display: Data.domainDisplay(d.name) }))];
    const cur = items.find(it => it.name === st.domain) || items[0];

    dd.innerHTML =
      `<button type="button" class="dd-toggle" aria-haspopup="listbox" aria-expanded="false">
         <span class="dd-label">${cur.display}</span>
         <svg class="dd-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
           <path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>
       </button>
       <ul class="dd-menu" role="listbox">${
         items.map(it => `<li role="option" data-domain="${it.name}" class="${it.name === st.domain ? 'selected' : ''}">${it.display}</li>`).join('')
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
        st.domain = li.dataset.domain;
        label.textContent = li.textContent;
        menu.querySelectorAll('li').forEach(x => x.classList.toggle('selected', x === li));
        setBlurb();
        close();
        render();
      };
    });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }

  /* ---- scout toggle + early-stop toggle + table/charts view switch ---- */
  function wire() {
    document.querySelectorAll('[data-control="tablescouts"] button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-control="tablescouts"] button')
          .forEach(b => b.classList.toggle('active', b === btn));
        st.scouts = btn.dataset.value;
        render();
      };
    });
    document.querySelectorAll('[data-control="view"] button').forEach(btn => {
      btn.onclick = () => {
        document.querySelectorAll('[data-control="view"] button')
          .forEach(b => b.classList.toggle('active', b === btn));
        setView(btn.dataset.value);
      };
    });
  }

  function setView(v) {
    document.getElementById('table-view').hidden = v !== 'table';
    document.getElementById('chart-view').hidden = v !== 'charts';
  }

  /* ---- formatting ---- */
  // Integrity (BSS) score: the band Brier rescaled so higher is better, anchored on a
  // coin-flip baseline. 100 = right-and-certain / wrong-and-doubtful every time; 0 = the
  // 50%-hedger; negative = worse than a coin flip. Integrity = 100 x (1 - Brier / 0.25).
  const integrityOf = brier => brier == null ? null : 100 - 400 * brier;
  const rowIntegrity = r => r.bandRms == null ? null : integrityOf((r.bandRms / 100) ** 2);
  const err = se => se == null ? '' : `<span class="err">±${se >= 1 ? Math.round(se) : se.toFixed(1)}%</span>`;
  const pct1 = (v, se) => v == null ? '<span class="no-data">No data</span>' : `${v.toFixed(1)}%${err(se)}`;
  const pctOrDash = (v, se) => v == null ? '<span class="no-data">—</span>' : `${v.toFixed(1)}%${err(se)}`;
  const fmtCost = c => c == null ? '—'
    : c >= 1 ? '$' + c.toFixed(2)
    : c >= 0.1 ? '$' + c.toFixed(3)
    : '$' + c.toFixed(4);
  const fmtTime = s => s == null ? '—'
    : s < 90 ? s.toFixed(1) + 's'
    : s < 3600 ? (s / 60).toFixed(1) + ' min'
    : (s / 3600).toFixed(1) + ' h';

  /* ---- shared tooltip (same #tooltip element + .tt-* classes as the charts) ---- */
  const tipEl = document.getElementById('tooltip');
  function showTip(html, e) {
    tipEl.innerHTML = html; tipEl.hidden = false;
    const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8) x = e.clientX - w - pad;
    if (y + h > innerHeight - 8) y = e.clientY - h - pad;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    y = Math.max(8, Math.min(y, innerHeight - h - 8));
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  const hideTip = () => { tipEl.hidden = true; };

  // Help bubble for the "?" next to the Calibration gap header — positioned under the icon
  // (not cursor-following), so it works on hover (desktop) and tap (mobile).
  const HELP = {
    integrity: "The Integrity Score is a rescaling of the Brier score a model got on the benchmark with the formula of Integrity Score = 100 × (1 − Brier / 0.25). The brier score is calculated by taking the mean squared error between stated confidence and wether or not the model got the answer correct",
    brierAll: "Brier score computed over EVERY answered question, not just the 3 difficulty levels nearest 50% accuracy. Shown for comparison only: without the band filter a model can look well calibrated just because a domain was very easy or very hard for it, so the headline Brier stays band-filtered.",
    right: "Average confidence the model stated on the answers it got right. A well-calibrated model should be sure of its correct answers, ideal here is 100%.",
    wrong: "Average confidence the model stated on the answers it got wrong. A well-calibrated model should be near 0%. High numbers here mean the model confidently tells you wrong answers.",
    accuracy: "Accuracy as a % over the whole benchmark (10 questions per level, 8 levels per domain, 10 domains makes it 800 questions)",
    conf: "Mean stated confidence across all answers, right or wrong. It is here to compare it directly against Overall Accuracy, a large gap between the two is the overconfidence signal in its simplest form.",
    cost: "Average API cost per question for this selection, priced from the provider's list rates at run time.",
    time: "Average wall-clock time the model took per question for this selection. Hover a row for the fastest and slowest single question. This is noisy and should not be taken too literally.",
    brier: "Brier score: the mean squared error between stated confidence (as a probability, 0–1) and the binary outcome (right = 1, wrong = 0). 0 is perfect, 0.25 is what always saying 50% scores, 1 is confidently wrong every time. This is only measured on questions closest to 50% accuracy which makes this benchmark capabilities agnostic. Those 3 band levels carry 30 questions each per domain \u2014 the 10 that located the band plus 20 more \u2014 so where the full widening has run this rests on about 900 questions per model; hover a row for its exact count.",
    score: "The headline number: how far this model's stated confidence sits from reality, averaged over both moments it is asked \u2014 before it attempts a question, and alongside the answer it gives. It is the mean of the two Brier scores (see the Advanced view), rescaled 0\u2013100, so 0 is perfect calibration and lower is better. It deliberately does NOT include accuracy: every model is measured at its own difficulty band, the 3 levels where it scores nearest 50%, so each is judged at the edge of its own ability and a weaker model is not punished simply for being weaker. Accuracy is shown beside it as a separate number.",
    prosBrier: "Brier score for confidence stated BEFORE the model attempts the question: it is shown the question and asked only how likely it is to answer correctly, then that forecast is scored against whether it actually got the same question right in the main run. Same scale as the column to its left, so the two are directly comparable — the difference is whether the model is judging itself before or after doing the work. Measured on 30 questions per domain inside the difficulty band (about 300 per model), so it carries a standard error of roughly \u00b10.013\u2013\u00b10.029 \u2014 read a gap against the column to its left as real only if it is clearly larger than that. On matched questions the picture splits by model generation: older or smaller models (GPT-3.5 Turbo and GPT-4o most dramatically, and DeepSeek V4 Pro, Inkling, GLM 5.2, Qwen 3.6 and both Gemini Flash models) forecast markedly better than they judge an answer they have already written, while both Muse Sparks, Gemini 3.1 Pro, GPT-5.5 and Claude Opus 5 show the opposite \u2014 their after-answering confidence is the better-calibrated one.",
    rms: "Root-mean-square confidence error between confidence and accuracy, meaning that a score closest to 0 is most calibrated. It is the SAME measurement as the Brier score in percentage points (RMS = √Brier × 100). This is only measured on questions closest to 50% accuracy which makes this benchmark capabilities agnostic.",
  };
  function showHtmlAt(el, html) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
    if (x < 8) x = 8;
    if (y + h > innerHeight - 8) y = r.top - 8 - h;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }
  const showHelpAt = el => showHtmlAt(el,
    `<div class="tt-row" style="white-space:normal;max-width:260px">${HELP[el.dataset.helpKey] || ''}</div>`);

  // Providers with a real batch API (Anthropic, OpenAI, Google; DeepSeek's off-peak window is
  // equivalent) bill 50% for batched runs — shown in the row tooltip as the what-if price.
  function batchable(slug) {
    const x = (slug || '').toLowerCase();
    return /claude|fable|opus|sonnet|gpt|gemini|deepseek/.test(x);
  }

  // One wiring for every "?" icon. Hover only fires for REAL mouse pointers (touch
  // browsers emulate mouseenter on tap, which made the first tap show-then-hide the
  // tip — the mobile double-tap bug); focus only for keyboard (:focus-visible);
  // click/tap toggles, tracking which icon owns the tooltip.
  let tipOwner = null;
  function wireHelp(el, getHtml) {
    const show = () => { showHtmlAt(el, getHtml()); tipOwner = el; };
    el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(); });
    el.addEventListener('mouseleave', hideTip);
    el.addEventListener('focus', () => { if (el.matches(':focus-visible')) show(); });
    el.addEventListener('blur', hideTip);
    el.addEventListener('click', e => {
      e.stopPropagation();
      if (!tipEl.hidden && tipOwner === el) hideTip(); else show();
    });
  }

  function tipHtml(r) {
    if (r.placeholder) return `<div class="tt-title">${r.display}</div><div class="tt-row">No data for this selection.</div>`;
    const warn = r.extrapolated ? `<div class="tt-warn">${r.warnTip || 'Extrapolated from partial pre-ban runs, not a full run.'}</div>` : '';
    // Coverage notes (excluded questions etc.) read last, in the warning orange so a
    // partial run is visible at a glance.
    const note = r.note ? `<div class="tt-note">${r.note}</div>` : '';
    // Reasoning effort lives in this hover — the model's own label for its arm.
    const effort = (r.reasoning && r.reasoning[r.arm || 'low']) || r.arm || 'low';
    // High runs cover the 800 scout questions only (no band widening), so their denominator
    // is the scout expectation, not the full-run 1400.
    const den = r.arm === 'high' ? r.nExpected : r.nExpectedFull;
    const n = r.nAll || r.n;
    return `<div class="tt-title">${r.display}</div>
      ${warn}
      <div class="tt-row">Reasoning effort: <b>${effort}</b></div>
      <div class="tt-row">Accuracy: <b>${r.accuracy == null ? '—' : r.accuracy.toFixed(1) + '%'}</b> (scout questions)</div>
      <div class="tt-row">Avg cost/task: <b>${fmtCost(r.costAvg)}</b> · total ${fmtCost(r.costTotal)}</div>
      ${r.costTotal ? (batchable(r.slug)
        ? `<div class="tt-row">With batch pricing (50% off): <b>${fmtCost(r.costAvg / 2)}</b>/task · total ${fmtCost(r.costTotal / 2)}</div>`
        : `<div class="tt-row">No batch API for this provider: batch pricing unavailable.</div>`) : ''}
      <div class="tt-row">Time/task: avg <b>${fmtTime(r.timeAvg)}</b> · min ${fmtTime(r.timeMin)} · max ${fmtTime(r.timeMax)}</div>
      <div class="tt-meta">${n}${den ? ' of ' + den : ''} question${n === 1 ? '' : 's'} answered${r.bandN ? ' · the Brier score rests on its ' + r.bandN + ' band questions' : ''}</div>
      ${note}`;
  }

  /* ---- metric columns (order = display order; toggled via st.cols) ---- */
  const helpSpan = (key, label) =>
    `<span class="gap-help" data-help-key="${key}" tabindex="0" role="button" aria-label="${label}">?</span>`;
  const COLS = [
    { key: 'integrity',
      th: `Integrity Score ${helpSpan('integrity', 'What the Integrity score means')}<span class="ideal">(higher is better)</span>`,
      td: r => r.bandRms == null ? '<span class="no-data">\u2014</span>'
        : rowIntegrity(r).toFixed(1)
          + (r.brierSe != null ? `<span class="err">\u00b1${(r.brierSe * 400).toFixed(1)}</span>` : '') },
    { key: 'score',
      th: `Overconfidence<br>score ${helpSpan('score', 'What the overconfidence score means')}<span class="ideal">(lower is better)</span>`,
      td: r => r.score == null ? '<span class="no-data">—</span>'
        : r.score.toFixed(1)
          + (r.scoreSe != null ? `<span class="err">±${r.scoreSe.toFixed(1)}</span>` : '') },
    { key: 'brier',
      th: `Confidence error<br>(Brier score) ${helpSpan('brier', 'What the Brier score means')}<span class="ideal">(lower is better)</span>`,
      td: r => r.bandRms == null ? '<span class="no-data">—</span>'
        : ((r.bandRms / 100) ** 2).toFixed(3)
          + (r.brierSe != null ? `<span class="err">±${r.brierSe.toFixed(3)}</span>` : '') },
    { key: 'prosBrier',
      th: `Confidence error<br>before answering ${helpSpan('prosBrier', 'What the before-answering Brier score means')}<span class="ideal">(lower is better)</span>`,
      td: r => r.prosBrier == null ? '<span class="no-data">—</span>'
        : r.prosBrier.toFixed(3)
          + (r.prosBrierSe != null ? `<span class="err">±${r.prosBrierSe.toFixed(3)}</span>` : '') },
    { key: 'accuracy',
      th: `Overall Accuracy ${helpSpan('accuracy', 'Why accuracy is shown')}<span class="ideal">(higher is better)</span>`,
      td: r => pct1(r.accuracy, r.accuracySe) },
    { key: 'brierAll',
      th: `Brier score<br>(all questions) ${helpSpan('brierAll', 'What the all-questions Brier score means')}<span class="ideal">(lower is better)</span>`,
      td: r => r.brierAll == null ? '<span class="no-data">—</span>' : r.brierAll.toFixed(3) },
    { key: 'rms',
      th: `Confidence error<br>(RMS) ${helpSpan('rms', 'What RMS confidence error means')}<span class="ideal">(lower is better)</span>`,
      td: r => r.bandRms == null ? '<span class="no-data">—</span>' : r.bandRms.toFixed(1) },
    { key: 'right',
      th: `Average confidence<br>when <span class="word-right">right</span> ${helpSpan('right', 'What average confidence when right means')}<span class="ideal">(higher is better)</span>`,
      td: r => pctOrDash(r.confRight, r.confRightSe) },
    { key: 'wrong',
      th: `Average confidence<br>when <span class="word-wrong">wrong</span> ${helpSpan('wrong', 'What average confidence when wrong means')}<span class="ideal">(lower is better)</span>`,
      td: r => pctOrDash(r.confWrong, r.confWrongSe) },
    { key: 'conf',
      th: `Average<br>confidence ${helpSpan('conf', 'What average confidence means')}`,
      td: r => pctOrDash(r.confidence, null) },
    { key: 'cost',
      th: `Avg cost<br>per question ${helpSpan('cost', 'What the cost column means')}`,
      td: r => r.costAvg == null ? '<span class="no-data">—</span>' : fmtCost(r.costAvg) },
    { key: 'time',
      th: `Avg time<br>per question ${helpSpan('time', 'What the time column means')}`,
      td: r => r.timeAvg == null ? '<span class="no-data">—</span>' : fmtTime(r.timeAvg) },
  ];

  /* ---- render ---- */
  async function render() {
    const token = ++renderToken;
    const mount = document.getElementById('cal-table-mount');
    // A baked table (written into index.html by export_site_data.py) paints instantly;
    // keep it (or the previous render) on screen instead of flashing "Loading…" while
    // the live rows compute — they replace it in place.
    if (!mount.querySelector('table')) mount.innerHTML = '<div class="table-loading">Loading…</div>';
    const scouts = st.scouts === 'include';
    // Main table is the LOW/off arm only — the field every model actually ran at low effort.
    // The high/max reasoning runs live in their own ablation table (renderHigh, below); a
    // mandatory-max-only model (Kimi K3) has no low run and so appears only there.
    const rows = (await Data.tableRows({ domain: st.domain, scouts, effort: 'low' }))
      .map(r => ({ ...r, arm: 'low' }));
    if (token !== renderToken) return;   // a newer render superseded us

    const active = COLS.filter(c => st.cols[c.key]);

    // Rank + order rows by the LEFT-MOST visible metric column (default: Brier).
    // Placeholders and per-domain-suppressed rows sink to the bottom, unranked.
    const METRIC = {
      integrity: [rowIntegrity, -1],
      score: [r => r.score, 1],
      brier: [r => r.bandRms, 1], brierAll: [r => r.brierAll, 1], rms: [r => r.bandRms, 1],
      prosBrier: [r => r.prosBrier, 1],
      right: [r => r.confRight, -1], wrong: [r => r.confWrong, 1],
      accuracy: [r => r.accuracy, -1], conf: [r => r.confidence, -1],
      cost: [r => r.costAvg, 1], time: [r => r.timeAvg, 1],
    };
    const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'})[n % 10] || 'th');
    const suppressedRow = r => r.extrapolated && st.domain !== 'overall';
    // Header-click sort key wins if its column is still visible; else the left-most metric.
    if (st.sortKey && !st.cols[st.sortKey]) st.sortKey = null;
    const sortKey = st.sortKey || (active.length ? active[0].key : null);
    let rankOf = () => '';
    if (active.length) {
      const [val, dir] = METRIC[sortKey];
      const sortable = r => !r.placeholder && !suppressedRow(r) && val(r) != null;
      rows.sort((a, b) => {
        if (sortable(a) !== sortable(b)) return sortable(a) ? -1 : 1;
        if (!sortable(a)) return 0;
        return (val(a) - val(b)) * dir;
      });
      let n = 0;
      const ranks = new Map(rows.filter(sortable).map(r => [r, ordinal(++n)]));
      rankOf = r => ranks.get(r) || '';
    }
    const body = rows.map((r, i) => {
      const warn = r.extrapolated ? `<div class="m-warn">${r.warnText || '(Noisy sample as it was only run on some of the data before the ban, we will re-run this soon after we get some feedback)'}</div>` : '';
      const ico = r.extrapolated
        ? ` <svg class="m-warn-ico" viewBox="0 0 16 16" width="17" height="17" aria-hidden="true">
             <title>Noisy sample — only run on some of the data before the ban</title>
             <path d="M8 2.6l5.6 10.2H2.4L8 2.6z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
             <path d="M8 6.6v3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
             <circle cx="8" cy="11.5" r=".7" fill="currentColor"/>
           </svg>`
        : '';
      const rowHelp = (r.placeholder || (r.extrapolated && st.domain !== 'overall')) ? ''
        : `<span class="gap-help m-row-help" data-i="${i}" tabindex="0" role="button" aria-label="Cost and time details">?</span>`;
      const helpCell = `<td class="m-help-cell">${rowHelp}</td>`;
      // Reasoning effort is no longer a label under the name — it lives in the row's "?" hover.
      const newTag = r.isNew ? '<div class="m-new-row"><span class="m-new">New</span></div>' : '';
      const name = `<td class="m-cell"><span class="m-rank">${rankOf(r)}</span><span class="dot" style="background:${r.color}"></span><span class="m-name">${r.display}</span>${ico}${newTag}${warn}</td>`;
      // Per-domain, an extrapolated model is too noisy (or absent) to report — same message
      // whether it has a handful of samples or none at all.
      if (r.extrapolated && st.domain !== 'overall')
        return `<tr data-i="${i}">${name}<td class="num no-data" colspan="${active.length + 1}">Not enough data for accurate confidence measurements</td></tr>`;
      if (r.placeholder) return `<tr data-i="${i}">${name}<td class="num no-data" colspan="${active.length + 1}">${r.placeholder}</td></tr>`;
      return `<tr data-i="${i}">${name}` +
        active.map(c => `<td class="num">${c.td(r)}</td>`).join('') + helpCell + '</tr>';
    }).join('');

    mount.innerHTML =
      `<table class="cal-table${st.errbars ? ' show-err' : ''}">
         <thead><tr>
           <th>AI Model</th>
           ${active.map(c => `<th class="num th-sort${st.sortKey === c.key ? ' th-sorted' : ''}" data-sort-key="${c.key}">${c.th}${st.sortKey === c.key ? '<span class="sort-arrow">▼</span>' : ''}</th>`).join('\n           ')}
           <th class="m-help-cell"></th>
         </tr></thead>
         <tbody>${body}</tbody>
       </table>`;

    // header click → sort by that column (fixed best-first direction); click again to clear
    mount.querySelectorAll('th[data-sort-key]').forEach(th => {
      th.addEventListener('click', e => {
        if (e.target.closest('.gap-help')) return;   // the "?" keeps its tooltip behaviour
        const k = th.dataset.sortKey;
        st.sortKey = st.sortKey === k ? null : k;
        render();
      });
    });

    // per-row "?" next to the model name → cost/time details (single-tap on touch)
    mount.querySelectorAll('.m-row-help').forEach(help => {
      const r = rows[+help.dataset.i];
      wireHelp(help, () => tipHtml(r));
    });

    // "?" help icons (gap + RMS headers) — single-tap on touch too.
    // :not(.m-row-help) — the per-row cost icons have their own wiring above.
    mount.querySelectorAll('.gap-help:not(.m-row-help)').forEach(help =>
      wireHelp(help, () => `<div class="tt-row" style="white-space:normal;max-width:260px">${HELP[help.dataset.helpKey] || ''}</div>`));
  }

  /* =================== ablation tables =================== */
  // Shared bits for the ablation renderers below. All ablation tables show their error
  // bars permanently (no toggle) and sit at prose width (the .abl-panel class).
  const ordinal = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th');
  const nameCell = (r, rank) =>
    `<td class="m-cell"><span class="m-rank">${rank}</span>`
    + `<span class="dot" style="background:${r.color}"></span>`
    + `<span class="m-name">${r.display}</span></td>`;
  const errSpan = se => se == null ? '' : `<span class="err">±${se >= 1 ? se.toFixed(1) : se.toFixed(3)}</span>`;
  const errPct = se => se == null ? '' : `<span class="err">±${se.toFixed(1)}%</span>`;
  // A signed change, green when it moved in the good direction (dir=-1: lower is better).
  const delta = (v, se, dir, fmt) => {
    const good = v * dir > 0;
    const cls = v === 0 ? '' : good ? 'delta-good' : 'delta-bad';
    return `<span class="${cls}">${v > 0 ? '+' : ''}${fmt(v)}</span>${se != null ? `<span class="err">±${fmt(Math.abs(se)).replace('+', '')}</span>` : ''}`;
  };
  const ablTable = (cols, rows, sortVal, dir) => {
    const ordered = [...rows].sort((a, b) => (sortVal(a) - sortVal(b)) * dir);
    const body = ordered.map(r =>
      `<tr>${nameCell(r, ordinal(ordered.indexOf(r) + 1))}`
      + cols.map(c => `<td class="num">${c.td(r)}</td>`).join('')
      + (r._help ? `<td class="m-help-cell"><span class="gap-help m-row-help abl-help" tabindex="0" role="button" aria-label="Details">?</span></td>` : '<td class="m-help-cell"></td>')
      + '</tr>').join('');
    return { html: `<table class="cal-table show-err abl-table">
       <thead><tr>
         <th>AI Model</th>
         ${cols.map(c => `<th class="num">${c.th}</th>`).join('\n         ')}
         <th class="m-help-cell"></th>
       </tr></thead>
       <tbody>${body}</tbody>
     </table>`, ordered };
  };
  const wireAblHovers = (mount, orderedPerTable) => {
    const tables = mount.querySelectorAll('table');
    tables.forEach((tbl, ti) => {
      const ordered = orderedPerTable[ti];
      if (!ordered) return;
      tbl.querySelectorAll('.abl-help').forEach((h, i) => wireHelp(h, () => ordered[i]._help()));
    });
    mount.querySelectorAll('.gap-help:not(.m-row-help)').forEach(h =>
      wireHelp(h, () => `<div class="tt-row" style="white-space:normal;max-width:260px">${HELP[h.dataset.helpKey] || ''}</div>`));
  };

  // ---- High/max reasoning: low vs high, Brier then accuracy, each with a coloured change ----
  // Each ablation table sits in its OWN wide panel (like the level plot), with its
  // explanation reading as a normal prose paragraph between the panels.
  const ablPanel = html => `<div class="panel chart-panel abl-panel">${html}</div>`;
  const ablText = text => text ? `<p class="abl-text">${text}</p>` : '';

  async function renderHigh() {
    const mount = document.getElementById('high-ablation-mount');
    if (!mount) return;
    // tableRowsAll, NOT tableRows(effort:'high'): the direct high call recomputes the
    // prospective half by pairing LOW-effort forecasts against HIGH-effort outcomes, a mixed
    // pairing banned from the hero table. tableRowsAll's high rows keep their own high-effort
    // prospective where one was run and borrow the low arm's only as a fallback.
    const all = await Data.tableRowsAll({ domain: 'overall', scouts: true });
    const high = all.filter(r => r.arm === 'high' && !r.placeholder && r.bandRms != null);
    const lowBySlug = {};
    for (const r of all)
      if (r.arm === 'low' && !r.placeholder) lowBySlug[r.slug] = r;
    const rows = high.map(h => {
      const l = lowBySlug[h.slug] || null;
      const bH = (h.bandRms / 100) ** 2;
      const bL = l && l.bandRms != null ? (l.bandRms / 100) ** 2 : null;
      // Before-answering (prospective) Brier per arm. The high value counts ONLY when a
      // real high-effort forecast run exists (prosArm 'high') — a high row that borrowed
      // the low arm's forecasts would just repeat the low column here.
      const pL = l && l.prosBrier != null ? l.prosBrier : null;
      const pH = h.prosArm === 'high' && h.prosBrier != null ? h.prosBrier : null;
      return {
        slug: h.slug, display: h.display, color: h.color,
        bL, bH, bLSe: l ? l.brierSe : null, bHSe: h.brierSe,
        dB: bL != null ? bH - bL : null,
        dBSe: bL != null && l.brierSe != null && h.brierSe != null
          ? Math.sqrt(l.brierSe ** 2 + h.brierSe ** 2) : null,
        pL, pH, pLSe: l ? l.prosBrierSe : null, pHSe: h.prosBrierSe,
        dP: pL != null && pH != null ? pH - pL : null,
        dPSe: pL != null && pH != null && l.prosBrierSe != null && h.prosBrierSe != null
          ? Math.sqrt(l.prosBrierSe ** 2 + h.prosBrierSe ** 2) : null,
        aL: l ? l.accuracy : null, aH: h.accuracy,
        aLSe: l ? l.accuracySe : null, aHSe: h.accuracySe,
        dA: l && l.accuracy != null && h.accuracy != null ? h.accuracy - l.accuracy : null,
        dASe: l && l.accuracySe != null && h.accuracySe != null
          ? Math.sqrt(l.accuracySe ** 2 + h.accuracySe ** 2) : null,
        _help: () => tipHtml(h) + (l ? '' : '<div class="tt-note">No low-reasoning run for this model.</div>'),
      };
    });
    if (!rows.length) { mount.innerHTML = '<div class="table-loading">No data yet.</div>'; return; }
    // Change-only columns, matching the follow-up prompt-ablation tables (Pablo, 2026-08-13)
    const dash = '<span class="no-data">—</span>';
    const t1 = ablTable([
      { th: `Integrity score change ${helpSpan('integrity', 'What the Integrity score means')}<span class="ideal">(positive = improved)</span>`,
        td: r => r.dB == null ? dash : delta(-400 * r.dB, 400 * r.dBSe, 1, v => v.toFixed(2)) },
    ], rows, r => r.dB ?? 9, 1);
    const t3 = ablTable([
      { th: `Integrity before answering change ${helpSpan('integrity', 'What the Integrity score means')}<span class="ideal">(positive = improved)</span>`,
        td: r => r.dP == null ? dash : delta(-400 * r.dP, 400 * r.dPSe, 1, v => v.toFixed(2)) },
    ], rows, r => r.dP ?? 9, 1);
    const t2 = ablTable([
      { th: `Accuracy change<span class="ideal">(positive = improved)</span>`,
        td: r => r.dA == null ? dash : delta(r.dA, r.dASe, 1, v => v.toFixed(2) + '%') },
    ], rows, r => -(r.dA ?? -9), 1);
    mount.innerHTML = ablPanel(t2.html)
      + ablText('As expected here the models got significantly more accurate by spending more tokens to reason about the problem, with a really big jump from Claude Opus 5 in particular. This bit here is not surprising but it is reassuring that our benchmark acts in expected ways with models when turning up their reasoning ability. Note here that Kimi K3 was run at max reasoning as that was the only available option at the time of running.')
      + ablPanel(t1.html)
      + ablText('Here we can see how reasoning improves the Integrity score (Brier score) overall, this seems to be a clear trend except for Gemma 4 26B. We hypothesise this is because more reasoning gives models more time to realise they have made a mistake in their answer, which makes them more calibrated. Even though Claude Opus 5 got the biggest boost in accuracy, Gemini 3.6 Flash got the biggest improvement in terms of its Brier score which is an interesting finding as there is no clear correlation between absolute accuracy points gained with higher reasoning and better calibration, but it seems to trend in a positive direction overall.')
      + ablPanel(t3.html)
      + ablText('To make our findings more robust for the prospective ablation we also ran the same 300 question set but on higher reasoning this time. Compared to the original low reasoning results, it seems that models overall seem to improve with having more thinking tokens, with the notable exception of Muse Spark 1.2, which at the time of release is the best performing model on the benchmark, which shows an interesting blind spot of the model when it needs to predict its ability instead of actually completing the task and this miscalibration seems to get worse the more reasoning is applied to the model.');
    wireAblHovers(mount, [t2.ordered, t1.ordered, t3.ordered]);
  }

  // ---- Follow-up challenges (are-you-sure / expert pushback): paired change columns ----
  async function renderChallenge(mountId, variant, labels = {}) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    const rows = [];
    // Muse Spark 1.1 ran both variants but its provider's serving degraded until most
    // replays never returned; the tables show its successor 1.2 instead (Pablo, 2026-08-09).
    const HIDDEN = new Set(['muse-spark-1.1']);
    for (const rm of Data.roster()) {
      if (!rm.has_data || HIDDEN.has(rm.slug)) continue;
      const r = await Data.areYouSure(rm.slug, variant);
      if (r && r.n >= 50) rows.push({
        slug: rm.slug, display: Data.display(rm.slug), color: Data.providerColor(rm.slug), ...r,
        _help: function () {
          return `<div class="tt-title">${this.display}</div>`
            + `<div class="tt-row">${this.n} challenged answers, paired by question</div>`
            + `<div class="tt-row">Confidence error: ${this.brierBefore.toFixed(3)} &rarr; ${this.brierAfter.toFixed(3)}</div>`
            + `<div class="tt-row">Accuracy: ${this.accBefore.toFixed(1)}% &rarr; ${this.accAfter.toFixed(1)}%</div>`
            + `<div class="tt-row">Mean stated confidence: ${this.confBefore.toFixed(1)}% &rarr; ${this.confAfter.toFixed(1)}%</div>`
            + `<div class="tt-row">Answers that flipped correctness: ${this.flips}</div>`;
        },
      });
    }
    if (!rows.length) { mount.innerHTML = '<div class="table-loading">No data yet.</div>'; return; }
    const t1 = ablTable([
      { th: `Integrity score change ${helpSpan('integrity', 'What the Integrity score means')}<span class="ideal">(positive = improved)</span>`,
        td: r => delta(-400 * r.dBrier, 400 * r.dBrierSe, 1, v => v.toFixed(2)) },
    ], rows, r => r.dBrier, 1);
    const t2 = ablTable([
      { th: `Accuracy change<span class="ideal">(positive = improved)</span>`,
        td: r => delta(r.dAcc, r.dAccSe, 1, v => v.toFixed(2) + '%') },
    ], rows, r => -r.dAcc, 1);
    mount.innerHTML = ablPanel(t1.html)
      + ablText(labels.confText || '')
      + ablPanel(t2.html)
      + ablText(labels.accText || '');
    wireAblHovers(mount, [t1.ordered, t2.ordered]);
  }

  // ---- Told the scoring rule: Brier on the band, accuracy over the full scout set ----
  async function renderBrierTold() {
    const mount = document.getElementById('bt-ablation-mount');
    if (!mount) return;
    const table = await Data.tableRows({ domain: 'overall', scouts: true, effort: 'low' });
    const rows = [];
    for (const rm of Data.roster()) {
      if (!rm.has_data) continue;
      const band = await Data.areYouSure(rm.slug, 'no_tools_brier_told', { band: true });
      const full = await Data.areYouSure(rm.slug, 'no_tools_brier_told');
      const tr = table.find(x => x.slug === rm.slug);
      if (!band || !full || full.n < 50 || !tr || tr.bandRms == null) continue;
      rows.push({
        slug: rm.slug, display: Data.display(rm.slug), color: Data.providerColor(rm.slug),
        // "Not told" Brier = the leaderboard's own headline number (band, widening included),
        // so this column always matches the main table exactly.
        bL: (tr.bandRms / 100) ** 2, bLSe: tr.brierSe,
        bT: band.brierAfter, bTSe: band.brierAfterSe,
        // Accuracy over the full scout set on both sides, matching the main table's accuracy.
        aL: full.accBefore, aLSe: full.accBeforeSe,
        aT: full.accAfter, aTSe: full.accAfterSe,
        nBand: band.n, nFull: full.n,
        _help: function () {
          return `<div class="tt-title">${this.display}</div>`
            + `<div class="tt-row">Brier measured on ${this.nBand} band questions; accuracy on ${this.nFull} scout questions</div>`
            + `<div class="tt-row">Mean stated confidence: ${full.confBefore.toFixed(1)}% &rarr; ${full.confAfter.toFixed(1)}%</div>`
            + `<div class="tt-row">Answers that flipped correctness: ${full.flips}</div>`;
        },
      });
    }
    if (!rows.length) { mount.innerHTML = '<div class="table-loading">No data yet.</div>'; return; }
    // Change-only columns, matching the other ablation tables (told minus not-told)
    const seSum = (a, b) => a != null && b != null ? Math.sqrt(a * a + b * b) : null;
    const t1 = ablTable([
      { th: `Integrity score change ${helpSpan('integrity', 'What the Integrity score means')}<span class="ideal">(positive = improved)</span>`,
        td: r => delta(-400 * (r.bT - r.bL), 400 * seSum(r.bLSe, r.bTSe), 1, v => v.toFixed(2)) },
    ], rows, r => r.bT - r.bL, 1);
    const t2 = ablTable([
      { th: `Accuracy change<span class="ideal">(positive = improved)</span>`,
        td: r => delta(r.aT - r.aL, seSum(r.aLSe, r.aTSe), 1, v => v.toFixed(2) + '%') },
    ], rows, r => -(r.aT - r.aL), 1);
    mount.innerHTML = ablPanel(t1.html)
      + ablText('')
      + ablPanel(t2.html)
      + ablText('As we can see here the results are close to noise on our error bars, it seems that models don\'t actually use this information very effectively to produce better answers which would minimise the Brier score. However this was only run with the best performing model of Muse Spark 1.2 and more data points would make this trend clearer.');
    wireAblHovers(mount, [t1.ordered, t2.ordered]);
  }

  // ---- Prospective confidence: forecast-before-answering vs after, 5 models by default ----
  const CORE5 = ['gpt-5.6-sol', 'claude-opus-5', 'gemini-3.6-flash', 'gemma-4-26b-a4b-it', 'muse-spark-1.2'];
  let prospectiveAll = false;
  async function renderProspective() {
    const mount = document.getElementById('prospective-mount');
    if (!mount) return;
    const table = await Data.tableRows({ domain: 'overall', scouts: true, effort: 'low' });
    let rows = table.filter(r => !r.placeholder && r.prosBrier != null && r.bandRms != null)
      .map(r => ({ ...r, arm: 'low', _help: () => tipHtml({ ...r, arm: 'low' })
        + `<div class="tt-row">Before-answering forecasts: ${r.prosN} band questions</div>` }));
    if (!prospectiveAll) rows = rows.filter(r => CORE5.includes(r.slug));
    if (!rows.length) { mount.innerHTML = '<div class="table-loading">No data yet.</div>'; return; }
    // The model's normal after-answering Integrity score plus the change to its
    // before-answering forecast (positive = the forecast is the better-calibrated one),
    // ranked by the normal score so positions match the main table.
    const pDelta = r => -400 * (r.prosBrier - (r.bandRms / 100) ** 2);
    const pSe = r => r.prosBrierSe != null && r.brierSe != null
      ? 400 * Math.sqrt(r.prosBrierSe ** 2 + r.brierSe ** 2) : null;
    const t1 = ablTable([
      { th: `Integrity Score ${helpSpan('integrity', 'What the Integrity score means')}<span class="ideal">(higher is better)</span>`,
        td: r => (100 - 400 * (r.bandRms / 100) ** 2).toFixed(2)
          + (r.brierSe != null ? `<span class="err">\u00b1${(400 * r.brierSe).toFixed(2)}</span>` : '') },
      { th: `Change<span class="ideal">(forecast vs after answering; positive = the forecast is better)</span>`,
        td: r => delta(pDelta(r), pSe(r), 1, v => v.toFixed(2)) },
    ], rows, r => (r.bandRms / 100) ** 2, 1);
    mount.innerHTML = ablPanel(t1.html)
      + `<button type="button" class="quick-toggle prospective-toggle" id="prospective-toggle">${prospectiveAll ? 'Show just 5 models' : 'Show all models'}</button>`;
    wireAblHovers(mount, [t1.ordered]);
    const btn = document.getElementById('prospective-toggle');
    if (btn) btn.onclick = () => { prospectiveAll = !prospectiveAll; renderProspective(); };
  }

  async function init() {
    buildDropdown();
    setBlurb();
    wire();
    // Advanced panel: column checkboxes (data-col matches st.cols keys)
    document.querySelectorAll('#table-adv input[data-col]').forEach(cb => {
      cb.checked = !!st.cols[cb.dataset.col];
      cb.onchange = () => { st.cols[cb.dataset.col] = cb.checked; render(); };
    });
    // Quick toggle beside the domain dropdown (accuracy is a permanent default column
    // now, so its old toggle is gone). Toggle error bars shows the ±SEs.
    const tErr = document.getElementById('toggle-errbars');
    if (tErr) tErr.onchange = () => { st.errbars = tErr.checked; render(); };
    // (The reasoning-arm slider is gone: both arms are listed in the one table, one row each.)
    // the early-stop toggle's "?" lives outside the table mount, so it's wired once here
    document.querySelectorAll('.table-controls .gap-help').forEach(help =>
      wireHelp(help, () => `<div class="tt-row" style="white-space:normal;max-width:260px">${HELP[help.dataset.helpKey] || ''}</div>`));
    // tap/click outside any tooltip target dismisses the bubble (mobile); taps ON a
    // target must NOT hide here, or the tap's trailing click kills the tip it just opened
    document.addEventListener('click', e => { if (!e.target.closest('.gap-help, .has-tip')) hideTip(); });
    await render();
    renderHigh();   // the high/max ablation table lives further down the page
    renderChallenge('ays-ablation-mount', 'no_tools_are_you_sure', {
      confText: '',
      accText: 'As we can see by the results here, the models are both more calibrated and also more accurate. Our hypothesis for this finding is that, like the high reasoning ablation, the models have more thinking tokens to think through the question and try and find flaws with their answer, leading to a more calibrated and accurate answer.',
    });
    renderChallenge('pressure-ablation-mount', 'no_tools_pressure', {
      confText: '',
      accText: 'The models do in fact significantly change their output and become significantly more calibrated, with this ablation Claude Opus 5 would become the most calibrated model on the benchmark, gaining a massive +30.21 points (Brier score of 0.150 compared to Muse Spark 1.2 getting 0.161 after the prompt follow-up). It seems that models change the way they interact with users and they pick up on details about them and adjust their outputs based on that, we hypothesise that the PhD mention here makes a big difference as models change their outputs based on who they think they are talking to, as shown in <a href="https://transluce.org/user-awareness" target="_blank" rel="noopener">User awareness in frontier models</a>. We are unsure as to what the practical effects of this finding are as a reader could theorise that it would be best after any sufficiently high stakes prompt that is sent to models to send a follow-up message with very harsh pushback on the model\'s response.',
    });
    renderBrierTold();
    renderProspective();
  }

  return { init, renderHigh };
})();

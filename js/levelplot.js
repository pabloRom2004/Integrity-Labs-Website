/* ============================================================
   levelplot.js — the per-level accuracy vs stated-confidence line
   plot in the Methodology section (HTML version of the repo's
   plot_confidence.py scaled plot). Two lines over difficulty
   levels 1–8, a shaded 3-level transition band (accuracy closest
   to 50%), hover tooltips per level, and a caption stating the
   band's mean accuracy + the RMS confidence error inside it.
   Model + domain dropdowns; scout samples, no-tools run.
   ============================================================ */

window.LevelPlot = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const st = { model: null, domain: null };
  let renderToken = 0;

  const ACC = Charts.COLOR.acc, CONF = Charts.COLOR.conf;
  const PROS = '#7C3AED';   // prospective confidence — a third hue, distinct from acc/conf

  /* ---- shared tooltip (same element + classes as the table/charts) ---- */
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

  // Help bubble under a "?" icon (same behaviour as the table's header helps).
  const AREA_HELP = "The shaded area marks the 3 consecutive difficulty levels where the model's accuracy is closest to 50% — the zone where the task stops being solvable for it. The Brier confidence error is computed ONLY from the questions in this area, so a model can't look well calibrated just because a domain was very easy or very hard for it.";
  function showHelpAt(el) {
    tipEl.innerHTML = `<div class="tt-row" style="white-space:normal;max-width:260px">${AREA_HELP}</div>`;
    tipEl.hidden = false;
    const r = el.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - w / 2, y = r.bottom + 8;
    if (x + w > innerWidth - 8) x = innerWidth - 8 - w;
    if (x < 8) x = 8;
    if (y + h > innerHeight - 8) y = r.top - 8 - h;
    tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px';
  }

  /* ---- dropdowns (same custom control as the table's) ---- */
  function buildDropdown(mountId, items, current, onPick) {
    const dd = document.getElementById(mountId);
    const cur = items.find(it => it.value === current) || items[0];
    dd.innerHTML =
      `<button type="button" class="dd-toggle" aria-haspopup="listbox" aria-expanded="false">
         <span class="dd-label">${cur.display}</span>
         <svg class="dd-caret" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
           <path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
         </svg>
       </button>
       <ul class="dd-menu" role="listbox">${
         items.map(it => `<li role="option" data-value="${it.value}" class="${it.value === current ? 'selected' : ''}">${it.display}</li>`).join('')
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
        label.textContent = li.textContent;
        menu.querySelectorAll('li').forEach(x => x.classList.toggle('selected', x === li));
        close();
        onPick(li.dataset.value);
      };
    });
    document.addEventListener('click', e => { if (!dd.contains(e.target)) close(); });
  }

  function el(tag, attrs = {}, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---- render ---- */
  async function render() {
    const token = ++renderToken;
    const mount = document.getElementById('level-plot-mount');
    const caption = document.getElementById('level-plot-caption');
    const desc = document.getElementById('lp-domain-desc');
    mount.innerHTML = '<div class="table-loading">Loading…</div>';
    caption.textContent = '';
    if (desc) desc.textContent = st.domain === 'overall'
      ? 'Every domain pooled — each level averages the model\u2019s samples across all ten.'
      : ((typeof DOMAIN_DESC !== 'undefined' && DOMAIN_DESC[st.domain]) || '');

    const { levels, band, rms, rmsN, bandAcc } = await Data.levelCurve(st.model, st.domain);
    if (token !== renderToken) return;

    if (!levels.length) {
      // A text-only model on an image domain hasn't got a gap in its run — it physically
      // cannot see the rendered views. Say that instead of implying a missing run.
      const textOnly = !!(Data.roster().find(r => r.slug === st.model) || {}).text_only;
      const isImage = !!Data.domains().find(d => d.name === st.domain)?.image;
      mount.innerHTML = `<div class="plot-empty">${textOnly && isImage
        ? 'Model does not support images'
        : 'No data yet for this model in this domain.'}</div>`;
      return;
    }

    // geometry — viewBox units; the SVG scales responsively
    const W = 860, H = 420, mL = 46, mR = 16, mT = 14, mB = 40;
    const iw = W - mL - mR, ih = H - mT - mB;
    const X = l => mL + ((l - 1) / 7) * iw;
    const Y = v => mT + (1 - v / 100) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'level-plot-svg', role: 'img' });

    // shaded RMS band behind everything — edges exactly on the first/last band level.
    // Hidden on the pooled Overall view: the band is picked per domain, so one shaded
    // region would be a fiction there; it reappears as soon as a domain is chosen.
    if (band && st.domain !== 'overall') {
      const x0 = X(band[0]), x1 = X(band[2]);
      svg.appendChild(el('rect', { x: x0, y: mT, width: x1 - x0, height: ih, class: 'lp-band' }));
      svg.appendChild(el('text', { x: (x0 + x1) / 2, y: mT + ih - 10, class: 'lp-band-label', 'text-anchor': 'middle' },
        'Confidence Error Area'));
    }

    // gridlines + y labels
    for (const v of [0, 25, 50, 75, 100]) {
      svg.appendChild(el('line', {
        x1: mL, y1: Y(v), x2: W - mR, y2: Y(v),
        class: v === 50 ? 'lp-grid lp-grid-50' : 'lp-grid',
      }));
      svg.appendChild(el('text', { x: mL - 8, y: Y(v) + 4, class: 'lp-axis', 'text-anchor': 'end' }, v + '%'));
    }
    // x labels
    for (let l = 1; l <= 8; l++)
      svg.appendChild(el('text', { x: X(l), y: H - mB + 22, class: 'lp-axis', 'text-anchor': 'middle' }, String(l)));
    svg.appendChild(el('text', { x: mL + iw / 2, y: H - 4, class: 'lp-axis lp-axis-title', 'text-anchor': 'middle' },
      'Difficulty level'));

    // lines + points (levels with no data simply leave a gap)
    const path = (key, color) => {
      const pts = levels.filter(p => p[key] != null);
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.level)},${Y(p[key])}`).join('');
        svg.appendChild(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
      }
      for (const p of pts) {
        const c = el('circle', { cx: X(p.level), cy: Y(p[key]), r: 5, fill: color, class: 'lp-dot' });
        svg.appendChild(c);
      }
    };
    path('acc', ACC);
    // min–max whisker per confidence dot: the range of stated confidence
    // across that level's samples (drawn under the line + dots)
    for (const p of levels) {
      // Overall pools every domain, where the min-max spread is so wide it just reads as
      // noise: the pooled view shows clean dots only; pick a single domain to see the range.
      if (st.domain === 'overall') break;
      if (p.confMin == null || p.confMax == null || p.confMax <= p.confMin) continue;
      const x = X(p.level), cap = 5;
      const w = el('g', { stroke: CONF, 'stroke-width': 1.6, opacity: 0.45, 'stroke-linecap': 'round' });
      w.appendChild(el('line', { x1: x, y1: Y(p.confMin), x2: x, y2: Y(p.confMax) }));
      w.appendChild(el('line', { x1: x - cap, y1: Y(p.confMin), x2: x + cap, y2: Y(p.confMin) }));
      w.appendChild(el('line', { x1: x - cap, y1: Y(p.confMax), x2: x + cap, y2: Y(p.confMax) }));
      svg.appendChild(w);
    }
    path('conf', CONF);
    // Prospective confidence: a short overlay across the band only (that is all we run),
    // dashed so it reads as a different measurement rather than a continuation of the curve.
    // Prospective is per-domain by construction (each domain has its own band), so it is
    // shown for a single domain and never for the pooled Overall view.
    const showPros = st.domain !== 'overall';
    if (showPros) {
      const pts = levels.filter(p => p.pros != null);
      if (pts.length > 1) {
        const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.level)},${Y(p.pros)}`).join('');
        svg.appendChild(el('path', { d, fill: 'none', stroke: PROS, 'stroke-width': 2.5,
                                     'stroke-dasharray': '7 4', 'stroke-linejoin': 'round' }));
      }
      for (const p of pts)
        svg.appendChild(el('circle', { cx: X(p.level), cy: Y(p.pros), r: 5, fill: PROS, class: 'lp-dot' }));
    }

    // one invisible hover strip per level → tooltip with both values
    for (const p of levels) {
      const strip = el('rect', {
        x: X(p.level) - iw / 14 / 2, y: mT, width: iw / 7 / 2, height: ih,
        fill: 'transparent',
      });
      const inBand = band && band.includes(p.level);
      const html =
        `<div class="tt-title">Level ${p.level}${inBand ? ' · counted in the confidence error' : ''}</div>
         <div class="tt-row"><i style="background:${ACC}"></i>Accuracy: <b>${p.acc.toFixed(0)}%</b></div>
         <div class="tt-row"><i style="background:${CONF}"></i>Average stated confidence: <b>${p.conf == null ? '—' : p.conf.toFixed(1) + '%'}</b>${
           p.confMin != null && p.confMax > p.confMin ? ` <span class="tt-meta">(${p.confMin.toFixed(0)}–${p.confMax.toFixed(0)}%)</span>` : ''}</div>
         ${showPros && p.pros != null ? `<div class="tt-row"><i style="background:${PROS}"></i>Confidence before answering: <b>${p.pros.toFixed(1)}%</b></div>` : ''}
         <div class="tt-meta">${p.n} question${p.n === 1 ? '' : 's'}</div>`;
      strip.classList.add('has-tip');
      strip.addEventListener('mousemove', e => showTip(html, e));
      strip.addEventListener('pointerdown', e => showTip(html, e));   // tap = hover on touch
      strip.addEventListener('mouseleave', hideTip);
      svg.appendChild(strip);
    }

    mount.innerHTML = '';
    mount.appendChild(svg);

    // legend
    const legend = document.createElement('div');
    legend.className = 'legend lp-legend';
    legend.innerHTML =
      `<span><i style="background:${ACC}"></i>Accuracy</span>
       <span><i style="background:${CONF}"></i>Average stated confidence</span>` +
      (showPros && levels.some(p => p.pros != null)
        ? `<span><i style="background:${PROS}"></i>Confidence before answering</span>` : '') +
      (band ? `<span><i class="lp-legend-band"></i>Confidence Error Area <span class="gap-help" id="lp-area-help" tabindex="0" role="button" aria-label="What the Confidence Error Area means">?</span></span>` : '');
    mount.appendChild(legend);
    const help = legend.querySelector('#lp-area-help');
    if (help) {
      // hover only for real mice (touch emulates mouseenter on tap → double-tap bug),
      // keyboard focus via :focus-visible, tap toggles.
      help.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showHelpAt(help); });
      help.addEventListener('mouseleave', hideTip);
      help.addEventListener('focus', () => { if (help.matches(':focus-visible')) showHelpAt(help); });
      help.addEventListener('blur', hideTip);
      help.addEventListener('click', e => {
        e.stopPropagation();
        tipEl.hidden ? showHelpAt(help) : hideTip();
      });
    }

    // no bottom caption: the band shading and hover tooltips carry the numbers
    caption.textContent = '';
  }

  async function init() {
    // models: the roster line-up, data-having only (extrapolated Fable included — it plots
    // whatever sparse points it has). Default: Gemini 3.5 Flash (the example in the prose).
    const models = Data.roster().filter(m => m.has_data)
      .map(m => ({ value: m.slug, display: Data.display(m.slug) }));
    const domains = [{ value: 'overall', display: 'Overall (all domains)' },
      ...Data.domains().map(d => ({ value: d.name, display: Data.domainDisplay(d.name) }))];
    if (!models.length || domains.length < 2) return;
    st.model = (models.find(m => m.value === 'gemini-3.5-flash') || models[0]).value;
    st.domain = 'overall';
    buildDropdown('lp-model-dd', models, st.model, v => { st.model = v; render(); });
    buildDropdown('lp-domain-dd', domains, st.domain, v => { st.domain = v; render(); });
    await render();
  }

  return { init, buildDropdown };
})();

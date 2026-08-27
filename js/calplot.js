/* ============================================================
   calplot.js — the Metaculus-style calibration curve. Scout
   no-tools samples are binned by the model's STATED confidence
   (10%-wide bins, boxes centred on the bin midpoint). Each bin
   draws a gray line at its actual success rate and a box for the
   50% Bayesian (Jeffreys) credible interval of the TRUE success
   rate — Metaculus-style: a calibrated model has the dashed
   diagonal passing through about half the boxes. The mean stated
   confidence lives in the hover tooltip. Model + domain
   dropdowns (domain has Overall); checkbox toggles the boxes.
   ============================================================ */

window.CalPlot = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  const st = { model: null, domain: 'overall', errorBars: true };   // errorBars is always on (toggle removed)
  let renderToken = 0;

  /* ---- shared tooltip (same element + classes as the other plots) ---- */
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

  /* ---- Jeffreys 50% credible interval for k successes of n ----
     (Metaculus uses 50%: calibrated ⇒ the diagonal should cross
     about HALF the boxes.) Posterior Beta(k+.5, n−k+.5); quantiles
     via bisection on the regularised incomplete beta. */
  function logGamma(x) {
    const c = [676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
    x -= 1;
    let a = 0.99999999999980993;
    for (let i = 0; i < 8; i++) a += c[i] / (x + i + 1);
    const t = x + 7.5;
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betacf(a, b, x) {
    const EPS = 3e-9, FPMIN = 1e-30;
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= 200; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  function ibeta(a, b, x) {           // regularised I_x(a,b)
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
      a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a
                                     : 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function betainv(p, a, b) {
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (ibeta(a, b, mid) < p) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }
  const jeffreys = (k, n) =>
    [betainv(0.25, k + 0.5, n - k + 0.5), betainv(0.75, k + 0.5, n - k + 0.5)];

  function el(tag, attrs = {}, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---- render ---- */
  async function render() {
    const token = ++renderToken;
    const mount = document.getElementById('cal-plot-mount');
    const caption = document.getElementById('cal-plot-caption');
    mount.innerHTML = '<div class="table-loading">Loading…</div>';
    caption.textContent = '';

    const pairs = await Data.samplePairs(st.model, st.domain);
    if (token !== renderToken) return;

    if (!pairs.length) {
      mount.innerHTML = '<div class="plot-empty">No data yet for this model in this domain.</div>';
      return;
    }

    // bin by stated confidence: 10 bins of width 10, last bin includes 100
    const bins = [];
    for (let i = 0; i < 10; i++) {
      const lo = i * 10, hi = lo + 10;
      const inBin = pairs.filter(p => p.conf >= lo && (i === 9 ? p.conf <= 100 : p.conf < hi));
      if (!inBin.length) continue;
      const k = inBin.reduce((s, p) => s + p.correct, 0);
      const n = inBin.length;
      const [ciLo, ciHi] = jeffreys(k, n);
      bins.push({
        lo, hi, n, k,
        center: lo + 5,                                       // box sits on the bin midpoint
        meanConf: inBin.reduce((s, p) => s + p.conf, 0) / n,  // shown in the tooltip only
        y: (k / n) * 100,
        ciLo: ciLo * 100, ciHi: ciHi * 100,
      });
    }

    // geometry — near-square so the diagonal reads as the 45° reference
    const W = 640, H = 560, mL = 52, mR = 18, mT = 16, mB = 46;
    const iw = W - mL - mR, ih = H - mT - mB;
    const X = v => mL + (v / 100) * iw;
    const Y = v => mT + (1 - v / 100) * ih;

    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'level-plot-svg cal-plot-svg', role: 'img' });

    // gridlines + axis labels
    for (const v of [0, 25, 50, 75, 100]) {
      svg.appendChild(el('line', { x1: mL, y1: Y(v), x2: W - mR, y2: Y(v), class: 'lp-grid' }));
      svg.appendChild(el('line', { x1: X(v), y1: mT, x2: X(v), y2: H - mB, class: 'lp-grid' }));
      svg.appendChild(el('text', { x: mL - 14, y: Y(v) + 4, class: 'lp-axis', 'text-anchor': 'end' }, v + '%'));
      svg.appendChild(el('text', { x: X(v), y: H - mB + 20, class: 'lp-axis', 'text-anchor': 'middle' }, v + '%'));
    }
    svg.appendChild(el('text', { x: mL + iw / 2, y: H - 4, class: 'lp-axis lp-axis-title', 'text-anchor': 'middle' },
      'Stated confidence'));
    const yTitle = el('text', {
      x: 12, y: mT + ih / 2, class: 'lp-axis lp-axis-title', 'text-anchor': 'middle',
      transform: `rotate(-90 12 ${mT + ih / 2})`,
    }, 'Actual success rate');
    svg.appendChild(yTitle);

    // perfect-calibration diagonal + region labels
    svg.appendChild(el('line', { x1: X(0), y1: Y(0), x2: X(100), y2: Y(100), class: 'cp-diag' }));
    svg.appendChild(el('text', { x: X(22), y: Y(88), class: 'cp-corner', 'text-anchor': 'middle' }, 'Underconfident'));
    svg.appendChild(el('text', { x: X(78), y: Y(12), class: 'cp-corner', 'text-anchor': 'middle' }, 'Overconfident'));

    // Metaculus-style boxes: outlined 50% credible interval + a gray line at the
    // bin's observed success rate, centred on the bin midpoint (5%, 15%, … 95%)
    const color = Data.providerColor(st.model);
    const bw = (iw / 10) * 0.62;                       // box width: 62% of a bin
    for (const b of bins) {
      const cx = X(b.center);
      if (st.errorBars) svg.appendChild(el('rect', {
        x: cx - bw / 2, y: Y(b.ciHi), width: bw, height: Y(b.ciLo) - Y(b.ciHi),
        fill: 'none', stroke: color, 'stroke-width': 1.6, class: 'cp-box',
      }));
      svg.appendChild(el('line', {
        x1: cx - bw / 2, y1: Y(b.y), x2: cx + bw / 2, y2: Y(b.y), class: 'cp-obs',
      }));
      const hitTop = st.errorBars ? Math.min(Y(b.ciHi), Y(b.y)) - 6 : Y(b.y) - 10;
      const hitBot = st.errorBars ? Math.max(Y(b.ciLo), Y(b.y)) + 6 : Y(b.y) + 10;
      const hit = el('rect', {
        x: cx - bw / 2 - 4, y: hitTop, width: bw + 8, height: hitBot - hitTop,
        fill: 'transparent',
      });
      const html =
        `<div class="tt-title">Confidence ${b.lo}–${b.hi}%</div>
         <div class="tt-row">Stated (mean): <b>${b.meanConf.toFixed(1)}%</b></div>
         <div class="tt-row">Actually correct: <b>${b.y.toFixed(1)}%</b> (${b.k}/${b.n})</div>
         <div class="tt-row">50% credible interval: <b>${b.ciLo.toFixed(0)}–${b.ciHi.toFixed(0)}%</b></div>`;
      hit.classList.add('has-tip');
      hit.addEventListener('mousemove', e => showTip(html, e));
      hit.addEventListener('pointerdown', e => showTip(html, e));   // tap = hover on touch
      hit.addEventListener('mouseleave', hideTip);
      svg.appendChild(hit);
    }

    mount.innerHTML = '';
    mount.appendChild(svg);

    // legend + caption
    const legend = document.createElement('div');
    legend.className = 'legend lp-legend';
    legend.innerHTML =
      `<span><i class="cp-legend-obs"></i>Actual success rate</span>` +
      (st.errorBars ? `<span><i class="cp-legend-box" style="border-color:${color}"></i>50% credible interval</span>` : ``) +
      `<span><i class="cp-legend-diag"></i>Perfect calibration</span>`;
    mount.appendChild(legend);

    caption.innerHTML =
      `This plot was heavily inspired by how <a href="https://www.metaculus.com/notebooks/16708/exploring-metaculuss-ai-track-record/#results-for-binary-questions" target="_blank" rel="noopener">Metaculus's track record</a> plotted similar data.`;
  }

  const HOW_TO_READ = 'How to read this plot: the dashed diagonal is perfect calibration, '
    + 'predicted success equals actual success. A box above the line means the model was '
    + 'right more often than its stated confidence (underconfident); a box below the line '
    + 'means it was right less often than it claimed (overconfident).';
  function wireHowHelp() {
    const h = document.getElementById('cp-how-help');
    if (!h) return;
    const show = e => showTip(`<div class="tt-row" style="white-space:normal;max-width:280px">${HOW_TO_READ}</div>`, e);
    h.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') show(e); });
    h.addEventListener('mouseleave', hideTip);
    h.addEventListener('click', e => { e.stopPropagation(); tipEl.hidden ? show(e) : hideTip(); });
  }

  async function init() {
    wireHowHelp();
    const models = Data.roster().filter(m => m.has_data)
      .map(m => ({ value: m.slug, display: Data.display(m.slug) }));
    const domains = [{ value: 'overall', display: 'Overall (all domains)' },
      ...Data.domains().map(d => ({ value: d.name, display: Data.domainDisplay(d.name) }))];
    if (!models.length) return;
    st.model = (models.find(m => m.value === 'gemini-3.5-flash') || models[0]).value;
    LevelPlot.buildDropdown('cp-model-dd', models, st.model, v => { st.model = v; render(); });
    LevelPlot.buildDropdown('cp-domain-dd', domains, st.domain, v => { st.domain = v; render(); });
    await render();
  }

  return { init };
})();

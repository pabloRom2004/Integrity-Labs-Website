/* ============================================================
   charts.js — hand-rendered SVG bar charts.

   Custom (not a charting lib) so we get exact control over a
   diverging axis that crosses zero, grouped accuracy/confidence
   bars, and a per-bar hover tooltip.
   ============================================================ */

const Charts = (() => {
  const SVGNS = 'http://www.w3.org/2000/svg';
  let clipSeq = 0;   // unique clipPath ids across renders/panels

  const COLOR = {
    over: '#D85A39', under: '#3E8E84',
    acc: '#3E8E84', conf: '#E8A04A', accent: '#E2772F',
  };

  const tip = document.getElementById('tooltip');

  function el(tag, attrs = {}, text) {
    const n = document.createElementNS(SVGNS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }

  function showTip(html, e) {
    tip.innerHTML = html;
    tip.hidden = false;
    const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
    let x = e.clientX + pad, y = e.clientY + pad;
    if (x + w > innerWidth - 8)  x = e.clientX - w - pad;
    if (y + h > innerHeight - 8) y = e.clientY - h - pad;
    x = Math.max(8, Math.min(x, innerWidth - w - 8));
    y = Math.max(8, Math.min(y, innerHeight - h - 8));
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  function attachTip(node, html) {
    node.classList.add('has-tip');   // tap-away hider (table.js) leaves taps on targets alone
    node.addEventListener('mousemove', e => showTip(html, e));
    node.addEventListener('pointerdown', e => showTip(html, e));   // tap = hover on touch
    node.addEventListener('mouseleave', hideTip);
  }

  // opts: { mode, yLabel, fmt(v), color(v) | colors, baseZero, yDomain:[min,max] }
  function render(mountEl, rows, opts) {
    mountEl.innerHTML = '';
    if (!rows.length) {
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = opts.emptyText || 'No runs for this selection yet.';
      mountEl.appendChild(empty);
      return;
    }

    const grouped = opts.mode === 'both';
    // Fixed logical canvas — the SVG scales to its container width, so this sets the
    // aspect ratio and the RELATIVE text size, not absolute pixels. The canvas is kept
    // deliberately small (720 units wide) so that, fit to the ~1080px card, every unit
    // renders ~1.5× — making the axis text and bars read large. Tuned with the CSS font
    // sizes in styles.css (.axis-text etc.); change them together.
    const W = 720, H = 522;
    const mL = 74, mR = 18, mT = 30, mB = 144;
    const pw = W - mL - mR, ph = H - mT - mB;
    const n = rows.length;
    const band = pw / n;

    // y domain
    let [lo, hi] = opts.yDomain;
    if (lo === hi) hi = lo + 1;
    const y = v => mT + ph - ((v - lo) / (hi - lo)) * ph;
    const yZero = y(Math.max(lo, Math.min(hi, 0)));

    const svg = el('svg', {
      class: 'chart-svg', viewBox: `0 0 ${W} ${H}`,
      preserveAspectRatio: 'xMidYMid meet', role: 'img',
    });

    // rounded-corner clip for the provider logos (objectBoundingBox = one def fits every
    // logo position); id kept unique per render since two panels can coexist in compare mode
    const clipId = 'logo-clip-' + (clipSeq++);
    const clip = el('clipPath', { id: clipId, clipPathUnits: 'objectBoundingBox' });
    clip.appendChild(el('rect', { width: 1, height: 1, rx: 0.18 }));
    const defs = el('defs');
    defs.appendChild(clip);
    svg.appendChild(defs);

    // gridlines + y ticks
    const ticks = niceTicks(lo, hi, 5);
    for (const t of ticks) {
      const yy = y(t);
      svg.appendChild(el('line', { class: 'grid-line', x1: mL, x2: W - mR, y1: yy, y2: yy }));
      svg.appendChild(el('text', {
        class: 'axis-text', x: mL - 9, y: yy + 6, 'text-anchor': 'end',
      }, opts.tickFmt ? opts.tickFmt(t) : t));
    }
    // zero baseline emphasised
    svg.appendChild(el('line', { class: 'zero-line', x1: mL, x2: W - mR, y1: yZero, y2: yZero }));

    // y-axis title
    svg.appendChild(el('text', {
      class: 'y-title', x: -(mT + ph / 2), y: 15,
      transform: 'rotate(-90)', 'text-anchor': 'middle',
    }, opts.yLabel));

    rows.forEach((r, i) => {
      const cx = mL + i * band + band / 2;
      if (r.placeholder) {
        // A faint dashed column with vertical text — "No data yet" / "Text only model".
        const colW = Math.min(116, band * 0.6);
        const col = el('rect', {
          class: 'placeholder-col', x: cx - colW / 2, y: mT, width: colW, height: ph, rx: 6,
        });
        svg.appendChild(col);
        const ty = mT + ph / 2;
        svg.appendChild(el('text', {
          class: 'placeholder-text', x: cx, y: ty, 'text-anchor': 'middle',
          'dominant-baseline': 'central',                 // centre glyphs on the bar's centre line
          transform: `rotate(-90 ${cx} ${ty})`,
        }, r.placeholder));
      } else if (grouped) {
        const groupW = Math.min(band * 0.72, 110);
        const subW = (groupW - 4) / 2;
        const x0 = cx - groupW / 2;
        const subs = [
          { v: r.accuracy,   c: COLOR.acc,  label: 'Accuracy' },
          { v: r.confidence, c: COLOR.conf, label: 'Confidence' },
        ];
        subs.forEach((s, j) => {
          if (s.v == null) return;
          const yv = y(s.v);
          const rect = el('rect', {
            class: 'bar' + (r.extrapolated ? ' bar-est' : ''),
            x: x0 + j * (subW + 3), y: Math.min(yv, yZero),
            width: subW, height: Math.max(1, Math.abs(yZero - yv)), rx: 3, fill: s.c,
          });
          if (r.extrapolated) { rect.setAttribute('stroke', s.c); }
          attachTip(rect,
            `<div class="tt-title">${r.display}</div>
             <div class="tt-row">Accuracy <b>${r.accuracy == null ? '—' : Math.round(r.accuracy) + '%'}</b> · Confidence <b>${r.confidence == null ? '—' : Math.round(r.confidence) + '%'}</b></div>
             <div class="tt-row">n = ${r.n}</div>${Data.metaRow(r)}`);
          svg.appendChild(rect);
        });
        if (r.accuracy != null && r.confidence != null) {
          const gap = Math.round(r.confidence - r.accuracy);
          svg.appendChild(el('text', {
            class: 'bar-label', x: cx, y: mT - 8, 'text-anchor': 'middle',
          }, (gap > 0 ? '+' : '') + gap));
        }
      } else {
        const v = r.value;
        const yv = y(v);
        const bw = Math.min(100, band * 0.6);
        // bar colour is by PROVIDER (set per-row in data.js); fall back to the metric colour
        const color = r.color || (opts.color ? opts.color(v) : COLOR.accent);
        const rect = el('rect', {
          class: 'bar' + (r.extrapolated ? ' bar-est' : ''),
          x: cx - bw / 2, y: Math.min(yv, yZero), width: bw,
          height: Math.max(1.2, Math.abs(yZero - yv)), rx: 3, fill: color,
        });
        if (r.extrapolated) { rect.setAttribute('stroke', color); }
        attachTip(rect, opts.tip(r));
        svg.appendChild(rect);

        const above = v >= 0;
        svg.appendChild(el('text', {
          class: 'bar-label', x: cx, y: above ? yv - 8 : yv + 22, 'text-anchor': 'middle',
        }, opts.fmt(v)));
      }

      // provider logo, then the model name angled below it (the Artificial Analysis
      // look), with a small "(Text only)" line under text-only models
      const logo = Data.providerLogo(r.slug);
      let labelY = mT + ph + 8;
      if (logo) {
        const ls = Math.min(28, band * 0.8);
        svg.appendChild(el('image', {
          href: logo, x: cx - ls / 2, y: labelY, width: ls, height: ls,
          'clip-path': `url(#${clipId})`, preserveAspectRatio: 'xMidYMid slice',
        }));
        labelY += ls + 6;
      }
      labelY += 13;   // name baseline sits under the logo
      svg.appendChild(el('text', {
        class: 'axis-text model', x: cx, y: labelY,
        'text-anchor': 'end', transform: `rotate(-38 ${cx} ${labelY})`,
      }, r.display));
      const subLabel = r.textOnly ? '(Text only)' : r.extrapolated ? '(Incomplete data)' : null;
      if (subLabel) {
        const subY = labelY + 18;
        svg.appendChild(el('text', {
          class: 'axis-text model-sub', x: cx, y: subY,
          'text-anchor': 'end', transform: `rotate(-38 ${cx} ${subY})`,
        }, subLabel));
      }
    });

    mountEl.appendChild(svg);
  }

  function niceTicks(lo, hi, count) {
    const span = hi - lo;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    const start = Math.ceil(lo / step) * step;
    for (let t = start; t <= hi + 1e-9; t += step) out.push(Math.round(t * 100) / 100);
    return out;
  }

  return { render, COLOR };
})();

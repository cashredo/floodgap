// js/charts.js — hand-rolled inline SVG charts. Pure string builders, no deps.
const Charts = {
  _svg(w, h, inner) {
    return `<svg viewBox="0 0 ${w} ${h}" width="100%" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
  },
  depthDamageCurve(depthDamage, opts = {}) {
    const { currentDepth = 0, baseFloodDepth = null, maxDepth = 12, width = 320, height = 180 } = opts;
    const pad = 28;
    const x = (d) => pad + (d / maxDepth) * (width - 2 * pad);
    const y = (r) => height - pad - r * (height - 2 * pad);
    let path = "";
    for (let d = 0; d <= maxDepth; d += 0.5) {
      path += (d === 0 ? "M" : "L") + x(d).toFixed(1) + " " + y(depthDamage.damageRatio(d)).toFixed(1) + " ";
    }
    const axes =
      `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/>` +
      `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="axis"/>`;
    const bfe = baseFloodDepth != null
      ? `<line x1="${x(baseFloodDepth).toFixed(1)}" y1="${pad}" x2="${x(baseFloodDepth).toFixed(1)}" y2="${height - pad}" class="dd-bfe"/>`
      : "";
    const marker =
      `<circle class="dd-marker" cx="${x(currentDepth).toFixed(1)}" cy="${y(depthDamage.damageRatio(currentDepth)).toFixed(1)}" r="5"/>`;
    return this._svg(width, height, axes + bfe + `<path class="dd-line" d="${path}" fill="none"/>` + marker);
  },
  claimsByYearBars(yearData, opts = {}) {
    const { highlightYear = 2017, width = 320, height = 160 } = opts;
    const pad = 24;
    if (!yearData || yearData.length === 0) {
      return this._svg(width, height, `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" class="empty">No dated claims</text>`);
    }
    const max = Math.max(...yearData.map((d) => d.count), 1);
    const bw = (width - 2 * pad) / yearData.length;
    let bars = "";
    yearData.forEach((d, i) => {
      const h = (d.count / max) * (height - 2 * pad);
      const bx = pad + i * bw;
      const by = height - pad - h;
      const cls = d.year === highlightYear ? "bar bar-highlight" : "bar";
      bars += `<rect class="${cls}" x="${(bx + 1).toFixed(1)}" y="${by.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${d.year}: ${d.count}</title></rect>`;
    });
    const axis = `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/>`;
    return this._svg(width, height, axis + bars);
  },
  lossExceedance(losses, riskMetrics, opts = {}) {
    const { width = 320, height = 160 } = opts;
    const pad = 28;
    const n = losses.length;
    const maxL = losses[n - 1] || 1;
    let path = "";
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 60))) {
      const p = 1 - i / n; // exceedance probability
      const px = pad + (1 - p) * 0 + (losses[i] / maxL) * (width - 2 * pad);
      const py = pad + (1 - p) * (height - 2 * pad);
      path += (path === "" ? "M" : "L") + px.toFixed(1) + " " + py.toFixed(1) + " ";
    }
    const axes =
      `<line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" class="axis"/>` +
      `<line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" class="axis"/>`;
    return this._svg(width, height, axes + `<path class="le-line" d="${path}" fill="none"/>`);
  },
};
if (typeof module !== "undefined" && module.exports) module.exports = Charts;

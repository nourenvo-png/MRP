// Small SVG chart builders (no library)
import { esc, fmtShort } from "./util.js";

export function donut(segments, { size = 150, thickness = 26, center = "", sub = "" } = {}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  const r = (size - thickness) / 2, c = size / 2, C = 2 * Math.PI * r;
  let off = 0, arcs = "";
  if (total === 0) {
    arcs = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#e3e7ee" stroke-width="${thickness}"/>`;
  } else {
    for (const s of segments) {
      if (!s.value) continue;
      const len = (s.value / total) * C;
      arcs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${thickness}"
        stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"><title>${esc(s.label)}: ${s.value}</title></circle>`;
      const mid = (off + len / 2) / C * 2 * Math.PI - Math.PI / 2;
      if (s.value / total > 0.07) {
        arcs += `<text x="${c + r * Math.cos(mid)}" y="${c + r * Math.sin(mid) + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="#fff">${esc(fmtShort(s.value))}</text>`;
      }
      off += len;
    }
  }
  const mid = center !== "" ? `<text x="${c}" y="${c + (sub ? 2 : 7)}" text-anchor="middle" font-size="24" font-weight="800" fill="#0b2a5b">${esc(center)}</text>` +
    (sub ? `<text x="${c}" y="${c + 20}" text-anchor="middle" font-size="12" fill="#5b6b82">${esc(sub)}</text>` : "") : "";
  return `<svg viewBox="0 0 ${size} ${size}" class="donut" role="img">${arcs}${mid}</svg>`;
}

export function legend(segments, { total, fmtV = fmtShort } = {}) {
  const t = total ?? segments.reduce((a, s) => a + s.value, 0);
  return `<ul class="legend">${segments.map((s) => `<li><i style="background:${s.color}"></i><span>${esc(s.label)}</span><b>${fmtV(s.value)}${t ? ` <small>(${Math.round((s.value / t) * 100)}%)</small>` : ""}</b></li>`).join("")}</ul>`;
}

/** Vertical bars, newest on the left (RTL). items: [{label, value, color, highlight}] */
export function vbars(items, { height = 240, width = 440, line = null, fmtV = fmtShort } = {}) {
  const P = { l: 44, r: 8, t: 22, b: 30 };
  const vals = items.map((i) => i.value);
  const max = Math.max(1, ...vals, line ? line.value : 0) * 1.15;
  const raw = max / 4, p = 10 ** Math.floor(Math.log10(raw)), m = raw / p;
  let step = (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
  if (step < 1 && items.every((i) => Number.isInteger(i.value))) step = 1;
  const y = (v) => P.t + (height - P.t - P.b) * (1 - v / max);
  const slot = (width - P.l - P.r) / items.length, bw = Math.min(46, slot * 0.6);
  const x = (i) => width - P.r - slot * (i + 0.5);
  let g = "";
  for (let t = 0; t <= max; t += step) {
    g += `<line x1="${P.l}" x2="${width - P.r}" y1="${y(t)}" y2="${y(t)}" stroke="#e6eaf0"/>`;
    g += `<text x="${P.l - 6}" y="${y(t) + 4}" text-anchor="end" font-size="10.5" fill="#6b7a90">${fmtShort(t)}</text>`;
  }
  let b = "";
  items.forEach((it, i) => {
    const h = Math.max(0, height - P.b - y(it.value));
    b += `<rect x="${x(i) - bw / 2}" y="${y(it.value)}" width="${bw}" height="${h}" rx="3" fill="${it.color}" ${it.dashed ? 'stroke="#0b2a5b" stroke-dasharray="4 3" fill-opacity="0.55"' : ""}><title>${esc(it.label)}: ${fmtV(it.value)}</title></rect>`;
    if (it.value > 0) b += `<text x="${x(i)}" y="${y(it.value) - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#1d2a3d">${fmtV(it.value)}</text>`;
    b += `<text x="${x(i)}" y="${height - P.b + 17}" text-anchor="middle" font-size="11" fill="${it.dashed ? "#0b2a5b" : "#5b6b82"}" ${it.dashed ? 'font-weight="700"' : ""}>${esc(it.label)}</text>`;
  });
  let ln = "";
  if (line && line.value > 0) {
    const ly = y(line.value);
    ln = `<line x1="${P.l}" x2="${width - P.r}" y1="${ly}" y2="${ly}" stroke="#d93025" stroke-width="1.6" stroke-dasharray="6 4"/>
`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" class="vbars" role="img">${g}${b}${ln}</svg>`;
}

/** Horizontal bar rows as HTML (works well in RTL). items: [{label, value, color, note}] */
export function hbars(items, { fmtV = fmtShort, max } = {}) {
  const mx = max ?? Math.max(1, ...items.map((i) => i.value));
  return `<div class="hbars">${items.map((it) => `
    <div class="hb-row" ${it.href ? `data-href="${esc(it.href)}" tabindex="0" role="link"` : ""}>
      <span class="hb-label" title="${esc(it.label)}">${esc(it.label)}</span>
      <span class="hb-track"><span class="hb-fill" style="width:${Math.max(1.5, (it.value / mx) * 100)}%;background:${it.color || "#1f5fd6"}"></span></span>
      <span class="hb-val">${fmtV(it.value)}${it.note ? ` <small>${esc(it.note)}</small>` : ""}</span>
    </div>`).join("")}</div>`;
}

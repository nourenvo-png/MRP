// Forecasting methods on a monthly series (oldest -> newest)

export const METHODS = {
  sma3:  { label: "متوسط آخر 3 شهور", hint: "مناسب للصرف الثابت" },
  wma:   { label: "متوسط موزون 3-2-1", hint: "بيدي وزن أكبر لآخر شهر" },
  trend: { label: "اتجاه خطي (آخر 6 شهور)", hint: "مناسب لو الصرف بيزيد أو بيقل باستمرار" },
  ses:   { label: "تمهيد أسي α=0.3", hint: "بيهدّي التذبذب" },
};
export const METHOD_KEYS = Object.keys(METHODS);

function sma3(s) { const t = s.slice(-3); return t.length ? t.reduce((a, b) => a + b, 0) / t.length : 0; }
function wma(s) {
  const t = s.slice(-3); if (!t.length) return 0;
  const w = [1, 2, 3].slice(-t.length);
  return t.reduce((a, v, i) => a + v * w[i], 0) / w.reduce((a, b) => a + b, 0);
}
function trendLine(s) {
  const t = s.slice(-6), n = t.length;
  if (n < 3) return { a: sma3(s), b: 0, n };
  const xm = (n - 1) / 2, ym = t.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  t.forEach((y, x) => { num += (x - xm) * (y - ym); den += (x - xm) ** 2; });
  const b = den ? num / den : 0;
  return { a: ym - b * xm, b, n };
}
function ses(s, alpha = 0.3) {
  if (!s.length) return 0;
  let l = s[0];
  for (let i = 1; i < s.length; i++) l = alpha * s[i] + (1 - alpha) * l;
  return l;
}

/** Forecast H months ahead. Returns array of length H. */
export function forecast(series, method = "sma3", H = 1) {
  const out = [];
  if (method === "trend") {
    const { a, b, n } = trendLine(series);
    for (let h = 1; h <= H; h++) out.push(Math.max(0, a + b * (n - 1 + h)));
    return out;
  }
  const f = method === "wma" ? wma(series) : method === "ses" ? ses(series) : sma3(series);
  for (let h = 1; h <= H; h++) out.push(Math.max(0, f));
  return out;
}

/** One-step-ahead backtest over the last `k` months. */
export function backtest(series, method, k = 4) {
  let absErr = 0, pctErr = 0, nPct = 0, n = 0;
  const start = Math.max(3, series.length - k);
  for (let i = start; i < series.length; i++) {
    const f = forecast(series.slice(0, i), method, 1)[0];
    const a = series[i];
    absErr += Math.abs(a - f); n++;
    if (a > 0) { pctErr += Math.abs(a - f) / a; nPct++; }
  }
  return { mae: n ? absErr / n : null, mape: nPct ? (pctErr / nPct) * 100 : null, n };
}

export function bestMethod(series) {
  let best = "sma3", bestErr = Infinity;
  if (series.filter((v) => v > 0).length < 4) return best;
  for (const m of METHOD_KEYS) {
    const { mape } = backtest(series, m);
    if (mape != null && mape < bestErr - 0.5) { best = m; bestErr = mape; }
  }
  return best;
}

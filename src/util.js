export const AR_MONTHS = ["يناير","فبراير","مارس","أبريل","مايو","يونيو","يوليو","أغسطس","سبتمبر","أكتوبر","نوفمبر","ديسمبر"];

export const pad = (n) => String(n).padStart(2, "0");
export const mKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1);
export const dKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
export const addM = (k, n) => { const [y, m] = k.split("-").map(Number); return mKey(new Date(y, m - 1 + n, 1)); };
export const mLabel = (k) => { const [y, m] = k.split("-"); return AR_MONTHS[+m - 1] + " " + y.slice(2); };
export const mLabelShort = (k) => AR_MONTHS[+k.split("-")[1] - 1];

export const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
export const nkey = (s) => norm(s).toLowerCase()
  .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/[ًٌٍَُِّْـ]/g, "");

const AR_DIG = "٠١٢٣٤٥٦٧٨٩";
export const toNum = (v) => {
  if (typeof v === "number") return isFinite(v) ? v : null;
  if (v == null) return null;
  const s = String(v).replace(/[٠-٩]/g, (d) => AR_DIG.indexOf(d)).replace(/[,،\s]/g, "").replace("٫", ".");
  if (s === "") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const fmt = (n, d = 0) => (n == null || isNaN(n) || !isFinite(n)) ? "—"
  : Number(n).toLocaleString("en-US", { maximumFractionDigits: d });

export const fmtShort = (n) => {
  if (n == null || isNaN(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 1 : 2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e4) return (n / 1e3).toFixed(0) + "K";
  return fmt(n);
};

export const fmtMoney = (n) => (n == null || isNaN(n)) ? "—" : fmtShort(n) + " ج";

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// Excel serial date -> JS Date (local)
export const fromSerial = (n) => {
  const ms = Math.round((n - 25569) * 86400000);
  const d = new Date(ms);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};

const EN_M = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

// Header like "2026-08", "8/2026", "Aug 2026", "أغسطس 2026", a Date, or a serial -> "YYYY-MM"
export function parseMonth(h) {
  if (h instanceof Date && !isNaN(h)) return mKey(h);
  if (typeof h === "number") return h > 20000 && h < 80000 ? mKey(fromSerial(h)) : null;
  const s = norm(h).replace(/[٠-٩]/g, (d) => AR_DIG.indexOf(d));
  if (!s) return null;
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})$/); if (m && +m[2] >= 1 && +m[2] <= 12) return m[1] + "-" + pad(+m[2]);
  m = s.match(/^(\d{1,2})[-\/.](\d{4})$/); if (m && +m[1] >= 1 && +m[1] <= 12) return m[2] + "-" + pad(+m[1]);
  m = s.toLowerCase().match(/^([a-z]{3})[a-z]*[\s\-\/.']*(\d{2,4})$/);
  if (m && EN_M.includes(m[1])) { let y = +m[2]; if (y < 100) y += 2000; return y + "-" + pad(EN_M.indexOf(m[1]) + 1); }
  for (let i = 0; i < 12; i++) {
    if (nkey(s).startsWith(nkey(AR_MONTHS[i]))) {
      const y = s.match(/\d{2,4}/); if (y) { let yy = +y[0]; if (yy < 100) yy += 2000; return yy + "-" + pad(i + 1); }
    }
  }
  return null;
}

// Any date-ish cell -> "YYYY-MM-DD" (month-only values become the 1st)
export function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return dKey(v);
  if (typeof v === "number") return v > 20000 && v < 80000 ? dKey(fromSerial(v)) : null;
  const s = norm(v).replace(/[٠-٩]/g, (d) => AR_DIG.indexOf(d));
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return y + "-" + pad(+m[2]) + "-" + pad(+m[1]); }
  m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
  if (m) return m[1] + "-" + pad(+m[2]) + "-" + pad(+m[3]);
  const mk = parseMonth(s);
  return mk ? mk + "-01" : null;
}

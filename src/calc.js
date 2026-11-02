import { mKey, addM, dKey } from "./util.js";
import { forecast, bestMethod } from "./forecast.js";

export const STATUS = {
  order: { label: "حرجة - اطلب", short: "اطلب", color: "#d93025" },
  warn:  { label: "قربت من نقطة الطلب", short: "قربت", color: "#f29900" },
  ok:    { label: "رصيد كويس", short: "تمام", color: "#1e8e3e" },
  dead:  { label: "راكدة", short: "راكد", color: "#7b5ea7" },
  nodata:{ label: "مافيش بيانات صرف", short: "لا بيانات", color: "#9aa0a6" },
};
export const STATUS_ORDER = ["order", "warn", "dead", "ok", "nodata"];

export const addDays = (dateStr, n) => {
  const [y, m, d] = dateStr.split("-").map(Number);
  return dKey(new Date(y, m - 1, d + Math.round(n || 0)));
};
export const daysBetween = (a, b) => {
  const p = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(b) - p(a)) / 86400000);
};

/**
 * materials: [{key, code, name, group, unit, qty, price, lead, asOf}]
 * txns: [{key, date, type:"out"|"in"|"scrap", qty, manual}]
 * openOrders: [{key, qty}]
 */
export function compute(materials, txns, settings, openOrders = [], today = new Date()) {
  const byKey = new Map();
  materials.forEach((m) => byKey.set(m.key, { ...m, months: {}, adj: 0, hasStock: true }));
  const ensure = (t) => {
    let m = byKey.get(t.key);
    if (!m) {
      m = { key: t.key, code: t.code || "", name: t.name || t.key, group: "", unit: "", qty: 0, price: null, lead: null, asOf: null, months: {}, adj: 0, hasStock: false };
      byKey.set(t.key, m);
    }
    return m;
  };
  for (const t of txns) {
    const m = ensure(t);
    const mk = t.date.slice(0, 7);
    if (t.type === "out") m.months[mk] = (m.months[mk] || 0) + t.qty;
    if (t.manual && (!m.asOf || t.date >= m.asOf)) m.adj += t.type === "in" ? t.qty : -t.qty;
  }
  const onOrder = new Map();
  openOrders.forEach((o) => onOrder.set(o.key, (onOrder.get(o.key) || 0) + o.qty));

  const cur = mKey(today);
  let latest = null, first = null;
  byKey.forEach((m) => Object.keys(m.months).forEach((k) => {
    if (!latest || k > latest) latest = k;
    if (!first || k < first) first = k;
  }));
  const partial = !latest || latest >= cur;
  const lastFull = latest && latest < cur ? latest : addM(cur, -1);
  const hist = [-2, -1, 0].map((i) => addM(lastFull, i));
  const months = [-5, -4, -3, -2, -1, 0].map((i) => addM(lastFull, i));
  // full monthly axis for forecasting (max 24 months back)
  let start = first && first <= lastFull ? first : addM(lastFull, -5);
  if (start < addM(lastFull, -23)) start = addM(lastFull, -23);
  const axis = [];
  for (let k = start; k <= lastFull; k = addM(k, 1)) axis.push(k);
  const thisM = partial ? cur : lastFull;
  const next = addM(lastFull, 1);
  const todayStr = dKey(today);

  const LT0 = +settings.leadDefault || 14;
  const Z = +settings.z || 1.65;
  const COV = +settings.coverMonths || 1;
  const DEADM = +settings.deadMonths || 6;
  const METHOD = settings.method || "sma3";

  const rows = [...byKey.values()].map((m) => {
    const qty = (m.qty || 0) + m.adj;
    const full = axis.map((k) => m.months[k] || 0);
    const method = METHOD === "auto" ? bestMethod(full) : METHOD;
    const hasHist = full.some((v) => v > 0);
    // لسه مافيش 3 شهور كاملة متسجلة؟ استخدم متوسط الاستهلاك الشهري اللي في شيت المخازن
    const fcFromSheet = m.sheetAvg > 0 && (!hasHist || axis.length < 3);
    const fc = fcFromSheet ? m.sheetAvg : forecast(full, method, 1)[0];
    const h = hist.map((k) => m.months[k] || 0);
    const hm = (h[0] + h[1] + h[2]) / 3;
    const sd = Math.sqrt(h.reduce((a, b) => a + (b - hm) ** 2, 0) / 2);
    const lt = m.lead != null ? m.lead : LT0;
    // حدود الطلب المتسجلة في الشيت ليها الأولوية لو الإعداد مفعّل
    const levelsFromSheet = settings.useSheetLevels !== false && m.sheetRop > 0;
    const ss = levelsFromSheet && m.sheetSafety != null ? m.sheetSafety : Z * sd * Math.sqrt(lt / 30);
    const rop = levelsFromSheet ? m.sheetRop : (fc / 30) * lt + ss;
    const daily = fc / 30;
    const cover = daily > 0 ? qty / daily : null;
    const oo = onOrder.get(m.key) || 0;
    const position = qty + oo;
    const ever = Object.values(m.months).some((v) => v > 0) || fcFromSheet;
    const recentUse = h.some((v) => v > 0) || fcFromSheet || (m.months[cur] || 0) > 0;
    let status, deadQty = 0;
    if (!ever) status = "nodata";
    else if (!recentUse) { status = qty > 0 ? "dead" : "nodata"; deadQty = Math.max(0, qty); }
    else {
      status = position <= rop ? "order" : position <= rop * 1.5 ? "warn" : "ok";
      deadQty = Math.max(0, qty - fc * DEADM);
    }
    const orderQty = status === "order" || status === "warn" ? Math.max(0, Math.ceil(rop + fc * COV - position)) : 0;
    const p = m.price ?? null;
    const lastUse = Object.keys(m.months).filter((k) => m.months[k] > 0).sort().pop() || null;
    return {
      ...m, qty, onOrder: oo, position, hist: h, full, method, fc, fcFromSheet, levelsFromSheet, sd, lt, ss, rop, daily, cover, status, deadQty, orderQty,
      slow: status !== "dead" && deadQty > 0,
      thisMonth: m.months[thisM] || 0,
      series: months.map((k) => m.months[k] || 0),
      lastUse,
      arriveIfToday: addDays(todayStr, lt),
      stockoutDate: daily > 0 ? addDays(todayStr, qty / daily) : null,
      price: p,
      stockVal: p != null ? qty * p : null,
      fcVal: p != null ? fc * p : null,
      orderVal: p != null ? orderQty * p : null,
      deadVal: p != null ? deadQty * p : null,
    };
  });

  return { rows, meta: { hist, months, axis, thisM, partial, next, lastFull, today: todayStr } };
}

export function actionText(r) {
  if (r.status === "order") return r.qty <= r.ss ? "اطلب فورًا" : "اعمل أمر شراء";
  if (r.status === "warn") return "جهّز الطلبية";
  if (r.status === "dead") return "راجع الراكد";
  if (r.slow) return "فيه زيادة";
  return "لا إجراء";
}

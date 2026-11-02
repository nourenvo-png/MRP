// App state, saved in the browser (IndexedDB) so it survives refresh
import { buildFromSources } from "./sources.js";
import { sampleData } from "./sample.js";
import { compute } from "./calc.js";

const DB = "mrp-khamat", STORE = "kv", KEY = "state";

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet() {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const q = db.transaction(STORE).objectStore(STORE).get(KEY);
      q.onsuccess = () => res(q.result);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}
async function idbSet(v) {
  try {
    const db = await idb();
    db.transaction(STORE, "readwrite").objectStore(STORE).put(v, KEY);
  } catch (e) { console.warn("save failed", e); }
}

export const DEFAULT_STATE = {
  sources: [],
  excel: null,       // آخر مزامنة من شيت المخازن (excel_sync.py)
  excelMoves: [],    // حركات كروت الأصناف، بتتجمع شهر ورا شهر
  manual: [],
  orders: [],
  defects: [],
  settings: { leadDefault: 14, z: 1.65, coverMonths: 1, deadMonths: 6, method: "sma3", useSheetLevels: true },
  company: { name: "", logo: "" },
  view: { mode: "units", group: "", status: "" },
};

export const store = {
  state: structuredClone(DEFAULT_STATE),
  derived: null,
  listeners: new Set(),
  async load() {
    const s = await idbGet();
    if (s) this.state = { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) }, view: { ...DEFAULT_STATE.view, ...(s.view || {}) }, company: { ...DEFAULT_STATE.company, ...(s.company || {}) }, orders: s.orders || [], defects: s.defects || [], excelMoves: s.excelMoves || [] };
    this.recompute();
  },
  update(fn) {
    fn(this.state);
    this.recompute();
    idbSet(this.state);
    this.listeners.forEach((l) => l());
  },
  subscribe(l) { this.listeners.add(l); return () => this.listeners.delete(l); },
  recompute() {
    const built = buildFromSources(this.state.sources, this.state.excel, this.state.excelMoves);
    const isSample = !built.hasStock && !built.hasOut;
    const base = isSample ? sampleData() : built;
    const manual = this.state.manual.map((t) => ({ ...t, manual: true, source: "تسجيل يدوي" }));
    // received purchase orders become inbound movements
    this.state.orders.filter((o) => o.status === "received").forEach((o) => manual.push({
      id: "po-" + o.id, key: o.key, code: o.code, name: o.name, date: o.receivedDate, type: "in",
      qty: +o.receivedQty || +o.qty, note: "استلام طلب " + (o.poNo || "") + (o.supplier ? " من " + o.supplier : ""), manual: true, source: "طلب شراء", ref: o.id,
    }));
    // defects that remove stock
    this.state.defects.filter((d) => d.deduct).forEach((d) => manual.push({
      id: "df-" + d.id, key: d.key, code: d.code, name: d.name, date: d.date, type: "scrap",
      qty: +d.qty, note: (d.source === "supplier" ? "عيب مورد" : "عيب استخدام") + (d.kind ? ": " + d.kind : ""), manual: true, source: "عيوب الخامات", ref: d.id,
    }));
    const mats = base.materials;
    const nameOf = new Map(mats.map((m) => [m.key, m.name]));
    manual.forEach((t) => { t.name = nameOf.get(t.key) || t.name; });
    const allTx = [...base.txns, ...manual];
    const openOrders = this.state.orders.filter((o) => o.status === "open");
    const res = compute(mats, allTx, this.state.settings, openOrders);
    this.derived = {
      ...res, isSample, txns: allTx,
      partialSources: !isSample && (!built.hasStock || !built.hasOut),
      hasStock: built.hasStock, hasOut: built.hasOut,
      byKey: new Map(res.rows.map((r) => [r.key, r])),
    };
  },
};

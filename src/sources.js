// Reading Excel files and turning mapped sheets into materials + movements
import { norm, nkey, toNum, toDate, parseMonth, uid, dKey } from "./util.js";

export const ROLES = {
  stock: "رصيد الخامات",
  out: "حركات الصرف",
  in: "حركات الوارد",
  ignore: "تجاهل الشيت ده",
};

export const FIELDS = {
  stock: [["name", "اسم الخامة", true], ["code", "الكود"], ["qty", "الرصيد الحالي", true], ["group", "المجموعة"], ["unit", "الوحدة"], ["price", "سعر الوحدة"], ["lead", "مدة التوريد (يوم)"]],
  out: [["name", "اسم الخامة", true], ["code", "الكود"], ["date", "التاريخ / الشهر", true], ["qty", "الكمية المصروفة", true]],
  in: [["name", "اسم الخامة", true], ["code", "الكود"], ["date", "التاريخ", true], ["qty", "الكمية الواردة", true]],
  ignore: [],
};

const PAT = {
  name: ["اسم الخامه", "اسم الصنف", "الصنف", "صنف", "الخامه", "خامه", "البيان", "الاسم", "اسم", "item", "material", "description", "product", "name"],
  code: ["كود الصنف", "كود", "الكود", "رقم الصنف", "code", "sku", "item no", "part"],
  qty: ["الرصيد", "رصيد", "الكميه الموجوده", "الموجود", "المتاح", "on hand", "stock", "balance", "المنصرف", "منصرف", "المصروف", "مصروف", "صرف", "الوارد", "وارد", "الكميه", "كميه", "qty", "quantity", "consumption", "issued", "received"],
  group: ["المجموعه", "مجموعه", "التصنيف", "تصنيف", "النوع", "group", "category", "type"],
  unit: ["الوحده", "وحده", "unit", "uom"],
  price: ["سعر الوحده", "السعر", "سعر", "التكلفه", "تكلفه", "price", "cost"],
  lead: ["مده التوريد", "التوريد", "مده", "lead"],
  date: ["التاريخ", "تاريخ", "الشهر", "شهر", "date", "month", "الفتره", "period"],
};

export function headerLabels(sheet) {
  return (sheet.rows[0] || []).map((h, i) => {
    if (h instanceof Date) return dKey(h).slice(0, 7);
    const s = norm(h);
    return s || "عمود " + (i + 1);
  });
}

export function guessMap(headers, role) {
  const hk = headers.map(nkey);
  const taken = [];
  const map = {};
  for (const [f] of FIELDS[role] || []) {
    let idx = -1;
    for (const p of PAT[f] || []) {
      const pk = nkey(p);
      idx = hk.findIndex((h, j) => h === pk && !taken.includes(j));
      if (idx < 0) idx = hk.findIndex((h, j) => h.includes(pk) && !taken.includes(j));
      if (idx >= 0) break;
    }
    map[f] = idx;
    if (idx >= 0) taken.push(idx);
  }
  return map;
}

export function monthColumns(sheet) {
  return (sheet.rows[0] || []).map((h, i) => [i, parseMonth(h)]).filter((x) => x[1]);
}

export function guessRole(sheetName, headers, sheet) {
  const n = nkey(sheetName);
  if (/صرف|منصرف|مصروف|استهلاك|issue|consum|usage|out/.test(n)) return "out";
  if (/وارد|استلام|مشتريات|receipt|purchase|\bin\b/.test(n)) return "in";
  if (/رصيد|مخزون|جرد|stock|balance|inventory/.test(n)) return "stock";
  const hk = headers.map(nkey).join("|");
  if (monthColumns(sheet).length >= 2) return "out";
  if (/تاريخ|date|الشهر|month/.test(hk)) return /وارد|receiv/.test(hk) ? "in" : "out";
  if (/رصيد|balance|stock|الموجود|كميه|qty/.test(hk)) return "stock";
  return "ignore";
}

export async function readWorkbook(file) {
  if (!window.XLSX) throw new Error("مكتبة قراءة الإكسيل ماتحملتش. اتأكد إن النت شغال وافتح الصفحة تاني.");
  const buf = await file.arrayBuffer();
  const wb = window.XLSX.read(buf, { type: "array", cellDates: true });
  const sheets = wb.SheetNames.map((name) => {
    let rows = window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: "" });
    let h = rows.findIndex((r) => r.filter((c) => norm(c) !== "").length >= 2);
    if (h < 0) h = 0;
    rows = rows.slice(h).filter((r, i) => i === 0 || r.some((c) => norm(c) !== ""));
    const sheet = { name, rows };
    const headers = headerLabels(sheet);
    const role = guessRole(name, headers, sheet);
    sheet.role = role;
    sheet.map = role === "ignore" ? {} : guessMap(headers, role);
    sheet.wide = role === "out" && sheet.map.date < 0 && monthColumns(sheet).length >= 2;
    return sheet;
  });
  return { id: uid(), fileName: file.name, importedAt: new Date().toISOString(), sheets };
}

export function setRole(sheet, role) {
  sheet.role = role;
  sheet.map = role === "ignore" ? {} : guessMap(headerLabels(sheet), role);
  sheet.wide = role === "out" && sheet.map.date < 0 && monthColumns(sheet).length >= 2;
}

export function sheetProblems(sheet) {
  if (sheet.role === "ignore") return [];
  const miss = (FIELDS[sheet.role] || [])
    .filter(([f, , req]) => req && !(sheet.wide && f === "date") && !(sheet.wide && f === "qty"))
    .filter(([f]) => !(sheet.map[f] >= 0))
    .map(([, l]) => l);
  return miss.length ? ["حدد عمود: " + miss.join("، ")] : [];
}

/** Build materials + movements from all mapped sheets. */
export function buildFromSources(sources, excel = null, excelMoves = []) {
  const mats = new Map();
  const byCode = new Map();
  const byName = new Map();
  const txns = [];
  const keyFor = (code, name) => {
    const c = norm(code), n = nkey(name);
    if (c && byCode.has(nkey(c))) return byCode.get(nkey(c));
    if (n && byName.has(n)) return byName.get(n);
    return c ? "c:" + nkey(c) : "n:" + n;
  };
  let hasStock = false, hasOut = false;

  // 1) شيت المخازن المتزامن (excel_sync.py)
  if (excel && excel.items?.length) {
    hasStock = true;
    const asOf = (excel.source?.modified || excel.syncedAt || "").slice(0, 10);
    for (const it of excel.items) {
      const code = norm(it.code), name = norm(it.name);
      if (!code && !name) continue;
      const key = keyFor(code, name);
      if (mats.has(key)) { mats.get(key).qty += it.balance || 0; continue; }
      mats.set(key, {
        key, code, name: name || code, group: norm(it.group || it.category), unit: norm(it.unit),
        qty: it.balance || 0, price: null, lead: it.leadTime ?? null, asOf, fromExcel: true,
        erpCode: it.erpCode || "", cardSheet: it.cardSheet || "", dept: it.dept || "",
        place: [it.rack, it.subRack, it.shelf].filter(Boolean).join(" / "),
        opening: it.opening, inQty: it.inQty, outQty: it.outQty,
        sheetAvg: it.avgMonthly > 0 ? it.avgMonthly : null,
        sheetSafety: it.safety > 0 ? it.safety : null, sheetRop: it.rop > 0 ? it.rop : null, sheetMax: it.max > 0 ? it.max : null,
        sheetAlarm: it.alarm || "", sheetOrderStatus: it.orderStatus || "", sheetOrderQty: it.orderQty || null,
        abc: it.abc || "", sheetNotes: it.notes || "",
      });
      if (code) byCode.set(nkey(code), key);
      if (name && !byName.has(nkey(name))) byName.set(nkey(name), key);
    }
    for (const mv of excelMoves || []) {
      const key = keyFor(mv.itemCode || mv.code, "");
      const src = { key, code: mv.itemCode || mv.code, manual: false, source: "شيت المخازن", sheet: mv.sheet,
        note: [mv.permit && "إذن " + mv.permit, mv.dept, mv.supplier, mv.po && "طلب " + mv.po].filter(Boolean).join(" · ") };
      if (mv.out) { hasOut = true; txns.push({ ...src, id: "x:" + mv.key + ":o", date: mv.date, type: "out", qty: Math.abs(mv.out) }); }
      if (mv.in) txns.push({ ...src, id: "x:" + mv.key + ":i", date: mv.date, type: "in", qty: Math.abs(mv.in) });
    }
    if (excel.items.some((i) => i.avgMonthly > 0)) hasOut = true;
  }

  for (const src of sources) {
    const asOf = src.importedAt.slice(0, 10);
    for (const sh of src.sheets.filter((s) => s.role === "stock")) {
      if (sheetProblems(sh).length) continue;
      hasStock = true;
      const M = sh.map;
      for (const r of sh.rows.slice(1)) {
        const name = norm(r[M.name]);
        const code = M.code >= 0 ? norm(r[M.code]) : "";
        if (!name && !code) continue;
        const key = keyFor(code, name);
        let m = mats.get(key);
        if (!m) {
          m = { key, code, name: name || code, group: "", unit: "", qty: 0, price: null, lead: null, asOf };
          mats.set(key, m);
          if (code) byCode.set(nkey(code), key);
          if (name) byName.set(nkey(name), key);
        }
        m.qty += toNum(r[M.qty]) || 0;
        if (M.group >= 0 && norm(r[M.group])) m.group = norm(r[M.group]);
        if (M.unit >= 0 && norm(r[M.unit])) m.unit = norm(r[M.unit]);
        if (M.price >= 0 && toNum(r[M.price]) != null) m.price = toNum(r[M.price]);
        if (M.lead >= 0 && toNum(r[M.lead]) != null) m.lead = toNum(r[M.lead]);
      }
    }
  }
  for (const src of sources) {
    for (const sh of src.sheets.filter((s) => s.role === "out" || s.role === "in")) {
      if (sheetProblems(sh).length) continue;
      if (sh.role === "out") hasOut = true;
      const M = sh.map;
      const wideCols = sh.wide ? monthColumns(sh) : null;
      sh.rows.slice(1).forEach((r, i) => {
        const name = norm(r[M.name]);
        const code = M.code >= 0 ? norm(r[M.code]) : "";
        if (!name && !code) return;
        const key = keyFor(code, name);
        const base = { key, code, name: name || code, type: sh.role, manual: false, source: src.fileName, sheet: sh.name };
        if (wideCols) {
          wideCols.forEach(([ci, mk]) => {
            const q = toNum(r[ci]);
            if (q) txns.push({ ...base, id: src.id + sh.name + i + mk, date: mk + "-01", qty: Math.abs(q) });
          });
        } else {
          const d = toDate(r[M.date]);
          const q = toNum(r[M.qty]);
          if (d && q) txns.push({ ...base, id: src.id + sh.name + i, date: d, qty: Math.abs(q) });
        }
      });
    }
  }
  return { materials: [...mats.values()], txns, hasStock, hasOut };
}

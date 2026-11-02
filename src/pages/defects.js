import { store } from "../store.js";
import { donut, legend, hbars, vbars } from "../charts.js";
import { esc, fmt, fmtMoney, fmtShort, uid, mLabelShort, addM, mKey } from "../util.js";
import { materialInput, resolveMaterial, datalist, kpiStrip, confirmButton } from "../ui.js";
import { toast } from "./movements.js";

export const SOURCES = { supplier: ["عيب مورد", "#d93025"], usage: ["عيب استخدام", "#1f5fd6"] };
export const ACTIONS = ["مرتجع للمورد", "إعدام / هالك", "استخدام بشرط", "إعادة تشغيل", "تحت الفحص"];

let ui = { from: "", to: "", source: "", m: "" };

export function defectRows(filter = ui) {
  const d = store.derived;
  return store.state.defects
    .filter((x) => (!filter.from || x.date >= filter.from) && (!filter.to || x.date <= filter.to) &&
      (!filter.source || x.source === filter.source) && (!filter.m || x.key === filter.m))
    .map((x) => {
      const r = d.byKey.get(x.key);
      return { ...x, name: r?.name || x.name, unit: r?.unit || "", price: r?.price ?? null, value: r?.price != null ? r.price * x.qty : null };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** supplier quality: received qty (from received POs) vs supplier-defect qty, per supplier + material */
export function supplierQuality(rows, filter = ui) {
  const map = new Map();
  const k = (s, key) => s + "|" + key;
  store.state.orders.filter((o) => o.status === "received" && o.supplier &&
    (!filter.from || o.receivedDate >= filter.from) && (!filter.to || o.receivedDate <= filter.to)).forEach((o) => {
    const id = k(o.supplier, o.key);
    if (!map.has(id)) map.set(id, { supplier: o.supplier, key: o.key, name: o.name, received: 0, defective: 0, n: 0 });
    map.get(id).received += +o.receivedQty || +o.qty;
  });
  rows.filter((x) => x.source === "supplier").forEach((x) => {
    const s = x.supplier || "مورد غير محدد";
    const id = k(s, x.key);
    if (!map.has(id)) map.set(id, { supplier: s, key: x.key, name: x.name, received: 0, defective: 0, n: 0 });
    const o = map.get(id); o.defective += +x.qty; o.n++;
  });
  return [...map.values()].map((o) => ({ ...o, rate: o.received ? (o.defective / o.received) * 100 : null }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.defective - a.defective);
}

export function renderDefects() {
  const d = store.derived;
  const today = d.meta.today;
  const rows = defectRows();
  const hasVal = rows.some((x) => x.value != null);
  const totVal = rows.reduce((a, x) => a + (x.value || 0), 0);
  const bySrc = Object.entries(SOURCES).map(([k, [l, c]]) => ({ label: l, value: rows.filter((x) => x.source === k).length, color: c }));
  const bySrcVal = Object.entries(SOURCES).map(([k, [l, c]]) => ({ label: l, value: rows.filter((x) => x.source === k).reduce((a, x) => a + (x.value || 0), 0), color: c }));
  const supCount = new Map();
  rows.filter((x) => x.source === "supplier").forEach((x) => { const s = x.supplier || "غير محدد"; supCount.set(s, (supCount.get(s) || 0) + 1); });
  const matCount = new Map();
  rows.forEach((x) => { const o = matCount.get(x.key) || { name: x.name, n: 0, qty: 0, unit: x.unit }; o.n++; o.qty += +x.qty; matCount.set(x.key, o); });
  const curM = mKey(new Date());
  const months = [-5, -4, -3, -2, -1, 0].map((i) => addM(curM, i));
  const monthItems = months.map((k) => ({ label: mLabelShort(k), value: rows.filter((x) => x.date.startsWith(k)).length, color: "#d93025" }));
  const quality = supplierQuality(rows);
  const suppliers = [...store.state.orders.map((o) => o.supplier), ...store.state.defects.map((x) => x.supplier)];
  const kinds = store.state.defects.map((x) => x.kind);
  const mats = [...d.rows].sort((a, b) => a.name.localeCompare(b.name, "ar"));

  return `
  <div class="page-head"><div><h2>عيوب الخامات</h2><p class="muted">سجّل أي عيب في خامة: عيب من المورد ولا عيب في الاستخدام عندنا.</p></div>
    <div class="filters">
      <label class="inline">من<input type="date" id="df-from" value="${ui.from}"></label>
      <label class="inline">إلى<input type="date" id="df-to" value="${ui.to}"></label>
      <select id="df-src"><option value="">النوعين</option>${Object.entries(SOURCES).map(([k, [l]]) => `<option value="${k}" ${ui.source === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <select id="df-m"><option value="">كل الخامات</option>${mats.map((m) => `<option value="${esc(m.key)}" ${m.key === ui.m ? "selected" : ""}>${esc(m.name)}</option>`).join("")}</select>
    </div>
  </div>
  ${kpiStrip([
    ["عدد حالات العيوب", fmt(rows.length)],
    ["عيوب مورد", fmt(bySrc[0].value), "crit"],
    ["عيوب استخدام", fmt(bySrc[1].value)],
    ["قيمة الخامات المعيبة", hasVal ? fmtMoney(totVal) : "—", "dead"],
  ])}
  <section class="grid g-mov">
    <form class="card form" id="df-form" autocomplete="off">
      <h3>تسجيل عيب</h3>
      <div class="seg-radio" role="radiogroup">
        <label><input type="radio" name="df-source" value="supplier" checked><span>عيب مورد</span></label>
        <label><input type="radio" name="df-source" value="usage"><span>عيب استخدام</span></label>
      </div>
      <label>الخامة ${materialInput("df-mat", d.rows, "", "required")}</label>
      <div class="row2">
        <label>التاريخ<input type="date" id="df-date" required value="${today}"></label>
        <label>الكمية المعيبة<input type="number" id="df-qty" min="0" step="any" required></label>
      </div>
      <label id="df-sup-wrap">المورد<input id="df-sup" list="df-sup-list" placeholder="اسم المورد">${datalist("df-sup-list", suppliers)}</label>
      <label id="df-po-wrap">من طلب شراء (اختياري)<select id="df-po"><option value="">—</option></select></label>
      <label>وصف العيب<input id="df-kind" list="df-kind-list" placeholder="مثلاً: رطوبة، كسر، مخالف للمواصفات">${datalist("df-kind-list", kinds)}</label>
      <label>الإجراء<select id="df-action">${ACTIONS.map((a) => `<option>${a}</option>`).join("")}</select></label>
      <label class="check"><input type="checkbox" id="df-deduct" checked> اخصم الكمية المعيبة من الرصيد</label>
      <label>ملاحظة<input id="df-note"></label>
      <p class="err" id="df-err" hidden></p>
      <button class="btn primary" type="submit">سجّل العيب</button>
    </form>
    <div class="stack">
      <div class="grid g3 tight">
        <div class="card"><h3>حسب النوع</h3><div class="donut-wrap">${donut(bySrc, { center: fmt(rows.length), sub: "حالة" })}${legend(hasVal ? bySrcVal : bySrc, { fmtV: hasVal ? fmtMoney : fmt })}</div>${hasVal ? `<p class="cap">الأرقام جنب الأنواع = القيمة بالجنيه</p>` : ""}</div>
        <div class="card"><h3>عيوب الموردين <span class="unit">عدد الحالات</span></h3>${supCount.size ? hbars([...supCount].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([s, n]) => ({ label: s, value: n, color: "#d93025" })), { fmtV: fmt }) : `<p class="empty">مافيش عيوب مورد في الفترة دي.</p>`}</div>
        <div class="card"><h3>آخر 6 شهور <span class="unit">عدد الحالات</span></h3><div class="chart-ltr">${vbars(monthItems, { fmtV: fmt, height: 210, width: 320 })}</div></div>
      </div>
      <div class="card">
        <h3>جودة الموردين <span class="unit">الكمية المعيبة ÷ الكمية المستلمة من طلبات الشراء</span></h3>
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>المورد</th><th>الخامة</th><th>استلمنا</th><th>معيب</th><th>نسبة العيب</th><th>حالات</th></tr></thead>
          <tbody>${quality.map((q) => `<tr><td><b>${esc(q.supplier)}</b></td><td>${esc(q.name)}</td><td class="n">${q.received ? fmt(q.received) : "—"}</td><td class="n">${fmt(q.defective)}</td>
            <td class="n ${q.rate > 2 ? "neg" : ""}">${q.rate == null ? "—" : q.rate.toFixed(1) + "%"}</td><td class="n">${fmt(q.n)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">لما تسجل استلام طلبات وعيوب مورد هتظهر هنا نسبة العيب لكل مورد.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h3>سجل العيوب <span class="count">${fmt(rows.length)}</span></h3>
        <div class="table-wrap"><table class="tbl compact">
          <thead><tr><th>التاريخ</th><th>النوع</th><th>الخامة</th><th>الكمية</th><th>المورد</th><th>وصف العيب</th><th>الإجراء</th><th>القيمة</th><th>اتخصم</th><th></th></tr></thead>
          <tbody>${rows.map((x) => `<tr>
            <td class="mono">${x.date}</td><td><span class="chip ${x.source === "supplier" ? "order" : "plain"}">${SOURCES[x.source][0]}</span></td>
            <td><a href="#/materials/${encodeURIComponent(x.key)}"><b>${esc(x.name)}</b></a></td>
            <td class="n">${fmt(x.qty, 2)} <small>${esc(x.unit)}</small></td><td>${esc(x.supplier || "—")}</td><td>${esc(x.kind || "—")}</td>
            <td>${esc(x.action)}</td><td class="n">${x.value != null ? fmtMoney(x.value) : "—"}</td><td>${x.deduct ? "✓" : "—"}</td>
            <td><button class="btn ghost sm" data-del="${x.id}">حذف</button></td></tr>`).join("") || `<tr><td colspan="10" class="empty">مافيش عيوب متسجلة.</td></tr>`}</tbody>
        </table></div>
      </div>
    </div>
  </section>`;
}

export function bindDefects(root, rerender) {
  const d = store.derived;
  const on = (id, k) => root.querySelector(id)?.addEventListener("change", (e) => { ui[k] = e.target.value; rerender(); });
  on("#df-from", "from"); on("#df-to", "to"); on("#df-src", "source"); on("#df-m", "m");
  const srcVal = () => root.querySelector('input[name="df-source"]:checked').value;
  const supWrap = root.querySelector("#df-sup-wrap"), poWrap = root.querySelector("#df-po-wrap");
  const mat = root.querySelector("#df-mat"), po = root.querySelector("#df-po");
  const refresh = () => {
    const sup = srcVal() === "supplier";
    supWrap.hidden = !sup; poWrap.hidden = !sup;
    const m = resolveMaterial(mat.value, d.rows);
    const opts = m ? store.state.orders.filter((o) => o.key === m.key && o.status !== "cancelled") : [];
    po.innerHTML = `<option value="">—</option>` + opts.map((o) => `<option value="${o.id}">${esc(o.poNo || "طلب")} · ${o.orderDate} · ${esc(o.supplier || "")}</option>`).join("");
    root.querySelector("#df-action").value = sup ? "مرتجع للمورد" : "إعدام / هالك";
  };
  root.querySelectorAll('input[name="df-source"]').forEach((r) => r.addEventListener("change", refresh));
  mat?.addEventListener("change", refresh);
  po?.addEventListener("change", () => { const o = store.state.orders.find((x) => x.id === po.value); if (o?.supplier) root.querySelector("#df-sup").value = o.supplier; });
  if (mat) refresh();

  root.querySelector("#df-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const err = root.querySelector("#df-err");
    const m = resolveMaterial(mat.value, d.rows);
    const qty = +root.querySelector("#df-qty").value;
    if (!m) { err.textContent = "اختار الخامة من الاقتراحات."; err.hidden = false; return; }
    if (!(qty > 0)) { err.textContent = "اكتب الكمية المعيبة."; err.hidden = false; return; }
    const source = srcVal();
    store.update((s) => s.defects.push({
      id: uid(), key: m.key, code: m.code, name: m.name, source, qty,
      date: root.querySelector("#df-date").value,
      supplier: source === "supplier" ? root.querySelector("#df-sup").value.trim() : "",
      poId: source === "supplier" ? po.value : "",
      kind: root.querySelector("#df-kind").value.trim(),
      action: root.querySelector("#df-action").value,
      deduct: root.querySelector("#df-deduct").checked,
      note: root.querySelector("#df-note").value.trim(),
    }));
    toast("اتسجل العيب");
  });
  root.querySelectorAll("[data-del]").forEach((b) => confirmButton(b, () => store.update((s) => { s.defects = s.defects.filter((x) => x.id !== b.dataset.del); })));
}

export function defectFilter() { return ui; }

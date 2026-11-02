import { store } from "../store.js";
import { STATUS, STATUS_ORDER, actionText } from "../calc.js";
import { vbars } from "../charts.js";
import { esc, fmt, fmtMoney, mLabel, mLabelShort, nkey } from "../util.js";
import { typeChip } from "./movements.js";
import { METHODS } from "../forecast.js";
import { orderState, ORDER_STATE } from "./orders.js";

let ui = { q: "", group: "", status: "", sort: "status", dir: 1 };

const COLS = [
  ["code", "الكود"], ["name", "الخامة"], ["group", "المجموعة"], ["status", "الحالة"], ["qty", "الرصيد"],
  ["thisMonth", "مصروف الشهر"], ["fc", "التوقع"], ["rop", "نقطة الطلب"], ["orderQty", "اطلب"],
  ["cover", "تغطية (يوم)"], ["deadQty", "راكد"], ["stockVal", "قيمة الرصيد"],
];

export function renderMaterials() {
  const d = store.derived;
  const groups = [...new Set(d.rows.map((r) => r.group || "بدون مجموعة"))].sort();
  const q = nkey(ui.q);
  let rows = d.rows.filter((r) =>
    (!q || nkey(r.name).includes(q) || nkey(r.code).includes(q)) &&
    (!ui.group || (r.group || "بدون مجموعة") === ui.group) &&
    (!ui.status || r.status === ui.status || (ui.status === "dead" && r.deadQty > 0)));
  const k = ui.sort, dir = ui.dir;
  rows.sort((a, b) => {
    let A = k === "status" ? STATUS_ORDER.indexOf(a.status) : a[k];
    let B = k === "status" ? STATUS_ORDER.indexOf(b.status) : b[k];
    if (typeof A === "string" || typeof B === "string") return String(A || "").localeCompare(String(B || ""), "ar") * dir;
    A = A ?? -Infinity; B = B ?? -Infinity;
    return (A === B ? 0 : A < B ? -1 : 1) * dir;
  });

  return `
  <div class="page-head">
    <h2>الخامات <span class="count">${fmt(rows.length)} من ${fmt(d.rows.length)}</span></h2>
    <div class="filters">
      <input type="search" id="m-q" placeholder="دور بالاسم أو الكود" value="${esc(ui.q)}">
      <select id="m-group"><option value="">كل المجموعات</option>${groups.map((g) => `<option ${g === ui.group ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
      <select id="m-status"><option value="">كل الحالات</option>${STATUS_ORDER.map((s) => `<option value="${s}" ${s === ui.status ? "selected" : ""}>${STATUS[s].label}</option>`).join("")}</select>
    </div>
  </div>
  <div class="m-list">${rows.slice(0, ui.mShow || 60).map((r) => `
    <a class="m-item ${r.status}" href="#/materials/${encodeURIComponent(r.key)}">
      <div class="m-top"><b>${esc(r.name)}</b><span class="chip ${r.status}">${STATUS[r.status].short}</span></div>
      <div class="m-sub">${esc(r.code || "")}${r.group ? " · " + esc(r.group) : ""}${r.place ? " · " + esc(r.place) : ""}</div>
      <div class="m-nums">
        <div><small>الرصيد</small><b>${fmt(r.qty)} <small>${esc(r.unit)}</small></b></div>
        <div><small>حد الطلب</small><b>${fmt(r.rop)}</b></div>
        <div class="${r.orderQty ? "hot" : ""}"><small>اطلب</small><b>${r.orderQty ? fmt(r.orderQty) : "—"}</b></div>
      </div>
    </a>`).join("") || `<p class="empty">مافيش خامات بالفلتر ده.</p>`}
    ${rows.length > (ui.mShow || 60) ? `<button class="btn m-more" id="m-more">اعرض ${fmt(Math.min(60, rows.length - (ui.mShow || 60)))} كمان (فاضل ${fmt(rows.length - (ui.mShow || 60))})</button>` : ""}
  </div>
  <div class="card d-table">
    <div class="table-wrap">
      <table class="tbl">
        <thead><tr>${COLS.map(([c, l]) => `<th data-sort="${c}" class="sortable">${l}${ui.sort === c ? (ui.dir > 0 ? " ▾" : " ▴") : ""}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((r) => `
          <tr data-href="#/materials/${encodeURIComponent(r.key)}">
            <td class="mono">${esc(r.code || "—")}</td><td><b>${esc(r.name)}</b></td><td>${esc(r.group || "—")}</td>
            <td><span class="chip ${r.status}">${STATUS[r.status].short}</span>${r.slow ? ` <span class="chip dead">زيادة</span>` : ""}</td>
            <td class="n">${fmt(r.qty)} <small>${esc(r.unit)}</small></td><td class="n">${fmt(r.thisMonth)}</td><td class="n">${fmt(r.fc)}</td>
            <td class="n">${fmt(r.rop)}</td><td class="n strong">${r.orderQty ? fmt(r.orderQty) : "—"}</td>
            <td class="n">${r.cover == null ? "—" : fmt(r.cover)}</td><td class="n">${r.deadQty ? fmt(r.deadQty) : "—"}</td>
            <td class="n">${r.stockVal == null ? "—" : fmtMoney(r.stockVal)}</td>
          </tr>`).join("") || `<tr><td colspan="${COLS.length}" class="empty">مافيش خامات بالفلتر ده.</td></tr>`}</tbody>
      </table>
    </div>
  </div>`;
}

export function bindMaterials(root, rerender) {
  const q = root.querySelector("#m-q");
  q?.addEventListener("input", (e) => { ui.q = e.target.value; ui.mShow = 60; rerender(); const n = document.getElementById("m-q"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  root.querySelector("#m-group")?.addEventListener("change", (e) => { ui.group = e.target.value; rerender(); });
  root.querySelector("#m-status")?.addEventListener("change", (e) => { ui.status = e.target.value; rerender(); });
  root.querySelector("#m-more")?.addEventListener("click", () => { ui.mShow = (ui.mShow || 60) + 60; rerender(); });
  root.querySelectorAll("th[data-sort]").forEach((th) => th.addEventListener("click", () => {
    const c = th.dataset.sort; ui.dir = ui.sort === c ? -ui.dir : 1; ui.sort = c; rerender();
  }));
}

export function renderMaterial(key) {
  const d = store.derived;
  const r = d.byKey.get(key);
  if (!r) return `<div class="card"><p class="empty">الخامة دي مش موجودة. <a href="#/materials">ارجع للخامات</a></p></div>`;
  const u = r.unit ? " " + esc(r.unit) : "";
  const cov = r.cover == null ? "مافيش صرف" : fmt(r.cover) + " يوم";
  const s = store.state.settings;
  let verdict;
  if (r.status === "dead") verdict = `<div class="verdict dead">راكدة: مافيش صرف آخر 3 شهور. الرصيد كله <b>${fmt(r.deadQty)}${u}</b> راكد${r.deadVal != null ? ` بقيمة <b>${fmtMoney(r.deadVal)}</b>` : ""}${r.lastUse ? `، آخر صرف كان ${mLabel(r.lastUse)}` : ""}.</div>`;
  else if (r.status === "nodata") verdict = `<div class="verdict nodata">مافيش أي صرف متسجل للخامة دي، فمش هقدر أتوقع أو أحسب نقطة طلب.</div>`;
  else if (r.status === "order") verdict = `<div class="verdict order">الرصيد (${fmt(r.qty)}) وصل لنقطة إعادة الطلب (${fmt(r.rop)}). <b>اطلب ${fmt(r.orderQty)}${u}</b> دلوقتي. التوريد بياخد ${fmt(r.lt)} يوم، فلو اتطلبت النهارده هتتسجل في المخازن يوم <b>${r.arriveIfToday}</b>، والرصيد يكفي ${cov}.${r.onOrder ? ` (فيه ${fmt(r.onOrder)} تحت الطلب ومحسوبين.)` : ""}</div>`;
  else if (r.status === "warn") verdict = `<div class="verdict warn">فاضل <b>${fmt(r.qty - r.rop)}${u}</b> وتوصل لنقطة الطلب، يعني حوالي ${fmt((r.qty - r.rop) / r.daily)} يوم. الطلبية المقترحة ${fmt(r.orderQty)}${u}.</div>`;
  else verdict = `<div class="verdict ok">الرصيد يكفي ${cov}. هتوصل لنقطة الطلب بعد حوالي ${fmt((r.qty - r.rop) / r.daily)} يوم.</div>`;
  if (r.slow) verdict += `<div class="verdict dead">فيه زيادة راكدة <b>${fmt(r.deadQty)}${u}</b>${r.deadVal != null ? ` (${fmtMoney(r.deadVal)})` : ""} فوق احتياج ${s.deadMonths} شهور.</div>`;

  const items = d.meta.months.map((k, i) => ({ label: mLabelShort(k), value: r.series[i], color: "#1f5fd6" }));
  items.push({ label: "توقع " + mLabelShort(d.meta.next), value: r.fc, color: "#f29900", dashed: true });
  const tx = d.txns.filter((t) => t.key === r.key).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 15);
  const orders = store.state.orders.filter((o) => o.key === r.key && o.status !== "cancelled").sort((a, b) => b.orderDate.localeCompare(a.orderDate)).slice(0, 8);
  const kv = (l, v, sub = "") => `<div class="kv"><small>${l}</small><b>${v}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;

  return `
  <div class="page-head">
    <div>
      <a class="link" href="#/materials">→ كل الخامات</a>
      <h2>${esc(r.name)} <span class="chip ${r.status}">${STATUS[r.status].label}</span></h2>
      <p class="muted">${esc(r.code || "")}${r.group ? " · " + esc(r.group) : ""}${r.unit ? " · الوحدة: " + esc(r.unit) : ""}${r.price != null ? " · سعر الوحدة: " + fmt(r.price, 2) + " ج" : ""}</p>
      ${r.fromExcel ? `<p class="muted">${[r.erpCode && "ERP: " + esc(r.erpCode), r.cardSheet && "كارت الصنف: " + esc(r.cardSheet), r.place && "المكان: " + esc(r.place), r.dept && "جهة الصرف: " + esc(r.dept), r.abc && "ABC: " + esc(r.abc)].filter(Boolean).join(" · ")}</p>` : ""}
    </div>
    <div class="actions"><a class="btn" href="#/movements?m=${encodeURIComponent(r.key)}">سجّل حركة</a><a class="btn primary" href="#/orders?m=${encodeURIComponent(r.key)}">اعمل طلب شراء</a></div>
  </div>
  <section class="grid g-detail">
    <div class="card">
      <div class="kvs">
        ${kv("الكمية الموجودة", fmt(r.qty), esc(r.unit))}
        ${kv("مصروف " + mLabel(d.meta.thisM) + (d.meta.partial ? " (لسه ماخلصش)" : ""), fmt(r.thisMonth), esc(r.unit))}
        ${kv("توقع " + mLabel(d.meta.next), fmt(r.fc), esc(r.unit))}
        ${kv("نقطة إعادة الطلب", fmt(r.rop), r.levelsFromSheet ? "من الشيت" : esc(r.unit))}
        ${kv("مخزون الأمان", fmt(r.ss), r.levelsFromSheet && r.sheetSafety != null ? "من الشيت" : esc(r.unit))}
        ${kv("الرصيد يكفي", cov)}
        ${kv("مدة التوريد", fmt(r.lt) + " يوم", r.lead == null ? "افتراضي" : "")}
        ${kv("الراكد", r.deadQty ? fmt(r.deadQty) : "0", r.deadVal ? fmtMoney(r.deadVal) : "")}
        ${kv("تحت الطلب", fmt(r.onOrder), esc(r.unit))}
        ${kv("لو طلبت النهارده توصل", r.arriveIfToday, r.stockoutDate ? "الرصيد يخلص " + r.stockoutDate : "")}
      </div>
      ${verdict}
      ${r.fromExcel && (r.sheetAlarm || r.sheetOrderStatus || r.sheetMax || r.sheetNotes) ? `<div class="sheet-flags">
        <small>من شيت المخازن:</small>
        ${r.sheetAlarm ? `<span class="chip ${/^ok$/i.test(r.sheetAlarm) ? "ok" : /over/i.test(r.sheetAlarm) ? "dead" : "order"}">alarm: ${esc(r.sheetAlarm)}</span>` : ""}
        ${r.sheetOrderStatus ? `<span class="chip order">${esc(r.sheetOrderStatus)}${r.sheetOrderQty ? " · " + fmt(r.sheetOrderQty) : ""}</span>` : ""}
        ${r.sheetMax ? `<span class="chip plain">الحد الأقصى ${fmt(r.sheetMax)}</span>` : ""}
        ${r.opening != null ? `<span class="chip plain">أول المدة ${fmt(r.opening, 2)} · وارد ${fmt(r.inQty, 2)} · منصرف ${fmt(r.outQty, 2)}</span>` : ""}
        ${r.sheetNotes ? `<p class="cap">${esc(r.sheetNotes)}</p>` : ""}
      </div>` : ""}
    </div>
    <div class="card">
      <h3>المصروف الشهري <span class="unit">${esc(r.unit || "كمية")}</span></h3>
      <div class="chart-ltr">${vbars(items, { line: r.rop > 0 ? { value: r.rop, label: "نقطة الطلب " + fmt(r.rop) } : null, fmtV: (n) => fmt(n) })}</div>
      ${r.rop > 0 ? `<p class="cap"><span class="rop-key"></span> الخط الأحمر = نقطة إعادة الطلب (${fmt(r.rop)})</p>` : ""}
      <p class="cap">${r.fcFromSheet ? `التوقع = متوسط الاستهلاك الشهري من شيت المخازن (لحد ما يتجمع تاريخ شهور كاملة من المزامنة)` : `التوقع بطريقة "${METHODS[r.method].label}" · آخر 3 شهور: ${r.hist.map((n) => fmt(n)).join(" ، ")}`}</p>
    </div>
  </section>
  ${orders.length ? `<section class="card">
    <div class="card-head"><h3>طلبات الشراء</h3><a class="link" href="#/orders">كل الطلبات ←</a></div>
    <div class="table-wrap"><table class="tbl compact">
      <thead><tr><th>رقم الطلب</th><th>المورد</th><th>الكمية</th><th>تاريخ الطلب</th><th>الليد تايم</th><th>هتتسجل في المخازن</th><th>الحالة</th></tr></thead>
      <tbody>${orders.map((o) => { const st = orderState(o, d.meta.today); return `<tr><td class="mono">${esc(o.poNo || "—")}</td><td>${esc(o.supplier || "—")}</td><td class="n">${fmt(o.qty, 2)}</td><td class="mono">${o.orderDate}</td><td class="n">${fmt(o.lead)}</td><td class="mono strong">${st === "received" ? o.receivedDate : o.expected}</td><td><span class="chip ${ORDER_STATE[st][1]}">${ORDER_STATE[st][0]}</span></td></tr>`; }).join("")}</tbody>
    </table></div>
  </section>` : ""}
  <section class="card">
    <div class="card-head"><h3>آخر الحركات</h3><a class="link" href="#/movements?m=${encodeURIComponent(r.key)}">كل حركات الخامة ←</a></div>
    <div class="table-wrap"><table class="tbl compact">
      <thead><tr><th>التاريخ</th><th>النوع</th><th>الكمية</th><th>المصدر</th><th>ملاحظة</th></tr></thead>
      <tbody>${tx.map((t) => `<tr><td class="mono">${t.date}</td><td>${typeChip(t.type)}</td><td class="n">${fmt(t.qty)}</td><td>${esc(t.source)}${t.sheet ? " / " + esc(t.sheet) : ""}</td><td>${esc(t.note || "")}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">مافيش حركات.</td></tr>`}</tbody>
    </table></div>
  </section>`;
}

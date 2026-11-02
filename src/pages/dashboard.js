import { store } from "../store.js";
import { STATUS, STATUS_ORDER, actionText } from "../calc.js";
import { donut, legend, vbars, hbars } from "../charts.js";
import { esc, fmt, fmtShort, fmtMoney, mLabelShort, mLabel } from "../util.js";

const GROUP_COLORS = ["#1f5fd6", "#1e8e3e", "#f29900", "#7b5ea7", "#00897b", "#c2185b", "#5d4037"];

export function filteredRows() {
  const { rows } = store.derived;
  const v = store.state.view;
  return rows.filter((r) => (!v.group || (r.group || "بدون مجموعة") === v.group) && (!v.status || r.status === v.status));
}

export function renderDashboard() {
  const d = store.derived;
  const v = store.state.view;
  const val = v.mode === "value";
  const rows = filteredRows();
  const hasPrice = rows.some((r) => r.price != null);
  const M = (r, unitsKey, valueKey) => (val ? r[valueKey] || 0 : r[unitsKey] || 0);
  const F = val ? fmtMoney : fmtShort;

  // KPIs
  const count = (s) => rows.filter((r) => r.status === s).length;
  const need = rows.reduce((a, r) => a + M(r, "fc", "fcVal"), 0);
  const orderTot = rows.reduce((a, r) => a + M(r, "orderQty", "orderVal"), 0);
  const stockVal = rows.reduce((a, r) => a + (r.stockVal || 0), 0);
  const deadVal = rows.reduce((a, r) => a + (r.deadVal || 0), 0);
  const deadN = rows.filter((r) => r.deadQty > 0).length;
  const covs = rows.filter((r) => r.cover != null);
  const avgCov = covs.length ? covs.reduce((a, r) => a + Math.min(r.cover, 365), 0) / covs.length : null;

  const kpis = [
    ["box", "إجمالي الخامات", fmt(rows.length), ""],
    ["alert", "خامات حرجة", fmt(count("order")), "crit"],
    ["cart", "لازم تتطلب", fmt(count("order") + count("warn")), "warn"],
    ["clip", "احتياج " + mLabelShort(d.meta.next) + (val ? " (قيمة)" : " (كمية)"), F(need), ""],
    ["cash", "قيمة الطلبيات المقترحة", hasPrice ? fmtMoney(rows.reduce((a, r) => a + (r.orderVal || 0), 0)) : "—", ""],
    ["stack", "قيمة المخزون", hasPrice ? fmtMoney(stockVal) : "—", ""],
    ["moon", "الراكد", hasPrice ? fmtMoney(deadVal) : fmt(deadN) + " خامة", "dead", hasPrice ? deadN + " خامة" : ""],
    ["clock", "متوسط التغطية", avgCov == null ? "—" : fmt(avgCov), "", "يوم"],
  ];

  // status donut
  const SHORT = { order: "حرجة - اطلب", warn: "قربت", dead: "راكدة", ok: "تمام", nodata: "بدون صرف" };
  const stSeg = STATUS_ORDER.map((s) => ({ label: SHORT[s], value: count(s), color: STATUS[s].color }));

  // monthly bars + forecast
  const monthTotals = d.meta.months.map((k, i) => rows.reduce((a, r) => a + (val ? r.series[i] * (r.price || 0) : r.series[i]), 0));
  const barItems = d.meta.months.map((k, i) => ({ label: mLabelShort(k), value: monthTotals[i], color: "#1f5fd6" }));
  barItems.push({ label: "توقع " + mLabelShort(d.meta.next), value: need, color: "#f29900", dashed: true });

  // top 10 by need
  const top = [...rows].filter((r) => M(r, "fc", "fcVal") > 0).sort((a, b) => M(b, "fc", "fcVal") - M(a, "fc", "fcVal")).slice(0, 10);
  const topTotal = rows.reduce((a, r) => a + M(r, "fc", "fcVal"), 0) || 1;

  // coverage buckets
  const cb = [
    { label: "> 30 يوم", value: rows.filter((r) => r.cover != null && r.cover > 30).length, color: "#1e8e3e" },
    { label: "15 – 30 يوم", value: rows.filter((r) => r.cover != null && r.cover >= 15 && r.cover <= 30).length, color: "#f29900" },
    { label: "< 15 يوم", value: rows.filter((r) => r.cover != null && r.cover < 15).length, color: "#d93025" },
    { label: "بدون صرف", value: rows.filter((r) => r.cover == null).length, color: "#9aa0a6" },
  ];

  // by group
  const groups = new Map();
  rows.forEach((r) => {
    const g = r.group || "بدون مجموعة";
    if (!groups.has(g)) groups.set(g, { cov: [], need: 0, stock: 0, n: 0 });
    const o = groups.get(g);
    o.n++;
    if (r.cover != null) o.cov.push(Math.min(r.cover, 365));
    o.need += M(r, "fc", "fcVal");
    o.stock += r.stockVal || 0;
  });
  const gList = [...groups.entries()].map(([g, o], i) => ({ g, ...o, avg: o.cov.length ? o.cov.reduce((a, b) => a + b, 0) / o.cov.length : 0, color: GROUP_COLORS[i % GROUP_COLORS.length] }));
  const gNeedSeg = gList.map((x) => ({ label: x.g, value: x.need, color: x.color }));

  // action table
  const act = rows.filter((r) => r.status === "order" || r.status === "warn" || r.status === "dead" || r.slow)
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.cover ?? 1e9) - (b.cover ?? 1e9));

  const sumRow = (label, v, cls = "") => `<div class="vs-row ${cls}"><span>${label}</span><b>${v}</b></div>`;
  const s = store.state.settings;

  return `
  ${d.isSample ? `<div class="banner">دي <b>بيانات مثال</b>. روح لصفحة <a href="#/sheets">الشيتات</a> وارفع ملفات الإكسيل بتاعتك عشان تشوف أرقامك.</div>` : ""}
  ${d.partialSources ? `<div class="banner warn">${!d.hasStock ? "لسه مافيش شيت رصيد متحدد." : "لسه مافيش شيت صرف متحدد، فالتوقع ونقطة الطلب مش هيتحسبوا."} كمّل من صفحة <a href="#/sheets">الشيتات</a>.</div>` : ""}

  <section class="kpis">
    ${kpis.map(([ic, l, n, cls, sub]) => `<div class="kpi ${cls}"><span class="kpi-ic">${icon(ic)}</span><div><small>${l}</small><b>${n}${sub ? ` <em>${sub}</em>` : ""}</b></div></div>`).join("")}
  </section>

  <section class="grid g3">
    <div class="card">
      <h3>الخامات حسب الحالة</h3>
      <div class="donut-wrap">${donut(stSeg, { center: fmt(rows.length), sub: "خامة" })}${legend(stSeg, { fmtV: fmt })}</div>
    </div>
    <div class="card">
      <h3>المصروف الشهري وتوقع الشهر الجاي <span class="unit">${val ? "بالجنيه" : "بالكمية"}</span></h3>
      <div class="chart-ltr">${vbars(barItems, { fmtV: fmtShort })}</div>
      <p class="cap">التوقع محسوب بالطريقة المعتمدة في صفحة <a href="#/forecast">الفوركاست</a></p>
    </div>
    <div class="card">
      <h3>أعلى 10 خامات في الاحتياج <span class="unit">${val ? "بالجنيه" : "بالكمية"}</span></h3>
      ${top.length ? hbars(top.map((r) => ({ label: r.name, value: M(r, "fc", "fcVal"), note: Math.round((M(r, "fc", "fcVal") / topTotal) * 100) + "%", href: "#/materials/" + encodeURIComponent(r.key) })), { fmtV: F }) : `<p class="empty">مافيش صرف متسجل.</p>`}
      ${val ? "" : `<p class="cap">الوحدات مختلفة بين الخامات، فالمقارنة بالقيمة أدق.</p>`}
    </div>
  </section>

  <section class="grid g3">
    <div class="card">
      <h3>التغطية (أيام)</h3>
      <div class="donut-wrap">${donut(cb, { center: avgCov == null ? "—" : fmt(avgCov), sub: "يوم متوسط" })}${legend(cb, { fmtV: fmt })}</div>
    </div>
    <div class="card">
      <h3>متوسط التغطية حسب المجموعة <span class="unit">يوم</span></h3>
      ${hbars(gList.map((x) => ({ label: x.g, value: x.avg, color: "#1e8e3e" })), { fmtV: (n) => fmt(n) })}
    </div>
    <div class="card">
      <h3>الاحتياج حسب المجموعة <span class="unit">${val ? "بالجنيه" : "بالكمية"}</span></h3>
      <div class="donut-wrap">${donut(gNeedSeg, { thickness: 30 })}${legend(gNeedSeg, { fmtV: F })}</div>
    </div>
  </section>

  <section class="grid g-main">
    <div class="card">
      <div class="card-head"><h3>خامات محتاجة إجراء</h3><a class="link" href="#/materials">كل الخامات ←</a></div>
      <div class="table-wrap">
        <table class="tbl">
          <thead><tr><th>الكود</th><th>الخامة</th><th>التغطية (يوم)</th><th>الرصيد</th><th>تحت الطلب</th><th>التوقع/شهر</th><th>التوريد (يوم)</th><th>مخزون الأمان</th><th>نقطة الطلب</th><th>الكمية المقترحة</th><th>الراكد</th><th>الإجراء</th><th>الحالة</th></tr></thead>
          <tbody>${act.length ? act.map((r) => `
            <tr data-href="#/materials/${encodeURIComponent(r.key)}">
              <td class="mono">${esc(r.code || "—")}</td><td><b>${esc(r.name)}</b></td>
              <td class="n ${r.cover != null && r.cover < 15 ? "neg" : ""}">${r.cover == null ? "—" : fmt(r.cover)}</td>
              <td class="n">${fmt(r.qty)} <small>${esc(r.unit)}</small></td><td class="n">${r.onOrder ? fmt(r.onOrder) : "—"}</td><td class="n">${fmt(r.fc)}</td><td class="n">${fmt(r.lt)}</td>
              <td class="n">${fmt(r.ss)}</td><td class="n">${fmt(r.rop)}</td><td class="n strong">${r.orderQty ? fmt(r.orderQty) : "—"}</td>
              <td class="n">${r.deadQty ? fmt(r.deadQty) : "—"}</td>
              <td>${actionText(r)}</td><td><span class="chip ${r.status}">${STATUS[r.status].short}</span>${r.slow ? ` <span class="chip dead">زيادة</span>` : ""}</td>
            </tr>`).join("") : `<tr><td colspan="13" class="empty">كل الخامات في الأمان دلوقتي.</td></tr>`}</tbody>
        </table>
      </div>
    </div>
    <div class="side">
      <div class="card">
        <h3>ملخص القيمة</h3>
        ${hasPrice ? `
          ${sumRow("قيمة المخزون الحالي", fmtMoney(stockVal))}
          ${sumRow("قيمة احتياج " + mLabelShort(d.meta.next), fmtMoney(rows.reduce((a, r) => a + (r.fcVal || 0), 0)))}
          ${sumRow("قيمة الطلبيات المقترحة", fmtMoney(rows.reduce((a, r) => a + (r.orderVal || 0), 0)))}
          ${sumRow("قيمة الراكد", fmtMoney(deadVal), "neg")}
          ${sumRow("نسبة الراكد من المخزون", stockVal ? Math.round((deadVal / stockVal) * 100) + "%" : "—", "neg")}
        ` : `<p class="empty">أضف عمود سعر الوحدة في شيت الرصيد عشان القيم تظهر.</p>`}
      </div>
      <div class="card params">
        <h3>المعاملات</h3>
        <label>مدة التوريد الافتراضية (يوم)<input type="number" min="0" id="p-lead" value="${s.leadDefault}"></label>
        <label>مستوى الخدمة
          <select id="p-z">${[["1.28", "90%"], ["1.65", "95%"], ["2.05", "98%"], ["2.33", "99%"]].map(([z, l]) => `<option value="${z}" ${+s.z === +z ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>الطلبية تغطي (شهر)<input type="number" min="0.5" step="0.5" id="p-cov" value="${s.coverMonths}"></label>
        <label>راكد لو الرصيد أكتر من (شهر)<input type="number" min="1" id="p-dead" value="${s.deadMonths}"></label>
        <p class="cap">طريقة التوقع بتتغير من صفحة <a href="#/forecast">الفوركاست</a> · نقطة الطلب: صرف يومي × مدة التوريد + مخزون الأمان.</p>
      </div>
    </div>
  </section>

  <section class="card">
    <h3>المصروف حسب الشهر <span class="unit">${val ? "بالجنيه" : "بالكمية"}</span></h3>
    <div class="table-wrap"><table class="tbl compact"><thead><tr>${d.meta.months.map((k) => `<th>${mLabel(k)}</th>`).join("")}<th class="hl">توقع ${mLabel(d.meta.next)}</th></tr></thead>
    <tbody><tr>${monthTotals.map((t) => `<td class="n">${F(t)}</td>`).join("")}<td class="n hl strong">${F(need)}</td></tr></tbody></table></div>
  </section>`;
}

export function bindDashboard(root) {
  const set = (k, v) => store.update((s) => { s.settings[k] = v; });
  root.querySelector("#p-lead")?.addEventListener("change", (e) => set("leadDefault", +e.target.value || 0));
  root.querySelector("#p-z")?.addEventListener("change", (e) => set("z", +e.target.value));
  root.querySelector("#p-cov")?.addEventListener("change", (e) => set("coverMonths", +e.target.value || 1));
  root.querySelector("#p-dead")?.addEventListener("change", (e) => set("deadMonths", +e.target.value || 6));
}

export function icon(n) {
  const p = {
    box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    alert: '<path d="M12 3l10 18H2L12 3z"/><path d="M12 10v5"/><circle cx="12" cy="18" r=".6"/>',
    cart: '<circle cx="9" cy="20" r="1.5"/><circle cx="18" cy="20" r="1.5"/><path d="M2 3h3l3 12h11l2-8H6.5"/>',
    clip: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2"/><path d="M9 10h6M9 14h6M9 18h3"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>',
    stack: '<path d="M4 7h16M4 12h16M4 17h16"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
    moon: '<path d="M20 14A8 8 0 1110 4a6 6 0 0010 10z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  }[n] || "";
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
}

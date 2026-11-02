import { store } from "../store.js";
import { STATUS, STATUS_ORDER, actionText, daysBetween } from "../calc.js";
import { METHODS } from "../forecast.js";
import { forecastTable } from "./forecastPage.js";
import { defectRows, supplierQuality, SOURCES } from "./defects.js";
import { orderState, ORDER_STATE } from "./orders.js";
import { esc, fmt, fmtMoney, mLabel, dKey } from "../util.js";
import { toast } from "./movements.js";

let ui = { id: "reorder", from: "", to: "", H: 3 };

// column types: text | num | num2 | money | date | pct
const REPORTS = {
  reorder: { title: "تقرير الخامات المطلوب شراؤها", desc: "الخامات اللي وصلت أو قربت من نقطة إعادة الطلب، بالكمية المقترحة وميعاد الوصول لو اتطلبت النهارده.", period: false,
    build(d) {
      const rows = d.rows.filter((r) => r.status === "order" || r.status === "warn")
        .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.cover ?? 1e9) - (b.cover ?? 1e9));
      return {
        summary: [["خامات حرجة", fmt(rows.filter((r) => r.status === "order").length)], ["قربت من نقطة الطلب", fmt(rows.filter((r) => r.status === "warn").length)],
          ["قيمة الطلبيات المقترحة", rows.some((r) => r.orderVal != null) ? fmtMoney(rows.reduce((a, r) => a + (r.orderVal || 0), 0)) : "—"]],
        columns: [["الكود", "code", "text", 12], ["الخامة", "name", "text", 28], ["الوحدة", "unit", "text", 8], ["الرصيد", "qty", "num", 11], ["تحت الطلب", "onOrder", "num", 11],
          ["التوقع/شهر", "fc", "num", 12], ["مخزون الأمان", "ss", "num", 12], ["نقطة الطلب", "rop", "num", 12], ["الكمية المقترحة", "orderQty", "num", 14],
          ["الليد تايم", "lt", "num", 10], ["يوصل لو اتطلب النهارده", "arriveIfToday", "date", 18], ["الرصيد يخلص", "stockoutDate", "date", 14],
          ["القيمة", "orderVal", "money", 14], ["الحالة", "statusLabel", "text", 14]],
        rows: rows.map((r) => ({ ...r, statusLabel: STATUS[r.status].label })),
        totals: { orderVal: rows.reduce((a, r) => a + (r.orderVal || 0), 0) },
      };
    } },
  stock: { title: "تقرير حالة المخزون", desc: "كل الخامات بالرصيد ومصروف الشهر والتوقع والتغطية والحالة.", period: false,
    build(d) {
      const rows = [...d.rows].sort((a, b) => (a.group || "").localeCompare(b.group || "", "ar") || a.name.localeCompare(b.name, "ar"));
      return {
        summary: [["عدد الخامات", fmt(rows.length)], ["قيمة المخزون", rows.some((r) => r.stockVal != null) ? fmtMoney(rows.reduce((a, r) => a + (r.stockVal || 0), 0)) : "—"],
          ["حرجة", fmt(rows.filter((r) => r.status === "order").length)], ["راكدة", fmt(rows.filter((r) => r.status === "dead").length)]],
        columns: [["الكود", "code", "text", 12], ["الخامة", "name", "text", 28], ["المجموعة", "group", "text", 16], ["الوحدة", "unit", "text", 8], ["الرصيد", "qty", "num", 11],
          ["مصروف " + mLabel(d.meta.thisM), "thisMonth", "num", 14], ["التوقع/شهر", "fc", "num", 12], ["نقطة الطلب", "rop", "num", 12], ["التغطية (يوم)", "cover", "num", 12],
          ["سعر الوحدة", "price", "num2", 11], ["قيمة الرصيد", "stockVal", "money", 14], ["الحالة", "statusLabel", "text", 14], ["الإجراء", "action", "text", 14]],
        rows: rows.map((r) => ({ ...r, statusLabel: STATUS[r.status].label, action: actionText(r) })),
        totals: { stockVal: rows.reduce((a, r) => a + (r.stockVal || 0), 0) },
      };
    } },
  dead: { title: "تقرير الراكد", desc: "الخامات الراكدة بالكامل والزيادات فوق احتياج " + "الشهور المحددة، بالكمية والقيمة وآخر صرف.", period: false,
    build(d) {
      const rows = d.rows.filter((r) => r.deadQty > 0).sort((a, b) => (b.deadVal ?? b.deadQty) - (a.deadVal ?? a.deadQty));
      const stockVal = d.rows.reduce((a, r) => a + (r.stockVal || 0), 0), deadVal = rows.reduce((a, r) => a + (r.deadVal || 0), 0);
      return {
        summary: [["خامات فيها راكد", fmt(rows.length)], ["قيمة الراكد", deadVal ? fmtMoney(deadVal) : "—"], ["نسبة الراكد من المخزون", stockVal ? ((deadVal / stockVal) * 100).toFixed(1) + "%" : "—"]],
        columns: [["الكود", "code", "text", 12], ["الخامة", "name", "text", 28], ["المجموعة", "group", "text", 16], ["الوحدة", "unit", "text", 8], ["الرصيد", "qty", "num", 11],
          ["التوقع/شهر", "fc", "num", 12], ["الكمية الراكدة", "deadQty", "num", 13], ["قيمة الراكد", "deadVal", "money", 14], ["آخر صرف", "lastUseLabel", "text", 14], ["النوع", "kind", "text", 16]],
        rows: rows.map((r) => ({ ...r, lastUseLabel: r.lastUse ? mLabel(r.lastUse) : "—", kind: r.status === "dead" ? "راكد بالكامل" : "زيادة عن الاحتياج" })),
        totals: { deadVal },
      };
    } },
  forecast: { title: "تقرير الفوركاست", desc: "توقع صرف كل خامة للشهور الجاية والكمية المحتاج شراؤها.", period: false, horizon: true,
    build(d) {
      const t = forecastTable(ui.H, store.state.settings.method);
      const cols = [["الكود", "code", "text", 12], ["الخامة", "name", "text", 28], ["الوحدة", "unit", "text", 8], ["الطريقة", "methodLabel", "text", 22]];
      t.nextMonths.forEach((k, i) => cols.push([mLabel(k), "m" + i, "num", 12]));
      cols.push(["الإجمالي", "total", "num", 12], ["الرصيد + تحت الطلب", "pos", "num", 16], ["محتاج تشتري", "need", "num", 13], ["قيمة الشراء", "needVal", "money", 14], ["نسبة الخطأ", "mape", "pct", 10]);
      const rows = t.rows.map((x) => {
        const o = { code: x.r.code, name: x.r.name, unit: x.r.unit, methodLabel: METHODS[x.m].label, total: x.total, pos: x.r.qty + x.r.onOrder, need: x.need, needVal: x.needVal, mape: x.mape };
        x.f.forEach((v, i) => { o["m" + i] = v; });
        return o;
      });
      return {
        summary: [["الفترة", t.nextMonths.map(mLabel).join(" ← ")], ["عدد الخامات", fmt(rows.length)], ["قيمة الشراء المتوقع", rows.some((r) => r.needVal != null) ? fmtMoney(rows.reduce((a, r) => a + (r.needVal || 0), 0)) : "—"]],
        columns: cols, rows, totals: { needVal: rows.reduce((a, r) => a + (r.needVal || 0), 0) },
      };
    } },
  orders: { title: "تقرير طلبات الشراء", desc: "الطلبات بتاريخ الطلب والليد تايم وميعاد التسجيل في المخازن والتأخير.", period: true,
    build(d) {
      const today = d.meta.today;
      const rows = store.state.orders.filter((o) => (!ui.from || o.orderDate >= ui.from) && (!ui.to || o.orderDate <= ui.to))
        .map((o) => {
          const st = orderState(o, today);
          const delay = st === "received" ? daysBetween(o.expected, o.receivedDate) : st === "late" ? daysBetween(o.expected, today) : null;
          return { ...o, stLabel: ORDER_STATE[st][0], delay: delay && delay > 0 ? delay : null, value: o.price ? o.price * o.qty : null };
        }).sort((a, b) => a.expected.localeCompare(b.expected));
      const rec = rows.filter((o) => o.status === "received");
      return {
        summary: [["عدد الطلبات", fmt(rows.length)], ["متأخرة / وصلت متأخر", fmt(rows.filter((o) => o.delay).length)],
          ["وصلت في ميعادها", rec.length ? Math.round((rec.filter((o) => !o.delay).length / rec.length) * 100) + "%" : "—"],
          ["القيمة", rows.some((o) => o.value) ? fmtMoney(rows.reduce((a, o) => a + (o.value || 0), 0)) : "—"]],
        columns: [["رقم الطلب", "poNo", "text", 12], ["الخامة", "name", "text", 26], ["المورد", "supplier", "text", 18], ["الكمية", "qty", "num2", 11],
          ["تاريخ الطلب", "orderDate", "date", 13], ["الليد تايم", "lead", "num", 10], ["ميعاد الوصول", "expected", "date", 13], ["تاريخ الاستلام", "receivedDate", "date", 13],
          ["التأخير (يوم)", "delay", "num", 11], ["القيمة", "value", "money", 13], ["الحالة", "stLabel", "text", 15]],
        rows, totals: { value: rows.reduce((a, o) => a + (o.value || 0), 0) },
      };
    } },
  defects: { title: "تقرير عيوب الخامات", desc: "كل حالات العيوب بالنوع (مورد / استخدام) والمورد والإجراء، مع نسبة العيب لكل مورد.", period: true,
    build(d) {
      const f = { from: ui.from, to: ui.to };
      const rows = defectRows(f).map((x) => ({ ...x, srcLabel: SOURCES[x.source][0], deductLabel: x.deduct ? "نعم" : "لا" }));
      const q = supplierQuality(rows, f);
      return {
        summary: [["عدد الحالات", fmt(rows.length)], ["عيوب مورد", fmt(rows.filter((x) => x.source === "supplier").length)], ["عيوب استخدام", fmt(rows.filter((x) => x.source === "usage").length)],
          ["قيمة المعيب", rows.some((x) => x.value != null) ? fmtMoney(rows.reduce((a, x) => a + (x.value || 0), 0)) : "—"]],
        columns: [["التاريخ", "date", "date", 12], ["النوع", "srcLabel", "text", 12], ["الكود", "code", "text", 12], ["الخامة", "name", "text", 26], ["الكمية", "qty", "num2", 10], ["الوحدة", "unit", "text", 8],
          ["المورد", "supplier", "text", 18], ["وصف العيب", "kind", "text", 22], ["الإجراء", "action", "text", 16], ["اتخصم من الرصيد", "deductLabel", "text", 14], ["القيمة", "value", "money", 13]],
        rows, totals: { value: rows.reduce((a, x) => a + (x.value || 0), 0) },
        extra: q.length ? { title: "جودة الموردين", columns: [["المورد", "supplier", "text", 18], ["الخامة", "name", "text", 26], ["الكمية المستلمة", "received", "num", 14], ["الكمية المعيبة", "defective", "num", 14], ["نسبة العيب", "rate", "pct", 12], ["حالات", "n", "num", 8]], rows: q } : null,
      };
    } },
};

function cell(v, type) {
  if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) return "—";
  if (type === "num") return fmt(v);
  if (type === "num2") return fmt(v, 2);
  if (type === "money") return v ? fmt(v) : "—";
  if (type === "pct") return (+v).toFixed(1) + "%";
  return esc(v);
}
const isNum = (t) => t !== "text" && t !== "date";

function tableHTML(columns, rows, totals) {
  return `<table class="rp-table">
    <thead><tr><th>#</th>${columns.map(([h, , t]) => `<th class="${isNum(t) ? "n" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="n">${i + 1}</td>${columns.map(([, k, t]) => `<td class="${isNum(t) ? "n nw" : t === "date" || k === "code" ? "nw" : ""}">${cell(r[k], t)}</td>`).join("")}</tr>`).join("")
      || `<tr><td colspan="${columns.length + 1}" class="empty">مافيش بيانات.</td></tr>`}</tbody>
    ${totals && rows.length && Object.values(totals).some(Boolean) ? `<tfoot><tr><td></td>${columns.map(([, k, t], i) => `<td class="n">${i === 0 ? "الإجمالي" : totals[k] ? cell(totals[k], t) : ""}</td>`).join("")}</tr></tfoot>` : ""}
  </table>`;
}

export function renderReports() {
  const d = store.derived;
  const c = store.state.company;
  const def = REPORTS[ui.id];
  const rep = def.build(d);
  const now = new Date();
  const period = def.period && (ui.from || ui.to) ? `الفترة: ${ui.from || "البداية"} إلى ${ui.to || "النهارده"}` : "";
  return `
  <div class="page-head no-print"><div><h2>التقارير</h2><p class="muted">اختار التقرير، وطلّعه PDF أو Excel.</p></div></div>
  <section class="grid g-rep no-print">
    <div class="card rp-list">
      ${Object.entries(REPORTS).map(([k, r]) => `<button class="rp-item ${k === ui.id ? "on" : ""}" data-rep="${k}"><b>${r.title}</b><small>${r.desc}</small></button>`).join("")}
    </div>
    <div class="side">
      <div class="card form">
        <h3>بيانات الشركة على التقارير</h3>
        <label>اسم الشركة<input id="co-name" value="${esc(c.name)}" placeholder="اسم الشركة"></label>
        <div class="logo-row">${c.logo ? `<img src="${c.logo}" alt="اللوجو" class="logo-prev">` : `<span class="muted">مافيش لوجو</span>`}
          <label class="btn file-btn sm">${c.logo ? "غيّر اللوجو" : "ارفع اللوجو"}<input type="file" id="co-logo" accept="image/png,image/jpeg"></label>
          ${c.logo ? `<button class="btn ghost sm" id="co-logo-x">شيله</button>` : ""}</div>
      </div>
      <div class="card form">
        <h3>إعدادات التقرير</h3>
        ${def.period ? `<div class="row2"><label>من<input type="date" id="rp-from" value="${ui.from}"></label><label>إلى<input type="date" id="rp-to" value="${ui.to}"></label></div>` : ""}
        ${def.horizon ? `<label>عدد الشهور<select id="rp-h">${[1, 2, 3, 4, 5, 6].map((n) => `<option ${n === ui.H ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : ""}
        ${!def.period && !def.horizon ? `<p class="muted">التقرير ده بيطلع بحالة النهارده.</p>` : ""}
        <div class="row2"><button class="btn primary" id="rp-pdf">PDF</button><button class="btn" id="rp-xlsx">Excel</button></div>
        <p class="cap">PDF: هتفتح شاشة الطباعة، اختار "Save as PDF". الصفحة بتتطبع بالعرض A4.</p>
      </div>
    </div>
  </section>

  <article class="paper" id="paper">
    <header class="rp-head">
      <div class="rp-co">${c.logo ? `<img src="${c.logo}" alt="">` : ""}<div><b>${esc(c.name || "اسم الشركة")}</b><small>إدارة المخازن والمشتريات</small></div></div>
      <div class="rp-meta"><small>تاريخ الإصدار</small><b>${dKey(now)}</b><small>${now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</small></div>
    </header>
    <h1 class="rp-title">${def.title}</h1>
    <p class="rp-sub">${def.desc}${period ? " · " + period : ""}${d.isSample ? " · <b>بيانات مثال</b>" : ""}</p>
    <div class="rp-summary">${rep.summary.map(([l, v]) => `<div><small>${l}</small><b>${v}</b></div>`).join("")}</div>
    ${tableHTML(rep.columns, rep.rows, rep.totals)}
    ${rep.extra ? `<h2 class="rp-h2">${rep.extra.title}</h2>${tableHTML(rep.extra.columns, rep.extra.rows)}` : ""}
    <footer class="rp-foot"><span>${c.name ? esc(c.name) + " · " : ""}${def.title}</span><span>طريقة التوقع: ${store.state.settings.method === "auto" ? "الأدق لكل خامة" : METHODS[store.state.settings.method].label} · مستوى الخدمة ${({ 1.28: "90%", 1.65: "95%", 2.05: "98%", 2.33: "99%" })[store.state.settings.z] || ""}</span></footer>
  </article>`;
}

async function exportExcel() {
  if (!window.ExcelJS) { toast("مكتبة الإكسيل ماتحملتش، اتأكد من النت"); return; }
  const d = store.derived, c = store.state.company, def = REPORTS[ui.id], rep = def.build(d);
  const NAVY = "FF0B2A5B", AMBER = "FFF29900", ZEBRA = "FFF4F7FC", LINE = "FFD6DEEA";
  const wb = new window.ExcelJS.Workbook();
  wb.creator = c.name || "MRP"; wb.created = new Date();
  const ws = wb.addWorksheet(def.title.slice(0, 31), {
    views: [{ rightToLeft: true, showGridLines: false }],
    pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 } },
    headerFooter: { oddFooter: `&L${def.title}&Rصفحة &P من &N` },
  });
  const ncol = rep.columns.length + 1;
  rep.columns.forEach(([, , , w], i) => { ws.getColumn(i + 2).width = w || 14; });
  ws.getColumn(1).width = 6;
  const font = (o = {}) => ({ name: "Arial", size: 10, ...o });

  let r = 1;
  if (c.logo) {
    try {
      const ext = c.logo.startsWith("data:image/png") ? "png" : "jpeg";
      const img = wb.addImage({ base64: c.logo, extension: ext });
      ws.addImage(img, { tl: { col: ncol - 1.6, row: 0.15 }, ext: { width: 90, height: 48 } });
    } catch (e) { console.warn(e); }
  }
  ws.mergeCells(r, 1, r, ncol - 2); ws.getCell(r, 1).value = c.name || "";
  ws.getCell(r, 1).font = font({ size: 15, bold: true, color: { argb: NAVY } }); ws.getRow(r).height = 26; r++;
  ws.mergeCells(r, 1, r, ncol - 2); ws.getCell(r, 1).value = def.title;
  ws.getCell(r, 1).font = font({ size: 13, bold: true, color: { argb: "FF1B4A96" } }); ws.getRow(r).height = 22; r++;
  const period = def.period && (ui.from || ui.to) ? ` · الفترة: ${ui.from || "البداية"} إلى ${ui.to || "النهارده"}` : "";
  ws.mergeCells(r, 1, r, ncol); ws.getCell(r, 1).value = `تاريخ الإصدار: ${dKey(new Date())}${period}${d.isSample ? " · بيانات مثال" : ""}`;
  ws.getCell(r, 1).font = font({ color: { argb: "FF5B6B82" } }); r++;
  for (let i = 1; i <= ncol; i++) ws.getCell(r, i).border = { top: { style: "medium", color: { argb: AMBER } } };
  r++;
  // summary boxes: label row + value row
  rep.summary.forEach(([l, v], i) => {
    const col = 2 + i * 2;
    if (col + 1 > ncol) return;
    ws.mergeCells(r, col, r, col + 1); ws.mergeCells(r + 1, col, r + 1, col + 1);
    const a = ws.getCell(r, col), b = ws.getCell(r + 1, col);
    a.value = l; b.value = String(v).replace(/<[^>]+>/g, "");
    a.font = font({ size: 9, color: { argb: "FF5B6B82" } }); b.font = font({ size: 13, bold: true, color: { argb: NAVY } });
    [a, b].forEach((x) => { x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } }; x.alignment = { horizontal: "right" }; });
  });
  r += 3;

  const writeTable = (columns, rows, totals, startRow, title) => {
    let rr = startRow;
    if (title) { ws.getCell(rr, 1).value = title; ws.getCell(rr, 1).font = font({ size: 12, bold: true, color: { argb: NAVY } }); rr++; }
    const head = ws.getRow(rr);
    ["#", ...columns.map((c) => c[0])].forEach((h, i) => {
      const cl = head.getCell(i + 1); cl.value = h;
      cl.font = font({ bold: true, color: { argb: "FFFFFFFF" } });
      cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cl.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cl.border = { bottom: { style: "medium", color: { argb: AMBER } } };
    });
    head.height = 30;
    const headRow = rr; rr++;
    rows.forEach((o, idx) => {
      const row = ws.getRow(rr);
      row.getCell(1).value = idx + 1;
      columns.forEach(([, k, t], i) => {
        const cl = row.getCell(i + 2);
        let v = o[k];
        if (v == null || v === "" || (typeof v === "number" && !isFinite(v))) v = null;
        if (v != null && t === "date") { const [y, m, dd] = String(v).split("-").map(Number); v = new Date(Date.UTC(y, m - 1, dd)); cl.numFmt = "yyyy-mm-dd"; }
        if (v != null && (t === "num")) { v = Math.round(v); cl.numFmt = "#,##0"; }
        if (v != null && (t === "num2" || t === "money")) { v = Math.round(v * 100) / 100; cl.numFmt = t === "money" ? '#,##0 "ج"' : "#,##0.##"; }
        if (v != null && t === "pct") { v = v / 100; cl.numFmt = "0.0%"; }
        cl.value = v;
        cl.alignment = { horizontal: isNum(t) ? "left" : "right", vertical: "middle" };
      });
      for (let i = 1; i <= columns.length + 1; i++) {
        const cl = row.getCell(i);
        cl.font = font();
        cl.border = { bottom: { style: "thin", color: { argb: LINE } } };
        if (idx % 2) cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }
      rr++;
    });
    if (totals && rows.length && Object.values(totals).some(Boolean)) {
      const row = ws.getRow(rr);
      row.getCell(2).value = "الإجمالي";
      columns.forEach(([, k, t], i) => { if (totals[k]) { const cl = row.getCell(i + 2); cl.value = Math.round(totals[k]); cl.numFmt = t === "money" ? '#,##0 "ج"' : "#,##0"; } });
      for (let i = 1; i <= columns.length + 1; i++) {
        const cl = row.getCell(i);
        cl.font = font({ bold: true, color: { argb: NAVY } });
        cl.border = { top: { style: "medium", color: { argb: NAVY } } };
        cl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2D6" } };
      }
      rr++;
    }
    return { end: rr, headRow };
  };

  const t1 = writeTable(rep.columns, rep.rows, rep.totals, r);
  ws.views = [{ rightToLeft: true, showGridLines: false, state: "frozen", ySplit: t1.headRow }];
  ws.autoFilter = { from: { row: t1.headRow, column: 1 }, to: { row: t1.headRow, column: ncol } };
  ws.pageSetup.printTitlesRow = `${t1.headRow}:${t1.headRow}`;
  if (rep.extra) {
    const ws2cols = rep.extra.columns;
    writeTable(ws2cols, rep.extra.rows, null, t1.end + 2, rep.extra.title);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${def.title} ${dKey(new Date())}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast("اتنزل ملف الإكسيل");
}

export function bindReports(root, rerender) {
  root.querySelectorAll("[data-rep]").forEach((b) => b.addEventListener("click", () => { ui.id = b.dataset.rep; rerender(); }));
  root.querySelector("#rp-from")?.addEventListener("change", (e) => { ui.from = e.target.value; rerender(); });
  root.querySelector("#rp-to")?.addEventListener("change", (e) => { ui.to = e.target.value; rerender(); });
  root.querySelector("#rp-h")?.addEventListener("change", (e) => { ui.H = +e.target.value; rerender(); });
  root.querySelector("#co-name")?.addEventListener("change", (e) => store.update((s) => { s.company.name = e.target.value.trim(); }));
  root.querySelector("#co-logo")?.addEventListener("change", (e) => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => store.update((s) => { s.company.logo = rd.result; });
    rd.readAsDataURL(f);
  });
  root.querySelector("#co-logo-x")?.addEventListener("click", () => store.update((s) => { s.company.logo = ""; }));
  root.querySelector("#rp-pdf")?.addEventListener("click", () => {
    const old = document.title;
    document.title = REPORTS[ui.id].title + " " + dKey(new Date());
    window.print();
    setTimeout(() => { document.title = old; }, 500);
  });
  root.querySelector("#rp-xlsx")?.addEventListener("click", () => exportExcel().catch((e) => { console.error(e); toast("حصلت مشكلة في تصدير الإكسيل: " + e.message); }));
}

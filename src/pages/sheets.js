import { store } from "../store.js";
import { ROLES, FIELDS, readWorkbook, setRole, headerLabels, sheetProblems, monthColumns } from "../sources.js";
import { esc, fmt, dKey } from "../util.js";
import { toast } from "./movements.js";
import { syncInfo, syncSummary, checkSync, disconnectSync, timeAgo } from "../autosync.js";
import { confirmButton } from "../ui.js";
import { renderPhoneCard, bindPhoneCard } from "../phone.js";

export function renderSheets() {
  const { sources } = store.state;
  const d = store.derived;
  return `
  <div class="page-head">
    <div><h2>الشيتات</h2><p class="muted">ارفع ملفات الإكسيل اللي هتسحب منها، وحدد كل شيت بيحتوي على إيه.</p></div>
    <label class="btn primary file-btn">ارفع ملف إكسيل<input type="file" id="up-new" accept=".xlsx,.xls,.xlsm,.csv" multiple></label>
  </div>
  <p class="err" id="up-err" hidden></p>
  ${renderPhoneCard()}
  ${syncCard()}

  <section class="status-strip">
    <div class="st ${d.hasStock ? "good" : "bad"}"><b>${d.hasStock ? "✓" : "!"}</b> شيت رصيد ${d.hasStock ? "متحدد" : "مش متحدد"}</div>
    <div class="st ${d.hasOut ? "good" : "bad"}"><b>${d.hasOut ? "✓" : "!"}</b> شيت صرف ${d.hasOut ? "متحدد" : "مش متحدد"}</div>
    <div class="st"><b>${fmt(d.rows.length)}</b> خامة · <b>${fmt(d.txns.length)}</b> حركة</div>
    ${d.isSample ? `<div class="st note">اللوحة شغالة على بيانات مثال لحد ما تحدد شيت رصيد أو صرف.</div>` : ""}
  </section>

  ${sources.length ? sources.map((src, si) => `
    <section class="card src">
      <div class="card-head">
        <div><h3>📄 ${esc(src.fileName)}</h3><p class="muted">اتسحب ${dKey(new Date(src.importedAt))} · ${src.sheets.length} شيت</p></div>
        <div class="actions">
          <label class="btn file-btn">حدّث من نسخة أحدث<input type="file" data-replace="${si}" accept=".xlsx,.xls,.xlsm,.csv"></label>
          <button class="btn ghost" data-remove="${si}">شيل الملف</button>
        </div>
      </div>
      ${src.sheets.map((sh, hi) => sheetCard(sh, si, hi)).join("")}
    </section>`).join("") : `
    <section class="card dropzone" id="drop">
      <h3>${store.state.excel ? "ملفات إضافية (اختياري)" : "لسه مافيش ملفات"}</h3>
      <p>${store.state.excel ? "البيانات الأساسية جاية من المزامنة فوق. لو عندك شيت تاني (زي صرف شهور قديمة) اسحبه هنا." : 'اسحب ملفات الإكسيل هنا أو استخدم زرار "ارفع ملف إكسيل".'}</p>
    </section>`}

  <section class="card help">
    <h3>الشيتات المطلوبة</h3>
    <div class="grid g2">
      <div><h4>رصيد الخامات</h4><p>سطر لكل خامة: <code>الكود</code> <code>اسم الخامة</code> <code>الرصيد</code>، واختياري <code>المجموعة</code> <code>الوحدة</code> <code>سعر الوحدة</code> <code>مدة التوريد</code>.</p></div>
      <div><h4>حركات الصرف</h4><p>سطر لكل عملية صرف: <code>التاريخ</code> <code>الكود أو الاسم</code> <code>الكمية</code>. أو جدول فيه عمود لكل شهر (مثلاً <code>2026-08</code> أو <code>أغسطس 2026</code>).</p></div>
    </div>
    <p class="muted">الملف ممكن يكون فيه الشيتين مع بعض. الربط بين الشيتات بالكود لو موجود، وإلا بالاسم. الملفات بتتحفظ في المتصفح ده بس، ولما الإكسيل يتحدث ارفع النسخة الجديدة بزرار "حدّث".</p>
  </section>`;
}

function syncCard() {
  const ex = store.state.excel, st = syncInfo.status, sm = syncSummary();
  const s = store.state.settings;
  const nMoves = (store.state.excelMoves || []).length;
  const months = [...new Set((store.state.excelMoves || []).map((m) => m.date.slice(0, 7)))].sort();
  return `
  <section class="card sync-card ${sm.cls}">
    <div class="card-head">
      <div><h3>🔄 المزامنة التلقائية مع شيت المخازن</h3>
        <p class="muted">${esc(sm.text)}</p></div>
      <div class="actions">
        <button class="btn" id="sync-now" ${syncInfo.checking ? "disabled" : ""}>${syncInfo.checking ? "بيشيك..." : "شيك دلوقتي"}</button>
        ${ex ? `<button class="btn ghost" id="sync-off">افصل وامسح بيانات الشيت</button>` : ""}
      </div>
    </div>
    ${ex ? `
    <div class="kvs sync-kvs">
      <div class="kv"><small>الملف</small><b class="sm"><bdi>${esc(ex.source?.file || "—")}</bdi></b><em>${esc(ex.source?.period ? "شهر " + ex.source.period : "")}</em></div>
      <div class="kv"><small>آخر تعديل في الشيت</small><b class="sm">${timeAgo(ex.source?.modified)}</b><em>${esc((ex.source?.modified || "").replace("T", " "))}</em></div>
      <div class="kv"><small>آخر مزامنة</small><b class="sm">${timeAgo(ex.syncedAt)}</b><em>${syncInfo.lastCheck ? "آخر تشييك " + syncInfo.lastCheck.toTimeString().slice(0, 5) : ""}</em></div>
      <div class="kv"><small>الأصناف</small><b>${fmt(ex.stats?.items)}</b><em>${fmt(ex.stats?.linkedCards)} كارت صنف</em></div>
      <div class="kv"><small>الحركات المتجمعة</small><b>${fmt(nMoves)}</b><em>${months.length ? months[0] + (months.length > 1 ? " ← " + months[months.length - 1] : "") : ""}</em></div>
    </div>` : `
    <ol class="steps">
      <li>شغّل الموقع من <code>start-windows.bat</code>. أول مرة هيفتحلك ملف <code>sync-config.json</code>.</li>
      <li>اكتب فيه مسار الشيت (أو مسار الفولدر اللي فيه شيتات الشهور، وهياخد أحدث واحد) والباسورد، واحفظه.</li>
      <li>اقفل الشباك وشغّل <code>start-windows.bat</code> تاني. البيانات هتظهر هنا لوحدها في خلال دقيقة.</li>
    </ol>`}
    ${st && st.ok === false ? `<p class="err">${esc(st.error || "")} <small>(${esc((st.at || "").replace("T", " "))})</small></p>` : ""}
    <label class="check"><input type="checkbox" id="sync-levels" ${s.useSheetLevels !== false ? "checked" : ""}> استخدم حد الطلب ومخزون الأمان المتسجلين في الشيت لو موجودين (غير كده البرنامج يحسبهم من الصرف)</label>
    <p class="cap">السكريبت بيبص على الشيت كل فترة، ولو اتعدّل بيقرا «الارصدة» وكروت الأصناف. والصفحة دي بتسحب الجديد كل دقيقة. حركات كل شهر بتتحفظ، فلما تنقل لشيت الشهر الجديد التاريخ بيفضل موجود.</p>
  </section>`;
}

function sheetCard(sh, si, hi) {
  const headers = headerLabels(sh);
  const probs = sheetProblems(sh);
  const fields = (FIELDS[sh.role] || []).filter(([f]) => !(sh.wide && (f === "date" || f === "qty")));
  const preview = sh.rows.slice(0, 6);
  const ncols = Math.min(headers.length, 10);
  return `
  <div class="sheet ${sh.role === "ignore" ? "ignored" : ""}">
    <div class="sheet-head">
      <b>${esc(sh.name)}</b> <span class="muted">${fmt(Math.max(0, sh.rows.length - 1))} سطر</span>
      <label class="role">الشيت ده فيه
        <select data-role="${si}:${hi}">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${k === sh.role ? "selected" : ""}>${l}</option>`).join("")}</select>
      </label>
      ${sh.role !== "ignore" ? (probs.length ? `<span class="chip order">${esc(probs[0])}</span>` : `<span class="chip ok">جاهز</span>`) : ""}
    </div>
    ${sh.role !== "ignore" ? `
      <div class="maps">${fields.map(([f, l, req]) => `
        <label>${l}${req ? " *" : ""}
          <select data-map="${si}:${hi}:${f}"><option value="-1">—</option>${headers.map((h, i) => `<option value="${i}" ${sh.map[f] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select>
        </label>`).join("")}
      </div>
      ${sh.wide ? `<p class="cap">اتعرفت على ${monthColumns(sh).length} عمود شهور، كل عمود هيتحسب صرف الشهر ده.</p>` : ""}
      <div class="table-wrap preview"><table class="tbl compact">
        <thead><tr>${headers.slice(0, ncols).map((h, i) => `<th class="${Object.values(sh.map).includes(i) ? "hl" : ""}">${esc(h)}</th>`).join("")}</tr></thead>
        <tbody>${preview.slice(1).map((r) => `<tr>${r.slice(0, ncols).map((c) => `<td>${esc(c instanceof Date ? dKey(c) : c)}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>` : ""}
  </div>`;
}

async function addFiles(files, replaceIdx = null) {
  const err = document.getElementById("up-err");
  err.hidden = true;
  for (const f of files) {
    try {
      const src = await readWorkbook(f);
      store.update((s) => {
        if (replaceIdx != null) {
          const old = s.sources[replaceIdx];
          // keep the user's choices for sheets with the same name
          src.sheets.forEach((sh) => {
            const o = old.sheets.find((x) => x.name === sh.name);
            if (o) { sh.role = o.role; const hd = headerLabels(sh); sh.map = Object.fromEntries(Object.entries(o.map).map(([k, v]) => [k, v < hd.length ? v : -1])); sh.wide = o.wide; }
          });
          src.id = old.id;
          s.sources[replaceIdx] = src;
        } else {
          const same = s.sources.findIndex((x) => x.fileName === src.fileName);
          if (same >= 0) s.sources[same] = src; else s.sources.push(src);
        }
      });
      toast("اتسحب " + f.name);
    } catch (e) {
      err.textContent = "مش قادر أقرا " + f.name + ": " + e.message;
      err.hidden = false;
    }
  }
}

export function bindSheets(root) {
  bindPhoneCard(root);
  root.querySelector("#sync-now")?.addEventListener("click", () => checkSync({ force: true }).then(() => toast(syncInfo.error || "تم التشييك")));
  const off = root.querySelector("#sync-off");
  if (off) confirmButton(off, () => { disconnectSync(); toast("اتفصلت المزامنة واتمسحت بيانات الشيت"); }, "متأكد؟ اضغط تاني");
  root.querySelector("#sync-levels")?.addEventListener("change", (e) => store.update((s) => { s.settings.useSheetLevels = e.target.checked; }));
  root.querySelector("#up-new")?.addEventListener("change", (e) => addFiles([...e.target.files]));
  root.querySelectorAll("[data-replace]").forEach((i) => i.addEventListener("change", (e) => addFiles([...e.target.files].slice(0, 1), +i.dataset.replace)));
  root.querySelectorAll("[data-remove]").forEach((b) => b.addEventListener("click", () => {
    if (!b.dataset.confirm) { b.dataset.confirm = "1"; b.textContent = "متأكد؟ اضغط تاني"; b.classList.add("danger"); return; }
    store.update((s) => s.sources.splice(+b.dataset.remove, 1));
  }));
  root.querySelectorAll("[data-role]").forEach((sel) => sel.addEventListener("change", () => {
    const [si, hi] = sel.dataset.role.split(":").map(Number);
    store.update((s) => setRole(s.sources[si].sheets[hi], sel.value));
  }));
  root.querySelectorAll("[data-map]").forEach((sel) => sel.addEventListener("change", () => {
    const [si, hi, f] = sel.dataset.map.split(":");
    store.update((s) => { s.sources[+si].sheets[+hi].map[f] = +sel.value; });
  }));
  const drop = root.querySelector(".main") || root;
  drop.ondragover = (e) => { e.preventDefault(); };
  drop.ondrop = (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); };
}

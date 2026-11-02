// المزامنة التلقائية مع شيت المخازن:
// سكريبت excel_sync.py بيكتب data/sync.json، والصفحة دي بتبص عليه كل دقيقة وتسحب الجديد.
import { store } from "./store.js";

// جوه تطبيق الأندرويد الملفات بتبقى على الموبايل، فالبيانات بتيجي من موقع GitHub Pages
export const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const REMOTE = "https://nourenvo-png.github.io/MRP/";
const BASE = isNative() ? REMOTE : "./";
const DATA = BASE + "data/sync.json";
const STATUS = BASE + "data/sync-status.json";
const EVERY_MS = 60 * 1000;

export const syncInfo = { status: null, lastCheck: null, checking: false, error: null, needCode: false, codeError: "" };

// ---------- كود الدخول وفك التشفير ----------
const CODE_KEY = "mrp-app-code";
const getCode = () => { try { return localStorage.getItem(CODE_KEY) || ""; } catch { return ""; } };
const setCode = (c) => { try { c ? localStorage.setItem(CODE_KEY, c) : localStorage.removeItem(CODE_KEY); } catch {} };
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(enc, code) {
  if (!crypto?.subtle) throw Object.assign(new Error("المتصفح ده مش بيدعم فك التشفير على اللينك ده. افتح التطبيق من لينك https."), { fatal: true });
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: b64(enc.salt), iterations: enc.iter },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  let raw;
  try { raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(enc.iv) }, key, b64(enc.data)); }
  catch { throw Object.assign(new Error("الكود غلط"), { badCode: true }); }
  let stream = new Blob([raw]).stream();
  if (enc.gzip) stream = stream.pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}

/** بيتنادي من شاشة القفل */
export async function submitCode(code) {
  setCode(code.trim());
  syncInfo.codeError = "";
  await checkSync({ force: true });
  if (syncInfo.needCode) setCode("");
  return !syncInfo.needCode;
}
export function forgetCode() { setCode(""); }
const listeners = new Set();
export const onSyncInfo = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const ping = () => listeners.forEach((l) => l());

async function getJSON(url) {
  const r = await fetch(url + "?t=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { code: r.status });
  return r.json();
}

const periodMonth = (p) => {
  const m = String(p || "").match(/^(\d{1,2})-(\d{4})$/);
  return m ? m[2] + "-" + m[1].padStart(2, "0") : null;
};

/** دمج بيانات المزامنة في حالة البرنامج. الحركات بتتجمع شهر ورا شهر. */
export function applySync(data) {
  store.update((s) => {
    s.excel = { syncedAt: data.syncedAt, source: data.source, stats: data.stats, items: data.items };
    const incoming = data.moves || [];
    // الشهور اللي في الملف الجديد بتتبدل بالكامل (عشان لو حركة اتعدلت أو اتمسحت في الشيت)
    const months = new Set(incoming.map((m) => m.date.slice(0, 7)));
    const pm = periodMonth(data.source?.period);
    if (pm) months.add(pm);
    const kept = (s.excelMoves || []).filter((m) => !months.has(m.date.slice(0, 7)));
    const seen = new Set();
    s.excelMoves = [...kept, ...incoming].filter((m) => !seen.has(m.key) && seen.add(m.key));
  });
}

export async function checkSync({ force = false } = {}) {
  if (syncInfo.checking) return;
  syncInfo.checking = true; ping();
  try {
    let status = null;
    try { status = await getJSON(STATUS); } catch (e) { if (e.code !== 404) throw e; }
    syncInfo.status = status;
    const have = store.state.excel?.syncedAt;
    const remote = status?.syncedAt;
    if (status?.encrypted) {
      const code = getCode();
      if (!code) { syncInfo.needCode = true; syncInfo.error = null; return; }
      if (force || remote !== have || syncInfo.needCode) {
        try {
          const data = await decrypt(await getJSON(BASE + "data/" + (status.dataFile || "sync.enc.json")), code);
          syncInfo.needCode = false; syncInfo.codeError = "";
          if (data?.format === "mrp-sync/1" && (force || data.syncedAt !== have)) applySync(data);
        } catch (e) {
          if (e.badCode) { syncInfo.needCode = true; syncInfo.codeError = "الكود غلط، جرّب تاني"; return; }
          throw e;
        }
      }
    } else if (force || (remote && remote !== have) || (!status && !have)) {
      try {
        const data = await getJSON(DATA);
        if (data?.format === "mrp-sync/1" && (force || data.syncedAt !== have)) applySync(data);
      } catch (e) { if (e.code !== 404) throw e; }
    }
    syncInfo.error = null;
  } catch (e) {
    syncInfo.error = e.fatal ? e.message : isNative() ? "مفيش نت، أو البيانات لسه ما اترفعتش. التطبيق شغال بآخر بيانات اتحملت." : location.protocol === "file:" ? "الموقع لازم يشتغل من start-windows.bat عشان المزامنة تشتغل" : "مش قادر يوصل لبيانات المزامنة: " + e.message;
  } finally {
    syncInfo.lastCheck = new Date();
    syncInfo.checking = false;
    ping();
  }
}

export function disconnectSync() {
  setCode("");
  store.update((s) => { s.excel = null; s.excelMoves = []; });
}

export function startAutoSync() {
  checkSync();
  setInterval(() => { if (!document.hidden) checkSync(); }, EVERY_MS);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkSync(); });
}

/** نص قصير لحالة المزامنة */
export function syncSummary() {
  const ex = store.state.excel, st = syncInfo.status;
  if (syncInfo.error) return { cls: "bad", text: syncInfo.error };
  if (st && st.ok === false) return { cls: "bad", text: "المزامنة وقفت: " + (st.error || "خطأ") };
  if (!ex) return { cls: "off", text: "مش متوصل بشيت المخازن" };
  return { cls: "good", text: "متزامن مع " + (ex.source?.file || "الشيت") };
}

export const timeAgo = (iso) => {
  if (!iso) return "—";
  const d = new Date(iso), mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1) return "دلوقتي";
  if (mins < 60) return "من " + (mins === 1 ? "دقيقة" : mins === 2 ? "دقيقتين" : mins + (mins <= 10 ? " دقايق" : " دقيقة"));
  const h = Math.round(mins / 60);
  if (h < 24) return "من " + (h === 1 ? "ساعة" : h === 2 ? "ساعتين" : h + (h <= 10 ? " ساعات" : " ساعة"));
  return d.toLocaleDateString("en-GB") + " " + d.toTimeString().slice(0, 5);
};

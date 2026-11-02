// كارت "افتح التطبيق على الموبايل" (على الكمبيوتر) و"ثبّت التطبيق" (على الموبايل)
import { esc } from "./util.js";

const isLocal = () => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(location.hostname);
let net = null, qrLoading = null;

async function loadNet() {
  try { const r = await fetch("./data/net.json?t=" + Date.now(), { cache: "no-store" }); if (r.ok) net = await r.json(); } catch {}
}
function loadQr() {
  if (window.qrcode) return Promise.resolve();
  return qrLoading ||= new Promise((res) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js";
    s.onload = res; s.onerror = res; document.head.appendChild(s);
  });
}
function qrSvg(text) {
  if (!window.qrcode) return "";
  const q = window.qrcode(0, "M"); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

export function renderPhoneCard() {
  if (!isLocal()) {
    const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return "";
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<section class="card phone-card">
      <h3>📱 ثبّت التطبيق على الموبايل</h3>
      <p>${ios ? "في Safari دوس زرار المشاركة <b>⬆︎</b> وبعدين <b>Add to Home Screen</b>." : "في Chrome دوس <b>⋮</b> فوق وبعدين <b>Add to Home screen</b> (إضافة إلى الشاشة الرئيسية)."}
      هتلاقي أيقونة <b>الخامات</b> على الشاشة تفتح التطبيق على طول.</p>
      <p class="cap">لازم الموبايل يكون على واي فاي الشركة، والكمبيوتر اللي شغّال عليه التطبيق مفتوح.</p>
    </section>`;
  }
  const url = net?.urls?.[0];
  return `<section class="card phone-card" id="phone-card">
    <h3>📱 افتح التطبيق على الموبايل</h3>
    ${url ? `<div class="phone-row">
      <div class="qr" id="phone-qr" aria-label="QR"></div>
      <div>
        <p>وصّل الموبايل على <b>واي فاي الشركة</b>، وصوّر الكود بالكاميرا، أو اكتب العنوان ده في Chrome:</p>
        <div class="phone-url">${esc(url)}</div>
        ${net.urls.length > 1 ? `<p class="cap">لو ما فتحش جرّب: ${net.urls.slice(1).map(esc).join(" أو ")}</p>` : ""}
        <p class="cap">بعد ما يفتح، من قايمة Chrome اختار <b>Add to Home screen</b> عشان يبقى أيقونة على الموبايل.
        لو ما فتحش خالص، غالبًا الـ Firewall في ويندوز قافل البورت ${esc(net.port)}: اسمح لـ Python على Private networks.</p>
      </div>
    </div>` : `<p class="muted">شغّل التطبيق من <code>start-windows.bat</code> عشان يظهر هنا العنوان اللي تفتحه من الموبايل.</p>`}
  </section>`;
}

export async function bindPhoneCard(root) {
  if (!isLocal()) return;
  const had = !!net;
  await loadNet();
  if (!had && net && document.getElementById("phone-card")) {
    const card = document.getElementById("phone-card");
    const tmp = document.createElement("div"); tmp.innerHTML = renderPhoneCard(); card.replaceWith(tmp.firstElementChild);
  }
  const box = document.getElementById("phone-qr");
  if (box && net?.urls?.[0]) { await loadQr(); box.innerHTML = qrSvg(net.urls[0]) || `<small class="muted">الكود محتاج نت عشان يظهر</small>`; }
}

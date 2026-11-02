# -*- coding: utf-8 -*-
"""
مزامنة شيت مخزن الخامات مع لوحة الخامات MRP.
بيبص على ملف الشيت كل فترة، ولو اتعدّل بيفك الباسورد ويقرا:
  - شيت «الارصدة»  -> الأصناف والأرصدة وحدود الطلب
  - كروت الأصناف    -> حركات الوارد والمنصرف
ويكتب النتيجة في data/sync.json جوه فولدر الموقع، والموقع بيسحبها لوحده.
"""
import argparse, base64, datetime as dt, gzip, io, json, os, re, shutil, socket, sys, tempfile, time, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(HERE, "sync-config.json")
DEFAULT_CONFIG = {
    "_help": "excel_path = مسار الشيت، أو مسار الفولدر اللي فيه شيتات الشهور (هياخد أحدث ملف). استخدم / أو \\\\ في المسار.",
    "excel_path": "C:/Users/اسمك/Desktop/المخازن",
    "password": "",
    "interval_minutes": 10,
    "name_contains": "الخامات",
    "balance_sheet": "الارصدة",
    "output": "data/sync.json",
    "port": 5173,
    "_help_online": "عشان يتفتح من أي مكان: app_code = كود الدخول للتطبيق، و github = الريبو والتوكن",
    "app_code": "",
    "github": {"repo": "", "token": "", "branch": "main"},
}

# ---------- helpers ----------
def log(*a):
    print(dt.datetime.now().strftime("%H:%M:%S"), *a, flush=True)

def s(v):
    if v is None: return ""
    if isinstance(v, float) and v.is_integer(): v = int(v)
    return str(v).strip()

def num(v):
    if isinstance(v, bool): return None
    if isinstance(v, (int, float)): return float(v)
    if isinstance(v, str):
        t = v.strip().replace(",", "")
        try: return float(t)
        except ValueError: return None
    return None

def bad(v):  # excel error strings
    return isinstance(v, str) and v.strip().startswith("#")

def clean(v):
    if v is None or bad(v): return None
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v).strip()
        return v or None
    if isinstance(v, float) and v.is_integer(): return int(v)
    if isinstance(v, (dt.datetime, dt.date)): return v.strftime("%Y-%m-%d")
    return v

def to_date(v):
    """excel serial / datetime / text -> 'YYYY-MM-DD' or None"""
    if isinstance(v, dt.datetime): return v.strftime("%Y-%m-%d")
    if isinstance(v, dt.date): return v.strftime("%Y-%m-%d")
    if isinstance(v, (int, float)) and 20000 < v < 80000:
        return (dt.datetime(1899, 12, 30) + dt.timedelta(days=float(v))).strftime("%Y-%m-%d")
    if isinstance(v, str):
        m = re.match(r"^\s*(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\s*$", v)
        if m:
            d, mo, y = map(int, m.groups()); y += 2000 if y < 100 else 0
            try: return dt.date(y, mo, d).strftime("%Y-%m-%d")
            except ValueError: return None
    return None

def norm(t):
    t = s(t).lower()
    t = re.sub("[إأآا]", "ا", t); t = t.replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"[\s\-_/()]+", "", t)

# ---------- readers (give each sheet as a list of row lists) ----------
class Book:
    def __init__(self, path, password):
        self.path, self.password = path, password
        ext = os.path.splitext(path)[1].lower()
        self.data = self._decrypt(path, password)
        if ext == ".xlsb": self._open_xlsb()
        else: self._open_openpyxl()

    @staticmethod
    def _decrypt(path, password):
        with open(path, "rb") as f: raw = f.read()
        if raw[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":  # encrypted (OLE container)
            import msoffcrypto
            of = msoffcrypto.OfficeFile(io.BytesIO(raw))
            of.load_key(password=password)
            out = io.BytesIO(); of.decrypt(out)
            return out.getvalue()
        return raw

    def _open_xlsb(self):
        from pyxlsb import open_workbook
        self.kind = "xlsb"
        self._tmp = tempfile.NamedTemporaryFile(suffix=".xlsb", delete=False)
        self._tmp.write(self.data); self._tmp.close()
        self.wb = open_workbook(self._tmp.name)
        self.sheetnames = list(self.wb.sheets)

    def _open_openpyxl(self):
        import openpyxl, warnings; warnings.filterwarnings("ignore")
        import openpyxl.reader.workbook as w
        orig = w.WorkbookParser.assign_names
        def safe(self_):
            try: orig(self_)
            except Exception: pass
        w.WorkbookParser.assign_names = safe
        self.kind = "xlsx"
        self.wb = openpyxl.load_workbook(io.BytesIO(self.data), read_only=True, data_only=True)
        self.sheetnames = list(self.wb.sheetnames)

    def rows(self, name, max_rows=None):
        out = []
        if self.kind == "xlsb":
            with self.wb.get_sheet(name) as sh:
                for i, r in enumerate(sh.rows()):
                    out.append([c.v for c in r])
                    if max_rows and i + 1 >= max_rows: break
        else:
            for i, r in enumerate(self.wb[name].iter_rows(values_only=True)):
                out.append(list(r))
                if max_rows and i + 1 >= max_rows: break
        return out

    def close(self):
        try: self.wb.close()
        except Exception: pass
        if getattr(self, "_tmp", None):
            try: os.unlink(self._tmp.name)
            except Exception: pass

# ---------- balance sheet ----------
BAL_COLS = {  # header text -> field (matched on the header rows, positions as fallback)
    "serial": (0, ["مسلسل"]), "rack": (2, ["راك رئيسي"]), "subRack": (4, ["راك فرعي"]), "shelf": (6, ["رقم الرف"]),
    "category": (9, ["التصنيف"]), "group": (10, None), "name": (11, ["اسم الصنف"]),
    "cardSheet": (12, ["الكود القديم"]), "code": (13, None), "erpCode": (14, ["كود erp system", "erp"]),
    "newCode": (15, ["الكود الجديد"]), "supplierSize": (16, ["مقاس المورد"]), "dept": (19, ["جهه الصرف"]),
    "shortCode": (21, ["كود مختصر"]), "unit": (22, ["الوحده"]), "inQty": (23, ["الوارد"]), "outQty": (24, ["منصرف"]),
    "balance": (25, ["رصيد اخر المده"]), "packQty": (32, ["عبوه المشتريات"]), "suggestQty": (35, ["الكميه المطلوب شرائها"]),
    "opening": (36, ["رصيد اول المده"]), "safety": (41, ["مخزون الامان"]), "max": (42, ["maximumstock"]),
    "rop": (43, None), "planning": (44, None), "eoq": (45, ["كميه الطلب الاقتصاديه"]), "orderStatus": (46, ["حاله الطلب"]),
    "orderQty": (47, ["كميه طلب الشراء"]), "alarm": (48, ["alarm"]), "notes": (49, None),
    "avgMonthly": (50, ["متوسط الاستهلاك الشهري"]), "abc": (56, None), "leadTime": (70, ["مده التوريد"]),
}
NUMERIC = {"inQty", "outQty", "balance", "packQty", "suggestQty", "opening", "safety", "max", "rop", "eoq", "orderQty", "avgMonthly"}

def locate_columns(head_rows):
    cols = {k: v[0] for k, v in BAL_COLS.items()}
    for field, (pos, keys) in BAL_COLS.items():
        if not keys: continue
        for hr in head_rows:
            if pos < len(hr) and any(norm(k) in norm(hr[pos]) for k in keys): break
        else:
            for hr in head_rows:
                hit = [i for i, v in enumerate(hr) if v and any(norm(k) == norm(v) or norm(k) in norm(v) for k in keys)]
                if hit: cols[field] = hit[0]; break
    return cols

def lead_days(v):
    n = num(v)
    if n is not None: return n
    m = re.search(r"(\d+)", s(v))
    return float(m.group(1)) if m else None

def read_balance(book, sheet):
    rows = book.rows(sheet)
    hi = next((i for i, r in enumerate(rows[:15]) if any(norm(x) == norm("اسم الصنف") for x in r if x)), 1)
    cols = locate_columns(rows[max(0, hi - 1): hi + 3])
    title = next((s(x) for r in rows[:hi] for x in r if s(x)), "")
    period = (re.search(r"(\d{1,2}-\d{4})", title) or [None, None])[1]
    items = []
    for r in rows[hi + 1:]:
        g = lambda f: r[cols[f]] if cols[f] < len(r) else None
        name = clean(g("name"))
        if not name or not isinstance(name, str): continue
        it = {}
        for f in BAL_COLS:
            v = g(f)
            it[f] = (None if bad(v) else num(v)) if f in NUMERIC else clean(v)
        it["leadTime"] = lead_days(g("leadTime"))
        it["code"] = s(it["code"]) or s(it["erpCode"]) or name
        it["cardSheet"] = s(it["cardSheet"]) or None
        items.append(it)
    return {"title": title, "period": period, "items": items}

# ---------- item cards ----------
def is_card(rows):
    if len(rows) < 4: return False
    r0 = [norm(x) for x in rows[0]]
    return norm("اسم الصنف") in r0 and norm("الكود") in r0

def read_card(name, rows):
    r0, r1 = rows[0], rows[1]
    pos = {norm(v): i for i, v in enumerate(r0) if v}
    ci = pos.get(norm("الكود"), 8); ni = pos.get(norm("اسم الصنف"), 4); oi = pos.get(norm("اول مده"), 10)
    card = {"sheet": name, "code": s(r1[ci]) if ci < len(r1) else "", "name": clean(r1[ni]) if ni < len(r1) else None,
            "unit": clean(r1[0]), "opening": num(r1[oi]) if oi < len(r1) else None}
    hdr = next((i for i, r in enumerate(rows[:6]) if r and norm(r[0]) == norm("التاريخ")), 2)
    h = [norm(x) for x in rows[hdr]]
    def col(label, dflt):
        k = norm(label)
        return next((i for i, v in enumerate(h) if v == k), next((i for i, v in enumerate(h) if v and k in v), dflt))
    C = {"date": 0, "po": col("رقم طلب الشراء", 1), "permit": col("رقم الاذن", 2), "dept": col("جهه الصرف", 4),
         "supplier": col("المورد", 5), "in": col("الوارد", 8), "out": col("منصرف", 9), "bal": col("رصيد متبقي", 10)}
    moves, seq = [], 0
    for r in rows[hdr + 2:]:
        d = to_date(r[C["date"]] if r else None)
        if not d: continue
        g = lambda k: r[C[k]] if C[k] < len(r) else None
        qin, qout = num(g("in")) or 0, num(g("out")) or 0
        if not qin and not qout: continue
        seq += 1
        pm, ps = clean(r[2]) if len(r) > 2 else None, clean(r[3]) if len(r) > 3 else None
        permit = s(pm or ps)
        moves.append({"key": f"{card['code'] or name}|{d}|{permit or 'n'+str(seq)}|{qin}|{qout}",
                      "sheet": name, "code": card["code"], "date": d, "po": clean(g("po")), "permit": permit or None,
                      "dept": clean(g("dept")), "supplier": clean(g("supplier")),
                      "in": qin, "out": qout, "balance": num(g("bal"))})
    card["moves"] = moves
    return card

# ---------- one sync ----------
EXTS = (".xlsb", ".xlsx", ".xlsm")
PERIOD_RE = re.compile(r"(?<!\d)(\d{1,2})[-_. ](20\d{2})(?!\d)")

def _period(text):
    """'11-2026' في اسم الملف أو الفولدر -> (2026, 11)"""
    found = [(int(y), int(m)) for m, y in PERIOD_RE.findall(text) if 1 <= int(m) <= 12]
    return max(found) if found else (0, 0)

def resolve_path(p, name_contains="", max_depth=3):
    """
    ملف -> نفسه.
    فولدر -> بيدور جواه (وجوه الفولدرات اللي فيها أرقام زي 2026 و 11-2026) على شيتات
    اسمها فيه name_contains، وياخد أحدث شهر حسب الرقم اللي في الاسم (11-2026)،
    ولو اتساووا ياخد آخر واحد اتعدّل.
    """
    p = os.path.normpath(os.path.expandvars(os.path.expanduser(p)))
    if not os.path.isdir(p): return p
    key = norm(name_contains)
    found = []
    base = p.rstrip("/\\").count(os.sep)
    for root, dirs, files in os.walk(p):
        depth = root.rstrip("/\\").count(os.sep) - base
        if depth >= max_depth: dirs[:] = []
        else: dirs[:] = [d for d in dirs if re.search(r"\d", d)]
        for f in files:
            if not f.lower().endswith(EXTS) or f.startswith("~$"): continue
            if key and key not in norm(f): continue
            full = os.path.join(root, f)
            try: found.append((_period(f) if _period(f) != (0, 0) else _period(root), os.path.getmtime(full), full))
            except OSError: pass
    return max(found)[2] if found else None

def build(cfg, path):
    mtime = os.path.getmtime(path)
    # copy first so an open Excel file doesn't block us
    tmpdir = tempfile.mkdtemp()
    local = os.path.join(tmpdir, "src" + os.path.splitext(path)[1])
    shutil.copy2(path, local)
    t0 = time.time()
    book = Book(local, cfg.get("password", ""))
    try:
        bal_name = next((n for n in book.sheetnames if norm(n) == norm(cfg["balance_sheet"])), None)
        if not bal_name: raise RuntimeError(f"مش لاقي شيت «{cfg['balance_sheet']}» في الملف")
        bal = read_balance(book, bal_name)
        cards, by_code = [], {}
        for n in book.sheetnames:
            if n == bal_name: continue
            try: rows = book.rows(n, max_rows=2000)
            except Exception: continue
            if not is_card(rows): continue
            c = read_card(n, rows); cards.append(c)
            if c["code"]: by_code.setdefault(c["code"], c)
        # link each item to its card by code, then by sheet name
        by_sheet = {norm(c["sheet"]): c for c in cards}
        moves, linked = [], 0
        for it in bal["items"]:
            c = by_code.get(s(it["code"])) or by_sheet.get(norm(it["cardSheet"] or ""))
            if c:
                linked += 1; it["cardSheet"] = c["sheet"]
                for m in c["moves"]:
                    m["itemCode"] = it["code"]; moves.append(m)
                c["_used"] = True
        unlinked = [c["sheet"] for c in cards if not c.get("_used") and c["moves"]]
    finally:
        book.close(); shutil.rmtree(tmpdir, ignore_errors=True)
    return {
        "format": "mrp-sync/1",
        "syncedAt": dt.datetime.now().isoformat(timespec="seconds"),
        "source": {"file": os.path.basename(path), "modified": dt.datetime.fromtimestamp(mtime).isoformat(timespec="seconds"),
                   "title": bal["title"], "period": bal["period"]},
        "stats": {"items": len(bal["items"]), "cards": len(cards), "linkedCards": linked, "moves": len(moves),
                  "seconds": round(time.time() - t0, 1), "cardsNotLinked": unlinked[:50]},
        "items": bal["items"], "moves": moves,
    }

def write_json(obj, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
    tmp = out + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, out)

# ---------- تشفير البيانات قبل رفعها (AES-256-GCM بمفتاح من كود الدخول) ----------
KDF_ITER = 200_000
def encrypt_payload(obj, code):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=KDF_ITER).derive(code.encode("utf-8"))
    raw = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    ct = AESGCM(key).encrypt(iv, raw, None)
    b = lambda x: base64.b64encode(x).decode()
    return {"format": "mrp-enc/1", "kdf": "PBKDF2-SHA256", "iter": KDF_ITER, "salt": b(salt), "iv": b(iv), "gzip": True, "data": b(ct)}

# ---------- الرفع على GitHub (من غير ما تحتاج git) ----------
def gh_put(cfg, rel_path, local_path, message):
    gh = cfg.get("github") or {}
    repo, token, branch = gh.get("repo", "").strip(), gh.get("token", "").strip(), gh.get("branch", "main") or "main"
    if not repo or not token: return False
    url = f"{gh.get('api', 'https://api.github.com')}/repos/{repo}/contents/{rel_path}"
    hdr = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
           "User-Agent": "mrp-excel-sync", "X-GitHub-Api-Version": "2022-11-28"}
    sha = None
    try:
        with urllib.request.urlopen(urllib.request.Request(url + f"?ref={branch}", headers=hdr), timeout=60) as r:
            sha = json.load(r).get("sha")
    except urllib.error.HTTPError as e:
        if e.code != 404: raise RuntimeError(f"GitHub رفض القراية ({e.code}): اتأكد من اسم الريبو والتوكن")
    with open(local_path, "rb") as f: content = base64.b64encode(f.read()).decode()
    body = {"message": message, "content": content, "branch": branch}
    if sha: body["sha"] = sha
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={**hdr, "Content-Type": "application/json"}, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=120) as r: r.read()
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"GitHub رفض الرفع ({e.code}): التوكن لازم يكون له صلاحية Contents: Read and write على الريبو")
    return True

def publish(cfg, files):
    """files: [(rel_path_in_repo, local_path)]"""
    gh = cfg.get("github") or {}
    if not gh.get("repo") or not gh.get("token"): return
    for rel, local in files:
        gh_put(cfg, rel, local, f"تحديث بيانات المخزن {dt.datetime.now():%Y-%m-%d %H:%M}")
    log("اترفع على GitHub:", gh["repo"])

def write_status(out, **kw):
    p = os.path.join(os.path.dirname(out), "sync-status.json")
    write_json({"at": dt.datetime.now().isoformat(timespec="seconds"), **kw}, p)
    return p

def lan_ips():
    """عناوين الجهاز على شبكة الشركة، عشان الموبايل يفتح التطبيق منها"""
    ips = set()
    try:
        so = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); so.connect(("10.255.255.255", 1))
        ips.add(so.getsockname()[0]); so.close()
    except Exception: pass
    try: ips.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except Exception: pass
    return sorted(i for i in ips if not i.startswith(("127.", "169.254.")))

def write_net(cfg):
    try:
        port = int(cfg.get("port", 5173))
        write_json({"host": socket.gethostname(), "port": port, "ips": lan_ips(),
                    "urls": [f"http://{i}:{port}" for i in lan_ips()]},
                   os.path.join(os.path.dirname(cfg["output"]), "net.json"))
    except Exception: pass

def load_config():
    if not os.path.exists(CONFIG_PATH):
        with open(CONFIG_PATH, "w", encoding="utf-8") as f: json.dump(DEFAULT_CONFIG, f, ensure_ascii=False, indent=2)
        log("اتعمل ملف sync-config.json. اكتب فيه مسار الشيت والباسورد، احفظه، وشغّل تاني.")
        if os.name == "nt":
            try: os.startfile(CONFIG_PATH)
            except Exception: pass
        sys.exit(1)
    with open(CONFIG_PATH, encoding="utf-8-sig") as f: cfg = {**DEFAULT_CONFIG, **json.load(f)}
    if not os.path.isabs(cfg["output"]): cfg["output"] = os.path.join(HERE, cfg["output"])
    return cfg

def run_once(cfg, last=None, force=False):
    path = resolve_path(cfg["excel_path"], cfg.get("name_contains", ""))
    if not path or not os.path.exists(path):
        msg = f"مش لاقي شيت اسمه فيه «{cfg.get('name_contains', '')}» في: {cfg['excel_path']}"
        log(msg); write_status(cfg["output"], ok=False, error=msg); return last
    stamp = (path, os.path.getmtime(path))
    if not force and stamp == last: return last
    log("بيقرا:", os.path.basename(path))
    try:
        data = build(cfg, path)
        code = str(cfg.get("app_code") or "").strip()
        outdir = os.path.dirname(cfg["output"])
        if code:
            enc_path = os.path.join(outdir, "sync.enc.json")
            write_json(encrypt_payload(data, code), enc_path)
            if os.path.exists(cfg["output"]): os.remove(cfg["output"])  # مفيش نسخة مكشوفة
            data_file, data_local = "sync.enc.json", enc_path
        else:
            write_json(data, cfg["output"])
            data_file, data_local = "sync.json", cfg["output"]
        st = data["stats"]
        log(f"تم: {st['items']} صنف، {st['moves']} حركة من {st['linkedCards']} كارت ({st['seconds']} ثانية)")
        status_local = write_status(cfg["output"], ok=True, syncedAt=data["syncedAt"], modified=data["source"]["modified"],
                                    file=data["source"]["file"], period=data["source"]["period"], stats=st,
                                    encrypted=bool(code), dataFile=data_file)
        try:
            publish(cfg, [("data/" + data_file, data_local), ("data/sync-status.json", status_local)])
        except Exception as e:
            log("الرفع على GitHub فشل:", e, "(هيحاول تاني المرة الجاية)")
            return last
        return stamp
    except Exception as e:
        msg = str(e)
        if isinstance(e, ModuleNotFoundError):
            msg = f"مكتبة ناقصة ({e.name}). شغّل: python -m pip install msoffcrypto-tool pyxlsb openpyxl"
        elif isinstance(e, PermissionError):
            msg = "الملف مقفول ومش قادر يقراه دلوقتي، هيحاول تاني المرة الجاية."
        elif "password" in msg.lower() or "decrypt" in msg.lower() or "key" in msg.lower():
            msg = "الباسورد غلط أو مش قادر يفك قفل الملف: " + msg
        log("خطأ:", msg); write_status(cfg["output"], ok=False, error=msg)
        return last  # retry next round

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true", help="مزامنة مرة واحدة وخروج")
    ap.add_argument("--file"); ap.add_argument("--password"); ap.add_argument("--out")
    a = ap.parse_args()
    cfg = load_config() if not a.file else {**DEFAULT_CONFIG, "excel_path": a.file}
    if a.password is not None: cfg["password"] = a.password
    if a.out: cfg["output"] = a.out
    if not os.path.isabs(cfg["output"]): cfg["output"] = os.path.join(HERE, cfg["output"])
    write_net(cfg)
    if a.once:
        run_once(cfg, force=True); return
    every = max(1, float(cfg.get("interval_minutes", 10)))
    log(f"المزامنة شغالة: هيبص على الشيت كل {every:g} دقيقة. سيب الشباك ده مفتوح.")
    for u in [f"http://{i}:{cfg.get('port', 5173)}" for i in lan_ips()]: log("افتحه من الموبايل:", u)
    last = run_once(cfg, force=True)
    while True:
        time.sleep(every * 60)
        last = run_once(cfg, last)

if __name__ == "__main__":
    main()

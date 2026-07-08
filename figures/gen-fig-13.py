# -*- coding: utf-8 -*-
import csv, math, os, datetime

# Portable paths: reads history.csv next to the script (or one level up, for the public
# alkanes-opreturn-stats repo where this lives in figures/) and writes SVGs beside itself.
SP = os.path.dirname(os.path.abspath(__file__))
CSV = os.path.join(SP, "history.csv")
if not os.path.exists(CSV):
    CSV = os.path.join(os.path.dirname(SP), "history.csv")
OUT = SP
os.makedirs(OUT, exist_ok=True)

# ---- palette ----
GREEN="#5dcaa5"; GREEN_D="#0f6e56"; GREEN_L="#9fd9c2"
ORANGE="#f0997b"; ORANGE_D="#993c1d"
NEUT="#d3d1c7"; NEUT_D="#5f5e5a"
T_DARK="#2c2c2a"; T_LABEL="#5f5e5a"; T_MUTE="#888780"; GRID="#cfcdc4"
LAV="#aab8d6"; GOLD="#d9a441"; CHAR="#4a4a52"          # site accents: block-weight, miner-fee, other
GDASH='stroke-dasharray="4 3"'                          # dashed gridlines, like the /metrics charts

# Theme-adaptive ink: an internal <style> remaps the fixed ink hexes to currentColor (the article
# inlines these SVGs under [data-ed-theme], so currentColor follows the reader's light/dark theme),
# while data-mark hexes (GREEN/ORANGE/NEUT on <path>/<rect>/<polyline>) stay put. Attribute
# selectors mean zero per-emitter edits; DOMPurify (the CMS sanitizer) preserves this <style>.
# The line[stroke-width="1"] qualifier hits only 1px gridlines, not the 3px NEUT_D legend swatch.
#
# STANDALONE FALLBACK (admin preview / RSS / anywhere the figure renders as <img>): inside an
# <img>, currentColor cannot inherit from the page and resolves to BLACK — invisible on a dark
# canvas. So the root <svg class="figchart"> carries its own ink+canvas, with a
# prefers-color-scheme media query for dark. When the site INLINES the SVG, the higher-specificity
# rule in globals.css (.ed-figure svg{color:var(--ed-ink);background:transparent}) takes back
# control, so the manual theme toggle keeps working exactly as before. The .figchart class keeps
# these rules from leaking onto the page's icon SVGs when inlined (a bare svg{} selector would).
# NOTE: no prefers-color-scheme media query here on purpose. Inside an <img>, browsers evaluate
# that MQ against the EMBEDDING page's color-scheme, which differs across admin surfaces — the
# same article showed a mix of dark- and light-canvas figures ("será que bugou?"). A fixed light
# card is deterministic and readable everywhere; the inline path overrides it anyway.
INK_STYLE = ('<style>'
    '.figchart{color:#2c2c2a;background:#fdfdfc}'
    'text[fill="#2c2c2a"]{fill:currentColor;fill-opacity:.92}'
    'text[fill="#5f5e5a"]{fill:currentColor;fill-opacity:.6}'
    'text[fill="#888780"]{fill:currentColor;fill-opacity:.5}'
    'line[stroke="#cfcdc4"]{stroke:currentColor;stroke-opacity:.14}'
    'line[stroke="#5f5e5a"][stroke-width="1"]{stroke:currentColor;stroke-opacity:.3}'
    'circle[fill="#fff"]{fill:var(--ed-canvas,#fff)}'
    'path[stroke="#fff"]{stroke:var(--ed-canvas,#fff)}'
    '</style>\n')
SRC="Source: in-house full-chain OP_RETURN decode, every block. Live charts: subfrost.io/metrics"

rows=[]
with open(CSV, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        def n(k):
            try: return float(r[k])
            except: return 0.0
        def o(k):
            # extended census columns lag the daily sample by 1-3 days; empty cell = MISSING
            try: return float(r[k])
            except (ValueError, KeyError, TypeError): return None
        rows.append({
            "date": r["date"],
            "fromH": n("fromHeight"), "toH": n("toHeight"), "scanned": n("blocksScanned"),
            "totalTx": n("totalTx"), "opTx": n("txWithOpReturn"), "alkTx": n("txAlkanes"),
            "opB": n("opReturnBytes"), "runeB": n("runestoneBytes"), "alkB": n("alkanesBytes"),
            "diesel": n("dieselMints"),
            "feeT": n("feeTotalSats"), "feeA": n("feeAlkanesSats"), "feeO": n("feeOpReturnSats"),
            "btc": n("btcUsd"),
            # extended census columns (added 2026-07-06)
            "wT": o("weightTotal"), "wA": o("weightAlkanes"),
            "ug": o("ugMints"), "dug": o("dieselUg"),
            "alkRune": o("txAlkRunestone"), "pureRune": o("txPureRunes"),
        })
rows.sort(key=lambda x:x["date"])

# ---- day filter: full-census days PLUS the sampled trailing days from the daily cron
# (>=20 blocks; ratios are unbiased, per-day counts get the x144/scanned extrapolation),
# mirroring what subfrost.io/metrics shows. Only the CURRENT UTC day (still filling)
# and too-thin days are dropped.
TODAY = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")
full=[]; dropped=[]
for r in rows:
    span=r["toH"]-r["fromH"]+1
    keep = span>0 and (r["scanned"]>=0.9*span or r["scanned"]>=20) and r["date"] < TODAY
    (full if keep else dropped).append(r)
if dropped:
    print("DROPPED non-census (partial) rows:",
          [(r["date"], int(r["scanned"]), int(r["toH"]-r["fromH"]+1)) for r in dropped])
rows=full
N=len(rows)
last60 = rows[-60:]

def safe(a,b): return a/b if b else 0.0

for r in rows:
    r["p_alkTx"]   = safe(r["alkTx"], r["totalTx"])
    r["p_opTx"]    = safe(r["opTx"], r["totalTx"])
    r["p_alkOfOp"] = safe(r["alkTx"], r["opTx"])
    r["p_alkB"]    = safe(r["alkB"], r["opB"])
    r["p_diesel"]  = safe(r["diesel"], r["alkTx"])
    r["p_feeA"]    = safe(r["feeA"], r["feeT"])
    r["feeA_usd"]  = r["feeA"]/1e8*r["btc"]
    pure_rune = max(r["runeB"]-r["alkB"], 0.0)
    other = max(r["opB"]-r["runeB"], 0.0)
    tot = r["alkB"]+pure_rune+other
    r["sh_alk"]  = safe(r["alkB"], tot)
    r["sh_rune"] = safe(pure_rune, tot)
    r["sh_oth"]  = safe(other, tot)
    # --- extended metrics (2026-07-06); None = column not yet backfilled for that day ---
    opt = lambda a,b: None if (a is None or b is None) else safe(a,b)
    r["p_weight"]     = opt(r["wA"], r["wT"])                        # alkanes share of block weight
    r["p_ugDiesel"]   = opt(r["dug"], r["ug"])                       # UNCOMMON*GOODS mints that are DIESEL
    runeTxTot = None if (r["alkRune"] is None or r["pureRune"] is None) else r["alkRune"] + r["pureRune"]
    r["p_runeTxAlk"]  = opt(r["alkRune"], runeTxTot)                # runestone tx that are Alkanes
    r["p_runeTxPure"] = opt(r["pureRune"], runeTxTot)              # runestone tx that are non-Alkanes Runes
    r["bpt_alk"]      = safe(r["alkB"], r["alkTx"])                 # OP_RETURN bytes per Alkanes tx
    r["bpt_oth"]      = safe(r["opB"]-r["alkB"], r["opTx"]-r["alkTx"])
    r["fpt_alk"]      = safe(r["feeA"], r["alkTx"])                 # fee (sats) per Alkanes tx
    r["fpt_oth"]      = safe(r["feeT"]-r["feeA"], r["totalTx"]-r["alkTx"])
    # --- fig-site series (mirror of subfrost.io/metrics, 2026-07-06) ---
    r["p_dieselAll"]  = safe(r["diesel"], r["totalTx"])             # DIESEL mints as share of ALL tx
    r["p_pureB"]      = safe(pure_rune, r["opB"])                   # non-Alkanes Runes share of OP_RETURN bytes
    r["fpt_alk_gap"]  = r["fpt_alk"] if r["alkTx"] >= 50 else None  # min-sample rule (site): <50 tx/day = noise, gap
    r["ug_d_raw"]     = r["dug"]                                    # raw sampled counts (site plots raw, not x144)
    r["ug_i_raw"]     = None if (r["ug"] is None or r["dug"] is None) else max(r["ug"]-r["dug"], 0.0)
    # per standard 144-block day (normalises the varying block count per row)
    norm = safe(144.0, r["scanned"])
    r["diesel_day"]   = r["diesel"]*norm
    r["ugDiesel_day"] = None if r["dug"] is None else r["dug"]*norm
    r["ugIndep_day"]  = None if (r["ug"] is None or r["dug"] is None) else max(r["ug"]-r["dug"], 0.0)*norm
    # txAlkRunestone/txPureRunes chegam do CSV JA extrapolados p/ dia de 144 blocos
    # (spec do censo, 2026-07-06) — plotar direto, sem re-aplicar norm.
    r["alkRune_day"]  = r["alkRune"]
    r["pureRune_day"] = r["pureRune"]
    r["alkB_day"]     = r["alkB"]*norm
    r["pureRuneB_day"]= pure_rune*norm
    r["feeBTC_alk"]   = r["feeA"]/1e8*norm
    r["feeBTC_rest"]  = max(r["feeT"]-r["feeA"], 0.0)/1e8*norm
    r["minerRev_usd"] = (r["feeT"]/1e8*norm + 3.125*144)*r["btc"]   # fees + block subsidy, USD/day

def mov(series, key, w=7):
    out=[]
    for i in range(len(series)):
        lo=max(0,i-w+1); seg=series[lo:i+1]
        out.append(sum(s[key] for s in seg)/len(seg))
    return out

def agg(series):
    s=lambda k: sum((r[k] or 0) for r in series)
    tt=s("totalTx"); op=s("opTx"); al=s("alkTx"); di=s("diesel")
    opB=s("opB"); runeB=s("runeB"); alkB=s("alkB")
    feeT=s("feeT"); feeA=s("feeA"); feeO=s("feeO")
    wT=s("wT"); wA=s("wA"); ug=s("ug"); dug=s("dug")
    alkR=s("alkRune"); pureR=s("pureRune")
    pure_rune=max(runeB-alkB,0.0); other=max(opB-runeB,0.0); totB=alkB+pure_rune+other
    usd=sum(r["feeA_usd"] for r in series)
    return {
        "p_alkTx":safe(al,tt),"p_opTx":safe(op,tt),"p_alkOfOp":safe(al,op),
        "p_alkB":safe(alkB,opB),"p_diesel":safe(di,al),"p_feeA":safe(feeA,feeT),
        "p_feeO":safe(feeO,feeT),
        "sh_alk":safe(alkB,totB),"sh_rune":safe(pure_rune,totB),"sh_oth":safe(other,totB),
        "p_weight":safe(wA,wT),"p_ugDiesel":safe(dug,ug),"p_runeTxAlk":safe(alkR,alkR+pureR),
        "bpt_alk":safe(alkB,al),"bpt_oth":safe(opB-alkB,op-al),
        "fpt_alk":safe(feeA,al),"fpt_oth":safe(feeT-feeA,tt-al),
        "usd":usd,"usd_day":usd/len(series),"tt":tt,"days":len(series),
    }

# running cumulative DIESEL mints; sampled tail days enter EXTRAPOLATED to the full
# 144-block day (census days have norm~1, so this is identical for them)
cum=0.0
for r in rows:
    cum += r["diesel_day"]; r["diesel_cum"]=cum

A60=agg(last60); AALL=agg(rows); LAST=rows[-1]

# per-chart series: extended columns lag the sampled tail by 1-3 days; each chart simply
# ends on the last day its own columns exist (no fake zeros at the right edge)
W60=[x for x in last60 if x["p_weight"] is not None];   WR=[x for x in rows if x["p_weight"] is not None]
UG60=[x for x in last60 if x["p_ugDiesel"] is not None]; UGR=[x for x in rows if x["p_ugDiesel"] is not None]
RS60=[x for x in last60 if x["p_runeTxAlk"] is not None]; RSR=[x for x in rows if x["p_runeTxAlk"] is not None]

def esc(s): return s.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")

def header(w,h,title,desc,sub):
    return (f'<svg class="figchart" width="{w}" height="{h}" viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg" '
            f'font-family="Arial, Helvetica, sans-serif">\n'
            f'{INK_STYLE}'
            f'<title>{esc(title)}</title>\n<desc>{esc(desc)}</desc>\n'
            f'<text x="40" y="26" font-size="12" fill="{T_LABEL}">{esc(sub)}</text>\n')

MONTHS={"01":"Jan","02":"Feb","03":"Mar","04":"Apr","05":"May","06":"Jun","07":"Jul","08":"Aug","09":"Sep","10":"Oct","11":"Nov","12":"Dec"}

# evenly spaced x ticks -> avoids the cramped month-boundary labels
def even_ticks(series, count=6):
    n=len(series)
    if n<=1: return [(0, series[0]["date"])]
    if n<=count: idxs=list(range(n))
    else: idxs=[round(j*(n-1)/(count-1)) for j in range(count)]
    seen=set(); out=[]
    for i in idxs:
        if i not in seen:
            seen.add(i); out.append((i, series[i]["date"]))
    return out

def dlabel(d): return d   # ISO YYYY-MM-DD, matching the /metrics x-axis

def xaxis(series, X, ny):
    s=""
    for i,d in even_ticks(series,4):
        s+=f'<text x="{X(i):.1f}" y="{ny}" font-size="11" fill="{T_MUTE}" text-anchor="middle">{dlabel(d)}</text>\n'
    return s

# ---- generic percent line chart ----
def line_pct(fname,title,desc,sub,series,key,color=GREEN,area=GREEN,smooth=True):
    w,h=680,260; x0,x1=70,650; y0,y1=46,212
    vals = mov(series,key) if smooth else [r[key] for r in series]
    n=len(vals)
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v))
    s=header(w,h,title,desc,sub)
    for gy,lab in [(0,"100%"),(0.25,"75%"),(0.5,"50%"),(0.75,"25%"),(1.0,"0%")]:
        yy=y0+(y1-y0)*gy
        base=lab=="0%"; col=NEUT_D if base else GRID; dash="" if base else " "+GDASH
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{col}" stroke-width="1"{dash}/>\n'
        s+=f'<text x="62" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{lab}</text>\n'
    pts=" ".join(f"{X(i):.1f},{Y(v):.1f}" for i,v in enumerate(vals))
    s+=f'<path d="M {X(0):.1f},{y1:.1f} L {pts} L {X(n-1):.1f},{y1:.1f} Z" fill="{area}" fill-opacity="0.16"/>\n'
    s+=f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linejoin="round"/>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- multi-line percent chart with legend ----
def multiline_pct(fname,title,desc,sub,series,keys,smooth=True,ylabel=None):
    w,h=680,290; x0,x1=70,650; y0,y1=70,236
    n=len(series)
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v))
    s=header(w,h,title,desc,sub)
    lx=70
    for key,color,label in keys:
        s+=f'<line x1="{lx}" y1="44" x2="{lx+22}" y2="44" stroke="{color}" stroke-width="3"/>\n'
        s+=f'<text x="{lx+28}" y="48" font-size="11" fill="{T_LABEL}">{esc(label)}</text>\n'
        lx+= 30+ 7.0*len(label)+18
    for gy,lab in [(0,"100%"),(0.25,"75%"),(0.5,"50%"),(0.75,"25%"),(1.0,"0%")]:
        yy=y0+(y1-y0)*gy
        base=lab=="0%"; col=NEUT_D if base else GRID; dash="" if base else " "+GDASH
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{col}" stroke-width="1"{dash}/>\n'
        s+=f'<text x="62" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{lab}</text>\n'
    if ylabel:
        ym=(y0+y1)/2
        s+=f'<text x="14" y="{ym:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="middle" transform="rotate(-90 14 {ym:.1f})">{esc(ylabel)}</text>\n'
    for key,color,label in keys:
        vals=mov(series,key) if smooth else [r[key] for r in series]
        pts=" ".join(f"{X(i):.1f},{Y(v):.1f}" for i,v in enumerate(vals))
        s+=f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linejoin="round"/>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- 100% stacked area (alk/rune/other) ----
def stacked_area(fname,title,desc,sub,series,smooth=True):
    w,h=680,290; x0,x1=70,650; y0,y1=70,236
    n=len(series)
    m=(lambda k: mov(series,k)) if smooth else (lambda k:[r[k] for r in series])
    sa=m("sh_alk"); sr=m("sh_rune"); so=m("sh_oth")
    A=[];R=[]
    for i in range(n):
        t=sa[i]+sr[i]+so[i] or 1
        A.append(sa[i]/t); R.append(sr[i]/t)
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v))
    s=header(w,h,title,desc,sub)
    leg=[(GREEN,"Alkanes"),(ORANGE,"Runes (non-Alkanes)"),(CHAR,"Other")]
    lx=70
    for color,label in leg:
        s+=f'<rect x="{lx}" y="40" width="14" height="10" fill="{color}"/>\n'
        s+=f'<text x="{lx+20}" y="49" font-size="11" fill="{T_LABEL}">{esc(label)}</text>\n'
        lx+=30+7.0*len(label)+16
    cumA=[A[i] for i in range(n)]
    cumAR=[A[i]+R[i] for i in range(n)]
    zero=[0.0]*n; one=[1.0]*n
    def band(lower,upper,fill,op=0.9):
        top=" ".join(f"{X(i):.1f},{Y(upper[i]):.1f}" for i in range(n))
        bot=" ".join(f"{X(i):.1f},{Y(lower[i]):.1f}" for i in range(n-1,-1,-1))
        return f'<path d="M {top} L {bot} Z" fill="{fill}" fill-opacity="{op}"/>\n'
    s+=band(zero,cumA,GREEN)
    s+=band(cumA,cumAR,ORANGE)
    s+=band(cumAR,one,CHAR,0.82)
    for gy,lab in [(0,"100%"),(0.5,"50%"),(1.0,"0%")]:
        yy=y0+(y1-y0)*gy
        s+=f'<text x="62" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{lab}</text>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- funnel snapshot bars ----
def funnel(fname,title,desc,sub,items,footnote,conv=None):
    # conv[i] = stage-to-stage conversion label drawn in the gap under bar i. The bar widths
    # are honest absolute shares of ALL transactions, and today the bottom three come out
    # nearly identical (61.0 / 59.2 / 59.0) — that near-equality IS the story (OP_RETURN
    # traffic basically is the Alkanes DIESEL mint), so the conversions are spelled out
    # between the bars instead of leaving the reader to think the chart is broken.
    w=680; rowh=66; top=52; h=top+len(items)*rowh+50
    x0=170; xw=420
    s=header(w,h,title,desc,sub)
    y=top
    for i,(label,val,fill,stroke) in enumerate(items):
        bw=max(4,xw*val)
        s+=f'<rect x="{x0}" y="{y}" width="{bw:.1f}" height="36" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="0.5"/>\n'
        s+=f'<text x="{x0-15}" y="{y+18}" font-size="14" fill="{T_DARK}" text-anchor="end" dominant-baseline="central">{esc(label)}</text>\n'
        s+=f'<text x="{x0+bw+8:.1f}" y="{y+18}" font-size="14" font-weight="500" fill="{T_DARK}" dominant-baseline="central">{val*100:.1f}%</text>\n'
        if conv and i < len(conv) and conv[i]:
            s+=f'<text x="{x0+14}" y="{y+53}" font-size="11.5" fill="{T_LABEL}">&#8627; {esc(conv[i])}</text>\n'
        y+=rowh
    s+=f'<text x="40" y="{y+2}" font-size="12" fill="{T_LABEL}">{esc(footnote)}</text>\n'
    s+=f'<text x="40" y="{y+24}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- two-segment snapshot bar ----
def split_bar(fname,title,desc,sub,a_label,a_val,a_fill,a_stroke,b_label,b_val,b_fill,b_stroke,footnote):
    w=680; h=200; x0=170; xw=420; y=64
    s=header(w,h,title,desc,sub)
    aw=xw*a_val; bw=xw*b_val
    s+=f'<rect x="{x0}" y="{y}" width="{aw:.1f}" height="40" rx="4" fill="{a_fill}" stroke="{a_stroke}" stroke-width="0.5"/>\n'
    s+=f'<text x="{x0-15}" y="{y+20}" font-size="14" fill="{T_DARK}" text-anchor="end" dominant-baseline="central">{esc(a_label)}</text>\n'
    s+=f'<text x="{x0+aw+8:.1f}" y="{y+20}" font-size="14" font-weight="500" fill="{T_DARK}" dominant-baseline="central">{a_val*100:.1f}%</text>\n'
    y+=58
    s+=f'<rect x="{x0}" y="{y}" width="{max(3,bw):.1f}" height="40" rx="4" fill="{b_fill}" stroke="{b_stroke}" stroke-width="0.5"/>\n'
    s+=f'<text x="{x0-15}" y="{y+20}" font-size="14" fill="{T_DARK}" text-anchor="end" dominant-baseline="central">{esc(b_label)}</text>\n'
    s+=f'<text x="{x0+max(3,bw)+8:.1f}" y="{y+20}" font-size="14" font-weight="500" fill="{T_DARK}" dominant-baseline="central">{b_val*100:.1f}%</text>\n'
    s+=f'<text x="40" y="{y+72}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- USD area chart ----
def usd_area(fname,title,desc,sub,series,key,smooth=True):
    w,h=680,260; x0,x1=70,650; y0,y1=46,212
    vals=mov(series,key) if smooth else [r[key] for r in series]
    n=len(vals); vmax=max(vals) if vals else 1
    step=10**math.floor(math.log10(vmax)) if vmax>0 else 1
    ceil=math.ceil(vmax/step)*step
    if ceil==0: ceil=1
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v/ceil))
    def fmtk(v): return f"${v/1000:.0f}k" if v>=1000 else f"${v:.0f}"
    s=header(w,h,title,desc,sub)
    for g in [0,0.25,0.5,0.75,1.0]:
        yy=y1-(y1-y0)*g; val=ceil*g
        base=g==0; col=NEUT_D if base else GRID; dash="" if base else " "+GDASH
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{col}" stroke-width="1"{dash}/>\n'
        s+=f'<text x="62" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{fmtk(val)}</text>\n'
    pts=" ".join(f"{X(i):.1f},{Y(v):.1f}" for i,v in enumerate(vals))
    s+=f'<path d="M {X(0):.1f},{y1:.1f} L {pts} L {X(n-1):.1f},{y1:.1f} Z" fill="{GREEN}" fill-opacity="0.16"/>\n'
    s+=f'<polyline points="{pts}" fill="none" stroke="{GREEN}" stroke-width="2.2" stroke-linejoin="round"/>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- donut / pie ----
def donut(fname,title,desc,sub,segs,foot,hole=True):
    # hole=True -> donut (all-time bytes); hole=False -> solid pie (last-day), matching /metrics
    w,h=680,300; cx,cy,rO=200,170,98; rI=56 if hole else 0
    s=header(w,h,title,desc,sub)
    total=sum(v for _,v,_ in segs) or 1
    ang=-90.0
    def pt(r,a):
        rad=a*math.pi/180.0; return cx+r*math.cos(rad), cy+r*math.sin(rad)
    for label,val,fill in segs:
        sweep=val/total*360.0; a0=ang; a1=ang+sweep
        large=1 if sweep>180 else 0
        x0o,y0o=pt(rO,a0); x1o,y1o=pt(rO,a1)
        if sweep>=359.999:
            s+=f'<circle cx="{cx}" cy="{cy}" r="{rO}" fill="{fill}"/>\n'
            if hole: s+=f'<circle cx="{cx}" cy="{cy}" r="{rI}" fill="#fff"/>\n'
        elif hole:
            x0i,y0i=pt(rI,a1); x1i,y1i=pt(rI,a0)
            s+=(f'<path d="M {x0o:.1f},{y0o:.1f} A {rO},{rO} 0 {large} 1 {x1o:.1f},{y1o:.1f} '
                f'L {x0i:.1f},{y0i:.1f} A {rI},{rI} 0 {large} 0 {x1i:.1f},{y1i:.1f} Z" '
                f'fill="{fill}" stroke="#fff" stroke-width="1.5"/>\n')
        else:
            s+=(f'<path d="M {cx},{cy} L {x0o:.1f},{y0o:.1f} A {rO},{rO} 0 {large} 1 {x1o:.1f},{y1o:.1f} Z" '
                f'fill="{fill}" stroke="#fff" stroke-width="1.5"/>\n')
        ang=a1
    lx=352; ly=104
    for label,val,fill in segs:
        s+=f'<rect x="{lx}" y="{ly}" width="15" height="15" rx="2" fill="{fill}"/>\n'
        s+=f'<text x="{lx+24}" y="{ly+12}" font-size="14" fill="{T_DARK}">{esc(label)}</text>\n'
        s+=f'<text x="{lx+24}" y="{ly+31}" font-size="14" font-weight="600" fill="{T_LABEL}">{val/total*100:.1f}%</text>\n'
        ly+=52
    s+=f'<text x="40" y="{h-30}" font-size="12" fill="{T_LABEL}">{esc(foot)}</text>\n'
    s+=f'<text x="40" y="{h-10}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- log-scale multi-line (absolute per-day counts / bytes) ----
def multiline_log(fname,title,desc,sub,series,keys,smooth=True):
    w,h=680,290; x0,x1=82,650; y0,y1=70,236
    n=len(series); ser={}; allv=[]
    for key,color,label in keys:
        v=mov(series,key) if smooth else [r[key] for r in series]
        ser[key]=v; allv+=[x for x in v if x>0]
    vmax=max(allv) if allv else 10; vmin=min(allv) if allv else 1
    lo=math.floor(math.log10(max(vmin,1))); hi=math.ceil(math.log10(max(vmax,10)))
    if hi<=lo: hi=lo+1
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v):
        if v<=0: v=10**lo
        return y1-(y1-y0)*(math.log10(v)-lo)/(hi-lo)
    def tick(p):
        m=10**p
        return ("%g"%m) if p<3 else (("%dk"%(m/1e3)) if p<6 else ("%dM"%(m/1e6)))
    s=header(w,h,title,desc,sub)
    lx=82
    for key,color,label in keys:
        s+=f'<line x1="{lx}" y1="44" x2="{lx+22}" y2="44" stroke="{color}" stroke-width="3"/>\n'
        s+=f'<text x="{lx+28}" y="48" font-size="11" fill="{T_LABEL}">{esc(label)}</text>\n'
        lx+=30+7.0*len(label)+18
    p=lo
    while p<=hi:
        yy=Y(10**p)
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{GRID}" stroke-width="1" {GDASH}/>\n'
        s+=f'<text x="74" y="{yy+4:.1f}" font-size="10" fill="{T_MUTE}" text-anchor="end">{tick(p)}</text>\n'
        p+=1
    for key,color,label in keys:
        v=ser[key]
        pts=" ".join(f"{X(i):.1f},{Y(val):.1f}" for i,val in enumerate(v))
        s+=f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2" stroke-linejoin="round"/>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- linear value area (single series, custom y formatter) ----
def value_area(fname,title,desc,sub,series,key,fmt,color=GREEN,area=GREEN,smooth=True):
    w,h=680,260; x0,x1=86,650; y0,y1=46,212
    vals=mov(series,key) if smooth else [r[key] for r in series]
    n=len(vals); vmax=max(vals) if vals else 1
    step=10**math.floor(math.log10(vmax)) if vmax>0 else 1
    ceil=math.ceil(vmax/step)*step
    if ceil<=0: ceil=1
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v/ceil))
    s=header(w,h,title,desc,sub)
    for g in [0,0.25,0.5,0.75,1.0]:
        yy=y1-(y1-y0)*g; val=ceil*g
        base=g==0; col=NEUT_D if base else GRID; dash="" if base else " "+GDASH
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{col}" stroke-width="1"{dash}/>\n'
        s+=f'<text x="78" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{fmt(val)}</text>\n'
    pts=" ".join(f"{X(i):.1f},{Y(v):.1f}" for i,v in enumerate(vals))
    s+=f'<path d="M {X(0):.1f},{y1:.1f} L {pts} L {X(n-1):.1f},{y1:.1f} Z" fill="{area}" fill-opacity="0.16"/>\n'
    s+=f'<polyline points="{pts}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linejoin="round"/>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- linear value multi-line (custom y formatter) ----
# Values may be None (only with smooth=False): the polyline breaks into segments at the
# gaps instead of drawing a fake bridge — used by the fee-per-tx min-sample rule.
def value_multiline(fname,title,desc,sub,series,keys,fmt,smooth=True):
    w,h=680,290; x0,x1=86,650; y0,y1=70,236
    n=len(series); ser={}; allv=[]
    for key,color,label in keys:
        v=mov(series,key) if smooth else [r[key] for r in series]
        ser[key]=v; allv+=[x for x in v if x is not None]
    vmax=max(allv) if allv else 1
    step=10**math.floor(math.log10(vmax)) if vmax>0 else 1
    ceil=math.ceil(vmax/step)*step
    if ceil<=0: ceil=1
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v/ceil))
    s=header(w,h,title,desc,sub)
    lx=86
    for key,color,label in keys:
        s+=f'<line x1="{lx}" y1="44" x2="{lx+22}" y2="44" stroke="{color}" stroke-width="3"/>\n'
        s+=f'<text x="{lx+28}" y="48" font-size="11" fill="{T_LABEL}">{esc(label)}</text>\n'
        lx+=30+7.0*len(label)+18
    for g in [0,0.25,0.5,0.75,1.0]:
        yy=y1-(y1-y0)*g; val=ceil*g
        base=g==0; col=NEUT_D if base else GRID; dash="" if base else " "+GDASH
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{col}" stroke-width="1"{dash}/>\n'
        s+=f'<text x="78" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{esc(fmt(val))}</text>\n'
    for key,color,label in keys:
        v=ser[key]
        seg=[]
        segs=[]
        for i,val in enumerate(v):
            if val is None:
                if len(seg)>=2: segs.append(seg)
                seg=[]
            else:
                seg.append(f"{X(i):.1f},{Y(val):.1f}")
        if len(seg)>=2: segs.append(seg)
        for pts in segs:
            s+=f'<polyline points="{" ".join(pts)}" fill="none" stroke="{color}" stroke-width="2.2" stroke-linejoin="round"/>\n'
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- stacked ABSOLUTE area (site's UG mints/day chart: raw counts stacked bottom-up) ----
def stacked_abs(fname,title,desc,sub,series,keys,fmt,smooth=True):
    w,h=680,290; x0,x1=86,650; y0,y1=70,236
    n=len(series)
    vals=[(mov(series,k) if smooth else [r[k] for r in series]) for k,_,_ in keys]
    tops=[]; run=[0.0]*n
    for v in vals:
        run=[run[i]+v[i] for i in range(n)]
        tops.append(run[:])
    vmax=max(run) if run else 1
    step=10**math.floor(math.log10(vmax)) if vmax>0 else 1
    ceil=math.ceil(vmax/step)*step
    if ceil<=0: ceil=1
    def X(i): return x0+(x1-x0)*i/(n-1) if n>1 else x0
    def Y(v): return y1-(y1-y0)*max(0,min(1,v/ceil))
    s=header(w,h,title,desc,sub)
    lx=86
    for _,color,label in keys:
        s+=f'<rect x="{lx}" y="40" width="14" height="10" fill="{color}"/>\n'
        s+=f'<text x="{lx+20}" y="49" font-size="11" fill="{T_LABEL}">{esc(label)}</text>\n'
        lx+=30+7.0*len(label)+16
    for g in [0,0.25,0.5,0.75,1.0]:
        yy=y1-(y1-y0)*g; val=ceil*g
        base=g==0; col=NEUT_D if base else GRID; dash="" if base else " "+GDASH
        s+=f'<line x1="{x0}" y1="{yy:.1f}" x2="{x1}" y2="{yy:.1f}" stroke="{col}" stroke-width="1"{dash}/>\n'
        s+=f'<text x="78" y="{yy+4:.1f}" font-size="11" fill="{T_MUTE}" text-anchor="end">{esc(fmt(val))}</text>\n'
    lower=[0.0]*n
    for idx,(key,color,label) in enumerate(keys):
        upper=tops[idx]
        top_pts=" ".join(f"{X(i):.1f},{Y(upper[i]):.1f}" for i in range(n))
        bot_pts=" ".join(f"{X(i):.1f},{Y(lower[i]):.1f}" for i in range(n-1,-1,-1))
        s+=f'<path d="M {top_pts} L {bot_pts} Z" fill="{color}" fill-opacity="0.85"/>\n'
        lower=upper
    s+=xaxis(series,X,h-30)
    s+=f'<text x="{x0}" y="{h-8}" font-size="12" fill="{T_MUTE}">{SRC}</text>\n</svg>\n'
    open(os.path.join(OUT,fname),"w",encoding="utf-8").write(s)

# ---- formatters ----
def f_bytes(v): return f"{v:.0f}"
def f_sats(v):  return f"{v:,.0f}"
def f_btc(v):   return f"{v:.2f}"
def f_usdM(v):  return (f"${v/1e6:.1f}M" if v>=1e6 else (f"${v/1e3:.0f}k" if v>=1000 else f"${v:.0f}"))
def f_cnt(v):   return (f"{v/1e6:.0f}M" if v>=1e6 else (f"{v/1e3:.0f}k" if v>=1000 else f"{v:.0f}"))

# ============ GENERATE ============
end=last60[-1]["date"]; start=last60[0]["date"]
gen_start=rows[0]["date"]; gen_end=rows[-1]["date"]

line_pct("fig-13-alkanes-tx-share-60d.svg",
    "Alkanes share of all Bitcoin transactions, last 60 days",
    f"Daily Alkanes share of all Bitcoin transactions over the 60 days ending {end}.",
    f"Alkanes as a share of ALL Bitcoin transactions (daily, {start} to {end})",
    last60,"p_alkTx",smooth=False)

multiline_pct("fig-13-funnel-trend-60d.svg",
    "The OP_RETURN funnel over time, last 60 days",
    "Share of Bitcoin transactions carrying OP_RETURN, share of OP_RETURN that is Alkanes, and Alkanes as a share of all transactions.",
    "The funnel over time (daily, last 60 days)",
    last60,
    [("p_opTx",NEUT_D,"Carry OP_RETURN"),("p_alkOfOp",GREEN,"OP_RETURN that is Alkanes"),("p_alkTx",GREEN_D,"Alkanes of all tx")],smooth=False)

funnel("fig-13-funnel-snapshot.svg",
    "How much of Bitcoin is Alkanes, last 60 days",
    f"Of all Bitcoin transactions over 60 days, {A60['p_opTx']*100:.1f} percent carry OP_RETURN, {A60['p_alkTx']*100:.1f} percent are Alkanes, and {A60['p_diesel']*A60['p_alkTx']*100:.1f} percent are the DIESEL mint.",
    f"Share of all Bitcoin transactions (60-day window ending {end})",
    [("All transactions",1.0,NEUT,NEUT_D),
     ("Carry OP_RETURN",A60["p_opTx"],GREEN_L,GREEN_D),
     ("Alkanes",A60["p_alkTx"],GREEN,GREEN_D),
     ("DIESEL mint",A60["p_diesel"]*A60["p_alkTx"],GREEN_D,GREEN_D)],
    "Bars match on purpose: OP_RETURN traffic today is almost entirely the Alkanes DIESEL mint.",
    conv=[f"{A60['p_opTx']*100:.1f}% of all transactions carry an OP_RETURN",
          f"{A60['p_alkOfOp']*100:.1f}% of those are Alkanes",
          f"{A60['p_diesel']*100:.1f}% of those are the DIESEL mint",
          None])

stacked_area("fig-13-bytes-composition-60d.svg",
    "Composition of Bitcoin OP_RETURN bytes, last 60 days",
    "Alkanes, non-Alkanes Runes and other share of OP_RETURN bytes over the last 60 days.",
    "Share of Bitcoin OP_RETURN bytes (daily, last 60 days)",
    last60,smooth=False)

line_pct("fig-13-alkanes-bytes-share-60d.svg",
    "Alkanes share of OP_RETURN bytes, last 60 days",
    "Daily Alkanes share of all OP_RETURN bytes on Bitcoin over the last 60 days.",
    "Alkanes as a share of all OP_RETURN bytes (daily, last 60 days)",
    last60,"p_alkB",smooth=False)

split_bar("fig-13-diesel-dominance-60d.svg",
    "What Alkanes activity actually is, last 60 days",
    f"Over the last 60 days, {A60['p_diesel']*100:.1f} percent of Alkanes transactions are the DIESEL mint and {(1-A60['p_diesel'])*100:.1f} percent are everything else.",
    f"Breakdown of Alkanes transactions (60-day window ending {end})",
    "DIESEL mint", A60["p_diesel"], GREEN_D, GREEN_D,
    "Everything else", 1-A60["p_diesel"], NEUT, NEUT_D,
    "")

line_pct("fig-13-fee-share-60d.svg",
    "Alkanes share of all Bitcoin transaction fees, last 60 days",
    "Daily share of total Bitcoin transaction fees paid by Alkanes transactions over the last 60 days.",
    "Alkanes as a share of ALL Bitcoin transaction fees (daily, last 60 days)",
    last60,"p_feeA",smooth=False)

usd_area("fig-13-fee-usd-60d.svg",
    "Daily fees paid to Bitcoin miners by Alkanes, last 60 days",
    "Daily US-dollar value of Bitcoin transaction fees paid by Alkanes activity over the last 60 days.",
    "Daily fees paid to Bitcoin miners by Alkanes, USD (daily, last 60 days)",
    last60,"feeA_usd",smooth=False)

line_pct("fig-13-tx-share-fulltime.svg",
    "Alkanes share of all Bitcoin transactions since the DIESEL genesis block",
    f"Seven-day average of the Alkanes share of all Bitcoin transactions from the DIESEL genesis block 880,000 ({gen_start}) to {gen_end}, rising from near zero to a sustained majority.",
    f"Alkanes as a share of ALL Bitcoin transactions (7-day avg, since DIESEL genesis block 880,000, {gen_start} to {gen_end})",
    rows,"p_alkTx")

stacked_area("fig-13-bytes-composition-fulltime.svg",
    "Composition of Bitcoin OP_RETURN bytes since the DIESEL genesis block",
    "Alkanes, non-Alkanes Runes and other share of OP_RETURN bytes since the DIESEL genesis block 880,000, showing Alkanes overtaking Runes.",
    f"Share of Bitcoin OP_RETURN bytes (7-day avg, since DIESEL genesis block 880,000, {gen_start} to {gen_end})",
    rows)

# ---- NEW: block weight share (60d) ----
line_pct("fig-13-weight-share-60d.svg",
    "Alkanes share of Bitcoin block weight, last 60 days",
    "Daily share of total Bitcoin block weight consumed by Alkanes transactions over the last 60 days.",
    f"Alkanes as a share of ALL Bitcoin block weight (daily, {start} to {end})",
    W60,"p_weight",color=GREEN,area=GREEN,smooth=False)

# ---- NEW: four answers overlay (tx / bytes / weight / fee) ----
multiline_pct("fig-13-four-answers-60d.svg",
    "How much of Bitcoin is Alkanes, four answers, last 60 days",
    "Alkanes share of Bitcoin over the last 60 days measured four ways: by transaction count, by OP_RETURN bytes, by block weight and by miner fees.",
    "The same question, four ways (daily, last 60 days)",
    W60,
    [("p_alkTx",GREEN,"Transactions"),
     ("p_alkB",ORANGE,"OP_RETURN bytes"),
     ("p_weight",LAV,"Block weight"),
     ("p_feeA",GOLD,"Miner fees")],smooth=False)

# ---- NEW: last full day, OP_RETURN tx donut ----
_ld=LAST["p_alkOfOp"]
donut("fig-13-lastday-opreturn-donut.svg",
    "Last full day, share of OP_RETURN transactions",
    f"On {LAST['date']}, {_ld*100:.1f} percent of Bitcoin OP_RETURN transactions were Alkanes.",
    f"Share of OP_RETURN transactions on {LAST['date']} (blocks {int(LAST['fromH'])}-{int(LAST['toH'])}, {int(LAST['scanned'])} sampled)",
    [("Alkanes",_ld,GREEN),("Other OP_RETURN",1-_ld,CHAR)],
    f"{int(LAST['alkTx']):,} of {int(LAST['opTx']):,} OP_RETURN transactions that day were Alkanes.",
    hole=False)

# ---- NEW: Runes (non-Alkanes) vs Alkanes, share of OP_RETURN bytes (60d) ----
multiline_pct("fig-13-runes-vs-alkanes-bytes-60d.svg",
    "Runes (non-Alkanes) versus Alkanes, share of OP_RETURN bytes, last 60 days",
    "Share of all Bitcoin OP_RETURN bytes written by Alkanes versus non-Alkanes Runes over the last 60 days.",
    "Share of OP_RETURN bytes: Alkanes vs Runes (non-Alkanes) (daily, last 60 days)",
    last60,
    [("sh_alk",GREEN,"Alkanes"),("sh_rune",ORANGE,"Runes (non-Alkanes)")],smooth=False)

# ---- NEW: Runes vs Alkanes absolute bytes/day (log, since genesis) ----
multiline_log("fig-13-runes-vs-alkanes-bytes-abs.svg",
    "Runes versus Alkanes, OP_RETURN bytes per day, since genesis",
    "Absolute OP_RETURN bytes written per day by Alkanes versus non-Alkanes Runes since the DIESEL genesis block, log scale.",
    "OP_RETURN bytes per day, Alkanes vs Runes (non-Alkanes) (7-day avg, log scale, since genesis)",
    rows,
    [("alkB_day",GREEN,"Alkanes bytes/day"),("pureRuneB_day",ORANGE,"Runes (non-Alkanes) bytes/day")])

# ---- NEW: genesis bytes donut (all-time relabelled) ----
donut("fig-13-bytes-donut-genesis.svg",
    "Composition of Bitcoin OP_RETURN bytes since genesis",
    f"Since the DIESEL genesis block, {AALL['sh_alk']*100:.1f} percent of Bitcoin OP_RETURN bytes are Alkanes, {AALL['sh_rune']*100:.1f} percent non-Alkanes Runes and {AALL['sh_oth']*100:.1f} percent other.",
    f"Share of ALL Bitcoin OP_RETURN bytes (since DIESEL genesis block 880,000, {gen_start} to {gen_end})",
    [("Alkanes",AALL["sh_alk"],GREEN),("Runes (non-Alkanes)",AALL["sh_rune"],ORANGE),("Other",AALL["sh_oth"],CHAR)],
    "Averaged across the whole period, so the early Runes-heavy months are included.")

# ---- NEW: OP_RETURN bytes per tx (60d) ----
value_multiline("fig-13-bytes-per-tx-60d.svg",
    "OP_RETURN bytes per transaction, last 60 days",
    "Average OP_RETURN payload size per transaction, Alkanes versus other OP_RETURN, over the last 60 days.",
    "OP_RETURN bytes per transaction (daily, last 60 days)",
    last60,
    [("bpt_oth",ORANGE,"Other OP_RETURN"),("bpt_alk",GREEN,"Alkanes")],
    f_bytes,smooth=False)

# ---- NEW: DIESEL mints per day birth curve (log, since genesis) ----
multiline_log("fig-13-diesel-birth-curve.svg",
    "DIESEL mints per day since genesis",
    "Estimated DIESEL mints per day from the genesis block to the last full day, log scale.",
    "DIESEL mints per day (7-day avg, log scale, since genesis)",
    rows,
    [("diesel_day",GREEN,"DIESEL mints/day")])

# ---- NEW: DIESEL cumulative since genesis ----
value_area("fig-13-diesel-cumulative.svg",
    "DIESEL minted, cumulative since genesis",
    "Running total of estimated DIESEL mints from the genesis block to the last full day.",
    "Cumulative DIESEL mints (since DIESEL genesis block 880,000)",
    rows,"diesel_cum",f_cnt,smooth=False)

# ---- NEW: UNCOMMON GOODS mints that are DIESEL (since genesis) ----
line_pct("fig-13-ug-is-diesel.svg",
    "UNCOMMON•GOODS mints that are actually DIESEL, since genesis",
    "Share of UNCOMMON GOODS mints that are in fact DIESEL mints, since the DIESEL genesis block.",
    "Share of UNCOMMON•GOODS mints that are DIESEL (7-day avg, since genesis)",
    UGR,"p_ugDiesel",color=GREEN,area=GREEN)

# ---- NEW: UNCOMMON GOODS mints per day, DIESEL vs independent (log) ----
multiline_log("fig-13-ug-per-day.svg",
    "UNCOMMON•GOODS mints per day, DIESEL versus independent, since genesis",
    "Daily UNCOMMON GOODS mints split into those that are DIESEL and those that are independent Runes, log scale.",
    "UNCOMMON•GOODS mints per day (7-day avg, log scale, since genesis)",
    UGR,
    [("ugDiesel_day",GREEN,"DIESEL"),("ugIndep_day",ORANGE,"Independent Runes")])

# ---- NEW: Runestone tx, Alkanes vs Runes (non-Alkanes) share (since genesis) ----
multiline_pct("fig-13-runestone-tx-share.svg",
    "Runestone transactions, Alkanes versus non-Alkanes Runes, since genesis",
    "Share of runestone-carrying transactions that are Alkanes versus non-Alkanes Runes since the DIESEL genesis block.",
    "Share of runestone transactions: Alkanes vs Runes (non-Alkanes) (7-day avg, since genesis)",
    RSR,
    [("p_runeTxAlk",GREEN,"Alkanes"),("p_runeTxPure",ORANGE,"Runes (non-Alkanes)")])

# ---- NEW: Runestone tx per day, Alkanes vs Runes (non-Alkanes) (log) ----
multiline_log("fig-13-runestone-tx-abs.svg",
    "Runestone transactions per day, Alkanes versus non-Alkanes Runes, since genesis",
    "Daily runestone-carrying transactions split into Alkanes and non-Alkanes Runes, log scale, since genesis.",
    "Runestone transactions per day, Alkanes vs Runes (non-Alkanes) (7-day avg, log scale, since genesis)",
    RSR,
    [("alkRune_day",GREEN,"Alkanes"),("pureRune_day",ORANGE,"Runes (non-Alkanes)")])

# ---- NEW: fees per day in BTC, Alkanes vs rest (60d) ----
value_multiline("fig-13-fee-btc-alk-vs-rest-60d.svg",
    "Bitcoin transaction fees per day, Alkanes versus the rest, last 60 days",
    "Daily Bitcoin transaction fees in BTC, split into Alkanes and every other transaction, over the last 60 days. Block subsidy excluded.",
    "Daily Bitcoin transaction fees, BTC (daily, last 60 days)",
    last60,
    [("feeBTC_rest",ORANGE,"All other transactions"),("feeBTC_alk",GREEN,"Alkanes")],
    f_btc,smooth=False)

# ---- NEW: total miner revenue (fees + subsidy) USD (60d) ----
value_area("fig-13-miner-revenue-60d.svg",
    "Total Bitcoin miner revenue per day, last 60 days",
    "Daily total Bitcoin miner revenue, transaction fees plus the block subsidy, in US dollars, over the last 60 days.",
    "Daily Bitcoin miner revenue, fees + subsidy, USD (daily, last 60 days)",
    last60,"minerRev_usd",f_usdM,color=ORANGE,area=ORANGE,smooth=False)

# ---- NEW: fee per tx, Alkanes vs everyone else (60d) ----
value_multiline("fig-13-fee-per-tx-60d.svg",
    "Fee per transaction, Alkanes versus everyone else, last 60 days",
    "Average transaction fee in satoshis, Alkanes versus all other transactions, over the last 60 days.",
    "Fee per transaction, sats (daily, last 60 days)",
    last60,
    [("fpt_oth",ORANGE,"Everyone else"),("fpt_alk",GREEN,"Alkanes")],
    f_sats,smooth=False)

# ============ 60-DAY RAW-DAILY SET (fig-60-*) — 100% faithful to the /metrics 60-day view ============
# Same primitives, but smooth=False (raw daily like the site) and 60-day window only.
S60=f"{start} to {end}"

multiline_pct("fig-60-four-answers.svg",
    "How much of Bitcoin is Alkanes, four answers, last 60 days",
    "Alkanes share of Bitcoin over the last 60 days by transaction count, OP_RETURN bytes, block weight and miner fees.",
    f"The same question, four ways (daily, {S60})",
    W60,
    [("p_alkTx",GREEN,"Transactions"),("p_alkB",ORANGE,"OP_RETURN bytes"),
     ("p_weight",LAV,"Block weight"),("p_feeA",GOLD,"Miner fees")], smooth=False)

line_pct("fig-60-tx-share.svg",
    "Alkanes share of all Bitcoin transactions, last 60 days",
    "Daily Alkanes share of all Bitcoin transactions over the last 60 days.",
    f"Alkanes as a share of ALL Bitcoin transactions (daily, {S60})",
    last60,"p_alkTx",smooth=False)

donut("fig-60-lastday-pie.svg",
    "Last full day, share of OP_RETURN transactions",
    f"On {LAST['date']}, {_ld*100:.1f} percent of Bitcoin OP_RETURN transactions were Alkanes.",
    f"Share of OP_RETURN transactions on {LAST['date']} (blocks {int(LAST['fromH'])}-{int(LAST['toH'])}, {int(LAST['scanned'])} sampled)",
    [("Alkanes",_ld,GREEN),("Other OP_RETURN",1-_ld,CHAR)],
    f"{int(LAST['alkTx']):,} of {int(LAST['opTx']):,} OP_RETURN transactions that day were Alkanes.",
    hole=False)

multiline_pct("fig-60-opreturn-share.svg",
    "Alkanes share of OP_RETURN, last 60 days",
    "Share of OP_RETURN transactions and of OP_RETURN bytes that are Alkanes, over the last 60 days.",
    f"Alkanes share of OP_RETURN, transactions and bytes (daily, {S60})",
    last60,
    [("p_alkOfOp",GREEN,"% of OP_RETURN transactions"),("p_alkB",ORANGE,"% of OP_RETURN bytes")], smooth=False)

line_pct("fig-60-weight.svg",
    "Alkanes share of Bitcoin block weight, last 60 days",
    "Daily Alkanes share of total Bitcoin block weight over the last 60 days.",
    f"Alkanes as a share of ALL Bitcoin block weight (daily, {S60})",
    W60,"p_weight",smooth=False)

stacked_area("fig-60-bytes-composition.svg",
    "Composition of Bitcoin OP_RETURN bytes, last 60 days",
    "Alkanes, non-Alkanes Runes and other share of OP_RETURN bytes over the last 60 days.",
    f"Share of Bitcoin OP_RETURN bytes (daily, {S60})",
    last60, smooth=False)

multiline_pct("fig-60-runes-vs-alkanes-bytes.svg",
    "Runes (non-Alkanes) versus Alkanes, share of OP_RETURN bytes, last 60 days",
    "Share of all OP_RETURN bytes written by Alkanes versus non-Alkanes Runes over the last 60 days.",
    f"Share of OP_RETURN bytes: Alkanes vs Runes (non-Alkanes) (daily, {S60})",
    last60,[("sh_alk",GREEN,"Alkanes"),("sh_rune",ORANGE,"Runes (non-Alkanes)")], smooth=False)

donut("fig-60-bytes-donut.svg",
    "Composition of Bitcoin OP_RETURN bytes, last 60 days",
    f"Over the last 60 days, {A60['sh_alk']*100:.1f} percent of OP_RETURN bytes are Alkanes, {A60['sh_rune']*100:.1f} percent non-Alkanes Runes and {A60['sh_oth']*100:.1f} percent other.",
    f"Share of Bitcoin OP_RETURN bytes (60-day window, {S60})",
    [("Alkanes",A60["sh_alk"],GREEN),("Runes (non-Alkanes)",A60["sh_rune"],ORANGE),("Other",A60["sh_oth"],CHAR)],
    "Last 60 days only, so this is the current steady state, not the historical average.")

value_multiline("fig-60-bytes-per-tx.svg",
    "OP_RETURN bytes per transaction, last 60 days",
    "Average OP_RETURN payload size per transaction, Alkanes versus other OP_RETURN, over the last 60 days.",
    f"OP_RETURN bytes per transaction (daily, {S60})",
    last60,[("bpt_oth",ORANGE,"Other OP_RETURN"),("bpt_alk",GREEN,"Alkanes")],f_bytes,smooth=False)

line_pct("fig-60-ug-is-diesel.svg",
    "UNCOMMON•GOODS mints that are DIESEL, last 60 days",
    "Daily share of UNCOMMON GOODS mints that are in fact DIESEL, over the last 60 days.",
    f"Share of UNCOMMON•GOODS mints that are DIESEL (daily, {S60})",
    UG60,"p_ugDiesel",smooth=False)

multiline_log("fig-60-ug-per-day.svg",
    "UNCOMMON•GOODS mints per day, DIESEL versus independent, last 60 days",
    "Daily UNCOMMON GOODS mints split into DIESEL and independent Runes over the last 60 days, log scale.",
    f"UNCOMMON•GOODS mints per day (daily, log scale, {S60})",
    UG60,[("ugDiesel_day",GREEN,"DIESEL"),("ugIndep_day",ORANGE,"Independent Runes")], smooth=False)

multiline_pct("fig-60-runestone-share.svg",
    "Runestone transactions, Alkanes versus non-Alkanes Runes, last 60 days",
    "Share of runestone-carrying transactions that are Alkanes versus non-Alkanes Runes over the last 60 days.",
    f"Share of runestone transactions: Alkanes vs Runes (non-Alkanes) (daily, {S60})",
    RS60,[("p_runeTxAlk",GREEN,"Alkanes"),("p_runeTxPure",ORANGE,"Runes (non-Alkanes)")], smooth=False)

multiline_log("fig-60-runestone-per-day.svg",
    "Runestone transactions per day, Alkanes versus non-Alkanes Runes, last 60 days",
    "Daily runestone-carrying transactions split into Alkanes and non-Alkanes Runes over the last 60 days, log scale.",
    f"Runestone transactions per day, Alkanes vs Runes (non-Alkanes) (daily, log scale, {S60})",
    RS60,[("alkRune_day",GREEN,"Alkanes"),("pureRune_day",ORANGE,"Runes (non-Alkanes)")], smooth=False)

line_pct("fig-60-fee-share.svg",
    "Alkanes share of all Bitcoin transaction fees, last 60 days",
    "Daily share of total Bitcoin transaction fees paid by Alkanes over the last 60 days.",
    f"Alkanes as a share of ALL Bitcoin transaction fees (daily, {S60})",
    last60,"p_feeA",smooth=False)

value_multiline("fig-60-fee-per-tx.svg",
    "Fee per transaction, Alkanes versus everyone else, last 60 days",
    "Average transaction fee in satoshis, Alkanes versus all other transactions, over the last 60 days.",
    f"Fee per transaction, sats (daily, {S60})",
    last60,[("fpt_oth",ORANGE,"Everyone else"),("fpt_alk",GREEN,"Alkanes")],f_sats,smooth=False)

value_multiline("fig-60-fee-btc.svg",
    "Bitcoin transaction fees per day, Alkanes versus the rest, last 60 days",
    "Daily Bitcoin transaction fees in BTC, Alkanes versus every other transaction, over the last 60 days. Block subsidy excluded.",
    f"Daily Bitcoin transaction fees, BTC ({S60})",
    last60,[("feeBTC_rest",ORANGE,"All other transactions"),("feeBTC_alk",GREEN,"Alkanes")],f_btc,smooth=False)

value_area("fig-60-miner-revenue.svg",
    "Total Bitcoin miner revenue per day, last 60 days",
    "Daily total Bitcoin miner revenue, fees plus block subsidy, USD, over the last 60 days.",
    f"Daily Bitcoin miner revenue, fees + subsidy, USD ({S60})",
    last60,"minerRev_usd",f_usdM,color=ORANGE,area=ORANGE,smooth=False)

# ============ FIG-SITE SET — 1:1 mirror of subfrost.io/metrics (21 charts, site order & titles,
# raw daily like the site, full window since DIESEL genesis; article v2 uses these) ============
# Gabe review 2026-07-07: datas fora dos títulos (o eixo X já as mostra)
W_FULL="daily, since DIESEL genesis 880,000"

multiline_pct("fig-site-01-daily-share.svg",
    "Daily Alkanes share",
    "Daily Alkanes share of all Bitcoin transactions alongside the share of all transactions that carry an OP_RETURN.",
    f"Daily Alkanes share ({W_FULL})",
    rows,
    [("p_alkTx",GREEN,"Transactions"),("p_opTx",NEUT_D,"OP_RETURN penetration")],smooth=False,
    ylabel="Share of all Bitcoin transactions")

multiline_pct("fig-site-02-opreturn-share.svg",
    "Alkanes' share of OP_RETURN",
    "Of transactions that carry an OP_RETURN, the share that are Alkanes, by transaction count and by bytes.",
    f"Alkanes' share of OP_RETURN ({W_FULL})",
    rows,
    [("p_alkOfOp",GREEN,"% of OP_RETURN transactions"),("p_alkB",ORANGE,"% of OP_RETURN bytes")],smooth=False)

line_pct("fig-site-03-weight-share.svg",
    "Alkanes' share of block space (by weight)",
    "Daily share of total Bitcoin block weight consumed by Alkanes transactions since the DIESEL genesis block.",
    f"Alkanes' share of block space, by weight ({W_FULL})",
    WR,"p_weight",smooth=False)

multiline_pct("fig-site-04-four-answers.svg",
    "How much of Bitcoin is Alkanes? Three answers",
    "Alkanes share of Bitcoin by transaction count, block weight and OP_RETURN bytes, daily since genesis.",
    f"How much of Bitcoin is Alkanes? Three answers ({W_FULL})",
    WR,
    [("p_alkTx",GREEN,"Transaction count"),("p_weight",LAV,"Block weight"),
     ("p_alkB",ORANGE,"OP_RETURN bytes")],smooth=False)  # Gabe review 2026-07-08: miner fees removido daqui (introduzido só nas figuras de fee posteriores); filename mantido p/ não trocar o src do artigo

donut("fig-site-05-lastday-donut.svg",
    "Last day — share of OP_RETURN transactions",
    f"On {LAST['date']}, {_ld*100:.1f} percent of Bitcoin OP_RETURN transactions were Alkanes.",
    f"Last day, share of OP_RETURN transactions ({LAST['date']}, blocks {int(LAST['fromH'])}-{int(LAST['toH'])})",  # Gabe review: sem "N sampled" no display; metodologia fica no /metrics e na secao honesta
    [("Alkanes",_ld,GREEN),("Other OP_RETURN",1-_ld,CHAR)],
    f"{int(LAST['alkTx']):,} of {int(LAST['opTx']):,} OP_RETURN transactions that day were Alkanes.",
    hole=False)

line_pct("fig-site-06-diesel-tx-share.svg",
    "DIESEL mints — share of all Bitcoin transactions",
    "Daily share of all Bitcoin transactions that are DIESEL mints, on their own, since the DIESEL genesis block.",
    f"DIESEL mints, share of ALL Bitcoin transactions ({W_FULL})",
    rows,"p_dieselAll",color=GREEN_D,area=GREEN_D,smooth=False)

multiline_log("fig-site-07-diesel-birth-curve.svg",
    "DIESEL mints per day — the birth curve",
    "Estimated DIESEL mints per day (sampled blocks scaled to 144) from the genesis block, log scale, daily.",
    f"DIESEL mints per day, log scale ({W_FULL})",
    rows,
    [("diesel_day",GREEN,"DIESEL mints/day")],smooth=False)

value_area("fig-site-08-diesel-cumulative.svg",
    "DIESEL minted — cumulative since genesis",
    "Running total of estimated DIESEL mints since the genesis block.",
    f"Cumulative DIESEL mints ({W_FULL})",
    rows,"diesel_cum",f_cnt,smooth=False)

line_pct("fig-site-09-ug-is-diesel.svg",
    "UNCOMMON•GOODS mints that are DIESEL",
    "Daily share of UNCOMMON GOODS mints that are in fact DIESEL mints, since the DIESEL genesis block.",
    f"Share of UNCOMMON•GOODS mints that are DIESEL ({W_FULL})",
    UGR,"p_ugDiesel",smooth=False)

stacked_abs("fig-site-10-ug-mints-per-day.svg",
    "UNCOMMON•GOODS mints per day — taken over by DIESEL",
    "Daily UNCOMMON GOODS mints split into DIESEL-driven and independent Runes, raw sampled counts, stacked.",
    f"UNCOMMON•GOODS mints per day, raw counts ({W_FULL})",
    UGR,
    [("ug_d_raw",GREEN,"DIESEL"),("ug_i_raw",ORANGE,"Independent Runes")],f_cnt,smooth=False)

multiline_pct("fig-site-11-runes-vs-alkanes-share.svg",
    "Runes (non-Alkanes) vs Alkanes — share of OP_RETURN bytes",
    "Daily share of all OP_RETURN bytes written by Alkanes versus non-Alkanes Runes since the DIESEL genesis block.",
    f"Share of OP_RETURN bytes: Alkanes vs Runes (non-Alkanes) ({W_FULL})",
    rows,
    [("p_alkB",GREEN,"Alkanes"),("p_pureB",ORANGE,"Runes (non-Alkanes)")],smooth=False)

multiline_log("fig-site-12-runes-vs-alkanes-bytes.svg",
    "Runes (non-Alkanes) vs Alkanes — absolute bytes per day",
    "Estimated OP_RETURN bytes per day for Alkanes versus non-Alkanes Runes, log scale, daily since genesis.",
    f"OP_RETURN bytes per day, log scale ({W_FULL})",
    rows,
    [("alkB_day",GREEN,"Alkanes"),("pureRuneB_day",ORANGE,"Runes (non-Alkanes)")],smooth=False)

stacked_area("fig-site-13-byte-composition.svg",
    "OP_RETURN byte composition over time",
    "How the OP_RETURN byte budget splits between Alkanes, non-Alkanes Runes and everything else, day by day.",
    f"OP_RETURN byte composition ({W_FULL})",
    rows,smooth=False)

multiline_pct("fig-site-14-runestone-tx-share.svg",
    "Runestone transactions — Alkanes vs Runes (non-Alkanes)",
    "Of every runestone-carrying transaction, the daily share that is Alkanes versus non-Alkanes Runes.",
    f"Share of runestone transactions ({W_FULL})",
    RSR,
    [("p_runeTxAlk",GREEN,"Alkanes"),("p_runeTxPure",ORANGE,"Runes (non-Alkanes)")],smooth=False)

multiline_log("fig-site-15-runestone-tx-count.svg",
    "Runestone transactions per day — Alkanes vs Runes (non-Alkanes)",
    "Daily runestone-carrying transactions split into Alkanes and non-Alkanes Runes, log scale.",
    f"Runestone transactions per day, log scale ({W_FULL})",
    RSR,
    [("alkRune_day",GREEN,"Alkanes"),("pureRune_day",ORANGE,"Runes (non-Alkanes)")],smooth=False)

donut("fig-site-16-bytes-donut.svg",
    "OP_RETURN bytes (since DIESEL genesis)",
    f"Since the DIESEL genesis block, {AALL['sh_alk']*100:.1f} percent of Bitcoin OP_RETURN bytes are Alkanes, {AALL['sh_rune']*100:.1f} percent non-Alkanes Runes and {AALL['sh_oth']*100:.1f} percent other.",
    f"Share of ALL Bitcoin OP_RETURN bytes (since DIESEL genesis 880,000, {gen_start} to {gen_end})",
    [("Alkanes",AALL["sh_alk"],GREEN),("Runes (non-Alkanes)",AALL["sh_rune"],ORANGE),("Other",AALL["sh_oth"],CHAR)],
    "Averaged across the whole period, so the early Runes-heavy months are included.")

value_multiline("fig-site-17-bytes-per-tx.svg",
    "OP_RETURN bytes per transaction",
    "Average OP_RETURN payload size per transaction, Alkanes versus other OP_RETURN, daily since genesis.",
    f"OP_RETURN bytes per transaction ({W_FULL})",
    rows,
    [("bpt_oth",ORANGE,"Other OP_RETURN"),("bpt_alk",GREEN,"Alkanes")],f_bytes,smooth=False)

value_area("fig-site-18-miner-revenue.svg",
    "Miner fee revenue",
    "Daily total Bitcoin miner revenue, transaction fees plus the block subsidy, in US dollars.",
    f"Daily Bitcoin miner revenue, fees + subsidy, USD ({W_FULL})",
    rows,"minerRev_usd",f_usdM,color=ORANGE,area=ORANGE,smooth=False)

value_multiline("fig-site-19-fees-split-btc.svg",
    "Miner fee revenue from fees (BTC) — Alkanes vs rest",
    "Daily Bitcoin transaction fees in BTC, split into Alkanes and every other transaction. Block subsidy excluded.",
    f"Daily Bitcoin transaction fees, BTC ({W_FULL})",
    rows,
    [("feeBTC_rest",ORANGE,"Other fees"),("feeBTC_alk",GREEN,"Alkanes fees")],f_btc,smooth=False)

line_pct("fig-site-20-fee-share.svg",
    "Alkanes' share of miner fee revenue",
    "Daily share of total Bitcoin transaction fees paid by Alkanes transactions since the DIESEL genesis block.",
    f"Alkanes' share of miner fee revenue ({W_FULL})",
    rows,"p_feeA",smooth=False)

value_multiline("fig-site-21-fee-per-tx.svg",
    "Fee per transaction — Alkanes vs everyone else",
    "Average fee per transaction in satoshis, Alkanes versus all other transactions, daily. Days with fewer than 50 Alkanes transactions are left blank (too few to average).",
    "Fee per transaction, sats (daily since genesis; Alkanes blank below 50 tx/day)",
    rows,
    [("fpt_oth",ORANGE,"Non-Alkanes tx"),("fpt_alk_gap",GREEN,"Alkanes tx")],f_sats,smooth=False)

def pct(x): return f"{x*100:.1f}%"
print("WINDOW", start, "->", end, "| full", rows[0]["date"], "->", rows[-1]["date"], "| N", N)
print("NEW 60d:", {k:pct(A60[k]) for k in ["p_weight","p_ugDiesel","p_runeTxAlk"]},
      "bpt", round(A60["bpt_alk"],1), round(A60["bpt_oth"],1),
      "fpt", round(A60["fpt_alk"]), round(A60["fpt_oth"]))
print("NEW full:", {k:pct(AALL[k]) for k in ["p_weight","p_ugDiesel","p_runeTxAlk"]})
print("last-day weight", pct(WR[-1]["p_weight"]), f"({WR[-1]['date']})", "| cumulative diesel", f_cnt(rows[-1]["diesel_cum"]), int(rows[-1]["diesel_cum"]))
print("miner rev/day 60d last", f_usdM(mov(last60,"minerRev_usd")[-1]))
print("60d:", {k:pct(A60[k]) for k in ["p_alkTx","p_opTx","p_alkOfOp","p_alkB","p_diesel","p_feeA","sh_alk","sh_rune","sh_oth"]})
print("60d usd total", round(A60["usd"]), "day", round(A60["usd_day"]))
print("LATEST", LAST["date"], {k:pct(LAST[k]) for k in ["p_alkTx","p_alkOfOp","p_alkB","p_feeA"]}, "usd", round(LAST["feeA_usd"]))
print("FULL:", {k:pct(AALL[k]) for k in ["p_alkTx","p_alkB","p_feeA","sh_alk","sh_rune"]})
print("xticks 60d:", [dlabel(d) for _,d in even_ticks(last60,6)])
print("xticks full:", [dlabel(d) for _,d in even_ticks(rows,6)])
print("OK ->", OUT)

#!/usr/bin/env python3
# ─── gridMET → per-county GDD phenology spine (Phase B Commit 6) ──────────────────
#
# Runs OFF Vercel (GitHub Actions, or locally). Fetches gridMET 4km DAILY tmin/tmax
# over OPeNDAP (spatial+temporal SUBSET to the 5-state bbox × Feb-to-date — we never
# download the 67MB CONUS file), computes a REAL daily GDD accumulation per county on
# the 291-county geojson, and EMITS JSON. A thin tsx step (gridmet-gdd-upsert.ts) then
# upserts it to public.hay_gdd_spine via supabase-js (same idiom as the prism-* scripts).
#
# Zero netCDF deps: OPeNDAP .ascii is plain text, parsed with the Python stdlib only.
#
#   GDD_day = (clamp(tmaxF,41,86) + clamp(tminF,41,86))/2 − 41   ; accumulated from Feb 1.
#
# Stage ladder = LITERATURE estimate (UMN/MSU alfalfa, first-cut ~680-750), CONTESTED /
# calibration-pending. It tracks NORMAL maturity — deliberately NOT anchored to PK's
# stress-advanced 2026 fields (a stressed crop looks more mature than its GDD; that GAP
# is the stress signal for commits 8-9, and must never be folded into the maturity clock).
#
# Honest-degraded: a county with no usable daily temp → gdd/stage NULL, days_used=0,
# never a faked green-up. is_provisional=true (all current-year gridMET is preliminary).
# as_of_date = the latest DAY actually covered (data-derived freshness, never a compute date).

import json, math, sys, urllib.request
from datetime import date, timedelta

# ── Footprint + grid + model constants ───────────────────────────────────────────
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = -116.1, -95.3, 40.0, 49.0
# gridMET grid (from the OPeNDAP DDS/DAS): 585 lat desc from 49.4, 1386 lon asc from -124.7666667, 1/24°.
GLAT0, GLON0, GSTEP = 49.4, -124.76666666666667, 1.0 / 24.0
GLAT_N, GLON_N = 585, 1386
BASE_F, CAP_F = 41.0, 86.0
# Green-up = the date cumulative GDD (from Feb 1) first crosses this threshold. CONTESTED /
# calibration-pending, same posture as the rest of the stage ladder (literature estimate,
# not field-anchored — see project_gdd_calibration_anchors). Consumed by the ceiling (C).
GREENUP_GDD = 150.0
SEASON_START_MONTH, SEASON_END_MONTH = 2, 7  # Feb–Jul
SENTINELS = {'30069', '31109', '46033'}
EPOCH = date(1900, 1, 1)  # gridMET `day` = days since 1900-01-01

VARS = {  # element -> gridMET OPeNDAP base
    'tmin': 'http://thredds.northwestknowledge.net:8080/thredds/dodsC/MET/tmmn/tmmn_{y}.nc',
    'tmax': 'http://thredds.northwestknowledge.net:8080/thredds/dodsC/MET/tmmx/tmmx_{y}.nc',
}

glat = lambda i: GLAT0 - i * GSTEP
glon = lambda j: GLON0 + j * GSTEP
lat_idx = lambda lat: int(round((GLAT0 - lat) / GSTEP))
lon_idx = lambda lon: int(round((lon - GLON0) / GSTEP))


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=180) as r:
        return r.read().decode()


# OPeNDAP .ascii Grid rows: "[d][la], v0, v1, …" (0-based within the requested subset).
def parse_ascii(txt: str) -> dict:
    out = {}
    for line in txt.splitlines():
        if not line.startswith('['):
            continue
        head, _, rest = line.partition(',')
        try:
            d, la = (int(x) for x in head.replace('][', ' ').strip('[]').split())
        except ValueError:
            continue
        out[(d, la)] = [int(x) for x in rest.split(',') if x.strip()]
    return out


def k_to_f(packed: int) -> float:
    # gridMET packs temp as UInt16: K = packed*0.1 + 210; _FillValue 32767.
    return ((packed * 0.1 + 210.0) - 273.15) * 9.0 / 5.0 + 32.0


def rings(feat):
    g = feat['geometry']
    return [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']


def pip(lon, lat, feat) -> bool:
    inside = False
    for poly in rings(feat):
        ring = poly[0]
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]; xj, yj = ring[j]
            if ((yi > lat) != (yj > lat)) and (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi):
                inside = not inside
            j = i
    return inside


# Stage ladder — LITERATURE estimate (CONTESTED, calibration-pending a NORMAL-year anchor).
def stage_of(gdd):
    if gdd is None:
        return None
    if gdd < 150:  return 'pre-green-up'
    if gdd < 400:  return 'establishment'
    if gdd < 680:  return 'boot-heading'
    if gdd < 750:  return 'first-cutting'
    return 'past-first-cutting'


def main():
    year = date.today().year
    season_start = date(year, SEASON_START_MONTH, 1)
    season_end = date(year, SEASON_END_MONTH, 1).replace(day=28) + timedelta(days=4)  # end of Jul
    season_end = season_end.replace(day=1) - timedelta(days=1)

    # 1) day[] for the year → indices within the Feb–Jul window that actually exist.
    day_txt = fetch(VARS['tmin'].format(y=year) + '.ascii?day')
    day_vals = []
    for line in day_txt.splitlines():
        if line and line[0].isdigit():
            day_vals += [float(x) for x in line.split(',') if x.strip()]
    if not day_vals:
        print('[gridmet-gdd] no day[] values — aborting', file=sys.stderr); sys.exit(1)
    day_dates = [EPOCH + timedelta(days=int(v)) for v in day_vals]
    sel = [i for i, d in enumerate(day_dates) if season_start <= d <= season_end]
    if not sel:
        print('[gridmet-gdd] no Feb–Jul days available yet — aborting', file=sys.stderr); sys.exit(1)
    d0, d1 = sel[0], sel[-1]
    as_of = day_dates[d1].isoformat()
    n_days = d1 - d0 + 1
    print(f'[gridmet-gdd] {year} Feb–Jul: days {d0}..{d1} ({n_days}d) · as_of={as_of}', file=sys.stderr)

    # 2) bbox → gridMET index window (pad ±1).
    la0 = max(0, lat_idx(LAT_MAX) - 1); la1 = min(GLAT_N - 1, lat_idx(LAT_MIN) + 1)
    lo0 = max(0, lon_idx(LON_MIN) - 1); lo1 = min(GLON_N - 1, lon_idx(LON_MAX) + 1)

    # 3) counties + their in-window cell offsets (PIP on cell centers, computed once).
    with open('public/geo/np-counties.geojson') as fh:
        fc = json.load(fh)
    county_cells = []  # (feat, [(li, lj), …])
    for f in fc['features']:
        xs = [p[0] for poly in rings(f) for p in poly[0]]
        ys = [p[1] for poly in rings(f) for p in poly[0]]
        cl0 = max(la0, lat_idx(max(ys)) - 1); cl1 = min(la1, lat_idx(min(ys)) + 1)
        co0 = max(lo0, lon_idx(min(xs)) - 1); co1 = min(lo1, lon_idx(max(xs)) + 1)
        cells = [(la - la0, lo - lo0)
                 for la in range(cl0, cl1 + 1) for lo in range(co0, co1 + 1)
                 if pip(glon(lo), glat(la), f)]
        county_cells.append((f, cells))

    # 4) accumulate GDD across day-chunks (bounded .ascii responses), per county.
    gdd = {f['properties']['GEOID']: 0.0 for f, _ in county_cells}
    used = {f['properties']['GEOID']: 0 for f, _ in county_cells}
    greenup = {f['properties']['GEOID']: None for f, _ in county_cells}  # date cum GDD first ≥ GREENUP_GDD
    CHUNK = 20
    for c0 in range(d0, d1 + 1, CHUNK):
        c1 = min(c0 + CHUNK - 1, d1)
        sub = {}
        for el, tmpl in VARS.items():
            q = f'.ascii?air_temperature%5B{c0}:{c1}%5D%5B{la0}:{la1}%5D%5B{lo0}:{lo1}%5D'
            sub[el] = parse_ascii(fetch(tmpl.format(y=year) + q))
        for di in range(c1 - c0 + 1):
            for f, cells in county_cells:
                fips = f['properties']['GEOID']
                tns, txs = [], []
                for (li, lj) in cells:
                    rn = sub['tmin'].get((di, li)); rx = sub['tmax'].get((di, li))
                    if rn and rx and lj < len(rn) and rn[lj] != 32767 and rx[lj] != 32767:
                        tns.append(k_to_f(rn[lj])); txs.append(k_to_f(rx[lj]))
                if not tns:
                    continue
                tn = sum(tns) / len(tns); tx = sum(txs) / len(txs)
                gdd[fips] += (min(max(tx, BASE_F), CAP_F) + min(max(tn, BASE_F), CAP_F)) / 2 - BASE_F
                used[fips] += 1
                # Green-up date = the first day cumulative GDD crosses the threshold.
                if greenup[fips] is None and gdd[fips] >= GREENUP_GDD:
                    greenup[fips] = day_dates[c0 + di].isoformat()
        print(f'[gridmet-gdd] chunk days {c0}..{c1} done', file=sys.stderr)

    # 5) rows (honest-degraded: no usable days → NULL gdd/stage, days_used=0).
    rows = []
    for f, _ in county_cells:
        fips = f['properties']['GEOID']
        g = round(gdd[fips], 1) if used[fips] > 0 else None
        rows.append({
            'fips': fips,
            'season_year': year,
            'gdd_cumulative': g,
            'stage': stage_of(g),
            'green_up_date': greenup[fips] if used[fips] > 0 else None,  # NULL if no temp OR not yet greened up
            'days_used': used[fips],
            'as_of_date': as_of if used[fips] > 0 else None,
            'is_provisional': True,  # all current-year gridMET is preliminary
        })
        if fips in SENTINELS:
            print(f"[gridmet-gdd] {fips} {f['properties']['NAME']}: "
                  f"GDD={g} stage={stage_of(g)} green_up={greenup[fips]} days={used[fips]}", file=sys.stderr)

    json.dump({'as_of': as_of, 'season_year': year, 'rows': rows}, sys.stdout)
    print(f'[gridmet-gdd] emitted {len(rows)} counties', file=sys.stderr)


if __name__ == '__main__':
    main()

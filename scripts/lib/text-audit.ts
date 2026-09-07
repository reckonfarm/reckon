// ─── Rendered text audit (Phase A1) ───────────────────────────────────────────
// A page.evaluate STRING (tsx/esbuild injects __name into function bodies, so
// the body must travel as text). For every element that owns visible text it
// reports the computed font size and the contrast of the computed text color
// against the color actually composited behind it — ancestors' backgrounds
// alpha-blended in order, down to the body — never the CSS the author wrote.
//
//   const r = await page.evaluate(`${TEXT_AUDIT}(${JSON.stringify({ minPx: 14, minRatio: 4.5, root: 'main' })})`) as TextAudit
//
// Any text under minPx or under minRatio lands in `tiny` / `low` with its text,
// size, colors, and ratio, so a failure names the offender.
export interface TextNode { text: string; px: number; color: string; bg: string; ratio: number; weight: number; tag: string; nav: boolean }
export interface TextAudit { total: number; tiny: TextNode[]; low: TextNode[]; lowEssential: TextNode[]; samples: TextNode[] }

export const TEXT_AUDIT = `(function(opts){
  var minPx = opts.minPx || 14, minRatio = opts.minRatio || 4.5, essentialRatio = opts.essentialRatio || 7, root = document.querySelector(opts.root || 'main') || document.body;
  var wantSamples = opts.samples || [];
  // Any CSS color the engine can paint — rgb(), color(srgb …), oklab(), color-mix results —
  // resolved through a 1×1 canvas so the alpha the text is REALLY drawn with is what we read.
  var cv = document.createElement('canvas'); cv.width = cv.height = 1; var cx = cv.getContext('2d', { willReadFrequently: true });
  function parse(c){
    if (!c) return null;
    if (c === 'transparent' || c === 'rgba(0, 0, 0, 0)') return { r: 0, g: 0, b: 0, a: 0 };
    var m = /^rgba?\\(([^)]+)\\)$/.exec(c);
    if (m) { var p = m[1].split(/[\\s,\\/]+/).filter(Boolean).map(parseFloat); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; }
    if (!cx) return null;
    cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; if (cx.fillStyle === '#000000' && c.indexOf('0') < 0) return null;
    cx.fillRect(0, 0, 1, 1); var d = cx.getImageData(0, 0, 1, 1).data; return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  function over(fg, bg){ var a = fg.a; return { r: fg.r*a + bg.r*(1-a), g: fg.g*a + bg.g*(1-a), b: fg.b*a + bg.b*(1-a), a: 1 }; }
  function lum(c){ function f(v){ v = v/255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); } return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b); }
  function contrast(a, b){ var la = lum(a), lb = lum(b); var hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); }
  // Composited background behind an element: walk up, blending each layer with alpha.
  function backdrop(el){
    var layers = []; var e = el;
    while (e && e !== document.documentElement) { var bg = parse(getComputedStyle(e).backgroundColor); if (bg && bg.a > 0) layers.push(bg); e = e.parentElement; }
    var htmlBg = parse(getComputedStyle(document.documentElement).backgroundColor);
    var base = (htmlBg && htmlBg.a > 0) ? htmlBg : { r: 253, g: 251, b: 247, a: 1 };
    var out = base; for (var i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
    return out;
  }
  function visible(el){ var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return false; var b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; }
  function ownText(el){ var t = ''; for (var i = 0; i < el.childNodes.length; i++) { var n = el.childNodes[i]; if (n.nodeType === 3) t += n.textContent; } return t.replace(/\\s+/g, ' ').trim(); }
  var fmt = function(c){ return '#' + [c.r, c.g, c.b].map(function(v){ v = Math.round(v).toString(16); return v.length < 2 ? '0' + v : v; }).join(''); };
  var all = root.querySelectorAll('*'); var total = 0, tiny = [], low = [], lowEssential = [], samples = [];
  for (var i = 0; i < all.length; i++) {
    var el = all[i]; if (el.closest('svg') || el.closest('script,style,noscript,template')) continue;
    var text = ownText(el); if (!text) continue; if (!visible(el)) continue;
    if (el.getAttribute('aria-hidden') === 'true' && text.length <= 2) continue;   // a lone chevron or bullet
    var cs = getComputedStyle(el); var px = parseFloat(cs.fontSize); var fg = parse(cs.color); if (!fg) continue;
    var eff = fg.a < 1 ? over(fg, backdrop(el)) : fg; var bg = backdrop(el); var ratio = contrast(eff, bg);
    var weight = parseInt(cs.fontWeight, 10) || 400; var nav = !!(el.closest('a, button, [role="tab"]') && el.closest('nav, header, [role="tablist"], [role="navigation"]'));
    // Answers and navigation must reach essentialRatio: headings, anything 18 px and up, and
    // links / buttons in nav, header, or a tablist. Weight alone does not make a node an answer.
    var essential = nav || px >= 18 || /^H[1-3]$/.test(el.tagName) || !!el.closest('h1,h2,h3');
    var node = { text: text.slice(0, 60), px: Math.round(px * 10) / 10, color: fmt(eff), bg: fmt(bg), ratio: Math.round(ratio * 100) / 100, weight: weight, tag: el.tagName, nav: nav };
    total++;
    if (px < minPx) tiny.push(node);
    if (ratio < minRatio) low.push(node);
    else if (essential && ratio < essentialRatio) lowEssential.push(node);
    for (var s = 0; s < wantSamples.length; s++) { if (text.indexOf(wantSamples[s]) >= 0) samples.push(Object.assign({ sample: wantSamples[s] }, node)); }
  }
  return { total: total, tiny: tiny.slice(0, 40), low: low.slice(0, 40), lowEssential: lowEssential.slice(0, 40), samples: samples, tinyCount: tiny.length, lowCount: low.length, lowEssentialCount: lowEssential.length };
})`

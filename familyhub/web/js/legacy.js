// Ältere Browser (z. B. iPad mit iOS 15): CSS „color-mix()“ gibt es erst ab Safari 16.2.
// Dann wird das Stylesheet einmal geladen, jede Farbmischung mit den aktuellen Farben (hell/dunkel)
// ausgerechnet und als fertige Farbe eingesetzt. Moderne Browser tun hier nichts.
(function () {
  if (!window.CSS || CSS.supports('color', 'color-mix(in srgb, red 50%, blue)')) return;
  var link = document.querySelector('link[href$="css/app.css"]');
  if (!link) return;
  var source = null; var style = null;
  var probe = document.createElement('i'); probe.style.display = 'none';

  function rgba(expr) { // Farbausdruck → [r,g,b,a] oder null (z. B. Variable, die erst am Element gesetzt wird)
    expr = expr.trim();
    var v = /^var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)$/.exec(expr);
    if (v) {
      var val = getComputedStyle(document.documentElement).getPropertyValue(v[1]).trim();
      if (!val) return v[2] ? rgba(v[2]) : null;
      expr = val;
    }
    if (/var\(/.test(expr)) return null;
    probe.style.color = ''; probe.style.color = expr;
    if (!probe.style.color) return null;
    if (!probe.parentNode) (document.body || document.documentElement).appendChild(probe);
    var m = getComputedStyle(probe).color.match(/[\d.]+/g);
    if (!m) return null;
    return [+m[0], +m[1], +m[2], m[3] == null ? 1 : +m[3]];
  }
  function splitTop(s) { var out = [], depth = 0, last = 0; for (var i = 0; i < s.length; i++) { var c = s[i]; if (c === '(') depth++; else if (c === ')') depth--; else if (c === ',' && !depth) { out.push(s.slice(last, i)); last = i + 1; } } out.push(s.slice(last)); return out; }
  function part(s) { var m = /\s(\d+(?:\.\d+)?)%\s*$/.exec(' ' + s.trim()); return m ? { c: s.trim().slice(0, -m[0].trim().length).trim(), p: +m[1] / 100 } : { c: s.trim(), p: null }; }
  function mix(args) {
    var a = splitTop(args); if (a.length < 3) return null;
    var A = part(a[1]), B = part(a[2]);
    var pa = A.p != null ? A.p : B.p != null ? 1 - B.p : 0.5; var pb = B.p != null ? B.p : 1 - pa;
    var t = pa + pb || 1; pa /= t; pb /= t;
    var ca = rgba(A.c), cb = rgba(B.c);
    if (!ca || !cb) return pa >= pb ? A.c : B.c; // nicht auflösbar: die überwiegende Farbe nehmen
    var al = ca[3] * pa + cb[3] * pb;
    if (!al) return 'transparent';
    var ch = [0, 1, 2].map(function (i) { return Math.round((ca[i] * ca[3] * pa + cb[i] * cb[3] * pb) / al); });
    return 'rgba(' + ch.join(',') + ',' + Math.round(al * 1000) / 1000 + ')';
  }
  function rewrite(css) {
    var i, guard = 0;
    while ((i = css.lastIndexOf('color-mix(')) >= 0 && guard++ < 2000) { // innerste zuerst
      var start = i + 'color-mix('.length, depth = 1, j = start;
      for (; j < css.length && depth; j++) { if (css[j] === '(') depth++; else if (css[j] === ')') depth--; }
      css = css.slice(0, i) + (mix(css.slice(start, j - 1)) || 'transparent') + css.slice(j);
    }
    return css.replace(/url\((['"]?)\.\.\//g, 'url($1');
  }
  function apply() {
    if (!source) return;
    var out = rewrite(source);
    if (!style) { style = document.createElement('style'); style.id = 'legacy-css'; link.parentNode.insertBefore(style, link.nextSibling); }
    style.textContent = out;
  }
  fetch(link.href).then(function (r) { return r.text(); }).then(function (t) { source = t; apply(); });
  // Hell/Dunkel wechselt → Farben neu ausrechnen
  new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  var mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', apply) : mq.addListener(apply));
})();

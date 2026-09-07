/* =====================================================================
   ОФЛАЙН-РАСПОЗНАВАНИЕ РАСТЕНИЙ «ДарЛес»
   ---------------------------------------------------------------------
   Работает полностью в браузере — БЕЗ API, без ключей и без интернета.
   Что умеет:
     1) Определять растение по имени файла (например «туя брабант.jpg»).
     2) Анализировать само фото: цвет листвы (сизая/голубая, тёмно-зелёная,
        злаковая, широколиственная), силуэт и форму.
     3) По каталогу сайта (PRODUCTS) подбирать наиболее похожее растение
        и возвращать его название, категорию, подпись и описание.

   ВАЖНО: это не «магия» — нейросеть в облаке тут не используется.
   Если фото названо по-русски и/или у растения выраженный цвет/форма,
   помощник даёт точный ответ. В остальных случаях он предлагает
   варианты, которые можно выбрать вручную.
   ===================================================================== */

(function () {
  "use strict";

  const STOP = new Set(("фото изображение img image photo jpg jpeg png webp bmp dsc im " +
    "растение растения для это и в на под с наш новый").split(" "));

  const norm = s => String(s || "").toLowerCase().replace(/ё/g, "е").replace(/\.(jpe?g|png|webp|bmp)$/i, "").trim();

  function tokens(s) {
    return norm(s).split(/[^a-zа-я0-9-]+/i).filter(t => t.length >= 3 && !STOP.has(t));
  }

  /* ---------- база знаний: берём каталог сайта + синонимы ---------- */
  const ALIASES = {
    10: "juniperus squamata blue star голубая звезда можжевельник чешуйчатый",
    11: "aucuba japonica variegata золотое дерево аукуба",
    12: "juniperus media variegata можжевельник средний пестрый",
    13: "berberis thunbergii барбарис тунберга",
    14: "juniperus sabina казацкий",
    15: "juniperus horizontalis blue chip голубой чип",
    16: "juniperus chinensis китайский",
    17: "hydrangea macrophylla гортензия крупнолистная",
    18: "photinia fraseri red robin фотиния",
    19: "lagerstroemia indica лагерстремия лагерстрёмия индийская",
    20: "pennisetum alopecuroides пеннисетум лисохвостный",
    21: "panicum virgatum просо прутьевидное свитчграсс",
    22: "hosta хоста гибридная",
  };

  function colorTypeOf(p) {
    const s = norm(p.name + " " + (p.short || ""));
    if (/голуб|blue|сиз|серебрист|gray|grey/.test(s + " " + (ALIASES[p.id] || ""))) return "blueGray";
    if (/пеннисетум|просо|злак|panicum|pennisetum/.test(s)) return "grass";
    if (/можжевельник|туя|ель|сосн|кипарис|пихт|тис/.test(s)) return "darkGreen";
    return "green";
  }

  function typeOf(p) {
    const s = norm(p.name);
    if (/можжевельник|туя|ель|сосн|кипарис|пихт|тис/.test(s)) return "conifer";
    if (/пеннисетум|просо|злак|panicum|pennisetum/.test(s)) return "grass";
    if (/хоста|hosta/.test(s)) return "broadleaf";
    return "shrub";
  }

  function buildKB() {
    const src = (typeof PRODUCTS !== "undefined" && Array.isArray(PRODUCTS)) ? PRODUCTS : [];
    return src.map(p => {
      const aliases = (ALIASES[p.id] || "") + " " + p.name + " " + (p.short || "");
      return {
        id: p.id,
        name: p.name,
        category: p.category,
        price: p.price,
        short: p.short || "",
        description: p.description || "",
        colorType: colorTypeOf(p),
        type: typeOf(p),
        keys: tokens(aliases),
      };
    });
  }

  function matchKey(token, key) {
    if (token === key) return true;
    if (token.length >= 4 && key.length >= 4) {
      if (key.startsWith(token) || token.includes(key) || key.includes(token)) return true;
      if (key.slice(0, Math.min(3, key.length)) === token.slice(0, Math.min(3, key.length))) return true;
    }
    return false;
  }

  /* ---------- анализ изображения ---------- */
  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось открыть изображение для распознавания"));
      img.src = url;
    });
  }

  function analyzeImage(img) {
    const MAX = 520;
    const k = Math.min(1, MAX / Math.max(img.width, img.height));
    const W = Math.max(1, Math.round(img.width * k));
    const H = Math.max(1, Math.round(img.height * k));
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;

    let n = W * H;
    let fol = 0, bg = 0, dark = 0;
    let hueSum = 0, satSum = 0, lumSum = 0;
    let minx = W, maxx = 0, miny = H, maxy = 0;
    let pGreen = 0, pBlue = 0, pGray = 0, pDark = 0, pGrass = 0;

    for (let i = 0; i < n; i++) {
      const j = i * 4;
      const r = d[j], g = d[j + 1], b = d[j + 2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx - mn;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      /* фон (белый/светлый нейтральный) и горшок (тёмный нейтральный) */
      if (lum > 236 && sat < 20) { bg++; continue; }
      if (lum < 65 && sat < 55) { dark++; continue; }

      fol++;
      const x = i % W, y = (i - x) / W;
      if (x < minx) minx = x; if (x > maxx) maxx = x;
      if (y < miny) miny = y; if (y > maxy) maxy = y;

      /* hue 0-360 */
      let hue = 0;
      if (mx !== mn) {
        if (mx === r) hue = 60 * (((g - b) / (mx - mn)) % 6);
        else if (mx === g) hue = 60 * ((b - r) / (mx - mn) + 2);
        else hue = 60 * ((r - g) / (mx - mn) + 4);
        if (hue < 0) hue += 360;
      }
      hueSum += hue; satSum += sat; lumSum += lum;

      if (hue >= 60 && hue <= 170 && sat > 25) pGreen++;
      if (hue >= 150 && hue <= 270 && sat > 18) pBlue++;
      if (sat >= 10 && sat <= 32 && lum >= 110 && lum <= 215) pGray++;
      if (hue >= 40 && hue <= 100 && sat > 45 && lum >= 70) pGrass++;
      if (hue >= 60 && hue <= 160 && sat > 40 && lum < 115) pDark++;
    }

    const bboxW = maxx - minx + 1, bboxH = maxy - miny + 1;
    return {
      W, H, fol, bg, dark,
      hue: fol ? hueSum / fol : 0,
      sat: fol ? satSum / fol : 0,
      lum: fol ? lumSum / fol : 0,
      pGreen: pGreen, pBlue: pBlue, pGray: pGray, pDark: pDark, pGrass: pGrass,
      aspect: bboxH ? bboxW / bboxH : 1,
      fillRatio: n ? (bboxW * bboxH) / n : 0,
    };
  }

  function foliageColor(info) {
    if (info.fol < 250) return null;
    if (info.pBlue > info.fol * 0.34) return "blueGray";
    if (info.pGrass > info.fol * 0.34) return "grass";
    if (info.pDark > info.fol * 0.30) return "darkGreen";
    if (info.pGray > info.fol * 0.34) return "grayGreen";
    if (info.pGreen > info.fol * 0.4) return "green";
    return null;
  }

  function colorScore(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 14;
    const close = [["green", "grayGreen"], ["green", "darkGreen"], ["darkGreen", "grayGreen"], ["grayGreen", "grass"], ["green", "grass"]];
    return close.some(x => (x[0] === a && x[1] === b) || (x[0] === b && x[1] === a)) ? 7 : 0;
  }

  function candidatePool(ctype) {
    const kb = buildKB();
    if (ctype === "blueGray") return kb.filter(p => p.colorType === "blueGray" || p.type === "conifer");
    if (ctype === "grass") return kb.filter(p => p.type === "grass" || p.category === "mnogoletnie");
    if (ctype === "darkGreen") return kb.filter(p => p.type === "conifer" || p.colorType === "darkGreen");
    if (ctype === "grayGreen") return kb.filter(p => /варьегата|variegata|чешуйчат/.test(p.name));
    return [];
  }

  /* ---------- публичное распознавание ---------- */
  async function detect(url, filename = "") {
    const kb = buildKB();
    const nameTokens = tokens(filename);
    const img = await loadImage(url);
    const info = analyzeImage(img);
    const ctype = foliageColor(info);
    const pool = ctype ? candidatePool(ctype) : [];
    const union = new Map();

    for (const p of kb) union.set(p.id, p);
    for (const p of pool) union.set(p.id, p);
    const list = [...union.values()];

    const scored = list.map(p => {
      let score = 0, nameHit = 0;
      for (const t of nameTokens) {
        if (p.keys.some(k => matchKey(t, k))) { nameHit++; score += 24; }
      }
      if (nameHit >= 2) score += 12;
      score += colorScore(p.colorType, ctype);
      if (ctype === "blueGray" && p.colorType === "blueGray") score += 4;
      if (p.type === "grass" && ctype === "grass") score += 8;
      if (p.type === "conifer" && (ctype === "blueGray" || ctype === "darkGreen")) score += 4;
      return { p, score, nameHit };
    }).filter(x => x.score > 0);

    scored.sort((a, b) => b.score - a.score || b.nameHit - a.nameHit || a.p.price - b.p.price);
    const max = scored.length ? scored[0].score : 1;
    const candidates = scored.slice(0, 6).map(s => ({
      product: s.p,
      score: s.score,
      confidence: Math.min(0.98, 0.22 + s.score / (max + 1) * 0.76),
      byName: s.nameHit > 0,
    }));

    return {
      colorType: ctype,
      analyzed: {
        fol: info.fol, bg: info.bg, pot: info.dark,
        hue: Math.round(info.hue), sat: Math.round(info.sat),
        aspect: +info.aspect.toFixed(2),
      },
      candidates,
    };
  }

  globalThis.PlantID = { detect, _buildKB: buildKB, _tokens: tokens, _matchKey: matchKey, _analyzeImage: analyzeImage, _foliageColor: foliageColor };

  /* доступ для тестов в Node */
  if (typeof window === "undefined") globalThis.__PlantIDTest = { buildKB, tokens, matchKey, analyzeImage, foliageColor, candidatePool, colorScore };
})();

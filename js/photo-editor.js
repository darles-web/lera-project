/* =====================================================================
   ФОТОРЕДАКТОР АДМИН-ПАНЕЛИ «ДарЛес»
   - Замена белого фона (умное удаление прямо в браузере, без сервисов):
     фон «вырезается» заливкой от краёв, растение остаётся нетронутым
     (даже белые цветки внутри кроны не пострадают).
   - Выравнивание: перетаскивание растения мышкой, масштаб, поворот.
   - Результат — фото 1200x1600 (3:4) под формат карточки каталога.

   Вызов: PhotoEditor.open({ source, state, onSave })
   ===================================================================== */

(function () {
  "use strict";

  const OUT_W = 1200, OUT_H = 1600;            // формат карточки 3:4
  const FIT_W = OUT_W - 92, FIT_H = OUT_H - 92; // базовые поля 46px
  const MAX_SRC = 1600;                         // предел исходника

  /* Чувствительность удаления фона: t1 — «точно фон», t2 — мягкий край */
  const SENS = [
    { label: "Аккуратно (сохранить тени)", t1: 12, t2: 30 },
    { label: "Обычно", t1: 24, t2: 55 },
    { label: "Агрессивно (убрать всё светлое)", t1: 40, t2: 82 },
  ];

  const BGS = [
    { id: "mint",  label: "Мята",     css: "linear-gradient(135deg,#e9f4ee,#cfe4d7)" },
    { id: "gray",  label: "Серый",    css: "#f1f3f1" },
    { id: "cream", label: "Кремовый", css: "#f8f3e6" },
    { id: "sky",   label: "Небо",     css: "linear-gradient(135deg,#ecf3f9,#d5e5f2)" },
    { id: "dark",  label: "Тёмный",   css: "#22432f" },
    { id: "custom", label: "Свой цвет", css: "#ffffff" },
  ];

  function paintBg(ctx, state) {
    const bg = BGS.find(b => b.id === state.bg) || BGS[0];
    if (state.bg === "custom") {
      ctx.fillStyle = state.custom || "#f1f3f1";
      ctx.fillRect(0, 0, OUT_W, OUT_H);
      return;
    }
    if (bg.css.startsWith("linear-gradient")) {
      const g = ctx.createLinearGradient(0, 0, OUT_W, OUT_H);
      g.addColorStop(0, bg.css.match(/#\w+/g)[0]);
      g.addColorStop(1, bg.css.match(/#\w+/g)[1]);
      ctx.fillStyle = g;
    } else {
      ctx.fillStyle = bg.css;
    }
    ctx.fillRect(0, 0, OUT_W, OUT_H);
  }

  /* ------------------------------------------------------------------ */
  /* Удаление фона: авто-вырезание объекта от краёв картинки             */
  /* ------------------------------------------------------------------ */
  function estimateBgColors(data, w, h) {
    const counts = new Map(), sums = new Map();
    const push = (x, y) => {
      const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      const q = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      counts.set(q, (counts.get(q) || 0) + 1);
      const s = sums.get(q) || [0, 0, 0];
      s[0] += r; s[1] += g; s[2] += b;
      sums.set(q, s);
    };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
    for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    return [...counts].map(([q, c]) => {
      const s = sums.get(q);
      return { r: Math.round(s[0] / c), g: Math.round(s[1] / c), b: Math.round(s[2] / c), c };
    }).sort((a, b) => b.c - a.c).slice(0, 6);
  }

  function minDist2ToBgs(r, g, b, bgs) {
    let d2 = Infinity;
    for (const c of bgs) {
      const dr = r - c.r, dg = g - c.g, db = b - c.b;
      const v = dr * dr + dg * dg + db * db;
      if (v < d2) d2 = v;
    }
    return d2;
  }

  function computeAlphaData(imgData, opts = {}) {
    const data = imgData.data, w = imgData.width, h = imgData.height, n = w * h;
    const t1 = opts.t1 ?? 24, t2 = opts.t2 ?? 55;
    const t1sq = t1 * t1, t2sq = t2 * t2;
    const doShadow = opts.shadow !== false;
    const keepMain = opts.mainObject !== false;

    const bgs = estimateBgColors(data, w, h);
    const bg = bgs[0] || { r: 255, g: 255, b: 255 };
    const bgLum = (bg.r + bg.g + bg.b) / 3;
    const bgSat = Math.max(bg.r, bg.g, bg.b) - Math.min(bg.r, bg.g, bg.b);
    const lightNeutralBg = bgLum > 150 && bgSat < 42;

    const alpha = new Uint8ClampedArray(n).fill(255);
    const visited = new Uint8Array(n);
    const q = new Int32Array(n);
    let head = 0, tail = 0;

    const shadowLike = i => {
      if (!doShadow || !lightNeutralBg) return false;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      return sat < 34 && lum > 150 && lum > bgLum - 90;
    };
    const softShadow = i => {
      if (!doShadow || !lightNeutralBg) return false;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = (r + g + b) / 3;
      return sat < 42 && lum > 150 && lum > bgLum - 78;
    };

    /* стартуем со всех краевых пикселей, похожих на фон */
    const seed = i => {
      if (visited[i]) return;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      if (minDist2ToBgs(r, g, b, bgs) <= t1sq || shadowLike(i)) {
        visited[i] = 1; alpha[i] = 0; q[tail++] = i;
      } else if (minDist2ToBgs(r, g, b, bgs) <= t2sq || softShadow(i)) {
        visited[i] = 1; alpha[i] = 70;
      }
    };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }

    /* вырастаем фон от краёв: глобальная похожесть + плавность по соседству */
    while (head < tail) {
      const i = q[head++];
      alpha[i] = 0;
      const x = i % w, y = (i - x) / w;
      const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
      const nbs = [];
      if (x > 0) nbs.push(i - 1);
      if (x < w - 1) nbs.push(i + 1);
      if (y > 0) nbs.push(i - w);
      if (y < h - 1) nbs.push(i + w);
      for (const j of nbs) {
        if (visited[j]) continue;
        const nr = data[j * 4], ng = data[j * 4 + 1], nb = data[j * 4 + 2];
        const localSq = (nr - r) * (nr - r) + (ng - g) * (ng - g) + (nb - b) * (nb - b);
        const bgSq = minDist2ToBgs(nr, ng, nb, bgs);
        if (bgSq <= t1sq || localSq <= t1sq || shadowLike(j)) {
          visited[j] = 1; alpha[j] = 0; q[tail++] = j;
        } else if (bgSq <= t2sq || localSq <= t2sq || softShadow(j)) {
          visited[j] = 1; alpha[j] = 70;
        } else {
          visited[j] = 1; /* растение — оставляем непрозрачным */
        }
      }
    }

    if (keepMain) keepMainComponent(alpha, w, h, n);
    fillTinyHoles(alpha, w, h, n);
    return alpha;
  }

  /* Оставляем главный объект (растение + горшок), убираем осколки фона */
  function keepMainComponent(alpha, w, h, n) {
    const labels = new Int32Array(n).fill(-1);
    const q = new Int32Array(n);
    const comps = [];
    let compId = 0;

    for (let start = 0; start < n; start++) {
      if (alpha[start] < 110 || labels[start] !== -1) continue;
      let head = 0, tail = 0, size = 0;
      let minx = w, miny = h, maxx = -1, maxy = -1;
      q[tail++] = start; labels[start] = compId;
      while (head < tail) {
        const i = q[head++]; size++;
        const x = i % w, y = (i - x) / w;
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
        const nbs = [];
        if (x > 0) nbs.push(i - 1);
        if (x < w - 1) nbs.push(i + 1);
        if (y > 0) nbs.push(i - w);
        if (y < h - 1) nbs.push(i + w);
        for (const j of nbs)
          if (alpha[j] >= 110 && labels[j] === -1) { labels[j] = compId; q[tail++] = j; }
      }
      comps.push({ id: compId, size, minx, miny, maxx, maxy });
      compId++;
    }
    if (!comps.length) return;

    const main = comps.reduce((a, b) => (a.size >= b.size ? a : b));
    const keep = new Uint8Array(compId); keep[main.id] = 1;
    for (const c of comps) {
      if (c.id === main.id || c.size < main.size * 0.02) continue;
      const ox = Math.min(main.maxx, c.maxx) - Math.max(main.minx, c.minx);
      const oy = Math.min(main.maxy, c.maxy) - Math.max(main.miny, c.miny);
      if (ox < 0 || oy < 0) continue;
      if ((ox + 1) * (oy + 1) / Math.min(main.size, c.size) >= 0.35) keep[c.id] = 1;
    }

    for (let i = 0; i < n; i++) {
      if (alpha[i] >= 110) {
        if (labels[i] !== -1 && !keep[labels[i]]) alpha[i] = 0;
        continue;
      }
      if (alpha[i] === 0) continue;
      const x = i % w, y = (i - x) / w;
      let kept = false;
      if (x > 0 && labels[i - 1] !== -1 && keep[labels[i - 1]]) kept = true;
      else if (x < w - 1 && labels[i + 1] !== -1 && keep[labels[i + 1]]) kept = true;
      else if (y > 0 && labels[i - w] !== -1 && keep[labels[i - w]]) kept = true;
      else if (y < h - 1 && labels[i + w] !== -1 && keep[labels[i + w]]) kept = true;
      if (!kept) alpha[i] = 0;
    }
  }

  /* Заполняем только крошечные «дырки» внутри вырезанного объекта */
  function fillTinyHoles(alpha, w, h, n) {
    const maxArea = Math.max(12, Math.round(n * 0.0004));
    const labels = new Int32Array(n).fill(-1);
    const q = new Int32Array(n);
    let compId = 0;
    for (let start = 0; start < n; start++) {
      if (alpha[start] >= 60 || labels[start] !== -1) continue;
      let head = 0, tail = 0, size = 0, border = false;
      q[tail++] = start; labels[start] = compId;
      while (head < tail) {
        const i = q[head++]; size++;
        const x = i % w, y = (i - x) / w;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;
        const nbs = [];
        if (x > 0) nbs.push(i - 1);
        if (x < w - 1) nbs.push(i + 1);
        if (y > 0) nbs.push(i - w);
        if (y < h - 1) nbs.push(i + w);
        for (const j of nbs)
          if (alpha[j] < 60 && labels[j] === -1) { labels[j] = compId; q[tail++] = j; }
      }
      if (!border && size <= maxArea)
        for (let k = 0; k < tail; k++) alpha[q[k]] = 255;
      compId++;
    }
  }

  /* ------------------------------------------------------------------ */
  /* DOM (только в браузере)                                             */
  /* ------------------------------------------------------------------ */
  if (typeof document === "undefined") {
    /* тестовый доступ для Node */
    globalThis.__PhotoEditorTest = { computeAlphaData, SENS, BGS };
    return;
  }

  const DEFAULT_STATE = {
    replace: false,     // заменять ли фон
    bg: "mint",
    custom: "#f1f3f1",
    sens: 1,
    shadow: true,       // убирать тени и осколки фона
    mainObject: true,   // оставлять только растение с горшком
    scale: 1,           // 0.5–2
    rot: 0,             // -15..15
    dx: 0, dy: 0,
  };

  let overlay, canvas, ctx, srcCanvas, cutoutCache = null, cutoutKey = "";
  let state = { ...DEFAULT_STATE };
  let onSaveCb = null;
  let raf = 0;

  function buildModal() {
    overlay = document.createElement("div");
    overlay.className = "pe-overlay";
    overlay.innerHTML = `
      <div class="pe-dialog" role="dialog" aria-label="Редактор фото">
        <div class="pe-dialog__head">
          <h3>Редактор фото</h3>
          <button class="pe-x" type="button" aria-label="Закрыть">✕</button>
        </div>
        <div class="pe-body">
          <div class="pe-stage">
            <canvas class="pe-canvas" width="${OUT_W}" height="${OUT_H}"></canvas>
            <p class="pe-note">Перетаскивайте растение мышкой или пальцем прямо в рамке.<br>
            Колесо мыши — масштаб. Рамка соответствует карточке каталога (3:4).</p>
          </div>
          <div class="pe-controls">
            <div class="pe-sec">
              <h4>Фон</h4>
              <label class="pe-toggle">
                <input type="checkbox" id="peReplace">
                Заменить белый фон
              </label>
              <div class="pe-swatches" id="peSwatches">
                ${BGS.map(b => `
                  <button type="button" class="pe-sw" data-bg="${b.id}" style="background:${b.css}">
                    <span>${b.label}</span>
                  </button>`).join("")}
                <label class="pe-sw pe-sw--custom" id="peCustomSw" title="Свой цвет">
                  <input type="color" id="peCustom" value="#f1f3f1">
                  <span>Свой цвет</span>
                </label>
              </div>
              <label class="pe-lab">Чувствительность к фону
                <select id="peSens" class="pe-select">
                  ${SENS.map((s, i) => `<option value="${i}">${s.label}</option>`).join("")}
                </select>
              </label>
              <label class="pe-toggle">
                <input type="checkbox" id="peShadow" checked>
                Вырезать фигуру — убрать тени и лишний фон
              </label>
              <label class="pe-toggle">
                <input type="checkbox" id="peMain" checked>
                Оставить только растение с горшком
              </label>
            </div>
            <div class="pe-sec">
              <h4>Выравнивание</h4>
              <div class="pe-row">
                <label for="peScale">Масштаб</label>
                <input type="range" id="peScale" min="50" max="200" value="100">
                <output id="peScaleOut">100%</output>
              </div>
              <div class="pe-row">
                <label for="peRot">Поворот</label>
                <input type="range" id="peRot" min="-15" max="15" value="0">
                <output id="peRotOut">0°</output>
              </div>
              <div class="pe-btns">
                <button type="button" class="prow__btn" id="peCenter">Центрировать</button>
                <button type="button" class="prow__btn" id="peReset">Сбросить всё</button>
              </div>
            </div>
          </div>
        </div>
        <div class="pe-dialog__foot">
          <button type="button" class="btn btn--ghost btn--sm" id="peCancel">Отмена</button>
          <button type="button" class="btn btn--sm" id="peSave">Сохранить фото</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    canvas = overlay.querySelector(".pe-canvas");
    ctx = canvas.getContext("2d");

    overlay.querySelector(".pe-x").addEventListener("click", close);
    overlay.querySelector("#peCancel").addEventListener("click", close);
    overlay.addEventListener("click", e => { if (e.target === overlay) close(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && overlay.classList.contains("open")) close(); });

    overlay.querySelector("#peReplace").addEventListener("change", e => {
      state.replace = e.target.checked;
      scheduleRender();
      syncBgUI();
    });
    overlay.querySelectorAll(".pe-sw[data-bg]").forEach(b => b.addEventListener("click", () => {
      state.bg = b.dataset.bg;
      if (!state.replace) { state.replace = true; overlay.querySelector("#peReplace").checked = true; }
      scheduleRender(); syncBgUI();
    }));
    overlay.querySelector("#peCustom").addEventListener("input", e => {
      state.custom = e.target.value;
      state.bg = "custom";
      if (!state.replace) { state.replace = true; overlay.querySelector("#peReplace").checked = true; }
      overlay.querySelector("#peCustomSw").style.background = state.custom;
      scheduleRender(); syncBgUI();
    });
    overlay.querySelector("#peSens").addEventListener("change", e => {
      state.sens = +e.target.value;
      scheduleRender();
    });
    overlay.querySelector("#peShadow").addEventListener("change", e => {
      state.shadow = e.target.checked;
      scheduleRender();
    });
    overlay.querySelector("#peMain").addEventListener("change", e => {
      state.mainObject = e.target.checked;
      scheduleRender();
    });
    overlay.querySelector("#peScale").addEventListener("input", e => {
      state.scale = +e.target.value / 100;
      overlay.querySelector("#peScaleOut").value = e.target.value + "%";
      scheduleRender();
    });
    overlay.querySelector("#peRot").addEventListener("input", e => {
      state.rot = +e.target.value;
      overlay.querySelector("#peRotOut").value = e.target.value + "°";
      scheduleRender();
    });
    overlay.querySelector("#peCenter").addEventListener("click", () => {
      state.dx = state.dy = 0; state.scale = 1; state.rot = 0;
      syncSliders(); scheduleRender();
    });
    overlay.querySelector("#peReset").addEventListener("click", () => {
      state = { ...DEFAULT_STATE };
      syncAll(); scheduleRender();
    });
    overlay.querySelector("#peSave").addEventListener("click", () => {
      render();
      const dataURL = canvas.toDataURL("image/jpeg", 0.9);
      if (onSaveCb) onSaveCb({ dataURL, state: { ...state } });
      close();
    });

    /* перетаскивание растения по рамке */
    let drag = null;
    canvas.addEventListener("pointerdown", e => {
      canvas.setPointerCapture(e.pointerId);
      const r = canvas.getBoundingClientRect();
      drag = { x: e.clientX, y: e.clientY, k: canvas.width / r.width };
      canvas.classList.add("dragging");
    });
    canvas.addEventListener("pointermove", e => {
      if (!drag) return;
      state.dx += (e.clientX - drag.x) * drag.k;
      state.dy += (e.clientY - drag.y) * drag.k;
      drag.x = e.clientX; drag.y = e.clientY;
      scheduleRender();
    });
    ["pointerup", "pointercancel"].forEach(ev => canvas.addEventListener(ev, () => {
      drag = null; canvas.classList.remove("dragging");
    }));
    canvas.addEventListener("wheel", e => {
      e.preventDefault();
      state.scale = Math.min(2, Math.max(0.5, state.scale * (e.deltaY < 0 ? 1.05 : 0.95)));
      syncSliders(); scheduleRender();
    }, { passive: false });
  }

  function syncSliders() {
    overlay.querySelector("#peScale").value = Math.round(state.scale * 100);
    overlay.querySelector("#peScaleOut").value = Math.round(state.scale * 100) + "%";
    overlay.querySelector("#peRot").value = state.rot;
    overlay.querySelector("#peRotOut").value = state.rot + "°";
  }
  function syncBgUI() {
    overlay.querySelectorAll(".pe-sw").forEach(b =>
      b.classList.toggle("active", state.replace && (b.dataset.bg === state.bg ||
        (b.id === "peCustomSw" && state.bg === "custom"))));
    overlay.querySelector("#peSwatches").style.opacity = state.replace ? "" : ".45";
    overlay.querySelector("#peCustomSw").style.background = state.custom;
  }
  function syncAll() {
    overlay.querySelector("#peReplace").checked = state.replace;
    overlay.querySelector("#peSens").value = state.sens;
    overlay.querySelector("#peShadow").checked = state.shadow !== false;
    overlay.querySelector("#peMain").checked = state.mainObject !== false;
    overlay.querySelector("#peCustom").value = state.custom;
    syncSliders(); syncBgUI();
  }

  /* ------------------------------------------------------------------ */
  /* Отрисовка                                                           */
  /* ------------------------------------------------------------------ */
  function ensureSrc(sourceURL, cb) {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_SRC / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      cb(c);
    };
    img.src = sourceURL;
  }

  function cutout() {
    const key = state.sens + "@" + (state.shadow !== false) + "@" + (state.mainObject !== false) + "@" + srcCanvas.width + "x" + srcCanvas.height;
    if (cutoutKey === key && cutoutCache) return cutoutCache;
    const { t1, t2 } = SENS[state.sens];
    const ictx = srcCanvas.getContext("2d");
    const img = ictx.getImageData(0, 0, srcCanvas.width, srcCanvas.height);
    const alpha = computeAlphaData(img, { t1, t2, shadow: state.shadow !== false, mainObject: state.mainObject !== false });
    const out = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
    for (let i = 0; i < alpha.length; i++) out.data[i * 4 + 3] = alpha[i];
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").putImageData(out, 0, 0);
    cutoutCache = c; cutoutKey = key;
    return c;
  }

  function render() {
    if (!srcCanvas) return;
    ctx.clearRect(0, 0, OUT_W, OUT_H);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, OUT_W, OUT_H);
    if (state.replace) paintBg(ctx, state);

    const src = state.replace ? cutout() : srcCanvas;
    const base = Math.min(FIT_W / src.width, FIT_H / src.height, 1.05);
    const s = base * state.scale;
    ctx.save();
    ctx.translate(OUT_W / 2 + state.dx, OUT_H / 2 + state.dy);
    ctx.rotate(state.rot * Math.PI / 180);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, -src.width * s / 2, -src.height * s / 2, src.width * s, src.height * s);
    ctx.restore();
  }
  function scheduleRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function close() {
    overlay.classList.remove("open");
  }

  /* ------------------------------------------------------------------ */
  /* Публичный API                                                       */
  /* ------------------------------------------------------------------ */
  function open({ source, state: saved, onSave }) {
    if (!overlay) buildModal();
    state = { ...DEFAULT_STATE, ...(saved || {}) };
    onSaveCb = onSave;
    cutoutCache = null; cutoutKey = "";
    syncAll();
    overlay.classList.add("open");
    ensureSrc(source, c => { srcCanvas = c; cutoutCache = null; cutoutKey = ""; render(); });
    render();
  }

  globalThis.PhotoEditor = { open };
  globalThis.__PhotoEditorTest = { computeAlphaData, SENS, BGS };
})();

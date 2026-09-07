/* =====================================================================
   АДМИН-ПАНЕЛЬ «ДарЛес»
   Добавление растений: фото перетаскиванием, поля, публикация на сайт.
   Работает в двух режимах:
     1) GitHub подключён — публикация в один клик (фото + js/products.js)
     2) Локальный режим — кнопка «Скачать файлы» и ручная загрузка
   ===================================================================== */

const CFG_KEY = "darles_admin_cfg";
const DRAFTS_KEY = "darles_drafts";

const cfg = Object.assign(
  { repo: "samagon90/lera-project", branch: "main", token: "" },
  JSON.parse(localStorage.getItem(CFG_KEY) || "{}")
);

let ghOK = false;          // подключён ли GitHub
let ghPush = false;        // есть ли право на запись
let photos = [];           // [{ dataURL, name }] — dataURL уже обработанного фото
let editingId = null;      // id растения, которое редактируем (или null)
let drafts = loadDrafts();
let recogCandidates = [];  // кандидаты автоопределения растения (без API)
let recogPrev = null;      // снимок полей до офлайн-заполнения

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* money() объявляет js/site.js — он загружается раньше этой панели.
   Раньше здесь было точно такое же объявление, и из-за него весь admin.js
   падал с SyntaxError «Identifier money has already been declared»,
   поэтому у своей функции другое имя. */
const fmtMoney = n => new Intl.NumberFormat("ru-RU").format(n) + " ₽";

function utf8b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64part = dataURL => dataURL.split(",")[1];

function saveCfg() {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]"); }
  catch { return []; }
}
function saveDrafts() {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); }
  catch (e) { alert("Черновик не сохранён в браузере (нет места), но он не потерян в открытой форме — опубликуйте или скачайте файлы."); }
}

function logLine(cls, text, html = false) {
  const log = $("publog");
  log.style.display = "block";
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (html) d.innerHTML = text; else d.textContent = text;
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}

/* ------------------------------------------------------------------ */
/* GitHub API                                                          */
/* ------------------------------------------------------------------ */
async function gh(path, { method = "GET", body } = {}) {
  const headers = { Accept: "application/vnd.github+json" };
  if (cfg.token) headers.Authorization = "Bearer " + cfg.token;
  const res = await fetch(`https://api.github.com/repos/${cfg.repo}/${path}`, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    let msg = res.status + " " + res.statusText;
    try { const j = await res.json(); if (j.message) msg = j.message; } catch {}
    throw new Error("GitHub: " + msg);
  }
  return res.status === 204 ? null : res.json();
}

async function checkConnection(silent = true) {
  const b = $("ghStatus");
  if (!cfg.token) {
    ghOK = ghPush = false;
    b.className = "badge badge--gray";
    b.textContent = "Локальный режим — публикация скачиванием файлов";
    $("tblNote").textContent = "GitHub не подключён: добавление через «Скачать файлы», изменение/удаление — через редактирование js/products.js.";
    return;
  }
  try {
    const r = await gh("");
    ghOK = true; ghPush = !!r.permissions?.push;
    b.className = "badge badge--" + (ghPush ? "green" : "red");
    b.textContent = ghPush
      ? `Подключено: ${cfg.repo} (${cfg.branch}) — публикация в один клик`
      : "Токен без права записи — только локальный режим";
    $("tblNote").textContent = ghPush ? "" : "Выдайте токену право Contents: Read and write.";
  } catch (e) {
    ghOK = ghPush = false;
    b.className = "badge badge--red";
    b.textContent = "GitHub не отвечает: " + e.message;
  }
  if (!silent) renderTable();
}

async function ghGetFile(path) {
  const r = await gh(`contents/${path}?ref=${cfg.branch}&t=${Date.now()}`);
  const text = new TextDecoder().decode(Utf8BytesFromB64(r.content));
  return { text, sha: r.sha };
}
function Utf8BytesFromB64(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
async function ghPutFile(path, contentB64, message, sha) {
  return gh(`contents/${path}`, {
    method: "PUT",
    body: { message, branch: cfg.branch, content: contentB64, ...(sha ? { sha } : {}) }
  });
}
async function ghDeleteFile(path, sha, message) {
  return gh(`contents/${path}`, { method: "DELETE", body: { message, branch: cfg.branch, sha } });
}

/* ------------------------------------------------------------------ */
/* Разбор и сборка js/products.js                                      */
/* ------------------------------------------------------------------ */
function parseProductsJS(text) {
  const m = text.match(/const\s+PRODUCTS\s*=\s*\[([\s\S]*?)\n\];/);
  if (!m) throw new Error("Не удалось найти список PRODUCTS в файле");
  try {
    return new Function("return [" + m[1] + "]")();
  } catch (e) {
    throw new Error("Файл products.js не разобрался: " + e.message);
  }
}

const FILE_HEADER = `/* =====================================================================
   КАТАЛОГ ТОВАРОВ ПИТОМНИКА «ДарЛес»
   ---------------------------------------------------------------------
   Проще всего менять этот файл через АДМИН-ПАНЕЛЬ: откройте admin.html —
   там фото добавляется перетаскиванием, а поля заполляются как форма.

   Каждое растение — блок { ... } в списке PRODUCTS, между блоками запятая.
     id  — уникальный номер (у нового: +1 к последнему)
     category — одно из: "hvoynye" | "listvennye" | "mnogoletnie"
     size  — размер (контейнер): "C3", "C5", "C7,5", "C10" или ""
     price — розничная цена числом, без пробелов и ₽
     stock — количество в наличии, штук (null — «уточняйте»)
     available — true/false: есть ли растение в продаже (false = «Нет в наличии»)
     image — путь к фото, например "images/catalog/23.jpg" ("" — фото пока нет)
     gallery — доп. фото: ["images/catalog/23-1.jpg"] или []
     short — короткая подпись в карточке
     description — абзацы разделяются пустой строкой ("" — описания пока нет)
   ===================================================================== */`;

function productToJS(p) {
  const q = s => JSON.stringify(s ?? "");
  const desc = String(p.description || "")
    .replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `  {
    id: ${Number(p.id)},
    name: ${q(p.name)},
    category: ${q(p.category)},
    size: ${q(p.size || "")},
    price: ${Number(p.price)},
    stock: ${p.stock == null || p.stock === "" ? "null" : Number(p.stock)},
    available: ${p.available === false ? "false" : "true"},
    image: ${q(p.image || "")},
    gallery: ${JSON.stringify(p.gallery || [])},
    short: ${q(p.short || "")},
    description: \`${desc}\`
  }`;
}

function productsToJS(products) {
  return `${FILE_HEADER}

const PRODUCTS = [
${products.map(productToJS).join(",\n")}
];

/* Названия категорий — можно менять подписи, но НЕ ключи */
const CATEGORIES = {
  hvoynye:     { title: "Хвойные",     icon: "images/site/7.jpg" },
  listvennye:  { title: "Лиственные",  icon: "images/site/8.jpg" },
  mnogoletnie: { title: "Многолетние", icon: "images/site/9.jpg" }
};
`;
}

/* ------------------------------------------------------------------ */
/* Автообработка фото: обрезка белых полей + холст 3:4 (1200x1600)     */
/* ------------------------------------------------------------------ */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Не удалось открыть изображение"));
    img.src = url;
  });
}

async function normalizeImage(file, trim) {
  const img = await loadImage(file);
  const W = 1200, H = 1600, M = 46, INSET = 4, MAX_UP = 1.05;

  // уменьшаем исходник до 1600px по большей стороне (для скорости)
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c1 = document.createElement("canvas");
  c1.width = Math.max(1, Math.round(img.width * k));
  c1.height = Math.max(1, Math.round(img.height * k));
  c1.getContext("2d").drawImage(img, 0, 0, c1.width, c1.height);

  let { width: cw, height: ch } = c1;
  let sx = 0, sy = 0;

  if (trim) {
    const d = c1.getContext("2d").getImageData(0, 0, cw, ch).data;
    let l = cw, t = ch, r = 0, b = 0;
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const i = (y * cw + x) * 4;
        if (Math.abs(d[i] - 255) > 16 || Math.abs(d[i + 1] - 255) > 16 || Math.abs(d[i + 2] - 255) > 16) {
          if (x < l) l = x; if (x > r) r = x;
          if (y < t) t = y; if (y > b) b = y;
        }
      }
    }
    if (r > l && b > t) {
      l = Math.min(l + INSET, cw - 1); t = Math.min(t + INSET, ch - 1);
      r = Math.max(r - INSET, 1);     b = Math.max(b - INSET, 1);
      sx = l; sy = t; cw = r - l + 1; ch = b - t + 1;
    }
  }

  const boxW = W - 2 * M, boxH = H - 2 * M;
  const scale = Math.min(Math.min(boxW / cw, boxH / ch), MAX_UP);
  const dw = Math.max(1, Math.round(cw * scale)), dh = Math.max(1, Math.round(ch * scale));

  const c2 = document.createElement("canvas");
  c2.width = W; c2.height = H;
  const ctx = c2.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c1, sx, sy, cw, ch, (W - dw) / 2, (H - dh) / 2, dw, dh);

  URL.revokeObjectURL(img.src);
  return await new Promise(res => c2.toBlob(res, "image/jpeg", 0.9));
}

function blobToDataURL(blob) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

/* ------------------------------------------------------------------ */
/* Дропзона                                                            */
/* ------------------------------------------------------------------ */
const dz = () => $("dropzone");

function initDropzone() {
  dz().addEventListener("click", e => {
    if (e.target.closest(".dz-thumb__x, .dz-thumb__edit")) return;
    $("fileInput").click();
  });
  $("fileInput").addEventListener("change", e => addFiles([...e.target.files]));
  ["dragenter", "dragover"].forEach(ev => dz().addEventListener(ev, e => {
    e.preventDefault(); dz().classList.add("dragover");
  }));
  ["dragleave", "drop"].forEach(ev => dz().addEventListener(ev, e => {
    e.preventDefault(); dz().classList.remove("dragover");
  }));
  dz().addEventListener("drop", e => addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith("image/"))));
  document.addEventListener("paste", e => {
    const files = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith("image/"));
    if (files.length && closestToForm(e.target)) { addFiles(files); e.preventDefault(); }
  });
}
function closestToForm(el) { return !el || !el.classList || !el.closest("textarea, input"); }

async function addFiles(files) {
  for (const f of files) {
    try {
      logLine("", `Обрабатываю фото «${f.name}»…`);
      let dataURL;
      if ($("optTrim").checked) {
        const blob = await normalizeImage(f, true);
        dataURL = await blobToDataURL(blob);
      } else {
        dataURL = await blobToDataURL(f);
      }
      photos.push({ originalDataURL: dataURL, dataURL, state: null, name: f.name || "" });
      logLine("ok", `Фото готово (${photos.length === 1 ? "главное" : "доп. " + (photos.length - 1)}). Кнопка ✏️ — сменить фон и выровнять.`);
      if (photos.length === 1) setTimeout(() => recognizePhoto(photos[0]), 160);
    } catch (e) {
      logLine("err", "Ошибка фото: " + e.message);
    }
    renderThumbs(); renderPreview(); renderTable();
  }
}

/* Редактор фото: фон + выравнивание */
function openEditor(i) {
  if (typeof PhotoEditor === "undefined") { alert("Редактор фото не загрузился — обновите страницу."); return; }
  const p = photos[i];
  PhotoEditor.open({
    source: p.originalDataURL || p.dataURL,
    state: p.state,
    onSave: ({ dataURL, state }) => {
      p.dataURL = dataURL;
      p.state = state;
      renderThumbs(); renderPreview();
      logLine("ok", "Фото отредактировано (фон/выравнивание)");
    }
  });
}

function renderThumbs() {
  $("dzThumbs").innerHTML = photos.map((p, i) => `
    <div class="dz-thumb ${i === 0 ? "dz-thumb--main" : ""}">
      <img src="${p.dataURL}" alt="">
      <button class="dz-thumb__edit" type="button" data-i="${i}" title="Редактировать: фон, выравнивание">✏️</button>
      <button class="dz-thumb__x" type="button" data-i="${i}" title="Убрать">✕</button>
    </div>`).join("");
  $("dzThumbs").querySelectorAll(".dz-thumb__x").forEach(b =>
    b.addEventListener("click", () => {
      photos.splice(+b.dataset.i, 1);
      if (!photos.length) hideOfflineRecognition();
      renderThumbs(); renderPreview();
    }));
  $("dzThumbs").querySelectorAll(".dz-thumb__edit").forEach(b =>
    b.addEventListener("click", () => openEditor(+b.dataset.i)));
}

/* ------------------------------------------------------------------ */
/* Офлайн-распознавание растения по фото (без API)                      */
/* ------------------------------------------------------------------ */
async function recognizePhoto(photo) {
  if (typeof PlantID === "undefined") return;
  try {
    const res = await PlantID.detect(photo.dataURL, photo.name || "");
    if (!res.candidates || !res.candidates.length) {
      hideOfflineRecognition();
      logLine("", "Определение без API: уверенного совпадения нет — заполните название и описание вручную.");
      return;
    }
    showOfflineRecognition(res);
  } catch (e) {
    logLine("err", "Определение без API: " + e.message);
  }
}

function showOfflineRecognition(res) {
  recogCandidates = res.candidates;
  const cat = key => ({ hvoynye: "хвойное", listvennye: "лиственное", mnogoletnie: "многолетнее" }[key] || key);
  const box = $("offlineIdPanel");
  if (!box) return;
  box.style.display = "block";
  $("idMatch").innerHTML =
    `<option value="-1">Не заполнять — ввести вручную</option>` +
    recogCandidates.map((c, i) =>
      `<option value="${i}">${esc(c.product.name)} · ${cat(c.product.category)} · ${Math.round(c.confidence * 100)}%</option>`
    ).join("");
  const top = recogCandidates[0];
  $("idMatch").value = "0";
  recogPrev = collectForm();
  applyOfflineProduct(top.product);
  logLine("ok", "Без API: похоже на «" + top.product.name + "» (≈ " + Math.round(top.confidence * 100) + "%). Проверьте поля, при необходимости выберите другой вариант.");
  $("btnOfflineUndo").onclick = () => {
    if (!recogPrev) return;
    $("fName").value = recogPrev.name || "";
    $("fCategory").value = recogPrev.category || "hvoynye";
    $("fShort").value = recogPrev.short || "";
    $("fDesc").value = recogPrev.description || "";
    renderPreview();
    logLine("", "Заполнение без API отменено.");
  };
  $("btnOfflineHide").onclick = () => { $("offlineIdPanel").style.display = "none"; };
}

function applyOfflineProduct(p) {
  $("fName").value = p.name;
  $("fCategory").value = p.category;
  $("fShort").value = p.short || "";
  $("fDesc").value = p.description || "";
  renderPreview();
}

function hideOfflineRecognition() {
  recogCandidates = [];
  const box = $("offlineIdPanel");
  if (box) box.style.display = "none";
}

/* ---------- поиск описания в интернете (без API, открывает поисковик) ---------- */
function currentRecogProduct() {
  return recogCandidates[0]?.product || (editingId != null ? PRODUCTS.find(x => x.id === editingId) : null);
}
function publicImageUrl(path) {
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  return "https://samagon90.github.io/lera-project/" + String(path).replace(/^\.?\//, "");
}
function openSearch(engine, query) {
  const q = encodeURIComponent(query);
  const urls = {
    google: "https://www.google.com/search?q=" + q,
    yandex: "https://yandex.ru/search/?text=" + q,
    lens: "https://lens.google.com/uploadbyurl?url=" + q,
    yandexPhoto: "https://yandex.ru/images/search?rpt=imageview&url=" + q,
  };
  window.open(urls[engine] || urls.google, "_blank", "noopener");
}
function searchSelectedProduct(engine) {
  const p = currentRecogProduct();
  if (!p || !p.name) { logLine("", "Сначала выберите растение — поиск нечего искать."); return; }
  openSearch(engine, p.name + " растение описание уход посадка");
}
function searchPhoto(engine) {
  const p = currentRecogProduct();
  const img = publicImageUrl(p?.image);
  if (!img) {
    logLine("", "Поиск по фото возможен после публикации фото (нужна публичная ссылка). Открываю поиск по названию.");
    searchSelectedProduct(engine === "lens" ? "google" : "yandex");
    return;
  }
  openSearch(engine, img);
}

/* ------------------------------------------------------------------ */
/* Форма и предпросмотр                                               */
/* ------------------------------------------------------------------ */
function collectForm() {
  const name = $("fName").value.trim();
  const price = parseInt($("fPrice").value, 10);
  const stock = parseInt($("fStock") ? $("fStock").value : "", 10);
  return {
    name,
    category: $("fCategory").value,
    size: $("fSize") ? $("fSize").value.trim() : "",
    price: isNaN(price) ? null : price,
    stock: isNaN(stock) ? null : Math.max(0, stock),
    available: $("fAvailable") ? $("fAvailable").checked : true,
    short: $("fShort").value.trim(),
    description: $("fDesc").value.trim(),
  };
}

function renderPreview() {
  const f = collectForm();
  const img = photos[0]?.dataURL || NO_PHOTO;
  const cat = catTitle(f.category);
  const out = f.available === false;
  const st = stockInfo(f);
  $("preview").innerHTML = `
    <a class="card ${out ? "card--out" : ""}" href="javascript:void(0)">
      <div class="card__img">
        <img src="${img}" alt="">
        <span class="card__tag">${cat}</span>
        ${out ? '<span class="card__out">Нет в наличии</span>'
              : (f.size ? `<span class="card__size">${esc(f.size)}</span>` : "")}
      </div>
      <div class="card__body">
        <div class="card__name">${esc(f.name) || "Название растения"}</div>
        <div class="card__short">${esc(f.short) || (f.size ? "Контейнер " + esc(f.size) : "короткая подпись")}</div>
        <div class="card__bottom">
          ${out
            ? '<span class="card__price card__price--out">Нет в наличии</span>'
            : `<span class="card__price">${f.price != null ? fmtMoney(f.price) : "— ₽"}</span>`}
          <span class="card__stock ${st.cls}">${st.text}</span>
        </div>
      </div>
    </a>
    <p class="muted small" style="margin-top:14px">${photos.length > 1 ? `Будет загружено фото: ${photos.length} (первое — главное).` : "Главное фото карточки — слева вверху."}</p>`;
}
["fName", "fCategory", "fSize", "fPrice", "fStock", "fShort", "fDesc"].forEach(id =>
  document.addEventListener("input", e => { if (e.target.id === id) renderPreview(); }));
if ($("fAvailable")) $("fAvailable").addEventListener("change", renderPreview);

function validate(f, isNew) {
  const errs = [];
  if (!f.name) errs.push("укажите название");
  if (f.price == null || f.price < 0) errs.push("укажите цену цифрами");
  if (isNew && !photos.length) errs.push("добавьте фото (перетащите или Ctrl+V)");
  return errs;
}

function resetForm() {
  editingId = null;
  photos = [];
  ["fName", "fSize", "fPrice", "fStock", "fShort", "fDesc"].forEach(id => { if ($(id)) $(id).value = ""; });
  $("fCategory").value = "hvoynye";
  if ($("fAvailable")) $("fAvailable").checked = true;
  const aiBox = $("aiResult"); if (aiBox) aiBox.style.display = "none";
  aiPrev = null;
  hideOfflineRecognition(); recogPrev = null;
  $("btnReset").style.display = "none";
  $("formTitle").textContent = "Добавить растение";
  $("btnPublish").textContent = "Опубликовать на сайт";
  renderThumbs(); renderPreview();
}

/* ------------------------------------------------------------------ */
/* Таблица растений + черновики                                        */
/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* Таблица каталога: фото, название, категория, цена, наличие, действия  */
/* ------------------------------------------------------------------ */
function filteredProducts() {
  const q = ($("tblSearch")?.value || "").trim().toLowerCase();
  const cat = $("tblCat")?.value || "";
  const avail = $("tblAvail")?.value || "";
  let list = PRODUCTS.slice();
  if (cat) list = list.filter(p => p.category === cat);
  if (avail === "in") list = list.filter(p => inStock(p));
  if (avail === "out") list = list.filter(p => !inStock(p));
  const todo = $("tblTodo")?.value || "";
  if (todo === "nophoto") list = list.filter(p => !p.image);
  if (todo === "nodesc") list = list.filter(p => !String(p.description || "").trim());
  if (q) list = list.filter(p => (p.name + " " + (p.short || "") + " " + (p.size || "") + " id" + p.id).toLowerCase().includes(q));
  return list;
}

function catOptions(selected) {
  return ["hvoynye", "listvennye", "mnogoletnie"].map(c =>
    `<option value="${c}"${c === selected ? " selected" : ""}>${catTitle(c)}</option>`).join("");
}

function productRow(p) {
  const out = p.available === false;
  const photosCount = (p.gallery || []).length + 1;
  return `<tr class="ptable__row${out ? " ptable__row--out" : ""}" data-id="${p.id}">
    <td data-label="Фото">
      <a href="product.html?id=${p.id}" target="_blank" rel="noopener" title="Открыть карточку на сайте">
        <img class="ptable__img" src="${prodImage(p)}" alt="" loading="lazy">
      </a>
    </td>
    <td data-label="Название">
      <div class="ptable__name">${esc(p.name)}${p.image ? "" : '<span class="tag-todo">нет фото</span>'}${String(p.description || "").trim() ? "" : '<span class="tag-todo">нет описания</span>'}</div>
      <div class="ptable__meta">id ${p.id} · фото: ${p.image ? photosCount : 0}${out ? " · <b>нет в наличии</b>" : ""}</div>
    </td>
    <td data-label="Категория">
      <select class="ptable__select" data-act="cat" data-id="${p.id}">${catOptions(p.category)}</select>
    </td>
    <td data-label="Размер">
      <input class="ptable__size" type="text" list="sizeList" value="${esc(p.size || "")}" placeholder="—"
             data-act="size" data-id="${p.id}" autocomplete="off">
    </td>
    <td data-label="Цена, ₽">
      <input class="ptable__price" type="number" min="0" step="50" value="${Number(p.price) || 0}" data-act="price" data-id="${p.id}">
    </td>
    <td data-label="Кол-во, шт">
      <input class="ptable__stock" type="number" min="0" step="1" inputmode="numeric"
             value="${p.stock == null ? "" : Number(p.stock)}" placeholder="—"
             data-act="stock" data-id="${p.id}" title="Количество в наличии. Пусто — «уточняйте», 0 — «Под заказ»">
    </td>
    <td data-label="Наличие">
      <label class="switch" title="${out ? "Сейчас на сайте: «Нет в наличии»" : "Сейчас на сайте: в продаже"}">
        <input type="checkbox" data-act="avail" data-id="${p.id}"${out ? "" : " checked"}>
        <span class="switch__track"><span class="switch__dot"></span></span>
        <span class="switch__text">${out ? "нет" : "есть"}</span>
      </label>
    </td>
    <td data-label="Действия" class="ptable__actions">
      <button class="prow__btn" data-act="edit" data-id="${p.id}">Изменить</button>
      <button class="prow__btn" data-act="ai" data-id="${p.id}" title="Определить растение по фото и заполнить описание">🤖 ИИ</button>
      <button class="prow__btn prow__btn--danger" data-act="del" data-id="${p.id}">Удалить</button>
    </td>
  </tr>`;
}

function draftRow(d, i) {
  return `<tr class="ptable__row ptable__row--draft">
    <td data-label="Фото"><img class="ptable__img" src="${d.imageDataURL || "images/site/7.jpg"}" alt=""></td>
    <td data-label="Название">
      <div class="ptable__name">${esc(d.name || "Без названия")}<span class="tag-draft">черновик</span></div>
      <div class="ptable__meta">${catTitle(d.category)}${d.price != null ? " · " + fmtMoney(d.price) : ""}</div>
    </td>
    <td data-label="Категория">${catTitle(d.category)}</td>
    <td data-label="Размер">${esc(d.size || "—")}</td>
    <td data-label="Цена, ₽">${d.price != null ? fmtMoney(d.price) : "—"}</td>
    <td data-label="Кол-во, шт">${d.stock == null ? "—" : d.stock}</td>
    <td data-label="Наличие">${d.available === false ? "нет" : "—"}</td>
    <td data-label="Действия" class="ptable__actions">
      <button class="prow__btn" data-act="editdraft" data-i="${i}">В форму</button>
      <button class="prow__btn prow__btn--danger" data-act="deldraft" data-i="${i}">Удалить</button>
    </td>
  </tr>`;
}

function renderTable() {
  const list = filteredProducts();
  const outCount = PRODUCTS.filter(p => !inStock(p)).length;
  const noPhotoCount = PRODUCTS.filter(p => !p.image).length;
  $("prodCount").textContent =
    `— ${PRODUCTS.length} на сайте` +
    (outCount ? `, из них ${outCount} нет в наличии` : "") +
    (noPhotoCount ? `, без фото ${noPhotoCount}` : "") +
    (drafts.length ? `, черновиков: ${drafts.length}` : "") +
    (list.length !== PRODUCTS.length ? ` · показано: ${list.length}` : "");

  const body = [
    ...drafts.map((d, i) => draftRow(d, i)),
    ...list.map(p => productRow(p))
  ].join("");

  $("prodTable").innerHTML = `
    <table class="ptable">
      <thead><tr>
        <th class="ptable__c-photo">Фото</th>
        <th>Название</th>
        <th class="ptable__c-cat">Категория</th>
        <th class="ptable__c-size">Размер</th>
        <th class="ptable__c-price">Цена, ₽</th>
        <th class="ptable__c-stock">Кол-во, шт</th>
        <th class="ptable__c-avail">Наличие</th>
        <th class="ptable__c-act">Действия</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;

  bindTable();
}

function bindTable() {
  $("prodTable").querySelectorAll("[data-act]").forEach(el => {
    const act = el.dataset.act;
    const id = el.dataset.id ? +el.dataset.id : null;

    if (act === "avail" || act === "cat" || act === "price" || act === "stock" || act === "size") {
      el.addEventListener("change", () => {
        if (act === "avail") toggleAvailable(id, el.checked);
        if (act === "cat") updateField(id, { category: el.value }, "категория: " + catTitle(el.value));
        if (act === "price") {
          const v = parseInt(el.value, 10);
          if (isNaN(v) || v < 0) {
            alert("Цена — число (например 1300), без пробелов и без знака ₽.");
            renderTable();
            return;
          }
          updateField(id, { price: v }, "цена: " + fmtMoney(v));
        }
        if (act === "size") {
          const v = el.value.trim().replace(/^[Сс]/, "C").replace(/\s+/g, "");
          updateField(id, { size: v }, v ? "размер: " + v : "размер убран");
        }
        if (act === "stock") {
          const raw = el.value.trim();
          if (raw === "") {
            updateField(id, { stock: null }, "количество: уточняйте");
            return;
          }
          const v = parseInt(raw, 10);
          if (isNaN(v) || v < 0) {
            alert("Количество — целое число штук (например 120). Пустое поле = «уточняйте».");
            renderTable();
            return;
          }
          const p = PRODUCTS.find(x => x.id === id);
          const patch = { stock: v };
          // 0 штук — растение автоматически уходит в «нет в наличии», больше 0 — возвращается
          if (v === 0 && p && p.available !== false) patch.available = false;
          if (v > 0 && p && p.available === false) patch.available = true;
          updateField(id, patch, "количество: " + v + " шт");
        }
      });
      if (act === "price" || act === "stock" || act === "size")
        el.addEventListener("keydown", e => { if (e.key === "Enter") el.blur(); });
      return;
    }

    el.addEventListener("click", () => {
      if (act === "edit") startEdit(id);
      if (act === "del") deleteProduct(id);
      if (act === "ai") aiForProduct(id);
      if (act === "editdraft") loadDraftToForm(+el.dataset.i);
      if (act === "deldraft") {
        if (confirm("Удалить черновик из браузера?")) {
          drafts.splice(+el.dataset.i, 1); saveDrafts(); renderTable();
        }
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/* Правки из таблицы: наличие, цена, категория                          */
/* ------------------------------------------------------------------ */
async function updateField(id, patch, label) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  const ok = await patchOnGitHub(id, patch, `[admin] ${p.name} — ${label}`);
  if (ok) Object.assign(p, patch);
  renderTable();
}

async function toggleAvailable(id, value) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  await updateField(id, { available: !!value }, value ? "вернули в наличие" : "сняли с наличия");
}

async function setAllAvailable(value) {
  if (!PRODUCTS.length) return;
  if (!confirm(value
      ? "Включить наличие у ВСЕХ растений каталога?"
      : "Выключить наличие у ВСЕХ растений каталога (на сайте появится «Нет в наличии»)?"))
    return;
  if (!ghPush) {
    alert("GitHub не подключён — изменить каталог нельзя.\n\n" +
      "Откройте «Настройки публикации» и вставьте токен с правом Contents: Read and write.");
    return;
  }
  $("publog").style.display = "block";
  try {
    logLine("", "Читаю js/products.js с GitHub…");
    const { text, sha } = await ghGetFile("js/products.js");
    const products = parseProductsJS(text);
    products.forEach(x => { x.available = !!value; });
    await ghPutFile("js/products.js", utf8b64(productsToJS(products)),
      `[admin] Наличие: ${value ? "включили всем" : "выключили всем"}`, sha);
    PRODUCTS.forEach(x => { x.available = !!value; });
    renderTable();
    logLine("ok", value ? "Всем растениям включено наличие." : "Все растения сняты с наличия.");
    logLine("", "Изменится на сайте через 1–2 минуты.");
  } catch (e) {
    logLine("err", "Ошибка: " + e.message);
    renderTable();
  }
}

/* Одна и та же операция: прочитать products.js → изменить → записать */
async function patchOnGitHub(id, patch, message) {
  if (!ghPush) {
    alert("GitHub не подключён — изменить товар на сайте нельзя.\n\n" +
      "Откройте «Настройки публикации», вставьте токен с правом Contents: Read and write — " +
      "и правки из таблицы будут уходить на сайт сами.");
    return false;
  }
  $("publog").style.display = "block";
  try {
    logLine("", "Сохраняю: " + message.replace("[admin] ", "") + "…");
    const { text, sha } = await ghGetFile("js/products.js");
    const products = parseProductsJS(text);
    const target = products.find(x => x.id === id);
    if (!target) throw new Error("растение не найдено в файле products.js");
    Object.assign(target, patch);
    await ghPutFile("js/products.js", utf8b64(productsToJS(products)), message, sha);
    logLine("ok", "Готово — на сайте появится через 1–2 минуты.");
    return true;
  } catch (e) {
    logLine("err", "Ошибка: " + e.message);
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* ИИ-помощник: определяет растение по фото                             */
/* ------------------------------------------------------------------ */
let aiPrev = null;   // снимок полей до заполнения ИИ (для кнопки «Отменить»)

function aiReady() { return typeof AdminAI !== "undefined" && AdminAI.isReady(); }

function renderAiHint() {
  const el = $("aiHint");
  if (!el) return;
  el.textContent = aiReady()
    ? `ИИ: ${AdminAI.providerLabel()} · ${AdminAI.model()}`
    : "ИИ не настроен — нажмите «Настроить ИИ»";
}

function openAiSettings() {
  const s = $("settings");
  if (s) {
    s.style.display = "block";
    s.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  setTimeout(() => { try { $("aiKey").focus(); } catch (e) {} }, 400);
  if (!aiReady() && typeof AdminAI !== "undefined") alert(AdminAI.requirement());
}

function showAiResult(data) {
  const box = $("aiResult");
  if (!box) return;
  const pct = Math.round((data.confidence || 0) * 100);
  box.style.display = "block";
  box.innerHTML = `
    <div class="ai-result__head">
      <b>🤖 ИИ заполнил поля</b>
      <span class="ai-result__conf">уверенность: ${pct}%</span>
    </div>
    <p class="muted small">${
      data.comment
        ? esc(data.comment)
        : (data.latin ? "Латинское название: " + esc(data.latin) : "Проверьте текст — особенно сорт и цифры.")
    }</p>
    <div class="ai-result__actions">
      <button class="btn btn--ghost btn--sm" id="btnAiUndo" type="button">Отменить заполнение</button>
      <button class="btn btn--ghost btn--sm" id="btnAiHide" type="button">Скрыть</button>
    </div>`;
  $("btnAiUndo").addEventListener("click", undoAi);
  $("btnAiHide").addEventListener("click", () => { box.style.display = "none"; });
}

function undoAi() {
  if (!aiPrev) return;
  $("fName").value = aiPrev.name;
  $("fCategory").value = aiPrev.category;
  $("fShort").value = aiPrev.short;
  $("fDesc").value = aiPrev.description;
  aiPrev = null;
  const box = $("aiResult"); if (box) box.style.display = "none";
  renderPreview();
  logLine("", "Заполнение ИИ отменено — вернулся ваш текст.");
}

/* Заполнить форму по фото, которое уже лежит в дропзоне */
async function aiFillForm() {
  if (!photos.length) {
    alert("Сначала добавьте фото — перетащите его в рамку выше, выберите файлом или вставьте Ctrl+V.");
    return;
  }
  if (!aiReady()) { openAiSettings(); return; }

  const btn = $("btnAI");
  const oldText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "🤖 ИИ смотрит фото…";
  $("publog").style.display = "block";
  logLine("", `Отправляю фото в ИИ (${AdminAI.providerLabel()}, ${AdminAI.model()})…`);
  try {
    const data = await AdminAI.analyze(photos[0].dataURL);
    if (!data.name && !data.description)
      throw new Error("ИИ не вернул название" + (data.comment ? " (" + data.comment + ")" : ""));
    if (!data.confidence)
      logLine("", "Внимание: ИИ не уверен в определении." + (data.comment ? " " + data.comment : ""));
    aiPrev = collectForm();
    if (data.name) $("fName").value = data.name;
    if (data.category) $("fCategory").value = data.category;
    if (data.short) $("fShort").value = data.short;
    if (data.description) $("fDesc").value = data.description;
    showAiResult(data);
    renderPreview();
    logLine("ok", "Поля заполнены. Проверьте текст, поправьте что нужно — и публикуйте.");
  } catch (e) {
    logLine("err", "ИИ: " + e.message);
    alert("ИИ не справился: " + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = oldText;
  }
}

/* Определить растение по фото уже опубликованного товара */
async function aiForProduct(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  if (!aiReady()) { openAiSettings(); return; }
  if (!confirm(`Определить растение по фото «${p.name}»?\n\n` +
      `Форма заполнится заново: название, категория, подпись и описание. ` +
      `Вы всё проверите и нажмёте «Сохранить изменения».`))
    return;

  $("publog").style.display = "block";
  logLine("", "ИИ смотрит фото «" + p.name + "»…");
  try {
    const data = await AdminAI.analyzeUrl(p.image);
    if (!data.name && !data.description)
      throw new Error("ИИ не вернул название" + (data.comment ? " (" + data.comment + ")" : ""));
    startEdit(id);
    aiPrev = collectForm();
    if (data.name) $("fName").value = data.name;
    if (data.category) $("fCategory").value = data.category;
    if (data.short) $("fShort").value = data.short;
    if (data.description) $("fDesc").value = data.description;
    showAiResult(data);
    logLine("ok", "Готово. Проверьте поля и нажмите «Сохранить изменения».");
  } catch (e) {
    logLine("err", "ИИ: " + e.message);
    alert("ИИ не справился: " + e.message);
  }
}

/* Настройки ИИ в блоке «Настройки публикации» */
function renderAiSettings() {
  if (typeof AdminAI === "undefined") return;
  const c = AdminAI.get();
  $("aiProvider").value = c.provider;
  $("aiModel").value = c.model || "";
  $("aiModel").placeholder = AdminAI.DEFAULT_MODEL[c.provider] || "модель";
  $("aiKey").value = c.key || "";
  $("aiModelList").innerHTML = AdminAI.models().map(m => `<option value="${m}"></option>`).join("");
  renderAiStatus();
}

function renderAiStatus() {
  const note = $("aiTestNote");
  if (note) {
    note.textContent = aiReady()
      ? `Подключено: ${AdminAI.providerLabel()} · модель ${AdminAI.model()}`
      : "ИИ не подключён: укажите модель и ключ.";
  }
  renderAiHint();
}

const catTitle = key => ({ hvoynye: "Хвойные", listvennye: "Лиственные", mnogoletnie: "Многолетние" }[key] || key);

function startEdit(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p) return;
  editingId = id;
  $("fName").value = p.name;
  $("fCategory").value = p.category;
  if ($("fSize")) $("fSize").value = p.size || "";
  $("fPrice").value = p.price;
  if ($("fStock")) $("fStock").value = p.stock == null ? "" : p.stock;
  $("fShort").value = p.short || "";
  $("fDesc").value = p.description || "";
  if ($("fAvailable")) $("fAvailable").checked = p.available !== false;
  photos = [];
  hideOfflineRecognition(); recogPrev = null;
  renderThumbs();
  // предпросмотр с текущим фото с сайта
  $("preview").innerHTML = `
    <p class="muted small" style="margin-bottom:12px">Редактируется существующее растение. Фото останется прежним — если не перетащите новое.</p>
    ${cardMarkup(p)}`;
  $("btnReset").style.display = "";
  $("formTitle").textContent = "Изменить растение: " + p.name;
  $("btnPublish").textContent = "Сохранить изменения";
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function cardMarkup(p) {
  const cat = catTitle(p.category);
  const st = stockInfo(p);
  return `<a class="card" href="javascript:void(0)">
    <div class="card__img"><img src="${prodImage(p)}" alt=""><span class="card__tag">${cat}</span>
      ${p.size ? `<span class="card__size">${esc(p.size)}</span>` : ""}</div>
    <div class="card__body">
      <div class="card__name">${esc(p.name)}</div>
      <div class="card__short">${esc(p.short || (p.size ? "Контейнер " + p.size : ""))}</div>
      <div class="card__bottom">
        <span class="card__price">${fmtMoney(p.price)}</span>
        <span class="card__stock ${st.cls}">${st.text}</span>
      </div>
    </div>
  </a>`;
}

function loadDraftToForm(i) {
  const d = drafts[i];
  $("fName").value = d.name; $("fCategory").value = d.category;
  $("fPrice").value = d.price ?? ""; $("fShort").value = d.short || "";
  if ($("fSize")) $("fSize").value = d.size || "";
  if ($("fStock")) $("fStock").value = d.stock == null ? "" : d.stock;
  $("fDesc").value = d.description || "";
  photos = [
    ...(d.imageDataURL ? [{ originalDataURL: d.imageDataURL, dataURL: d.imageDataURL, state: null, name: d.name || "" }] : []),
    ...(d.galleryDataURLs || []).map(u => ({ originalDataURL: u, dataURL: u, state: null, name: "" }))
  ];
  hideOfflineRecognition(); recogPrev = null;
  renderThumbs(); renderPreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ------------------------------------------------------------------ */
/* Публикация через GitHub                                             */
/* ------------------------------------------------------------------ */
async function publish() {
  const f = collectForm();
  const errs = validate(f, editingId == null);
  if (errs.length) { alert("Проверьте форму: " + errs.join("; ") + "."); return; }

  if (!ghPush) {
    alert("GitHub не подключён (нет токена с правом записи).\n\nИспользуйте кнопку «Скачать файлы» — она подготовит всё для загрузки в репозиторий.");
    downloadFiles();
    return;
  }

  $("publog").innerHTML = ""; $("btnPublish").disabled = true;
  try {
    // 1. актуальный products.js
    logLine("", "Читаю js/products.js с GitHub…");
    const { text, sha } = await ghGetFile("js/products.js");
    let products = parseProductsJS(text);
    let id = editingId;

    if (editingId == null) {
      id = Math.max(0, ...products.map(p => p.id)) + 1;
    }

    // 2. фото: главное (перезапись при редактировании) + галерея
    const mainPath = `images/catalog/${id}.jpg`;
    if (photos.length) {
      if (editingId != null) {
        logLine("", "Загружаю новое главное фото (замена)…");
        let shaImg;
        try { shaImg = (await gh(`contents/${mainPath}?ref=${cfg.branch}`)).sha; } catch { shaImg = undefined; }
        await ghPutFile(mainPath, b64part(photos[0].dataURL), `[admin] Фото: ${f.name}`, shaImg);
      } else {
        logLine("", "Загружаю главное фото…");
        await ghPutFile(mainPath, b64part(photos[0].dataURL), `[admin] Фото: ${f.name}`);
      }
      logLine("ok", "Главное фото загружено");
    }
    const gallery = [];
    for (let i = 1; i < photos.length; i++) {
      const gPath = `images/catalog/${id}-${i}.jpg`;
      logLine("", `Загружаю доп. фото ${i}…`);
      await ghPutFile(gPath, b64part(photos[i].dataURL), `[admin] Доп. фото: ${f.name}`);
      gallery.push(gPath);
      logLine("ok", `Доп. фото ${i} загружено`);
    }

    // 3. запись в products.js
    const oldEntry = editingId != null ? products.find(p => p.id === editingId) : null;
    const entry = {
      id,
      name: f.name, category: f.category, price: f.price,
      size: f.size, stock: f.stock,
      available: f.available !== false,
      image: (editingId != null && !photos.length)
        ? (oldEntry ? oldEntry.image || "" : mainPath)   // фото не меняли — оставляем как было ("" = фото ещё нет)
        : mainPath,
      gallery: gallery.length ? gallery : (oldEntry?.gallery || []),
      short: f.short, description: f.description
    };
    if (oldEntry) Object.assign(oldEntry, entry);
    else products.push(entry);
    logLine("", "Обновляю js/products.js…");
    await ghPutFile("js/products.js", utf8b64(productsToJS(products)),
      editingId != null ? `[admin] Изменено: ${f.name}` : `[admin] Добавлено растение: ${f.name}`, sha);
    logLine("ok", "products.js обновлён");

    logLine("ok", editingId != null
      ? `Готово! Изменения появятся на сайте через 1–2 минуты.`
      : `Готово! «${f.name}» появилось на сайте (через 1–2 минуты, пока пересобирается GitHub Pages).`);
    logLine("", `<a href="catalog.html?cat=${f.category}" target="_blank">Открыть каталог →</a>`, true);

    resetForm();
    // обновляем локальную копию для таблицы
    try {
      PRODUCTS.length = 0;
      products.forEach(p => PRODUCTS.push(p));
    } catch {}
    renderTable();
  } catch (e) {
    logLine("err", "Ошибка публикации: " + e.message);
    logLine("", "Ничего не потеряно — попробуйте ещё раз или используйте «Скачать файлы».");
  }
  $("btnPublish").disabled = false;
}

/* ------------------------------------------------------------------ */
/* Удаление растения                                                   */
/* ------------------------------------------------------------------ */
async function deleteProduct(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p || !confirm(`Удалить «${p.name}» с сайта?`)) return;

  if (!ghPush) {
    alert("В локальном режиме удаление недоступно.\n\nОткройте js/products.js в репозитории и удалите блок растения (см. ШПАРГАЛКА.md).");
    return;
  }
  $("publog").innerHTML = "";
  try {
    logLine("", "Читаю js/products.js с GitHub…");
    const { text, sha } = await ghGetFile("js/products.js");
    const products = parseProductsJS(text);
    const idx = products.findIndex(x => x.id === id);
    if (idx < 0) throw new Error("растение не найдено в файле");
    const [removed] = products.splice(idx, 1);
    await ghPutFile("js/products.js", utf8b64(productsToJS(products)),
      `[admin] Удалено растение: ${removed.name}`, sha);
    logLine("ok", `Удалено из каталога: ${removed.name}`);
    // убрать фото (не критично, если не выйдет)
    for (const path of [removed.image, ...(removed.gallery || [])]) {
      if (!path || !path.startsWith("images/catalog/")) continue;
      try {
        const f = await gh(`contents/${path}?ref=${cfg.branch}`);
        await ghDeleteFile(path, f.sha, `[admin] Удалён файл ${path}`);
        logLine("ok", "Удалён файл " + path);
      } catch { logLine("", "Файл " + path + " оставлен (не критично)"); }
    }
    const i = PRODUCTS.findIndex(x => x.id === id);
    if (i >= 0) PRODUCTS.splice(i, 1);
    renderTable();
  } catch (e) {
    logLine("err", "Ошибка удаления: " + e.message);
  }
}

/* ------------------------------------------------------------------ */
/* Локальный режим: скачать файлы                                      */
/* ------------------------------------------------------------------ */
function downloadDataURL(dataURL, filename) {
  const a = document.createElement("a");
  a.href = dataURL; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
}

async function downloadFiles() {
  const f = collectForm();
  const errs = validate(f, editingId == null);
  if (errs.length) { alert("Проверьте форму: " + errs.join("; ") + "."); return; }

  $("publog").innerHTML = "";
  const products = [...PRODUCTS];
  const id = editingId ?? (Math.max(0, ...products.map(p => p.id)) + 1);
  const oldEntry = editingId != null ? products.find(p => p.id === editingId) : null;
  const gallery = [];
  if (photos.length > 1)
    for (let i = 1; i < photos.length; i++) gallery.push(`images/catalog/${id}-${i}.jpg`);

  if (oldEntry) {
    Object.assign(oldEntry, {
      name: f.name, category: f.category, price: f.price,
      size: f.size, stock: f.stock,
      available: f.available !== false,
      image: photos[0] ? `images/catalog/${id}.jpg` : oldEntry.image,
      gallery: gallery.length ? gallery : (oldEntry.gallery || []),
      short: f.short, description: f.description
    });
  } else {
    products.push({
      id, name: f.name, category: f.category, size: f.size, price: f.price, stock: f.stock,
      available: f.available !== false,
      image: `images/catalog/${id}.jpg`, gallery,
      short: f.short, description: f.description
    });
  }

  logLine("ok", "Готовлю файлы…");
  // 1. products.js
  const blob = new Blob([productsToJS(products)], { type: "text/javascript;charset=utf-8" });
  downloadDataURL(await blobToDataURL(blob), "products.js");
  logLine("ok", "Скачан products.js");

  // 2. фото
  if (photos[0]) {
    downloadDataURL(photos[0].dataURL, `${id}.jpg`);
    logLine("ok", `Скачано фото ${id}.jpg`);
  }
  for (let i = 1; i < photos.length; i++) {
    downloadDataURL(photos[i].dataURL, `${id}-${i}.jpg`);
    logLine("ok", `Скачано фото ${id}-${i}.jpg`);
  }

  logLine("", "Дальше: github.com → репозиторий → Add file → Upload files → перетащите скачанные файлы (фото — в папку images/catalog, products.js — в папку js) → Commit changes.");
}

/* ------------------------------------------------------------------ */
/* Черновики                                                           */
/* ------------------------------------------------------------------ */
function saveDraft() {
  const f = collectForm();
  if (!f.name && !photos.length) { alert("Пустой черновик — сначала заполните что-нибудь."); return; }
  drafts.push({
    ...f,
    imageDataURL: photos[0]?.dataURL || null,
    galleryDataURLs: photos.slice(1).map(p => p.dataURL),
    savedAt: Date.now()
  });
  saveDrafts(); renderTable();
  logLine("ok", "Черновик сохранён в браузере (виден в списке ниже).");
}

/* ------------------------------------------------------------------ */
/* Смена пароля админ-панели                                           */
/* ------------------------------------------------------------------ */
async function changeAdminPassword() {
  if (!ghPush) {
    alert("Смена пароля требует подключённый GitHub с правом записи.\n\nОткройте «Настройки публикации», введите fine-grained токен (Contents: Read and write) и нажмите «Сохранить и проверить».");
    return;
  }
  if (typeof ADMIN_AUTH?.hashPassword !== "function") {
    alert("Не удалось загрузить утилиту смены пароля. Обновите страницу: Ctrl+F5.");
    return;
  }
  const p1 = prompt("Введите новый пароль (минимум 4 символа):");
  if (!p1 || p1.length < 4) { alert("Пароль должен содержать минимум 4 символа."); return; }
  const p2 = prompt("Повторите новый пароль:");
  if (p1 !== p2) { alert("Пароли не совпадают — попробуйте ещё раз."); return; }

  const btn = $("btnChangePass");
  if (btn) btn.disabled = true;
  $("publog").innerHTML = "";
  logLine("", "Считаю актуальные файлы админки…");
  try {
    const [authRes, htmlRes] = await Promise.all([
      ghGetFile("js/admin-auth.js"),
      ghGetFile("admin.html")
    ]);
    const oldHash = (authRes.text.match(/const HASH = "([0-9a-f]{64})"/) || [])[1];
    if (!oldHash) throw new Error("в js/admin-auth.js не найден HASH");

    const newHash = await ADMIN_AUTH.hashPassword(p1);
    const oldVer = (htmlRes.text.match(/admin-auth\.js\?v=(\d+)/) || [])[1] || "3";
    const newVer = String(Number(oldVer) + 1);

    let auth = authRes.text
      .replace(oldHash, newHash)
      .replace(/const SESSION_VERSION = \d+;/, `const SESSION_VERSION = ${newVer};`);
    let html = htmlRes.text
      .split("?v=" + oldVer).join("?v=" + newVer)
      .replace(new RegExp("if \\(s && s\\.v !== " + oldVer + "\\)", "g"), `if (s && s.v !== ${newVer})`);

    logLine("", `Загружаю на GitHub файлы версии ${newVer}…`);
    await ghPutFile("js/admin-auth.js", utf8b64(auth), "[admin] Смена пароля админ-панели", authRes.sha);
    await ghPutFile("admin.html", utf8b64(html), `[admin] Смена пароля админ-панели (версия ${newVer})`, htmlRes.sha);
    logLine("ok", "Пароль изменён на GitHub. Выйдите из панели и войдите с новым паролем.");
  } catch (e) {
    logLine("err", "Ошибка смены пароля: " + e.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */
$("btnSettings").addEventListener("click", () => {
  const s = $("settings");
  s.style.display = s.style.display === "none" ? "block" : "none";
});
$("btnSaveCfg").addEventListener("click", async () => {
  cfg.repo = $("cfgRepo").value.trim() || cfg.repo;
  cfg.branch = $("cfgBranch").value.trim() || "main";
  cfg.token = $("cfgToken").value.trim();
  saveCfg();
  await checkConnection(false);
});
$("btnForget").addEventListener("click", async () => {
  cfg.token = ""; saveCfg();
  $("cfgToken").value = "";
  await checkConnection(false);
});
$("btnPublish").addEventListener("click", publish);
$("btnSaveDraft").addEventListener("click", saveDraft);
$("btnDownload").addEventListener("click", downloadFiles);
$("btnReset").addEventListener("click", resetForm);
$("btnChangePass").addEventListener("click", changeAdminPassword);

/* --- офлайн-распознавание и поиск --- */
$("idMatch").addEventListener("change", e => {
  const v = e.target.value;
  if (v === "-1") return;
  const c = recogCandidates[+v];
  if (c) { recogPrev = collectForm(); applyOfflineProduct(c.product); }
});
$("cfgTokenEye").addEventListener("click", e => {
  e.preventDefault();
  const inp = $("cfgToken");
  const show = inp.type === "password";
  inp.type = show ? "text" : "password";
  $("cfgTokenEye").textContent = show ? "🙈" : "👁";
  $("cfgTokenEye").setAttribute("aria-label", show ? "Скрыть токен" : "Показать токен");
  inp.focus();
});
$("btnSearchG").addEventListener("click", () => searchSelectedProduct("google"));
$("btnSearchY").addEventListener("click", () => searchSelectedProduct("yandex"));
$("btnSearchPhotoY").addEventListener("click", () => searchPhoto("yandexPhoto"));
$("btnSearchPhotoG").addEventListener("click", () => searchPhoto("lens"));

/* --- каталог: фильтры и массовое наличие --- */
$("tblSearch").addEventListener("input", renderTable);
$("tblCat").addEventListener("change", renderTable);
$("tblAvail").addEventListener("change", renderTable);
if ($("tblTodo")) $("tblTodo").addEventListener("change", renderTable);

/* подсказки размеров контейнеров — из каталога */
if ($("sizeList")) {
  $("sizeList").innerHTML = [...new Set(PRODUCTS.map(p => p.size).filter(Boolean))]
    .sort((a, b) => parseFloat(a.replace(/[^\d,]/g, "").replace(",", ".")) -
                    parseFloat(b.replace(/[^\d,]/g, "").replace(",", ".")))
    .map(v => `<option value="${v}"></option>`).join("");
}
$("btnAllIn").addEventListener("click", () => setAllAvailable(true));
$("btnAllOut").addEventListener("click", () => setAllAvailable(false));

/* --- ИИ-помощник --- */
$("btnAI").addEventListener("click", aiFillForm);
$("btnAiSettings").addEventListener("click", openAiSettings);
$("btnAiSave").addEventListener("click", async () => {
  AdminAI.set({
    provider: $("aiProvider").value,
    model: $("aiModel").value.trim(),
    key: $("aiKey").value.trim()
  });
  renderAiSettings();
  if (!AdminAI.isReady()) { alert("Укажите модель и ключ."); return; }
  const note = $("aiTestNote");
  note.textContent = "Проверяю ключ…";
  try {
    await AdminAI.test();
    note.textContent = "✓ Ключ работает: " + AdminAI.providerLabel() + " · " + AdminAI.model();
  } catch (e) {
    note.textContent = "✗ " + e.message;
  }
  renderAiHint();
});
$("btnAiForget").addEventListener("click", () => {
  AdminAI.set({ key: "", model: "" });
  renderAiSettings();
});

initDropzone();
$("cfgRepo").value = cfg.repo;
$("cfgBranch").value = cfg.branch;
$("cfgToken").value = cfg.token;
renderAiSettings();
renderPreview();
renderTable();
checkConnection();

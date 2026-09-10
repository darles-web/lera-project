/* =====================================================================
   АДМИН-ПАНЕЛЬ «ДарЛес»
   ---------------------------------------------------------------------
   Добавление / изменение / удаление растений. Фото — перетаскиванием.
   ВСЕ изменения сохраняются НА СЕРВЕРЕ хостинга:

     • каталог  → data/catalog.json      (api/catalog.php)
     • фото     → images/catalog/*.jpg   (api/upload.php)
     • ключ ИИ  → api/config.local.php   (api/config.php)

   Никакого GitHub: сайт живёт на хостинге, панель пишет напрямую
   в файлы этого хостинга. Если PHP недоступен (сайт открыт не с
   хостинга), панель показывает «статический режим» — правки можно
   скачать файлом darles-catalog.json и загрузить вручную.
   ===================================================================== */

const DRAFTS_KEY = "darles_drafts";

let photos = [];           // [{ dataURL, name }] — dataURL уже обработанного фото
let editingId = null;      // id растения, которое редактируем (или null)
let drafts = loadDrafts();
let recogCandidates = [];  // кандидаты автоопределения растения (без API)
let recogPrev = null;      // снимок полей до офлайн-заполнения
let serverMode = false;    // работает ли PHP-хостинг (есть ли папка api/)

const NO_SERVER_MSG =
  "Сервер не отвечает (нужны PHP и папка api/ на хостинге).\n\n" +
  "Правки из панели сохраняются на сайт только при открытии панели по адресу сайта на хостинге.\n" +
  "Если сайт уже размещён — проверьте, что при загрузке архива папка api/ распаковалась целиком.\n\n" +
  "Пока это недоступно: заполните растение и нажмите «Скачать каталог (JSON)»,\n" +
  "затем загрузите фото и файл в папки images/catalog и data на хостинге.";

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* money() объявляет js/site.js — он загружается раньше этой панели. */
const fmtMoney = n => new Intl.NumberFormat("ru-RU").format(n) + " ₽";

function loadDrafts() {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "[]"); }
  catch { return []; }
}
function saveDrafts() {
  try { localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts)); }
  catch (e) { alert("Черновик не сохранён в браузере (нет места), но он не потерян в открытой форме."); }
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
/* Запросы к API хостинга (тот же домен — CORS не нужен)               */
/* ------------------------------------------------------------------ */
/* Вход по паролю отключён: запросы идут без токена,
   на сервере стоит скоростной фильтр (лимит запросов в час). */
async function apiPost(url, data, form) {
  let body, headers = {};
  if (form) {
    body = form;
  } else {
    body = JSON.stringify(data || {});
    headers["Content-Type"] = "application/json";
  }
  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body });
  } catch (e) {
    throw new Error("сервер не ответил — проверьте, что сайт открыт по адресу хостинга");
  }
  let j = null;
  try { j = await res.json(); } catch {}
  if (!res.ok || !j || j.ok === false) {
    throw new Error((j && (j.error || j.message)) || ("HTTP " + res.status));
  }
  return j;
}

/* Проверка: PHP хостинга на месте? */
async function checkServer() {
  const b = $("srvStatus");
  try {
    const r = await fetch("api/ping.php", { cache: "no-store" });
    const j = await r.json();
    if (!j || !j.ok) throw new Error("ping не ok");
    serverMode = true;
    b.className = "badge badge--green";
    b.textContent = "Хостинг подключён — изменения сохраняются на сервере";
    $("tblNote").textContent = "Все правки (каталог, фото, наличие, ИИ) сохраняются в файлы хостинга и сразу видны на сайте.";
  } catch (e) {
    serverMode = false;
    b.className = "badge badge--gray";
    b.textContent = "Статический режим — сайт открыт не с PHP-хостинга";
    $("tblNote").textContent =
      "В этом режиме правки НЕ сохраняются на сайт. Заполните растение и нажмите «Скачать каталог (JSON)», " +
      "либо откройте панель по адресу сайта на хостинге (нужна загруженная папка api/).";
  }
  renderAiSettings();
}

/* Сохранить каталог целиком на сервере */
async function saveCatalog(message) {
  $("publog").style.display = "block";
  logLine("", "Сохраняю на сервере: " + message + "…");
  try {
    const j = await apiPost("api/catalog.php", { products: PRODUCTS });
    logLine("ok", "Сохранено на сервере (" + j.count + " растений) — изменения уже на сайте.");
    return true;
  } catch (e) {
    logLine("err", "Ошибка сохранения: " + e.message);
    return false;
  }
}

/* Загрузить фото (dataURL) на сервер, вернуть путь */
async function uploadPhoto(dataURL, filename) {
  const blob = await (await fetch(dataURL)).blob();
  const fd = new FormData();
  fd.append("file", blob, filename);
  const j = await apiPost("api/upload.php", null, fd);
  return j.path;
}

async function deletePhotoFile(path) {
  if (!path || !path.startsWith("images/catalog/")) return;
  try { await apiPost("api/upload.php", { action: "delete", path }); }
  catch (e) { /* не критично: файл остался, на сайт не влияет */ }
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
  if (location.protocol === "file:") return "";
  return location.origin + "/" + String(path).replace(/^\.?\//, "");
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
    logLine("", "Поиск по фото нужен, чтобы фото было доступно по ссылке (сайт на хостинге). Открываю поиск по названию.");
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
  return {
    name,
    category: $("fCategory").value,
    price: isNaN(price) ? null : price,
    available: $("fAvailable") ? $("fAvailable").checked : true,
    short: $("fShort").value.trim(),
    description: $("fDesc").value.trim(),
  };
}

function renderPreview() {
  const f = collectForm();
  const img = photos[0]?.dataURL || "images/site/7.jpg";
  const cat = catTitle(f.category);
  const out = f.available === false;
  $("preview").innerHTML = `
    <a class="card ${out ? "card--out" : ""}" href="javascript:void(0)">
      <div class="card__img">
        <img src="${img}" alt="">
        <span class="card__tag">${cat}</span>
        ${out ? '<span class="card__out">Нет в наличии</span>' : ""}
      </div>
      <div class="card__body">
        <div class="card__name">${esc(f.name) || "Название растения"}</div>
        <div class="card__short">${esc(f.short) || "короткая подпись"}</div>
        <div class="card__bottom">
          ${out
            ? '<span class="card__price card__price--out">Нет в наличии</span>'
            : `<span class="card__price">${f.price != null ? fmtMoney(f.price) : "— ₽"}</span>`}
          <span class="card__more">${out ? "Смотреть →" : "Подробнее →"}</span>
        </div>
      </div>
    </a>
    <p class="muted small" style="margin-top:14px">${photos.length > 1 ? `Будет загружено фото: ${photos.length} (первое — главное).` : "Главное фото карточки — слева вверху."}</p>`;
}
["fName", "fCategory", "fPrice", "fShort", "fDesc"].forEach(id =>
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
  ["fName", "fPrice", "fShort", "fDesc"].forEach(id => $(id).value = "");
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
/* Таблица каталога: фото, название, категория, цена, наличие, действия  */
/* ------------------------------------------------------------------ */
function filteredProducts() {
  const q = ($("tblSearch")?.value || "").trim().toLowerCase();
  const cat = $("tblCat")?.value || "";
  const avail = $("tblAvail")?.value || "";
  let list = PRODUCTS.slice();
  if (cat) list = list.filter(p => p.category === cat);
  if (avail === "in") list = list.filter(p => p.available !== false);
  if (avail === "out") list = list.filter(p => p.available === false);
  if (q) list = list.filter(p => (p.name + " " + (p.short || "") + " id" + p.id).toLowerCase().includes(q));
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
        <img class="ptable__img" src="${p.image}" alt="" loading="lazy">
      </a>
    </td>
    <td data-label="Название">
      <div class="ptable__name">${esc(p.name)}</div>
      <div class="ptable__meta">id ${p.id} · фото: ${photosCount}${out ? " · <b>нет в наличии</b>" : ""}</div>
    </td>
    <td data-label="Категория">
      <select class="ptable__select" data-act="cat" data-id="${p.id}">${catOptions(p.category)}</select>
    </td>
    <td data-label="Цена, ₽">
      <input class="ptable__price" type="number" min="0" step="50" value="${Number(p.price) || 0}" data-act="price" data-id="${p.id}">
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
    <td data-label="Цена, ₽">${d.price != null ? fmtMoney(d.price) : "—"}</td>
    <td data-label="Наличие">${d.available === false ? "нет" : "—"}</td>
    <td data-label="Действия" class="ptable__actions">
      <button class="prow__btn" data-act="editdraft" data-i="${i}">В форму</button>
      <button class="prow__btn prow__btn--danger" data-act="deldraft" data-i="${i}">Удалить</button>
    </td>
  </tr>`;
}

function renderTable() {
  const list = filteredProducts();
  const outCount = PRODUCTS.filter(p => p.available === false).length;
  $("prodCount").textContent =
    `— ${PRODUCTS.length} на сайте` +
    (outCount ? `, из них ${outCount} нет в наличии` : "") +
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
        <th class="ptable__c-price">Цена, ₽</th>
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

    if (act === "avail" || act === "cat" || act === "price") {
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
      });
      if (act === "price") el.addEventListener("keydown", e => { if (e.key === "Enter") el.blur(); });
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
  if (!serverMode) { alert(NO_SERVER_MSG); return; }
  Object.assign(p, patch);          // сначала — локально (таблица обновляется сразу)
  renderTable();
  await saveCatalog(`${p.name} — ${label}`);
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
  if (!serverMode) { alert(NO_SERVER_MSG); return; }
  PRODUCTS.forEach(x => { x.available = !!value; });
  renderTable();
  const ok = await saveCatalog(value ? "наличие включено всем" : "наличие выключено всем");
  if (ok) logLine("ok", value ? "Всем растениям включено наличие." : "Все растения сняты с наличия.");
}

/* ------------------------------------------------------------------ */
/* ИИ-помощник: определяет растение по фото                             */
/* ------------------------------------------------------------------ */
let aiPrev = null;   // снимок полей до заполнения ИИ (для кнопки «Отменить»)

function aiReady() { return typeof AdminAI !== "undefined" && AdminAI.isReady(); }

function renderAiHint() {
  const el = $("aiHint");
  if (!el) return;
  if (typeof AdminAI === "undefined") { el.textContent = ""; return; }
  el.textContent = aiReady()
    ? `ИИ: ${AdminAI.providerLabel()} · ${AdminAI.model()}`
    : (serverMode ? "ИИ не настроен — нажмите «Настроить ИИ»" : "ИИ доступен при работе с хостингом");
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

/* Настройки ИИ в блоке «Настройки» */
function renderAiSettings() {
  if (typeof AdminAI === "undefined") return;
  const c = AdminAI.get();
  $("aiProvider").value = c.provider;
  $("aiModel").value = c.model || "";
  $("aiModel").placeholder = AdminAI.DEFAULT_MODEL[c.provider] || "модель";
  // сам ключ сервер не отдаёт — показываем только маску
  $("aiKey").value = "";
  $("aiKey").placeholder = c.keyMask
    ? `ключ сохранён на сервере (${c.keyMask}) — введите новый, чтобы заменить`
    : "sk-… / AIza… / sk-ant-…";
  if ($("aiBase")) $("aiBase").value = c.base || "";
  $("aiModelList").innerHTML = AdminAI.models().map(m => `<option value="${m}"></option>`).join("");
  renderAiStatus();
}

function renderAiStatus() {
  const note = $("aiTestNote");
  if (note) {
    if (!serverMode) {
      note.textContent = "Настройки ИИ доступны при работе с хостингом.";
    } else {
      // показываем, ЧТО именно сохранено на сервере — для диагностики
      const c = AdminAI.get();
      const addr = c.base ? " · адрес: " + c.base : " · адрес: api.openai.com (без прокси)";
      const key  = c.keyMask ? " · ключ " + c.keyMask : " · ключ не задан";
      note.textContent = (aiReady() ? "Готово" : "Не настроено")
        + ": " + AdminAI.providerLabel()
        + " · модель " + (AdminAI.model() || "—")
        + key + addr;
    }
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
  $("fPrice").value = p.price;
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
  return `<a class="card" href="javascript:void(0)">
    <div class="card__img"><img src="${p.image}" alt=""><span class="card__tag">${cat}</span></div>
    <div class="card__body">
      <div class="card__name">${esc(p.name)}</div>
      <div class="card__short">${esc(p.short || "")}</div>
      <div class="card__bottom">
        <span class="card__price">${fmtMoney(p.price)}</span>
        <span class="card__more">Подробнее →</span>
      </div>
    </div>
  </a>`;
}

function loadDraftToForm(i) {
  const d = drafts[i];
  $("fName").value = d.name; $("fCategory").value = d.category;
  $("fPrice").value = d.price ?? ""; $("fShort").value = d.short || "";
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
/* Публикация: фото на сервер → каталог на сервер → сайт обновлён      */
/* ------------------------------------------------------------------ */
async function publish() {
  const f = collectForm();
  const errs = validate(f, editingId == null);
  if (errs.length) { alert("Проверьте форму: " + errs.join("; ") + "."); return; }
  if (!serverMode) { alert(NO_SERVER_MSG); return; }

  $("publog").innerHTML = ""; $("btnPublish").disabled = true;
  try {
    const id = editingId ?? (Math.max(0, ...PRODUCTS.map(p => p.id)) + 1);
    const mainPath = `images/catalog/${id}.jpg`;
    const oldEntry = editingId != null ? PRODUCTS.find(p => p.id === editingId) : null;

    // 1. фото: главное (перезапись при редактировании) + галерея
    let gallery = [];
    if (photos.length) {
      logLine("", "Загружаю главное фото…");
      await uploadPhoto(photos[0].dataURL, `${id}.jpg`);
      logLine("ok", "Главное фото загружено");
      for (let i = 1; i < photos.length; i++) {
        logLine("", `Загружаю доп. фото ${i}…`);
        await uploadPhoto(photos[i].dataURL, `${id}-${i}.jpg`);
        gallery.push(`images/catalog/${id}-${i}.jpg`);
        logLine("ok", `Доп. фото ${i} загружено`);
      }
      // старые доп. фото, которые больше не используются, убираем (не критично)
      if (oldEntry) {
        for (const op of (oldEntry.gallery || [])) {
          if (op && op.startsWith("images/catalog/") && !gallery.includes(op)) {
            await deletePhotoFile(op);
          }
        }
      }
    }

    // 2. запись каталога (локальная копия)
    const entry = {
      id,
      name: f.name, category: f.category, price: f.price,
      available: f.available !== false,
      image: (editingId != null && !photos.length) ? (oldEntry?.image || mainPath) : mainPath,
      gallery: photos.length ? gallery : (oldEntry?.gallery || []),
      short: f.short, description: f.description
    };
    if (oldEntry) Object.assign(oldEntry, entry);
    else PRODUCTS.push(entry);

    // 3. сохранить каталог на сервере
    const ok = await saveCatalog(editingId != null ? `Изменено: ${f.name}` : `Добавлено растение: ${f.name}`);
    if (ok) {
      logLine("ok", editingId != null
        ? "Готово! Изменения уже видны на сайте."
        : `Готово! «${f.name}» теперь на сайте.`);
      logLine("", `<a href="catalog.html?cat=${f.category}" target="_blank">Открыть каталог →</a>`, true);
      resetForm();
    }
    renderTable();
  } catch (e) {
    logLine("err", "Ошибка: " + e.message);
  }
  $("btnPublish").disabled = false;
}

/* ------------------------------------------------------------------ */
/* Удаление растения                                                   */
/* ------------------------------------------------------------------ */
async function deleteProduct(id) {
  const p = PRODUCTS.find(x => x.id === id);
  if (!p || !confirm(`Удалить «${p.name}» с сайта?`)) return;
  if (!serverMode) { alert(NO_SERVER_MSG); return; }

  $("publog").innerHTML = "";
  const i = PRODUCTS.findIndex(x => x.id === id);
  if (i < 0) return;
  const [removed] = PRODUCTS.splice(i, 1);
  const ok = await saveCatalog(`Удалено растение: ${removed.name}`);
  if (ok) {
    logLine("ok", `Удалено из каталога: ${removed.name}`);
    for (const path of [removed.image, ...(removed.gallery || [])]) {
      await deletePhotoFile(path); // фото с диска тоже убираем (не критично)
    }
    renderTable();
  } else {
    PRODUCTS.splice(i, 0, removed); // откат
    renderTable();
  }
}

/* ------------------------------------------------------------------ */
/* Резервная копия каталога (JSON)                                     */
/* ------------------------------------------------------------------ */
function downloadBackup() {
  const payload = { exportedAt: new Date().toISOString(), products: PRODUCTS };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "darles-catalog.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  logLine("ok", "Скачан darles-catalog.json — копия каталога (запасной способ перенести данные).");
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
/* Настройки ИИ: сохранение на сервере + проверка                      */
/* ------------------------------------------------------------------ */
async function loadAiSettingsFromServer() {
  if (!serverMode) return;
  try {
    const res = await fetch("api/config.php", { cache: "no-store" });
    const j = await res.json();
    if (res.ok && j && j.ai && typeof AdminAI !== "undefined") {
      AdminAI.applyServer(j.ai);
    }
  } catch (e) { /* без настроек — ИИ просто «не настроен» */ }
}

async function saveAiSettings() {
  if (typeof AdminAI === "undefined") { alert("Скрипт ИИ не загрузился — обновите страницу (Ctrl+F5)."); return; }
  const btn = $("btnAiSave");
  const note = $("aiTestNote");
  const noteShow = t => { if (note) note.textContent = t; };
  if (btn) { btn.disabled = true; btn.textContent = "Сохраняю…"; }
  noteShow("Сохраняю настройки…");
  try {
    const provider = $("aiProvider").value;
    const model = $("aiModel").value.trim();
    const key = $("aiKey").value.trim();
    const base = $("aiBase") ? $("aiBase").value.trim() : "";
    const c = AdminAI.get();
    // ключ в запросе передаём только если пользователь ввёл НОВЫЙ;
    // иначе сервер оставляет сохранённый
    const aiPatch = { provider, model, base };
    if (key) aiPatch.key = key;
    AdminAI.applyServer({
      provider, model, base,
      keySet: key ? true : c.keySet,
      keyMask: key ? (key.slice(0, 3) + "…" + key.slice(-4)) : (c.keyMask || "")
    });
    renderAiSettings();
    if (!serverMode) {
      noteShow("✗ Сайт работает без PHP-хостинга — сохранить нельзя. Проверьте, что папка api/ загружена на хостинг.");
      alert(NO_SERVER_MSG);
      return;
    }
    noteShow("Сохраняю на сервере…");
    const j = await apiPost("api/config.php", { ai: aiPatch });
    if (j && j.ai) AdminAI.applyServer(j.ai);
    if (!AdminAI.isReady()) {
      noteShow("✗ Ключ не задан: вставьте новый ключ и сохраните.");
      return;
    }
    noteShow("Проверяю ключ…");
    await AdminAI.test();
    noteShow("✓ Ключ работает: " + AdminAI.providerLabel() + " · " + AdminAI.model() + " (хранится на сервере)");
  } catch (e) {
    noteShow("✗ " + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Сохранить и проверить"; }
    renderAiHint();
  }
}

async function forgetAiKey() {
  if (typeof AdminAI === "undefined") return;
  if (!serverMode) {
    AdminAI.applyServer({ ...AdminAI.get(), keySet: false, keyMask: "" });
    renderAiSettings();
    return;
  }
  if (!confirm("Убрать ключ ИИ с сервера? ИИ-помощник перестанет работать, пока вы не зададите новый ключ.")) return;
  try {
    const j = await apiPost("api/config.php", { ai: { clear_key: true } });
    if (j && j.ai) AdminAI.applyServer(j.ai);
    renderAiSettings();
  } catch (e) {
    alert("Не удалось убрать ключ: " + e.message);
  }
}

/* ------------------------------------------------------------------ */
/* Инициализация                                                       */
/* ------------------------------------------------------------------ */
$("btnSettings").addEventListener("click", () => {
  const s = $("settings");
  s.style.display = s.style.display === "none" ? "block" : "none";
});
$("btnPublish").addEventListener("click", publish);
$("btnSaveDraft").addEventListener("click", saveDraft);
$("btnDownload").addEventListener("click", downloadBackup);
$("btnReset").addEventListener("click", resetForm);

/* --- офлайн-распознавание и поиск --- */
$("idMatch").addEventListener("change", e => {
  const v = e.target.value;
  if (v === "-1") return;
  const c = recogCandidates[+v];
  if (c) { recogPrev = collectForm(); applyOfflineProduct(c.product); }
});
$("btnSearchG").addEventListener("click", () => searchSelectedProduct("google"));
$("btnSearchY").addEventListener("click", () => searchSelectedProduct("yandex"));
$("btnSearchPhotoY").addEventListener("click", () => searchPhoto("yandexPhoto"));
$("btnSearchPhotoG").addEventListener("click", () => searchPhoto("lens"));

/* --- каталог: фильтры и массовое наличие --- */
$("tblSearch").addEventListener("input", renderTable);
$("tblCat").addEventListener("change", renderTable);
$("tblAvail").addEventListener("change", renderTable);
$("btnAllIn").addEventListener("click", () => setAllAvailable(true));
$("btnAllOut").addEventListener("click", () => setAllAvailable(false));

/* --- ИИ-помощник --- */
$("btnAI").addEventListener("click", aiFillForm);
$("btnAiSettings").addEventListener("click", openAiSettings);
$("btnAiSave").addEventListener("click", saveAiSettings);
$("btnAiForget").addEventListener("click", forgetAiKey);

initDropzone();
renderPreview();
renderTable();
checkServer().then(() => {
  return loadAiSettingsFromServer();
}).then(() => {
  renderAiSettings();
  renderTable();
});

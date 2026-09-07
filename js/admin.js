/* =====================================================================
   АДМИН-ПАНЕЛЬ «ДарЛес»
   Добавление растений: фото перетаскиванием, поля, публикация на сайт.
   Работает в двух режимах:
     1) GitHub подключён — публикация в один клик (фото + js/products.js)
     2) Локальный режим — кнопка «Скачать файлы» и ручная загрузка
   ===================================================================== */

const CFG_KEY = "darles_admin_cfg";
const DRAFTS_KEY = "darles_drafts";
const TOKEN_KEY = "darles_admin_token";

/* Токен НЕ хранится в localStorage: только в памяти вкладки (sessionStorage),
   и только если владелец явно поставил галочку «запомнить до закрытия вкладки».
   Это заметно снижает риск кражи токена сторонним скриптом или на чужом компьютере. */
function readCfg() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || "{}"); } catch { saved = {}; }
  delete saved.token; // старые версии могли сохранить токен — удаляем
  let token = "";
  try { token = sessionStorage.getItem(TOKEN_KEY) || ""; } catch {}
  return Object.assign({ repo: "samagon90/lera-project", branch: "main", token: "" }, saved, { token });
}
const cfg = readCfg();

let ghOK = false;          // подключён ли GitHub
let ghPush = false;        // есть ли право на запись
let photos = [];           // [{ dataURL, name }] — dataURL уже обработанного фото
let editingId = null;      // id растения, которое редактируем (или null)
let drafts = loadDrafts();

/* ------------------------------------------------------------------ */
/* Утилиты                                                             */
/* ------------------------------------------------------------------ */
const $ = id => document.getElementById(id);
/* esc() и money() приходят из js/site.js — не переобъявляем, чтобы не ломать страницу */


function utf8b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const b64part = dataURL => dataURL.split(",")[1];

function saveCfg() {
  const { token, ...rest } = cfg;
  localStorage.setItem(CFG_KEY, JSON.stringify(rest));
  try {
    if (token && $("cfgRemember")?.checked) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
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
const REPO_RE = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,100}$/;

async function gh(path, { method = "GET", body } = {}) {
  if (!REPO_RE.test(cfg.repo)) throw new Error("некорректное имя репозитория (нужно вида владелец/репозиторий)");
  if (!BRANCH_RE.test(cfg.branch)) throw new Error("некорректное имя ветки");
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
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
/* Разбор списка PRODUCTS БЕЗ eval/new Function: файл с GitHub исполнять нельзя —
   если в репозиторий попадёт вредоносный код, он выполнился бы в админке с токеном. */
function parseProductsJS(text) {
  const m = text.match(/const\s+PRODUCTS\s*=\s*\[([\s\S]*?)\n\];/);
  if (!m) throw new Error("Не удалось найти список PRODUCTS в файле");
  const body = m[1];
  const out = [];
  // делим на блоки верхнего уровня { ... }
  let depth = 0, start = -1, inStr = null, esc0 = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc0) esc0 = false;
      else if (ch === "\\") esc0 = true;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") { depth--; if (depth === 0 && start >= 0) { out.push(body.slice(start + 1, i)); start = -1; } }
  }
  if (!out.length) throw new Error("В файле products.js не найдено ни одного растения");
  return out.map(parseProductBlock);
}

function readJSLiteral(src, from) {
  // возвращает { value, end } для строки в кавычках/бэктиках, числа или массива строк
  let i = from;
  while (i < src.length && /\s/.test(src[i])) i++;
  const q = src[i];
  if (q === '"' || q === "'" || q === "`") {
    let out = "", esc1 = false;
    for (i++; i < src.length; i++) {
      const c = src[i];
      if (esc1) {
        out += ({ n: "\n", t: "\t", r: "\r" }[c] ?? c);
        esc1 = false;
      } else if (c === "\\") esc1 = true;
      else if (c === q) return { value: out, end: i + 1 };
      else out += c;
    }
    throw new Error("незакрытая строка в products.js");
  }
  if (q === "[") {
    const close = src.indexOf("]", i);
    if (close < 0) throw new Error("незакрытый массив в products.js");
    const inner = src.slice(i + 1, close);
    const arr = [...inner.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)]
      .map(mm => (mm[1] ?? mm[2]).replace(/\\(.)/g, "$1"));
    return { value: arr, end: close + 1 };
  }
  const num = /^-?\d+(?:\.\d+)?/.exec(src.slice(i));
  if (num) return { value: Number(num[0]), end: i + num[0].length };
  const kw = /^(true|false|null)/.exec(src.slice(i));
  if (kw) return { value: { true: true, false: false, null: null }[kw[0]], end: i + kw[0].length };
  throw new Error("неизвестное значение в products.js");
}

function parseProductBlock(block) {
  const obj = {};
  const keyRe = /(?:^|[,\s])(id|name|category|price|image|gallery|short|description)\s*:/g;
  let m2;
  while ((m2 = keyRe.exec(block))) {
    const { value, end } = readJSLiteral(block, m2.index + m2[0].length);
    obj[m2[1]] = value;
    keyRe.lastIndex = end;
  }
  if (obj.id == null || !obj.name) throw new Error("растение без id или названия в products.js");
  return {
    id: Number(obj.id), name: String(obj.name),
    category: String(obj.category || "hvoynye"), price: Number(obj.price) || 0,
    image: String(obj.image || ""), gallery: Array.isArray(obj.gallery) ? obj.gallery : [],
    short: String(obj.short || ""), description: String(obj.description || "")
  };
}

const FILE_HEADER = `/* =====================================================================
   КАТАЛОГ ТОВАРОВ ПИТОМНИКА «ДарЛес»
   ---------------------------------------------------------------------
   Проще всего менять этот файл через АДМИН-ПАНЕЛЬ: откройте admin.html —
   там фото добавляется перетаскиванием, а поля заполляются как форма.

   Каждое растение — блок { ... } в списке PRODUCTS, между блоками запятая.
     id  — уникальный номер (у нового: +1 к последнему)
     category — одно из: "hvoynye" | "listvennye" | "mnogoletnie"
     price — цена числом, без пробелов и ₽
     image — путь к фото, например "images/catalog/23.jpg"
     gallery — доп. фото: ["images/catalog/23-1.jpg"] или []
     short — короткая подпись в карточке
     description — абзацы разделяются пустой строкой
   ===================================================================== */`;

function productToJS(p) {
  const q = s => JSON.stringify(s ?? "");
  const desc = String(p.description || "")
    .replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
  return `  {
    id: ${Number(p.id)},
    name: ${q(p.name)},
    category: ${q(p.category)},
    price: ${Number(p.price)},
    image: ${q(p.image)},
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

const MAX_UPLOAD = 12 * 1024 * 1024; // 12 МБ на файл

async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/")) { logLine("err", `«${f.name}» — это не изображение, пропускаю.`); continue; }
    if (f.size > MAX_UPLOAD) { logLine("err", `«${f.name}» слишком большой (${(f.size / 1048576).toFixed(1)} МБ, максимум 12 МБ).`); continue; }
    try {
      logLine("", `Обрабатываю фото «${String(f.name).slice(0, 80)}»…`);
      let dataURL;
      if ($("optTrim").checked) {
        const blob = await normalizeImage(f, true);
        dataURL = await blobToDataURL(blob);
      } else {
        dataURL = await blobToDataURL(f);
      }
      photos.push({ originalDataURL: dataURL, dataURL, state: null });
      logLine("ok", `Фото готово (${photos.length === 1 ? "главное" : "доп. " + (photos.length - 1)}). Кнопка ✏️ — сменить фон и выровнять.`);
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
      <img src="${p.dataURL.startsWith("data:image/") ? p.dataURL : ""}" alt="">
      <button class="dz-thumb__edit" type="button" data-i="${i}" title="Редактировать: фон, выравнивание">✏️</button>
      <button class="dz-thumb__x" type="button" data-i="${i}" title="Убрать">✕</button>
    </div>`).join("");
  $("dzThumbs").querySelectorAll(".dz-thumb__x").forEach(b =>
    b.addEventListener("click", () => {
      photos.splice(+b.dataset.i, 1);
      renderThumbs(); renderPreview();
    }));
  $("dzThumbs").querySelectorAll(".dz-thumb__edit").forEach(b =>
    b.addEventListener("click", () => openEditor(+b.dataset.i)));
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
    short: $("fShort").value.trim(),
    description: $("fDesc").value.trim(),
  };
}

function renderPreview() {
  const f = collectForm();
  const raw = photos[0]?.dataURL;
  const img = raw && raw.startsWith("data:image/") ? raw : "images/site/7.jpg";
  const cat = { hvoynye: "Хвойные", listvennye: "Лиственные", mnogoletnie: "Многолетние" }[f.category];
  $("preview").innerHTML = `
    <div class="card">
      <div class="card__img"><img src="${img}" alt=""><span class="card__tag">${cat}</span></div>
      <div class="card__body">
        <div class="card__name">${esc(f.name) || "Название растения"}</div>
        <div class="card__short">${esc(f.short) || "короткая подпись"}</div>
        <div class="card__bottom">
          <span class="card__price">${f.price != null ? money(f.price) : "— ₽"}</span>
          <span class="card__more">Подробнее →</span>
        </div>
      </div>
    </div>
    <p class="muted small" style="margin-top:14px">${photos.length > 1 ? `Будет загружено фото: ${photos.length} (первое — главное).` : "Главное фото карточки — слева вверху."}</p>`;
}
["fName", "fCategory", "fPrice", "fShort", "fDesc"].forEach(id =>
  document.addEventListener("input", e => { if (e.target.id === id) renderPreview(); }));

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
  $("btnReset").style.display = "none";
  $("formTitle").textContent = "Добавить растение";
  $("btnPublish").textContent = "Опубликовать на сайт";
  renderThumbs(); renderPreview();
}

/* ------------------------------------------------------------------ */
/* Таблица растений + черновики                                        */
/* ------------------------------------------------------------------ */
function renderTable() {
  const rows = [
    ...drafts.map((d, i) => ({ draft: d, i })),
    ...PRODUCTS.map(p => ({ p }))
  ];
  $("prodCount").textContent = `— ${PRODUCTS.length} на сайте${drafts.length ? `, черновиков: ${drafts.length}` : ""}`;

  $("prodTable").innerHTML = rows.map(r => {
    if (r.draft) {
      const d = r.draft;
      return `<div class="prow">
        <img src="${d.imageDataURL || "images/site/7.jpg"}" alt="">
        <div>
          <div class="prow__name">${esc(d.name || "Без названия")}<span class="tag-draft">черновик</span></div>
          <div class="prow__meta">${catTitle(d.category)}${d.price != null ? " · " + money(d.price) : ""}</div>
        </div>
        <div class="prow__actions">
          <button class="prow__btn" data-act="editdraft" data-i="${r.i}">В форму</button>
          <button class="prow__btn prow__btn--danger" data-act="deldraft" data-i="${r.i}">Удалить</button>
        </div>
      </div>`;
    }
    const p = r.p;
    return `<div class="prow">
      <img src="${esc(typeof safeImg === "function" ? safeImg(p.image) : p.image)}" alt="" loading="lazy">
      <div>
        <div class="prow__name">${esc(p.name)}</div>
        <div class="prow__meta">${catTitle(p.category)} · ${esc(money(p.price))} · id ${p.id}${(p.gallery || []).length ? ` · фото: ${p.gallery.length + 1}` : ""}</div>
      </div>
      <div class="prow__actions">
        <button class="prow__btn" data-act="edit" data-id="${p.id}">Изменить</button>
        <button class="prow__btn prow__btn--danger" data-act="del" data-id="${p.id}">Удалить</button>
      </div>
    </div>`;
  }).join("");

  $("prodTable").querySelectorAll(".prow__btn").forEach(b => b.addEventListener("click", () => {
    const act = b.dataset.act;
    if (act === "edit") startEdit(+b.dataset.id);
    if (act === "del") deleteProduct(+b.dataset.id);
    if (act === "editdraft") loadDraftToForm(+b.dataset.i);
    if (act === "deldraft") {
      if (confirm("Удалить черновик из браузера?")) {
        drafts.splice(+b.dataset.i, 1); saveDrafts(); renderTable();
      }
    }
  }));
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
  photos = [];
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
  return `<div class="card">
    <div class="card__img"><img src="${esc(typeof safeImg === "function" ? safeImg(p.image) : p.image)}" alt=""><span class="card__tag">${cat}</span></div>
    <div class="card__body">
      <div class="card__name">${esc(p.name)}</div>
      <div class="card__short">${esc(p.short || "")}</div>
      <div class="card__bottom">
        <span class="card__price">${esc(money(p.price))}</span>
        <span class="card__more">Подробнее →</span>
      </div>
    </div>
  </div>`;
}

function loadDraftToForm(i) {
  const d = drafts[i];
  $("fName").value = d.name; $("fCategory").value = d.category;
  $("fPrice").value = d.price ?? ""; $("fShort").value = d.short || "";
  $("fDesc").value = d.description || "";
  photos = [
    ...(d.imageDataURL ? [{ originalDataURL: d.imageDataURL, dataURL: d.imageDataURL, state: null }] : []),
    ...(d.galleryDataURLs || []).map(u => ({ originalDataURL: u, dataURL: u, state: null }))
  ];
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
      image: (editingId != null && !photos.length)
        ? oldEntry?.image || mainPath
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
    logLine("", `<a href="catalog.html?cat=${encodeURIComponent(f.category)}" target="_blank" rel="noopener noreferrer">Открыть каталог →</a>`, true);

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
      image: photos[0] ? `images/catalog/${id}.jpg` : oldEntry.image,
      gallery: gallery.length ? gallery : (oldEntry.gallery || []),
      short: f.short, description: f.description
    });
  } else {
    products.push({
      id, name: f.name, category: f.category, price: f.price,
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
  cfg.token = "";
  $("cfgRemember").checked = false;
  try { sessionStorage.removeItem(TOKEN_KEY); } catch {}
  saveCfg();
  $("cfgToken").value = "";
  await checkConnection(false);
});
$("btnPublish").addEventListener("click", publish);
$("btnSaveDraft").addEventListener("click", saveDraft);
$("btnDownload").addEventListener("click", downloadFiles);
$("btnReset").addEventListener("click", resetForm);

initDropzone();
$("cfgRepo").value = cfg.repo;
$("cfgBranch").value = cfg.branch;
$("cfgToken").value = cfg.token;
try { $("cfgRemember").checked = !!sessionStorage.getItem(TOKEN_KEY); } catch {}
renderPreview();
renderTable();
checkConnection();

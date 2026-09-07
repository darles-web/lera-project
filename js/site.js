/* Общие скрипты сайта «ДарЛес»: шапка, подвал, карусели, карточки.
   Правки контактов делаются здесь в объекте CONTACTS. */

const CONTACTS = {
  phones: ["+7 (978) 104 92 36", "+7 (978) 857 39 47", "+7 (978) 048 72 04"],
  email: "darles-pitomnik@mail.ru",
  address: "с. Давыдово, трасса Донское — Кленовка, Крым",
  telegram: "https://t.me/darles_garden",
  vk: "https://m.vk.ru/club238739856"
};

const telHref = p => "tel:" + String(p).replace(/[^\d+]/g, "");

/* Экранирование пользовательских/каталожных данных перед вставкой в HTML.
   Защищает от XSS, если в описание растения попадёт разметка. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Безопасный путь к картинке: только относительные пути внутри images/ */
function safeImg(src) {
  const s = String(src ?? "");
  return /^images\/[A-Za-z0-9._\-\/]+$/.test(s) && !s.includes("..") ? s : "images/site/6.jpg";
}

/* Безопасная внешняя ссылка: только http(s) */
function safeUrl(u) {
  const s = String(u ?? "");
  return /^https?:\/\//i.test(s) ? s : "#";
}
const money = n => new Intl.NumberFormat("ru-RU").format(n) + " ₽";

/* базовый путь: страницы товара лежат в /product.html в корне, так что префикс всегда "" */
const ICONS = {
  phone: '<svg viewBox="0 0 24 24"><path d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24 11.4 11.4 0 003.6.58 1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.6a1 1 0 01-.25 1l-2.22 2.2z"/></svg>',
  tg: '<svg viewBox="0 0 24 24"><path d="M21.9 4.3 18.9 19c-.2 1-.8 1.3-1.7.8l-4.6-3.4-2.2 2.1c-.25.25-.45.45-.9.45l.33-4.7L18.4 6.5c.37-.33-.08-.5-.57-.2L6.24 13.5 1.7 12.1c-1-.3-1-1 .2-1.5L20.6 3.2c.82-.3 1.54.2 1.3 1.1z"/></svg>',
  vk: '<svg viewBox="0 0 24 24"><path d="M12.8 16.9c-5.5 0-8.9-3.9-9-10.3h2.8c.1 4.8 2.3 6.8 3.9 7.2V6.6h2.6v4c1.6-.2 3.3-2 3.9-4h2.6c-.45 2.5-2.2 4.3-3.4 5 1.2.6 3.2 2.2 4 5h-2.9c-.6-1.9-2.1-3.4-4.2-3.6v3.6h-.3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 2a7 7 0 00-7 7c0 5.2 7 13 7 13s7-7.8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z"/></svg>',
  leaf: '<svg viewBox="0 0 24 24"><path d="M17 8C8 10 5.9 16.2 3.8 21.7l1.9.3.9-2.4C12 20 17 17 19 8c.5-2.3 1-4.5 1-4.5s-1.5 2-3 4.5z"/></svg>',
  tree: '<svg viewBox="0 0 24 24"><path d="M12 2 6 10h3l-4 6h5v6h4v-6h5l-4-6h3z"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 1 3 5v6c0 5.5 3.8 10.7 9 12 5.2-1.3 9-6.5 9-12V5l-9-4zm-1 15-4-4 1.4-1.4L11 13.2l5.6-5.6L18 9l-7 7z"/></svg>',
  truck: '<svg viewBox="0 0 24 24"><path d="M3 6h11v9H3V6zm12 3h3.5l2.5 3v3h-6V9zM6.5 20a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6zm11 0a1.8 1.8 0 100-3.6 1.8 1.8 0 000 3.6z"/></svg>'
};

function renderHeader(active) {
  const phoneItems = CONTACTS.phones.map(p => `<a href="${telHref(p)}">${p}</a>`).join("");
  document.getElementById("site-header").innerHTML = `
  <div class="topbar">
    <div class="wrap topbar__in">
      <a class="topbar__logo" href="index.html">
        <img src="images/site/6.jpg" alt="ДарЛес — питомник декоративных растений" width="40" height="40" decoding="async">
        <span>ДарЛес</span>
      </a>
      <nav class="topbar__nav">
        <a href="index.html#about">О питомнике</a>
        <a href="catalog.html">Каталог</a>
        <a href="index.html#categories">Категории</a>
        <a href="index.html#contacts">Контакты</a>
      </nav>
      <div class="topbar__contacts">
        <div class="phones" id="phones">
          <button class="phones__btn" type="button" aria-label="Телефоны" aria-expanded="false">
            ${ICONS.phone}<span>${CONTACTS.phones[0]}</span> ▾
          </button>
          <div class="phones__list">${phoneItems}</div>
        </div>
        <a class="mail" href="mailto:${esc(CONTACTS.email)}">${esc(CONTACTS.email)}</a>
        <button class="burger" id="burger" type="button" aria-label="Меню" aria-expanded="false" aria-controls="drawer">
          <svg viewBox="0 0 24 24"><path d="M3 6h18v2H3V6zm0 5h18v2H3v-2zm0 5h18v2H3v-2z"/></svg>
        </button>
      </div>
    </div>
  </div>
  <nav class="drawer" id="drawer">
    <a href="index.html#about">О питомнике</a>
    <a href="catalog.html">Каталог</a>
    <a href="index.html#categories">Категории</a>
    <a href="mailto:${esc(CONTACTS.email)}">${esc(CONTACTS.email)}</a>
    <a href="index.html#contacts">Контакты</a>
  </nav>`;
  const ph = document.getElementById("phones");
  const phBtn = ph.querySelector(".phones__btn");
  phBtn.addEventListener("click", e => {
    e.stopPropagation();
    phBtn.setAttribute("aria-expanded", String(ph.classList.toggle("open")));
  });
  document.addEventListener("click", () => { ph.classList.remove("open"); phBtn.setAttribute("aria-expanded", "false"); });
  const burger = document.getElementById("burger"), drawer = document.getElementById("drawer");
  burger.addEventListener("click", e => {
    e.stopPropagation();
    const open = drawer.classList.toggle("open");
    burger.setAttribute("aria-expanded", String(open));
  });
  drawer.addEventListener("click", () => { drawer.classList.remove("open"); burger.setAttribute("aria-expanded", "false"); });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    drawer.classList.remove("open"); burger.setAttribute("aria-expanded", "false");
    ph.classList.remove("open");
  });
}

function renderFooter() {
  const phones = CONTACTS.phones.map(p => `<a href="${telHref(p)}">${p}</a>`).join("");
  document.getElementById("site-footer").innerHTML = `
  <footer class="footer" id="contacts">
    <div class="wrap footer__grid">
      <div>
        <img class="footer__logo" src="images/site/5.png" alt="ДарЛес" loading="lazy" decoding="async">
        <p>Первый питомник декоративных растений в Крыму. 15 га, более 400 000 растений и 350 сортов.</p>
        <div class="socials">
          <a class="social" href="${esc(safeUrl(CONTACTS.telegram))}" target="_blank" rel="noopener noreferrer" aria-label="Telegram">${ICONS.tg}</a>
          <a class="social" href="${esc(safeUrl(CONTACTS.vk))}" target="_blank" rel="noopener noreferrer" aria-label="ВКонтакте">${ICONS.vk}</a>
        </div>
      </div>
      <div>
        <h4>Телефоны</h4>
        ${phones}
        <h4 style="margin-top:22px">Email</h4>
        <a href="mailto:${esc(CONTACTS.email)}">${esc(CONTACTS.email)}</a>
      </div>
      <div>
        <h4>Адрес</h4>
        <p>${CONTACTS.address}</p>
        <h4 style="margin-top:22px">Разделы</h4>
        <a href="catalog.html?cat=hvoynye">Хвойные</a>
        <a href="catalog.html?cat=listvennye">Лиственные</a>
        <a href="catalog.html?cat=mnogoletnie">Многолетние</a>
      </div>
    </div>
    <div class="wrap footer__bottom">
      <span>© ${new Date().getFullYear()} Питомник «ДарЛес»</span>
      <span>Сайт-витрина. Заказ — по телефону или в соцсетях.</span>
      <a href="admin.html" style="opacity:.55;font-size:13px">Админ-панель</a>
    </div>
  </footer>`;
}

function cardHTML(p) {
  return `<a class="card" href="product.html?id=${encodeURIComponent(p.id)}">
    <div class="card__img">
      <img src="${esc(safeImg(p.image))}" alt="${esc(p.name)}" loading="lazy" decoding="async">
      <span class="card__tag">${esc(CATEGORIES[p.category]?.title || "")}</span>
    </div>
    <div class="card__body">
      <div class="card__name">${esc(p.name)}</div>
      <div class="card__short">${esc(p.short || "")}</div>
      <div class="card__bottom">
        <span class="card__price">${esc(money(p.price))}</span>
        <span class="card__more">Подробнее →</span>
      </div>
    </div>
  </a>`;
}

/* Автокарусель для больших фото */
function initHeroCarousel(el, interval = 5000) {
  const track = el.querySelector(".carousel__track");
  const slides = track.children.length;
  let i = 0, timer;
  const dots = el.querySelector(".carousel__dots");
  for (let k = 0; k < slides; k++) {
    const b = document.createElement("button");
    b.className = "dot" + (k === 0 ? " active" : "");
    b.addEventListener("click", () => go(k));
    dots.appendChild(b);
  }
  function go(k) {
    i = (k + slides) % slides;
    track.style.transform = `translateX(-${i * 100}%)`;
    [...dots.children].forEach((d, n) => d.classList.toggle("active", n === i));
    restart();
  }
  function restart() { clearInterval(timer); timer = setInterval(() => go(i + 1), interval); }
  el.querySelector(".carousel__arrow--prev").addEventListener("click", () => go(i - 1));
  el.querySelector(".carousel__arrow--next").addEventListener("click", () => go(i + 1));
  restart();
}


/* Горизонтальная карусель карточек: стрелки + автопрокрутка */
function initRowCarousel(wrapEl, auto = 4000) {
  const track = wrapEl.querySelector(".row-carousel__track");
  const mk = (cls, txt, dir) => {
    const b = document.createElement("button");
    b.className = "carousel__arrow " + cls; b.textContent = txt; b.type = "button";
    b.addEventListener("click", () => { stop(); scrollBy(dir); });
    wrapEl.appendChild(b); return b;
  };
  const step = () => track.firstElementChild ? track.firstElementChild.offsetWidth + 24 : 300;
  function scrollBy(dir) { track.scrollBy({ left: dir * step(), behavior: "smooth" }); }
  mk("carousel__arrow--prev", "‹", -1);
  mk("carousel__arrow--next", "›", 1);
  let timer = setInterval(tick, auto);
  function tick() {
    const max = track.scrollWidth - track.clientWidth - 4;
    if (track.scrollLeft >= max) track.scrollTo({ left: 0, behavior: "smooth" });
    else scrollBy(1);
  }
  function stop() { clearInterval(timer); timer = setInterval(tick, auto * 2); }
  wrapEl.addEventListener("mouseenter", () => clearInterval(timer));
  wrapEl.addEventListener("mouseleave", () => { timer = setInterval(tick, auto); });
}

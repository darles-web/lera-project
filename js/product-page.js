/* Логика страницы растения (вынесена из HTML ради строгой CSP) */
renderHeader(); renderFooter();

const id = Number(new URLSearchParams(location.search).get("id"));
const p = Number.isSafeInteger(id) ? PRODUCTS.find(x => x.id === id) : null;
const main = document.getElementById("main");

if (!p) {
  main.innerHTML = `<div class="empty"><h2>Растение не найдено</h2>
    <p style="margin-top:14px"><a class="btn" href="catalog.html">Вернуться в каталог</a></p></div>`;
} else {
  document.title = p.name + " — питомник «ДарЛес»";
  const meta = document.querySelector('meta[name="description"]');
  if (meta) meta.setAttribute("content", (p.short || p.name) + " — питомник «ДарЛес», Крым.");

  const images = [p.image, ...(p.gallery || [])].map(safeImg);
  const paras = String(p.description || "").split(/\n\s*\n/)
    .filter(t => t.trim()).map(t => `<p>${esc(t.trim())}</p>`).join("");
  const catTitle = esc(CATEGORIES[p.category]?.title || "Каталог");
  const catKey = encodeURIComponent(p.category);

  main.innerHTML = `
    <nav class="crumbs" style="padding-top:26px" aria-label="Хлебные крошки">
      <a href="index.html">Главная</a> / <a href="catalog.html?cat=${catKey}">${catTitle}</a> / ${esc(p.name)}
    </nav>
    <div class="product" itemscope itemtype="https://schema.org/Product">
      <div class="gallery">
        <div class="gallery__main"><img id="mainImg" itemprop="image" src="${esc(images[0])}" alt="${esc(p.name)}"></div>
        ${images.length > 1 ? `<div class="gallery__thumbs">${images.map((src, i) =>
          `<img src="${esc(src)}" data-src="${esc(src)}" class="${i === 0 ? "active" : ""}" tabindex="0" role="button" alt="${esc(p.name)} — фото ${i + 1}">`).join("")}</div>` : ""}
      </div>
      <div>
        <div class="product__cat">${catTitle}</div>
        <h1 class="product__title" itemprop="name">${esc(p.name)}</h1>
        <div class="product__price" itemprop="offers" itemscope itemtype="https://schema.org/Offer">
          <meta itemprop="priceCurrency" content="RUB">
          <meta itemprop="price" content="${Number(p.price)}">
          <link itemprop="availability" href="https://schema.org/InStock">
          ${esc(money(p.price))}
        </div>
        <div class="product__note">Цена указана за одно растение. Наличие и размеры уточняйте по телефону.</div>
        <div class="product__actions">
          <a class="btn" href="${esc(telHref(CONTACTS.phones[0]))}">Связаться · ${esc(CONTACTS.phones[0])}</a>
          <a class="btn btn--ghost" href="${esc(safeUrl(CONTACTS.telegram))}" target="_blank" rel="noopener noreferrer">Telegram</a>
          <a class="btn btn--ghost" href="${esc(safeUrl(CONTACTS.vk))}" target="_blank" rel="noopener noreferrer">ВКонтакте</a>
        </div>
        <div class="contact-card" style="grid-template-columns:1fr;margin-top:26px">
          <div>
            <h2 style="font-size:20px">Как заказать</h2>
            <span style="opacity:.9">Позвоните нам или напишите в соцсетях — расскажем о наличии, размерах и доставке.</span>
            ${CONTACTS.phones.slice(1).map(ph => `<a href="${esc(telHref(ph))}">${esc(ph)}</a>`).join("")}
            <a href="mailto:${esc(CONTACTS.email)}">${esc(CONTACTS.email)}</a>
          </div>
        </div>
      </div>
    </div>
    <div class="product__desc">
      <h2>Описание</h2>
      <div itemprop="description">${paras}</div>
    </div>`;

  const mainImg = document.getElementById("mainImg");
  const thumbs = main.querySelectorAll(".gallery__thumbs img");
  const pick = t => {
    mainImg.src = t.dataset.src;
    thumbs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
  };
  thumbs.forEach(t => {
    t.addEventListener("click", () => pick(t));
    t.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(t); } });
  });

  document.getElementById("related").innerHTML =
    PRODUCTS.filter(x => x.category === p.category && x.id !== p.id).slice(0, 4).map(cardHTML).join("");

}

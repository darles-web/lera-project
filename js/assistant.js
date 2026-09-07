/* =====================================================================
   ПОМОЩНИК ПИТОМНИКА «ДарЛес»
   Умный виджет: помогает искать растения и перемещаться по сайту.
   Работает без внешних сервисов — весь поиск происходит в браузере.
   Подключается на все страницы одной строкой:
   <script src="js/assistant.js" defer></script>
   ===================================================================== */

(function () {
  if (typeof PRODUCTS === "undefined") return;

  /* ---------- утилиты ---------- */
  const norm = s => String(s).toLowerCase().replace(/ё/g, "е").trim();
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = n => new Intl.NumberFormat("ru-RU").format(n) + " ₽";
  const CAT = { hvoynye: "Хвойные", listvennye: "Лиственные", mnogoletnie: "Многолетние" };
  const W = (re, s) => { const r = new RegExp("(^|[^а-яa-z])(" + re + ")", "i"); return r.test(s); };

  const STOP = new Set(("и в во не на под для с со а но или мне нужен нужна нужно хочем хотим хочу " +
    "подскажи скажи пожалуйста покажи найди ищу поиск посмотри какое какие какой какая сколько " +
    "есть ли у вас вас ваш питомник сайт растения растение сорт сорта растений чем что где когда " +
    "как это оно они мне его ей ему купить куплю продаете растет растут растешь " +
    "все вся весь до от за руб рублей рубля").split(" "));

  /* ---------- условия выращивания: слово из вопроса -> признак в описании ---------- */
  const CONDITIONS = [
    { key: "тень",      re: "тень|тени|тенист|теневыносл|затен|полутен",  test: s => W("тень|тени|тенист|теневыносл|затен", s) || /полутен/.test(s), tip: "которые хорошо переносят тень и полутень" },
    { key: "солнце",    re: "солнц",                                      test: s => W("солнц", s), tip: "любящие солнце" },
    { key: "засуха",    re: "засух|жар",                                  test: s => W("засух|жар", s), tip: "засухоустойчивые" },
    { key: "изгородь",  re: "изгород|забор",                              test: s => W("изгород", s), tip: "для живой изгороди" },
    { key: "склон",     re: "склон|откос|укреп",                          test: s => W("склон|откос", s), tip: "для склонов и откосов" },
    { key: "рокарий",   re: "рокар|альпин|камен|горк|горка|горке",        test: s => W("рокар|альпин|каменист", s), tip: "для рокариев и альпийских горок" },
    { key: "контейнер", re: "контейнер|горшк|кадк|террас|балкон",         test: s => W("контейнер|кадк|террас", s), tip: "для контейнеров и террас" },
    { key: "злаки",     re: "злак",                                       test: s => W("злак", s), tip: "декоративные злаки" },
    { key: "голубой",   re: "голуб|серебрист|сиз",                        test: s => W("голуб|серебрист|сиз", s), tip: "с голубой и серебристой листвой" },
    { key: "розовый",   re: "розов",                                      test: s => W("розов", s), tip: "с розовым цветением" },
    { key: "белый",     re: "бел",                                        test: s => W("бел", s), tip: "с белым цветением" },
    { key: "карлик",    re: "карлик|низкоросл|миниатюр|небольш|невысок",  test: s => W("карлик|низкоросл|невысок", s), tip: "низкорослые и карликовые" },
    { key: "быстрый",   re: "быстрорастущ|быстро раст|побыстр",           test: s => W("быстр", s), tip: "быстрорастущие" },
    { key: "мороз",     re: "мороз|зимостойк",                            test: s => W("морозостойк|зимует", s), tip: "морозостойкие" },
    { key: "ковер",     re: "почвопокров|ковер|ковёр|ковра|стелющ",       test: s => W("почвопокров|стелющ|ковер|ковёр", s), tip: "почвопокровные" },
    { key: "цветение",  re: "цветен|цветет|цветёт|цветущ|цветут",         test: s => W("цветен|цветет|цветёт|цветущ|цветут", s), tip: "с красивым цветением" },
    { key: "вечнозел",  re: "вечнозелен|вечнозелён",                      test: s => /вечнозелен|вечнозелён/.test(s), tip: "вечнозелёные" },
  ];

  /* слова-триггеры категорий (для запросов) */
  const CAT_RE = {
    hvoynye: "хвойн|ту[яюе]|можжевельник|ель|сосн|кипарис|пихт|тис",
    listvennye: "лиственн|кустарник|дерев|фотиния|барбарис|гортензия|аукуба|лагерстр",
    mnogoletnie: "многолетн|цвет|злак|трав|хост|просо|пеннисетум",
  };

  /* ---------- DOM виджета ---------- */
  const fab = document.createElement("button");
  fab.className = "ai-fab";
  fab.type = "button";
  fab.setAttribute("aria-label", "Открыть помощника");
  fab.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M17 8C8 10 5.9 16.2 3.8 21.7l1.9.3.9-2.4C12 20 17 17 19 8c.5-2.3 1-4.5 1-4.5s-1.5 2-3 4.5z"/></svg>';

  const box = document.createElement("div");
  box.className = "ai-box";
  box.innerHTML = `
    <div class="ai-head">
      <div class="ai-head__ava">🌿</div>
      <div><b>Помощник «ДарЛес»</b><span>поиск растений и подсказки по сайту</span></div>
      <button class="ai-x" type="button" aria-label="Закрыть">✕</button>
    </div>
    <div class="ai-msgs" id="aiMsgs"></div>
    <div class="ai-chips" id="aiChips"></div>
    <div class="ai-inputrow">
      <input id="aiInput" type="text" placeholder="Например: туя для изгороди до 1500 ₽" autocomplete="off">
      <button id="aiSend" type="button" aria-label="Отправить">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>
      </button>
    </div>`;
  document.body.append(fab, box);

  const msgs = box.querySelector("#aiMsgs");
  const chipsEl = box.querySelector("#aiChips");
  const input = box.querySelector("#aiInput");

  fab.addEventListener("click", () => {
    box.classList.toggle("open");
    if (box.classList.contains("open")) { input.focus(); if (!msgs.children.length) welcome(); }
  });
  box.querySelector(".ai-x").addEventListener("click", () => box.classList.remove("open"));
  box.querySelector("#aiSend").addEventListener("click", send);
  input.addEventListener("keydown", e => { if (e.key === "Enter") send(); });

  /* ---------- сообщения ---------- */
  function bubble(html, who = "bot") {
    const d = document.createElement("div");
    d.className = "ai-msg ai-msg--" + who;
    d.innerHTML = html;
    msgs.appendChild(d);
    msgs.scrollTop = msgs.scrollHeight;
    d.querySelectorAll("a").forEach(a => a.addEventListener("click", () => setTimeout(() => box.classList.remove("open"), 150)));
  }
  function setChips(list) {
    chipsEl.innerHTML = (list || DEFAULT_CHIPS).map(c => `<button type="button" data-q="${esc(c.q)}">${esc(c.t)}</button>`).join("");
    chipsEl.querySelectorAll("button").forEach(b => b.addEventListener("click", () => {
      input.value = b.dataset.q; send();
    }));
  }
  const DEFAULT_CHIPS = [
    { q: "Хвойные растения", t: "🌱 Хвойные" },
    { q: "Что растёт в тени?", t: "🌳 Для тени" },
    { q: "Дешевле 1000 ₽", t: "💰 До 1000 ₽" },
    { q: "Как заказать?", t: "📋 Как заказать" },
  ];

  function welcome() {
    bubble(`Здравствуйте! 🌿 Я помогу подобрать растение и найти нужное на сайте.<br>
      Спросите, например: <b>«туя»</b>, <b>«что растёт в тени»</b>, <b>«хвойные до 1000 ₽»</b>
      или <b>«как заказать»</b>.`);
    setChips();
  }

  function cards(list, { max = 6, tail = "" } = {}) {
    const shown = list.slice(0, max).map(p => `
      <a class="ai-card" href="product.html?id=${p.id}">
        <img src="${prodImage(p)}" alt="" loading="lazy">
        <span class="ai-card__n">${esc(p.name)}</span>
        <span class="ai-card__p">${money(p.price)}${p.size ? ` · ${p.size}` : ""}</span>
      </a>`).join("");
    const more = list.length > max
      ? `<div class="ai-more">Показал ${max} из ${list.length} — уточните запрос или откройте каталог.</div>` : "";
    return `<div class="ai-cards">${shown}</div>${more}${tail}`;
  }

  const catLink = key => `<div class="ai-more"><a href="catalog.html?cat=${key}">Открыть в каталоге →</a></div>`;

  /* ---------- поиск ---------- */
  function tokensOf(q) {
    return norm(q).split(/[^a-zа-я0-9-]+/i).filter(t => t.length > 1 && !STOP.has(t));
  }

  function scoreTokens(tokens) {
    if (!tokens.length) return [];
    const scored = PRODUCTS.map(p => {
      const name = norm(p.name), short = norm(p.short || ""), desc = norm(p.description || "");
      let score = 0;
      for (const t of tokens) {
        if (name.includes(t)) score += 6;
        if (short.includes(t)) score += 4;
        if (desc.includes(t)) score += 2;
        if (t.length >= 5 && name.includes(t.slice(0, -2))) score += 3;
      }
      return { p, score };
    }).filter(x => x.score >= 4);
    scored.sort((a, b) => b.score - a.score || a.p.price - b.p.price);
    return scored.map(x => x.p);
  }

  /* ---------- ответ ---------- */
  function answer(q) {
    const nq = norm(q);

    /* приветствие и благодарность */
    if (/(^|\s)(привет|здравству|здраст|добрый|доброе|хай|hello|hi)(\s|$|!|,)/.test(nq) && nq.length < 40)
      return { html: `Здравствуйте! 🌿 Чем помочь? Могу найти растение, подсказать по уходу или рассказать, как заказать.`, chips: 1 };
    if (/(спасибо|благодар|пасиб)/.test(nq))
      return { html: `Пожалуйста! 🌱 Если понадобится ещё что-то — я здесь. Хорошего дня в саду!` };

    /* контакты */
    if (/(телефон|позвонить|связаться|контакт|номер|адрес|почта|email|где вы|как добраться|как найти|доехать|соцсет)/.test(nq)) {
      const C = typeof CONTACTS !== "undefined" ? CONTACTS : null;
      return { html: `Вот наши контакты:<br>
        📞 ${C ? C.phones.map(p => `<a href="tel:${p.replace(/[^\d+]/g, "")}">${p}</a>`).join(" · ") : ""}<br>
        ✉️ <a href="mailto:${C ? C.email : ""}">${C ? C.email : ""}</a><br>
        📍 ${C ? C.address : ""}<br>
        💬 <a href="${C ? C.telegram : ""}" target="_blank" rel="noopener">Telegram</a> ·
        <a href="${C ? C.vk : ""}" target="_blank" rel="noopener">ВКонтакте</a>`,
        tail: `<div class="ai-more"><a href="index.html#contacts">Все контакты →</a></div>` };
    }

    /* как заказать / доставка */
    if (/(заказ|купить|оформить|доставк|оплат|самовывоз|привез)/.test(nq)) {
      return { html: `Оформить заказ просто:<br>
        <b>1.</b> Выберите растение в <a href="catalog.html">каталоге</a> 🌿<br>
        <b>2.</b> Позвоните или напишите — подтвердим наличие и размеры<br>
        <b>3.</b> Заберите в питомнике или согласуем доставку<br><br>
        ${typeof CONTACTS !== "undefined" ? `📞 <a href="tel:${CONTACTS.phones[0].replace(/[^\d+]/g, "")}">${CONTACTS.phones[0]}</a> · <a href="${CONTACTS.telegram}" target="_blank" rel="noopener">Telegram</a>` : ""}` };
    }

    /* навигация по каталогу */
    {
      const toks = tokensOf(q).filter(t => !/^(каталог|витрина|витрине|ассортимент|товары)$/.test(t));
      if (/(каталог|витрин|ассортимент)/.test(nq) && !toks.length) {
        return { html: `В каталоге три категории — выберите нужную:`, tail:
          `<div class="ai-cards">
            <a class="ai-card ai-card--wide" href="catalog.html?cat=hvoynye"><span class="ai-card__n">🌲 Хвойные</span></a>
            <a class="ai-card ai-card--wide" href="catalog.html?cat=listvennye"><span class="ai-card__n">🌳 Лиственные</span></a>
            <a class="ai-card ai-card--wide" href="catalog.html?cat=mnogoletnie"><span class="ai-card__n">🌾 Многолетние</span></a>
          </div>` };
      }
    }

    /* разбор: категория, условия, цена, значимые слова */
    let cat = null;
    if (W(CAT_RE.hvoynye, nq)) cat = "hvoynye";
    else if (W(CAT_RE.listvennye, nq)) cat = "listvennye";
    else if (W(CAT_RE.mnogoletnie, nq)) cat = "mnogoletnie";

    const conds = CONDITIONS.filter(c => W(c.re, nq));

    let maxP = null, minP = null;
    const m1 = nq.match(/(?:до|дешевле|меньше|не дороже|бюджет)\s*(\d{3,6})/);
    if (m1) maxP = +m1[1];
    const m2 = nq.match(/(?:от|дороже)\s*(\d{3,6})/);
    if (m2) minP = +m2[1];

    const hasFilters = !!(cat || conds.length || maxP != null || minP != null);

    /* значимые токены — то, что не является фильтром */
    const meaningful = tokensOf(q).filter(t =>
      !/^\d+$/.test(t) &&
      !(cat && W(CAT_RE[cat], t)) &&
      !conds.some(c => W(c.re, t)));

    let list = null, title = "";

    if (hasFilters) {
      list = PRODUCTS.filter(p => {
        const hay = norm(p.name + " " + (p.short || "") + " " + (p.description || ""));
        if (cat && p.category !== cat) return false;
        for (const c of conds) if (!c.test(hay)) return false;
        if (maxP != null && p.price > maxP) return false;
        if (minP != null && p.price < minP) return false;
        return true;
      });
      /* если есть ещё и значимые слова — пересекаем с поиском по ним */
      if (meaningful.length) {
        const byTok = scoreTokens(meaningful);
        const ids = new Set(byTok.map(p => p.id));
        const inter = list.filter(p => ids.has(p.id));
        if (inter.length) list = inter;
        else if (!list.length) list = byTok;
      }
      const parts = [];
      if (cat) parts.push(CAT[cat].toLowerCase());
      conds.forEach(c => parts.push(c.tip));
      if (maxP != null) parts.push("до " + money(maxP));
      if (minP != null) parts.push("от " + money(minP));
      title = "По запросу («" + parts.join(", ") + "») нашёл:";
    } else {
      list = scoreTokens(tokensOf(q));
      title = "Вот что нашёл по запросу «" + esc(q) + "»:";
    }

    if (list && list.length) {
      list = [...list].sort((a, b) => a.price - b.price);
      return { html: `<b>${title}</b>` + cards(list, { tail: catLink(list[0].category) }) };
    }

    /* ничего не нашли */
    return { html: `Не нашёл подходящего растения по запросу «${esc(q)}» 😔<br>
      В питомнике более 350 сортов — часть доступна под заказ. Позвоните нам, подберём!
      ${typeof CONTACTS !== "undefined" ? `<br>📞 <a href="tel:${CONTACTS.phones[0].replace(/[^\d+]/g, "")}">${CONTACTS.phones[0]}</a>` : ""}`,
      tail: `<div class="ai-more"><a href="catalog.html">Открыть весь каталог →</a></div>`,
      chips: 1 };
  }

  function send() {
    const q = input.value.trim();
    if (!q) return;
    bubble(esc(q), "user");
    input.value = "";
    const a = answer(q);
    setTimeout(() => {
      bubble(a.html + (a.tail || ""));
      if (a.chips) setChips();
    }, 250);
  }

  /* доступ для тестов (безопасно: секретов нет) */
  if (typeof window !== "undefined") window.DarlesAssistant = { answer, welcome };
})();

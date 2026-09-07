/* =====================================================================
   АНІМАЦІИ САЙТА «ДарЛес»
   - reveal при скролле (плавное появление блоков)
   - анимированные счётчики статистики
   - летающие листики на фоне hero
   - эффект шапки при скролле
   - кнопка «наверх»
   ===================================================================== */

(function(){
  "use strict";

  /* ---------- 1. Плавное появление блоков при скролле ---------- */
  const revealSelectors = [
    ".about__photo", ".about__text", ".stat", ".fact", ".kind",
    ".contact-card", ".carousel", ".circles .circle", ".section .center h2",
    ".lead", ".contact-card > div",
    ".product__gallery, .product > div:last-child",
    ".toolbar", ".grid .card",
    ".row-carousel",
  ];

  function setupReveal() {
    // Добавляем классы к тем блокам, которые есть на этой странице
    revealSelectors.forEach(sel => {
      document.querySelectorAll(sel).forEach((el, i) => {
        if (!el.classList.contains("reveal")) {
          el.classList.add("reveal");
          // добавляем направления для некоторых блоков
          if (el.matches(".about__photo, .circle:nth-child(odd)")) el.classList.add("reveal--left");
          if (el.matches(".about__text, .circle:nth-child(even)")) el.classList.add("reveal--right");
          if (el.matches(".stat, .fact, .center h2")) el.classList.add("reveal--scale");
          // убираем встроенную transition-delay от nth-child, если много карточек
          if (el.matches(".grid .card")) el.style.transitionDelay = (i * 0.06 % .5) + "s";
        }
      });
    });

    if (!("IntersectionObserver" in window)) {
      // В старых браузерах просто показываем
      document.querySelectorAll(".reveal").forEach(el => el.classList.add("in-view"));
      return;
    }

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add("in-view");
          if (e.target.matches(".reveal")) obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -50px 0px" });

    document.querySelectorAll(".reveal").forEach(el => obs.observe(el));
  }

  /* ---------- 2. Анимированные счётчики (15 га, 400 000+, 350+) ---------- */
  function setupCounters() {
    const stats = document.querySelectorAll(".stat__num");
    if (!stats.length || !("IntersectionObserver" in window)) return;

    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        animateStat(e.target);
        obs.unobserve(e.target);
      });
    }, { threshold: 0.5 });

    stats.forEach(s => obs.observe(s));
  }

  function animateStat(el) {
    const raw = el.textContent.trim();
    // Парсим число (с пробелами и плюсом в конце)
    const match = raw.match(/([\d\s]+)(.*)/);
    if (!match) return;
    const target = parseInt(match[1].replace(/\s/g, ""), 10);
    const suffix = match[2] || "";
    if (!target || target < 2) return;

    const start = performance.now();
    const dur = 1400;
    const startVal = 0;

    function frame(now) {
      const t = Math.min(1, (now - start) / dur);
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(startVal + (target - startVal) * eased);
      el.textContent = new Intl.NumberFormat("ru-RU").format(val) + suffix;
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = raw; // финальный исходный формат
    }
    requestAnimationFrame(frame);
  }

  /* ---------- 3. Летающие листики в hero ---------- */
  function setupLeaves() {
    const hero = document.querySelector(".hero");
    if (!hero) return;

    const num = window.innerWidth < 700 ? 6 : 12;
    const leafSVG = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 8C8 10 5.9 16.2 3.8 21.7l1.9.3.9-2.4C12 20 17 17 19 8c.5-2.3 1-4.5 1-4.5s-1.5 2-3 4.5z"/></svg>`;

    for (let i = 0; i < num; i++) {
      const leaf = document.createElement("div");
      leaf.className = "leaf";
      leaf.innerHTML = leafSVG;
      leaf.style.color = ["#9fc9a5", "#b7d99b", "#7ba785", "#c9e1b0", "#97b89b"][i % 5];
      leaf.style.left = (Math.random() * 100) + "%";
      leaf.style.fontSize = (16 + Math.random() * 18) + "px";
      const dur = 10 + Math.random() * 14;
      leaf.style.animationDuration = dur + "s";
      leaf.style.animationDelay = (-Math.random() * dur) + "s";
      leaf.style.setProperty("--drift", ((Math.random() * 200) - 40) + "px");
      leaf.style.opacity = 0.18 + Math.random() * 0.3;
      hero.appendChild(leaf);
    }
  }

  /* ---------- 4. Тень шапки при скролле ---------- */
  function setupTopbar() {
    const topbar = document.querySelector(".topbar");
    if (!topbar) return;
    const onScroll = () => {
      topbar.classList.toggle("scrolled", window.scrollY > 10);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------- 5. Кнопка «наверх» ---------- */
  function setupBackToTop() {
    const btn = document.createElement("button");
    btn.className = "to-top";
    btn.type = "button";
    btn.setAttribute("aria-label", "Наверх");
    btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 4l-8 8h5v8h6v-8h5z"/></svg>';
    document.body.appendChild(btn);

    const onScroll = () => {
      btn.classList.toggle("show", window.scrollY > 500);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    onScroll();
  }

  /* ---------- 6. Плавное появление карточек в каталоге после загрузки ---------- */
  function setupGridStagger() {
    const grid = document.querySelector(".grid");
    if (!grid) return;
    const observer = new MutationObserver(() => applyStagger());
    observer.observe(grid, { childList: true });
    applyStagger();

    function applyStagger() {
      grid.querySelectorAll(".card:not(.staggered)").forEach((c, i) => {
        c.classList.add("staggered", "reveal");
        c.style.transitionDelay = (i * 0.04 % .4) + "s";
        requestAnimationFrame(() => c.classList.add("in-view"));
      });
    }
  }

  /* ---------- Инициализация ---------- */
  function init() {
    setupTopbar();
    setupLeaves();
    setupReveal();
    setupCounters();
    setupBackToTop();
    setupGridStagger();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

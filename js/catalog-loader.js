/* =====================================================================
   ЗАГРУЗЧИК КАТАЛОГА «ДарЛес»
   ---------------------------------------------------------------------
   Если сайт работает на хостинге с PHP (папка api/), каталог читается
   с сервера: data/catalog.json — он же, который редактирует админ-панель.

   Если PHP недоступен (статический хостинг, файл открыт локально),
   сайт работает с запасным каталогом из js/products.js — как раньше.

   Подключается ПОСЛЕ js/products.js и ПЕРЕД рендерингом страницы:
     <script src="js/products.js"></script>
     <script src="js/catalog-loader.js"></script>
     ...
     await CatalogServer.load();  // до отрисовки каталога
   ===================================================================== */

window.CatalogServer = (() => {
  let mode = "unknown"; // "server" | "static"

  function setMode(m) { mode = m; }
  function isServer() { return mode === "server"; }

  /* Есть ли на сервере PHP с нашим API? */
  async function ping() {
    if (mode !== "unknown") return isServer();
    try {
      const r = await fetch("api/ping.php", { cache: "no-store" });
      const j = await r.json();
      setMode(j && j.ok ? "server" : "static");
    } catch (e) {
      setMode("static");
    }
    return isServer();
  }

  /*
    Заменить содержимое глобального PRODUCTS серверным каталогом.
    Метод «вместо» (in-place): все скрипты (каталог, карточка,
    помощник, офлайн-распознавание) работают с тем же массивом.
    Возвращает true, если применены данные с сервера.
  */
  async function load() {
    if (!(await ping())) return false;
    try {
      const r = await fetch("api/catalog.php", { cache: "no-store" });
      if (!r.ok) return false; // каталог ещё не сохранён — используем js/products.js
      const j = await r.json();
      if (!j || !Array.isArray(j.products) || !j.products.length) return false;
      PRODUCTS.length = 0;
      for (const p of j.products) PRODUCTS.push(p);
      return true;
    } catch (e) {
      return false;
    }
  }

  return { ping, load, isServer };
})();

/* Логика главной страницы (вынесена из HTML ради строгой CSP) */
renderHeader();
  renderFooter();
  document.getElementById("ico-tree").innerHTML = ICONS.tree;
  document.getElementById("ico-leaf").innerHTML = ICONS.leaf;
  document.getElementById("featured").innerHTML = PRODUCTS.slice(0, 8).map(cardHTML).join("");
  initHeroCarousel(document.getElementById("nurseryCarousel"), 5000);
  initRowCarousel(document.querySelector(".row-carousel"), 4000);

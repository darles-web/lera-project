/* Логика страницы каталога (вынесена из HTML ради строгой CSP) */
renderHeader(); renderFooter();

const params = new URLSearchParams(location.search);
let current = params.get("cat") && CATEGORIES[params.get("cat")] ? params.get("cat") : "hvoynye";

const tabsEl = document.getElementById("tabs");
tabsEl.innerHTML = Object.entries(CATEGORIES).map(([key, c]) =>
  `<button class="tab" data-cat="${key}"><img src="${c.icon}" alt="${c.title}">${c.title}</button>`).join("");

tabsEl.addEventListener("click", e => {
  const b = e.target.closest(".tab"); if (!b) return;
  current = b.dataset.cat;
  history.replaceState(null, "", "?cat=" + current);
  render();
});
document.getElementById("search").addEventListener("input", render);
document.getElementById("sort").addEventListener("change", render);

function render() {
  [...tabsEl.children].forEach(t => t.classList.toggle("active", t.dataset.cat === current));
  const q = document.getElementById("search").value.trim().toLowerCase();
  let list = PRODUCTS.filter(p => p.category === current);
  if (q) list = list.filter(p => (p.name + " " + (p.short || "")).toLowerCase().includes(q));
  const s = document.getElementById("sort").value;
  if (s === "price-asc") list.sort((a, b) => a.price - b.price);
  if (s === "price-desc") list.sort((a, b) => b.price - a.price);
  if (s === "name") list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
  document.getElementById("grid").innerHTML = list.map(cardHTML).join("");
  document.getElementById("empty").style.display = list.length ? "none" : "block";
  document.getElementById("count").textContent = list.length + " " +
    (list.length % 10 === 1 && list.length % 100 !== 11 ? "растение" : "растений");
}
render();

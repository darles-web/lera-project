<?php
/* =====================================================================
   API «ДарЛес» — каталог растений (data/catalog.json)
   ---------------------------------------------------------------------
   GET  → отдаёт актуальный каталог (публичные данные, как products.js)
   POST → сохраняет каталог целиком (только с токеном админ-панели)
   ===================================================================== */

require __DIR__ . "/common.php";

$method = $_SERVER["REQUEST_METHOD"];
$file   = DL_DATA . "/catalog.json";

if ($method === "GET") {
  if (!is_file($file)) {
    dl_http_error("Каталог на сервере ещё не сохранён — использую js/products.js", 404);
  }
  $raw = file_get_contents($file);
  $j   = $raw === false ? null : json_decode($raw, true);
  if (!is_array($j) || !isset($j["products"]) || !is_array($j["products"])) {
    dl_http_error("Файл каталога повреждён (data/catalog.json) — восстановите из резервной копии", 500);
  }
  dl_json_response($j);
}

if ($method === "POST") {
  $body = dl_require_auth();
  $products = isset($body["products"]) ? $body["products"] : null;
  if (!is_array($products) || !$products) {
    dl_http_error("Не передан список products (или он пуст)", 400);
  }

  $cats = array("hvoynye", "listvennye", "mnogoletnie");
  $clean = array();
  $seen  = array();
  foreach ($products as $p) {
    if (!is_array($p) || !isset($p["id"]) || !is_numeric($p["id"]) || !isset($p["name"])) continue;
    $id = (int) $p["id"];
    if ($id <= 0 || isset($seen[$id])) continue; // дубли id — пропускаем
    $seen[$id] = true;
    $clean[] = array(
      "id"          => $id,
      "name"        => (string) $p["name"],
      "category"    => in_array(isset($p["category"]) ? $p["category"] : "", $cats, true) ? $p["category"] : "hvoynye",
      "price"       => (int) (isset($p["price"]) ? $p["price"] : 0),
      "available"   => (isset($p["available"]) ? $p["available"] : true) !== false,
      "image"       => (string) (isset($p["image"]) ? $p["image"] : ""),
      "gallery"     => array_values(array_map("strval", (array) (isset($p["gallery"]) ? $p["gallery"] : array()))),
      "short"       => (string) (isset($p["short"]) ? $p["short"] : ""),
      "description" => (string) (isset($p["description"]) ? $p["description"] : ""),
    );
  }
  if (!$clean) dl_http_error("В списке нет валидных записей", 400);

  usort($clean, function ($a, $b) { return $a["id"] - $b["id"]; });

  if (!is_dir(DL_DATA)) {
    if (!@mkdir(DL_DATA, 0755, true)) {
      dl_http_error("Не удалось создать папку data/ — проверьте права на запись", 500);
    }
  }

  $payload = array("savedAt" => time(), "products" => $clean);
  $json    = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  if ($json === false) dl_http_error("Не удалось собрать JSON каталога", 500);

  $tmp = $file . ".tmp";
  if (@file_put_contents($tmp, $json, LOCK_EX) === false || !@rename($tmp, $file)) {
    @unlink($tmp);
    dl_http_error("Не удалось записать data/catalog.json — проверьте права на запись папки data/", 500);
  }

  dl_json_response(array("ok" => true, "count" => count($clean)));
}

dl_http_error("Метод не поддерживается", 405);

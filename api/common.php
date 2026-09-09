<?php
/* =====================================================================
   API «ДарЛес» — общие функции
   ---------------------------------------------------------------------
   Не вызывается напрямую. Используется остальными файлами api/.

   Хранение данных:
     • Каталог растений  → data/catalog.json          (пишет api/catalog.php)
     • Фото каталога     → images/catalog/*.jpg       (пишет api/upload.php)
     • Ключ ИИ и настройки → api/config.local.php     (пишет api/config.php)
     • Пароль админки    → js/admin-auth.js (константа HASH)

   Защита: все «пишущие» запросы требуют токен — SHA-256 хеш пароля
   админ-панели (тот же, что в js/admin-auth.js).
   ===================================================================== */

error_reporting(E_ALL);
ini_set("display_errors", "0");

define("DL_ROOT", dirname(__DIR__));
define("DL_DATA", DL_ROOT . "/data");
define("DL_CFG_FILE", __DIR__ . "/config.local.php");

/* ---------- ответ JSON ---------- */
function dl_json_response($data, $code = 200) {
  http_response_code($code);
  header("Content-Type: application/json; charset=utf-8");
  header("Cache-Control: no-store");
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function dl_http_error($message, $code) {
  dl_json_response(array("ok" => false, "error" => $message), $code);
}

/* ---------- тело запроса JSON ---------- */
function dl_read_json_body() {
  $raw = file_get_contents("php://input");
  if ($raw === false || $raw === "") return null;
  $j = json_decode($raw, true);
  return is_array($j) ? $j : null;
}

/* ---------- конфигурация (ключ ИИ и пр.) ---------- */
function dl_config() {
  static $cfg = null;
  if ($cfg !== null) return $cfg;

  $defaults = array(
    "ai" => array(
      "provider" => "openai",
      "model"    => "gpt-4o-mini",
      "key"      => "",
      "base"     => "",
    ),
  );

  if (is_file(DL_CFG_FILE)) {
    $DL_LOAD_CONFIG = true;
    $loaded = @include DL_CFG_FILE;
    if (is_array($loaded)) {
      $cfg = array_replace_recursive($defaults, $loaded);
      return $cfg;
    }
  }

  $cfg = $defaults;
  dl_write_config($cfg); // создаём файл с дефолтами
  return $cfg;
}

function dl_write_config(array $cfg) {
  $php = "<?php\n"
       . "/* Настройки API (ключ ИИ). Генерируется админ-панелью — "
       . "редактируйте через admin.html → «Настройки», не вручную. */\n"
       . "if (!isset(\$DL_LOAD_CONFIG)) { http_response_code(403); exit; }\n"
       . "return " . var_export($cfg, true) . ";\n";
  $tmp = DL_CFG_FILE . ".tmp";
  if (@file_put_contents($tmp, $php, LOCK_EX) !== false && @rename($tmp, DL_CFG_FILE)) {
    return true;
  }
  @unlink($tmp);
  return false;
}

/* ---------- пароль админ-панели ---------- */
/* Единственный источник: константа HASH в js/admin-auth.js. */
function dl_admin_hash() {
  static $h = null;
  if ($h !== null) return $h;
  $js = @file_get_contents(DL_ROOT . "/js/admin-auth.js");
  if ($js !== false && preg_match('/const HASH = "([0-9a-f]{64})"/', $js, $m)) {
    $h = $m[1];
    return $h;
  }
  $h = null;
  return $h;
}

/* ---------- авторизация «пишущих» запросов ---------- */
/* Возвращает тело запроса JSON, бросает HTTP-ошибку, если токен не подходит. */
function dl_require_auth() {
  $body = dl_read_json_body();
  if (!is_array($body)) dl_http_error("Некорректный запрос (ожидается JSON)", 400);
  $token = isset($body["token"]) ? strtolower(trim($body["token"])) : "";
  $hash = dl_admin_hash();
  if (!$hash || !hash_equals($hash, $token)) {
    dl_http_error("Нет доступа: токен админ-панели не подходит", 403);
  }
  return $body;
}

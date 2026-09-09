<?php
/* =====================================================================
   API «ДарЛес» — общие функции
   ---------------------------------------------------------------------
   Не вызывается напрямую. Используется остальными файлами api/.

   Хранение данных:
     • Каталог растений  → data/catalog.json          (пишет api/catalog.php)
     • Фото каталога     → images/catalog/*.jpg       (пишет api/upload.php)
     • Ключ ИИ и настройки → api/config.local.php     (пишет api/config.php)

   ВАЖНО: с 09.09.2026 админ-панель БЕЗ пароля (решение владельца) —
   доступ к api/ открыт. Поэтому все «пишущие» запросы ограничены
   скоростным фильтром (dl_rate_limit): максимум N запросов в час
   с одного IP. Ключ ИИ наружу не отдаётся — только маска вида sk-…1234.
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

/* ---------- скоростной фильтр (защита открытого API) ---------- */
/* Не более $limit запросов действия $action в час с одного IP.
   Счётчики лежат в data/ratelimit.json и чистятся сами. */
function dl_rate_limit($action, $limit) {
  $ip   = isset($_SERVER["REMOTE_ADDR"]) ? $_SERVER["REMOTE_ADDR"] : "unknown";
  $now  = time();
  $file = DL_DATA . "/ratelimit.json";

  $data = array();
  if (is_file($file)) {
    $raw = @file_get_contents($file);
    $d   = $raw === false ? null : json_decode($raw, true);
    if (is_array($d)) $data = $d;
  }

  // чистим записи старше часа
  foreach ($data as $k => $v) {
    if (!is_array($v) || $now - (int) $v["ts"] > 3600) unset($data[$k]);
  }

  $key   = $ip . "|" . $action;
  $count = (isset($data[$key]) && is_array($data[$key])) ? (int) $data[$key]["count"] : 0;

  if ($count >= $limit) {
    dl_http_error("Слишком много запросов. Попробуйте ещё раз через час.", 429);
  }

  $data[$key] = array("count" => $count + 1, "ts" => $now);
  if (!is_dir(DL_DATA)) @mkdir(DL_DATA, 0755, true);
  $tmp = $file . ".tmp";
  @file_put_contents($tmp, json_encode($data), LOCK_EX);
  @rename($tmp, $file);
}

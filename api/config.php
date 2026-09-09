<?php
/* =====================================================================
   API «ДарЛес» — настройки: ключ ИИ + смена пароля админ-панели
   ---------------------------------------------------------------------
   GET  → текущие настройки { ai: { provider, model, key, base } }
   POST → { token, ai: { provider, model, key, base } }            — сохранить
         { token, change_password: "новый пароль" }                 — сменить пароль

   Смена пароля перезаписывает константу HASH в js/admin-auth.js —
   старая сессия админки автоматически становится недействительной.
   ===================================================================== */

require __DIR__ . "/common.php";

$method = $_SERVER["REQUEST_METHOD"];

/* ---------- чтение настроек (только после входа в панель) ---------- */
if ($method === "GET") {
  /* GET без тела — авторизуем по заголовку Authorization: Bearer <hash>
     (на некоторых хостингах заголовки режутся — тогда token в URL) */
  $hash = dl_admin_hash();
  $auth = isset($_SERVER["HTTP_AUTHORIZATION"]) ? $_SERVER["HTTP_AUTHORIZATION"] : "";
  $token = strtolower(trim(preg_replace('/^Bearer\s+/i', "", $auth)));
  if ($token === "" && isset($_GET["token"])) $token = strtolower(trim($_GET["token"]));
  if (!$hash || !hash_equals($hash, $token)) {
    dl_http_error("Нет доступа: токен админ-панели не подходит", 403);
  }
  $cfg = dl_config();
  dl_json_response(array("ok" => true, "ai" => $cfg["ai"]));
}

if ($method !== "POST") {
  dl_http_error("Метод не поддерживается", 405);
}

$body = dl_require_auth();

/* ---------- смена пароля ---------- */
if (isset($body["change_password"])) {
  $newPass = (string) $body["change_password"];
  if (strlen($newPass) < 4) dl_http_error("Пароль должен содержать минимум 4 символа", 400);

  // Соль должна совпадать с SALT в js/admin-auth.js
  $salt = "darles_salt_w79r4l905";
  $newHash = hash("sha256", $salt . ":" . $newPass);

  $authFile = DL_ROOT . "/js/admin-auth.js";
  $js = @file_get_contents($authFile);
  if ($js === false) dl_http_error("Не найден js/admin-auth.js", 500);
  if (!preg_match('/const HASH = "[0-9a-f]{64}"/', $js)) {
    dl_http_error("В js/admin-auth.js не найдена константа HASH", 500);
  }

  $newJs = preg_replace('/const HASH = "[0-9a-f]{64}"/', 'const HASH = "' . $newHash . '"', $js, 1, $count);
  if ($newJs === false || $count !== 1) dl_http_error("Не удалось заменить HASH в js/admin-auth.js", 500);

  $tmp = $authFile . ".tmp";
  if (@file_put_contents($tmp, $newJs, LOCK_EX) === false || !@rename($tmp, $authFile)) {
    @unlink($tmp);
    dl_http_error("Не удалось сохранить js/admin-auth.js — проверьте права на запись", 500);
  }

  dl_json_response(array("ok" => true, "message" => "Пароль изменён"));
}

/* ---------- сохранение настроек ИИ ---------- */
if (isset($body["ai"]) && is_array($body["ai"])) {
  $ai    = $body["ai"];
  $cfg   = dl_config();
  $newAi = $cfg["ai"];

  $providers = array("openai", "gemini", "anthropic");
  if (isset($ai["provider"]) && in_array($ai["provider"], $providers, true)) {
    $newAi["provider"] = $ai["provider"];
  }
  if (isset($ai["model"])) $newAi["model"] = trim((string) $ai["model"]);
  if (isset($ai["key"]))   $newAi["key"]   = trim((string) $ai["key"]);
  if (isset($ai["base"]))  $newAi["base"]  = trim((string) $ai["base"]);

  $cfg["ai"] = $newAi;
  if (!dl_write_config($cfg)) {
    dl_http_error("Не удалось сохранить api/config.local.php — проверьте права на запись папки api/", 500);
  }

  dl_json_response(array("ok" => true, "ai" => $newAi));
}

dl_http_error("Неизвестное действие", 400);

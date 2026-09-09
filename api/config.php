<?php
/* =====================================================================
   API «ДарЛес» — настройки ИИ (провайдер, модель, ключ, прокси)
   ---------------------------------------------------------------------
   GET  → текущие настройки. ВНИМАНИЕ: сам ключ наружу НЕ отдаётся —
          только флаг keySet и маска вида "sk-…1234".
   POST → { ai: { provider, model, base, key? } }   — сохранить
          { ai: { clear_key: true } }               — убрать ключ

   Доступ открыт (панель без пароля) — защищено скоростным фильтром
   (60 запросов в час с IP).
   ===================================================================== */

require __DIR__ . "/common.php";

$method = $_SERVER["REQUEST_METHOD"];

/* ---------- чтение настроек ---------- */
if ($method === "GET") {
  $cfg = dl_config();
  $ai  = $cfg["ai"];
  $mask = ($ai["key"] !== "")
    ? substr($ai["key"], 0, 3) . "…" . substr($ai["key"], -4)
    : "";
  dl_json_response(array(
    "ok" => true,
    "ai" => array(
      "provider" => $ai["provider"],
      "model"    => $ai["model"],
      "base"     => $ai["base"],
      "keySet"   => $ai["key"] !== "",
      "keyMask"  => $mask,
    ),
  ));
}

if ($method !== "POST") {
  dl_http_error("Метод не поддерживается", 405);
}

dl_rate_limit("config", 60);
$body = dl_read_json_body();
if (!is_array($body)) dl_http_error("Некорректный запрос (ожидается JSON)", 400);

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
  if (isset($ai["base"]))  $newAi["base"]  = trim((string) $ai["base"]);
  // новый ключ — только если прислан непустой; пустой = оставить прежний
  if (isset($ai["key"]) && trim((string) $ai["key"]) !== "") {
    $newAi["key"] = trim((string) $ai["key"]);
  }
  if (!empty($ai["clear_key"])) {
    $newAi["key"] = "";
  }

  $cfg["ai"] = $newAi;
  if (!dl_write_config($cfg)) {
    dl_http_error("Не удалось сохранить api/config.local.php — проверьте права на запись папки api/", 500);
  }

  $mask = ($newAi["key"] !== "")
    ? substr($newAi["key"], 0, 3) . "…" . substr($newAi["key"], -4)
    : "";
  dl_json_response(array(
    "ok" => true,
    "ai" => array(
      "provider" => $newAi["provider"],
      "model"    => $newAi["model"],
      "base"     => $newAi["base"],
      "keySet"   => $newAi["key"] !== "",
      "keyMask"  => $mask,
    ),
  ));
}

dl_http_error("Неизвестное действие", 400);

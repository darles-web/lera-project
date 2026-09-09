<?php
/* =====================================================================
   API «ДарЛес» — прокси ИИ (OpenAI / Gemini / Anthropic)
   ---------------------------------------------------------------------
   Запрос идёт СЕРВЕРОМ к провайдеру, а не браузером:
     • нет CORS-проблем («failed to fetch» в браузере больше не бывает)
     • ключ API не виден посетителям сайта — хранится на сервере
     • работает из любых стран, если сервер видит api.openai.com
       (если не видит — укажите свой адрес API/прокси в настройках)

   POST JSON: { token, action: "test" }
              { token, action: "analyze", b64, mime, system, prompt }
   Ответ:     { ok: true, text: "…" }  |  { ok: false, error: "…" }
   ===================================================================== */

require __DIR__ . "/common.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  dl_http_error("Метод не поддерживается", 405);
}

$body = dl_require_auth();
$cfg  = dl_config();
$ai   = $cfg["ai"];

$provider = isset($ai["provider"]) ? $ai["provider"] : "openai";
$model    = trim((string) $ai["model"]);
$key      = trim((string) $ai["key"]);
$base     = trim((string) $ai["base"]);

$names = array("openai" => "OpenAI", "gemini" => "Gemini", "anthropic" => "Anthropic");
if (!isset($names[$provider])) $provider = "openai";
$name = $names[$provider];

if ($key === "")  dl_http_error("ИИ не настроен: введите ключ API (админ-панель → «Настройки» → «ИИ-помощник»)", 400);
if ($model === "") dl_http_error("Укажите модель ИИ в настройках", 400);

$action = isset($body["action"]) ? $body["action"] : "";

/* ---------- cURL → JSON ---------- */
function dl_curl($method, $url, array $headers, $payload) {
  $ch = curl_init($url);
  curl_setopt_array($ch, array(
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
    CURLOPT_POSTFIELDS     => json_encode($payload, JSON_UNESCAPED_UNICODE),
    CURLOPT_TIMEOUT        => 120,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_SSL_VERIFYPEER => true,
  ));
  $raw    = curl_exec($ch);
  $errno  = curl_errno($ch);
  $err    = curl_error($ch);
  $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  curl_close($ch);

  if ($raw === false || $errno) {
    $known = array(
      6  => "сервер хостинга не может открыть адрес API (нет доступа в интернет или нужен прокси)",
      7  => "сервер хостинга не смог подключиться к API",
      28 => "таймаут: API не ответил в течение 2 минут",
      35 => "ошибка TLS-соединения с API",
      60 => "не удалось проверить TLS-сертификат API (установите свой адрес API/прокси в настройках)",
    );
    $why = isset($known[$errno]) ? $known[$errno] : ("curl error " . $errno . ($err ? " (" . $err . ")" : ""));
    throw new Exception("Нет соединения с API: " . $why);
  }
  return array($status, (string) $raw);
}

function dl_provider_error($raw) {
  $j = json_decode((string) $raw, true);
  if (is_array($j)) {
    if (isset($j["error"]["message"])) return (string) $j["error"]["message"];
    if (isset($j["error"]) && is_string($j["error"])) return $j["error"];
    if (isset($j["message"])) return (string) $j["message"];
  }
  $s = trim(substr((string) $raw, 0, 300));
  return $s !== "" ? $s : "сервер API вернул ошибку без пояснения";
}

/* ---------- тест ключа: маленький текстовый запрос ---------- */
function dl_ai_test($provider, $model, $key, $base) {
  if ($provider === "gemini") {
    $host = $base !== "" ? rtrim($base, "/") : "https://generativelanguage.googleapis.com";
    $url  = $host . "/v1beta/models/" . urlencode($model) . ":generateContent?key=" . urlencode($key);
    list($st, $raw) = dl_curl("POST", $url, array("Content-Type: application/json"), array(
      "contents" => array(array("parts" => array(array("text" => "Ответь одним словом: ok")))),
    ));
    if ($st !== 200) throw new Exception(dl_provider_error($raw));
    return;
  }
  if ($provider === "anthropic") {
    $host = $base !== "" ? rtrim($base, "/") : "https://api.anthropic.com";
    list($st, $raw) = dl_curl("POST", $host . "/v1/messages", array(
      "Content-Type: application/json",
      "x-api-key: " . $key,
      "anthropic-version: 2023-06-01",
    ), array(
      "model"      => $model,
      "max_tokens" => 16,
      "messages"   => array(array("role" => "user", "content" => "Ответь одним словом: ok")),
    ));
    if ($st !== 200) throw new Exception(dl_provider_error($raw));
    return;
  }
  /* openai */
  $host = $base !== "" ? rtrim($base, "/") : "https://api.openai.com";
  list($st, $raw) = dl_curl("POST", $host . "/v1/chat/completions", array(
    "Content-Type: application/json",
    "Authorization: Bearer " . $key,
  ), array(
    "model"      => $model,
    "max_tokens" => 16,
    "messages"   => array(array("role" => "user", "content" => "Ответь одним словом: ok")),
  ));
  if ($st !== 200) throw new Exception(dl_provider_error($raw));
}

/* ---------- распознавание фото ---------- */
function dl_ai_analyze($provider, $model, $key, $base, $b64, $mime, $system, $prompt) {
  if ($provider === "gemini") {
    $host = $base !== "" ? rtrim($base, "/") : "https://generativelanguage.googleapis.com";
    $url  = $host . "/v1beta/models/" . urlencode($model) . ":generateContent?key=" . urlencode($key);
    list($st, $raw) = dl_curl("POST", $url, array("Content-Type: application/json"), array(
      "contents" => array(array("parts" => array(
        array("text" => $prompt),
        array("inline_data" => array("mime_type" => $mime, "data" => $b64)),
      ))),
      "systemInstruction" => array("parts" => array(array("text" => $system))),
      "generationConfig"  => array("temperature" => 0.3),
    ));
    if ($st !== 200) throw new Exception(dl_provider_error($raw));
    $j = json_decode($raw, true);
    $parts = isset($j["candidates"][0]["content"]["parts"]) ? $j["candidates"][0]["content"]["parts"] : array();
    $text = "";
    foreach ($parts as $p) if (isset($p["text"])) $text .= $p["text"];
    return $text;
  }

  if ($provider === "anthropic") {
    $host = $base !== "" ? rtrim($base, "/") : "https://api.anthropic.com";
    list($st, $raw) = dl_curl("POST", $host . "/v1/messages", array(
      "Content-Type: application/json",
      "x-api-key: " . $key,
      "anthropic-version: 2023-06-01",
    ), array(
      "model"      => $model,
      "max_tokens" => 4000,
      "temperature" => 0.3,
      "system"     => $system,
      "messages"   => array(array(
        "role"    => "user",
        "content" => array(
          array("type" => "image", "source" => array("type" => "base64", "media_type" => $mime, "data" => $b64)),
          array("type" => "text", "text" => $prompt),
        ),
      )),
    ));
    if ($st !== 200) throw new Exception(dl_provider_error($raw));
    $j = json_decode($raw, true);
    $text = "";
    foreach ((isset($j["content"]) ? $j["content"] : array()) as $c) {
      if (isset($c["text"])) $text .= $c["text"];
    }
    return $text;
  }

  /* openai */
  $host = $base !== "" ? rtrim($base, "/") : "https://api.openai.com";
  $headers = array("Content-Type: application/json", "Authorization: Bearer " . $key);
  $msgs = array(
    array("role" => "system", "content" => $system),
    array("role" => "user", "content" => array(
      array("type" => "text", "text" => $prompt),
      array("type" => "image_url", "image_url" => array("url" => "data:" . $mime . ";base64," . $b64)),
    )),
  );

  $send = function ($useJsonFormat) use ($host, $headers, $model, $msgs) {
    $payload = array("model" => $model, "temperature" => 0.3, "messages" => $msgs);
    if ($useJsonFormat) $payload["response_format"] = array("type" => "json_object");
    return dl_curl("POST", $host . "/v1/chat/completions", $headers, $payload);
  };

  list($st, $raw) = $send(true);
  if ($st !== 200 && $st !== 201) {
    // некоторые модели/прокси не знают response_format — повторяем без него
    if (preg_match('/response_format|json_object|Unsupported/i', $raw)) {
      list($st, $raw) = $send(false);
    }
  }
  if ($st !== 200 && $st !== 201) throw new Exception(dl_provider_error($raw));
  $j = json_decode($raw, true);
  if (isset($j["choices"][0]["message"]["content"])) {
    return (string) $j["choices"][0]["message"]["content"];
  }
  throw new Exception("OpenAI вернул ответ без текста");
}

/* ---------- исполнение ---------- */
try {
  if ($action === "test") {
    dl_ai_test($provider, $model, $key, $base);
    dl_json_response(array("ok" => true, "text" => "OK"));
  }
  if ($action === "analyze") {
    $b64   = isset($body["b64"]) ? (string) $body["b64"] : "";
    $mime  = isset($body["mime"]) ? (string) $body["mime"] : "image/jpeg";
    $system = isset($body["system"]) ? (string) $body["system"] : "";
    $prompt = isset($body["prompt"]) ? (string) $body["prompt"] : "";
    if ($b64 === "" || $prompt === "") dl_http_error("Не переданы фото или задание", 400);
    $text = dl_ai_analyze($provider, $model, $key, $base, $b64, $mime, $system, $prompt);
    if (trim($text) === "") dl_http_error("ИИ вернул пустой ответ", 502);
    dl_json_response(array("ok" => true, "text" => $text));
  }
  dl_http_error("Неизвестное действие", 400);
} catch (Exception $e) {
  dl_http_error($name . ": " . $e->getMessage(), 502);
}

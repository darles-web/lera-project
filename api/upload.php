<?php
/* =====================================================================
   API «ДарЛес» — фото каталога (images/catalog/)
   ---------------------------------------------------------------------
   POST multipart/form-data:  файл «file» + имя «name» (например 23.jpg)
   POST JSON:  { action: "delete", path: "images/catalog/23.jpg" }

   Доступ открыт (панель без пароля) — поэтому:
     • имя файла строго по шаблону (цифры + .jpg/.png/.webp)
     • фото не больше 8 МБ
     • скоростной фильтр: 120 запросов в час с IP
   ===================================================================== */

require __DIR__ . "/common.php";

if ($_SERVER["REQUEST_METHOD"] !== "POST") {
  dl_http_error("Метод не поддерживается", 405);
}

$ctype = isset($_SERVER["CONTENT_TYPE"]) ? $_SERVER["CONTENT_TYPE"] : "";

/* ---------- загрузка фото (multipart) ---------- */
if (stripos($ctype, "multipart/form-data") === 0) {
  dl_rate_limit("upload", 120);

  $name = isset($_POST["name"]) ? trim($_POST["name"]) : "";
  if (!preg_match('/^\d{1,4}(?:-\d{1,2})?\.(jpe?g|png|webp)$/i', $name)) {
    dl_http_error("Недопустимое имя файла (например 23.jpg или 23-1.jpg)", 400);
  }

  if (empty($_FILES["file"]) || !isset($_FILES["file"]["error"]) || $_FILES["file"]["error"] !== UPLOAD_ERR_OK) {
    $codes = array(
      UPLOAD_ERR_INI_SIZE   => "файл больше upload_max_filesize в PHP",
      UPLOAD_ERR_FORM_SIZE  => "файл больше лимита формы",
      UPLOAD_ERR_NO_FILE    => "файл не был передан",
      UPLOAD_ERR_NO_TMP_DIR => "на сервере нет временной папки",
      UPLOAD_ERR_CANT_WRITE => "не удалось записать во временный файл",
    );
    $errCode = isset($_FILES["file"]["error"]) ? (int) $_FILES["file"]["error"] : 0;
    dl_http_error("Файл не получен" . (isset($codes[$errCode]) ? " (" . $codes[$errCode] . ")" : ""), 400);
  }

  if ($_FILES["file"]["size"] > 8 * 1024 * 1024) {
    dl_http_error("Фото больше 8 МБ", 400);
  }

  $dir = DL_ROOT . "/images/catalog";
  if (!is_dir($dir)) {
    if (!@mkdir($dir, 0755, true)) {
      dl_http_error("Не удалось создать папку images/catalog", 500);
    }
  }

  $target = $dir . "/" . $name;
  if (!is_uploaded_file($_FILES["file"]["tmp_name"]) || !move_uploaded_file($_FILES["file"]["tmp_name"], $target)) {
    dl_http_error("Не удалось сохранить фото (права на запись images/catalog?)", 500);
  }

  dl_json_response(array("ok" => true, "path" => "images/catalog/" . $name));
}

/* ---------- удаление фото (JSON) ---------- */
dl_rate_limit("upload", 120);
$body = dl_read_json_body();
if (is_array($body) && isset($body["action"]) && $body["action"] === "delete") {
  $path = isset($body["path"]) ? (string) $body["path"] : "";
  if (!preg_match('#^images/catalog/[\w.\-]+$#', $path)) {
    dl_http_error("Недопустимый путь к файлу", 400);
  }
  $real = DL_ROOT . "/" . $path;
  if (is_file($real)) {
    if (!@unlink($real)) dl_http_error("Не удалось удалить файл " . $path, 500);
  }
  dl_json_response(array("ok" => true));
}

dl_http_error("Неизвестное действие", 400);

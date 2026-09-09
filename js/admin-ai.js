/* =====================================================================
   ИИ-ПОМОЩНИК АДМИН-ПАНЕЛИ «ДарЛес»
   ---------------------------------------------------------------------
   По фотографии определяет растение и возвращает название, категорию,
   короткую подпись и описание — их можно поправить в форме перед
   публикацией.

   Запрос идёт НА СЕРВЕР САЙТА (api/ai.php), а уже от него — к провайдеру:
     • OpenAI          (api.openai.com)
     • Google Gemini   (generativelanguage.googleapis.com)
     • Anthropic Claude (api.anthropic.com)

   Так нет ошибки «failed to fetch» (CORS): браузер общается только
   с собственным доменом. Ключ API хранится НА СЕРВЕРЕ (в файле
   api/config.local.php), а не в браузере — посетители сайта его не видят.

   Если сервер хостинга сам не может достучаться до провайдера
   (гео-блокировка и т.п.), в настройках есть поле «Свой адрес API»
   — туда можно вписать адрес прокси-сервера.
   ===================================================================== */

const AdminAI = (() => {
  const DEFAULT_MODEL = {
    openai: "gpt-4o-mini",
    gemini: "gemini-2.5-flash",
    anthropic: "claude-sonnet-4-20250514"
  };

  /* Подсказки для поля «модель». Можно вписать любую свою — поле свободное. */
  const MODELS = {
    openai: ["gpt-4o-mini", "gpt-4o", "gpt-5.5", "gpt-5.6-luna"],
    gemini: ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-pro"],
    anthropic: ["claude-sonnet-4-20250514", "claude-haiku-4-5", "claude-opus-4-1-20250805"]
  };

  const LABELS = {
    openai: "OpenAI",
    gemini: "Google Gemini",
    anthropic: "Anthropic Claude"
  };

  const SYSTEM =
    "Ты — агроном-консультант питомника декоративных растений «ДарЛес» (Крым). " +
    "Отвечай только валидным JSON, без пояснений и без markdown-разметки.";

  const PROMPT = `Посмотри на фотографию и определи декоративное растение.
Верни ТОЛЬКО JSON такого вида:

{
  "name": "Русское название «Сорт»",
  "latin": "Latin name 'Cultivar'",
  "category": "hvoynye",
  "short": "короткая подпись для карточки, максимум 70 символов",
  "description": "описание из 4–6 абзацев, абзацы разделены пустой строкой",
  "confidence": 0.9,
  "comment": "что вызывает сомнения, если они есть"
}

Правила:
• category — ровно одно из: "hvoynye" (хвойные), "listvennye" (лиственные деревья и кустарники), "mnogoletnie" (многолетние травы, злаки, цветы).
• name — по-русски, как в каталоге питомника: вид и, если виден, сорт в кавычках-ёлочках.
• Сорт НЕ выдумывай. Если сорт по фото определить нельзя — назови только вид.
• short — одна живая фраза про растение, до 70 символов, без названия.
• description — 4–6 абзацев: 1) что за растение и чем декоративно; 2) высота и ширина взрослого растения, зона морозостойкости, свет, почва; 3) посадка и уход; 4) применение в саду. Пиши просто, для покупателя, без канцелярита.
• confidence — уверенность от 0 до 1. Если растение опознать нельзя, верни confidence 0 и в comment объясни почему.
• Не указывай цену: её знает только питомник.`;

  /* Настройки живёт НА СЕРВЕРЕ; сюда они приходят запросом к api/config.php. */
  let server = { provider: "openai", model: "", key: "", base: "" };

  function applyServer(ai) {
    if (!ai || typeof ai !== "object") return;
    server = {
      provider: ai.provider || "openai",
      model: String(ai.model || ""),
      key: String(ai.key || ""),
      base: String(ai.base || "")
    };
  }
  function get() { return { ...server }; }
  function model() { return (server.model || DEFAULT_MODEL[server.provider] || "").trim(); }
  function providerLabel() { return LABELS[server.provider] || server.provider; }
  function models() { return MODELS[server.provider] || []; }
  function isReady() { return !!server.key && !!model(); }
  function requirement() {
    return "ИИ не настроен: откройте «Настройки» → блок «ИИ-помощник», " +
      "выберите провайдера, модель и вставьте ключ — он сохранится на сервере.";
  }

  /* ---------- запрос к api/ai.php (свой домен — CORS не нужен) ---------- */
  function token() {
    try {
      const s = JSON.parse(sessionStorage.getItem("darles_admin_session") || "null");
      return s && typeof s.hash === "string" ? s.hash : null;
    } catch { return null; }
  }

  async function apiPost(data) {
    const t = token();
    if (!t) throw new Error("Сессия админ-панели истекла — войдите заново");
    let res;
    try {
      res = await fetch("api/ai.php", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(Object.assign({ token: t }, data))
      });
    } catch (e) {
      throw new Error("сервер не ответил — проверьте, что сайт открыт по адресу хостинга");
    }
    let j = null;
    try { j = await res.json(); } catch {}
    if (!res.ok || !j || j.ok === false) {
      throw new Error((j && j.error) || ("HTTP " + res.status));
    }
    return j;
  }

  /* ---------- подготовка изображения ---------- */
  function prepare(dataURL, max = 1024) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * k));
        c.height = Math.max(1, Math.round(img.height * k));
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const out = c.toDataURL("image/jpeg", 0.85);
        resolve({ b64: out.split(",")[1], mime: "image/jpeg", dataURL: out });
      };
      img.onerror = () => reject(new Error("не удалось открыть изображение"));
      img.src = dataURL;
    });
  }

  function urlToDataURL(url) {
    return fetch(url, { cache: "no-store" })
      .then(r => { if (!r.ok) throw new Error("фото не загрузилось"); return r.blob(); })
      .then(blob => new Promise((res, rej) => {
        const fr = new FileReader();
        fr.onload = () => res(fr.result);
        fr.onerror = () => rej(new Error("фото не прочиталось"));
        fr.readAsDataURL(blob);
      }));
  }

  /* ---------- разбор ответа ---------- */
  const CAT_MAP = {
    hvoynye: "hvoynye", хвойные: "hvoynye", хвойное: "hvoynye", conifer: "hvoynye",
    listvennye: "listvennye", лиственные: "listvennye", лиственное: "listvennye", deciduous: "listvennye",
    mnogoletnie: "mnogoletnie", многолетние: "mnogoletnie", многолетники: "mnogoletnie", многолетнее: "mnogoletnie", perennial: "mnogoletnie"
  };

  /* Модели иногда вставляют в JSON настоящие переводы строк — это невалидно.
     Экранируем управляющие символы, но только внутри строковых значений. */
  function escapeRawControls(s) {
    let out = "", inStr = false, esc = false;
    for (const ch of s) {
      if (inStr) {
        if (esc) { out += ch; esc = false; continue; }
        if (ch === "\\") { out += ch; esc = true; continue; }
        if (ch === '"') { out += ch; inStr = false; continue; }
        if (ch.charCodeAt(0) < 0x20) {
          out += ch === "\n" ? "\\n" : ch === "\r" ? "\\r" : ch === "\t" ? "\\t" : "";
          continue;
        }
        out += ch;
        continue;
      }
      if (ch === '"') inStr = true;
      out += ch;
    }
    return out;
  }

  function parseAnswer(text) {
    let s = String(text || "").trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```\s*$/, "").trim();
    const start = s.indexOf("{"), end = s.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("ИИ вернул ответ без JSON — попробуйте другое фото или модель.");
    let data;
    try { data = JSON.parse(escapeRawControls(s.slice(start, end + 1))); }
    catch (e) { throw new Error("не удалось разобрать ответ ИИ: " + e.message); }

    const catKey = CAT_MAP[String(data.category || "").toLowerCase().trim()] || "";
    return {
      name: String(data.name || "").trim(),
      latin: String(data.latin || "").trim(),
      category: catKey,
      short: String(data.short || "").trim().slice(0, 70),
      description: String(data.description || "").trim(),
      confidence: Number(data.confidence ?? 0) || 0,
      comment: String(data.comment || "").trim()
    };
  }

  /* ---------- публичные методы ---------- */
  async function analyze(dataURL) {
    if (!isReady()) throw new Error(requirement());
    const { b64, mime } = await prepare(dataURL);
    const j = await apiPost({ action: "analyze", b64, mime, system: SYSTEM, prompt: PROMPT });
    return parseAnswer(j.text);
  }

  async function analyzeUrl(url) {
    return analyze(await urlToDataURL(url));
  }

  /* Проверка ключа и модели — маленький текстовый запрос через сервер */
  async function test() {
    if (!isReady()) throw new Error(requirement());
    await apiPost({ action: "test" });
    return "OK";
  }

  return {
    applyServer, get, model, models, isReady, requirement,
    providerLabel, DEFAULT_MODEL, LABELS,
    analyze, analyzeUrl, test, prepare, urlToDataURL, parseAnswer
  };
})();

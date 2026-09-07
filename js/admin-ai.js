/* =====================================================================
   ИИ-ПОМОЩНИК АДМИН-ПАНЕЛИ «ДарЛес»
   ---------------------------------------------------------------------
   По фотографии определяет растение и возвращает название, категорию,
   короткую подпись и описание — их можно поправить в форме перед
   публикацией.

   Запрос уходит из браузера напрямую к выбранному провайдеру:
     • OpenAI          (api.openai.com)
     • Google Gemini   (generativelanguage.googleapis.com)
     • Anthropic Claude(api.anthropic.com)

   Ключ хранится ТОЛЬКО в вашем браузере (localStorage) и отправляется
   только на сервер выбранного провайдера. Сайт статический, своего
   сервера у него нет — поэтому ключ вводите сами, в своей панели.
   ===================================================================== */

const AdminAI = (() => {
  const KEY = "darles_admin_ai_cfg";

  const DEFAULT_MODEL = {
    openai: "gpt-5.6-luna",
    gemini: "gemini-2.5-flash",
    anthropic: "claude-sonnet-5"
  };

  /* Подсказки для поля «модель». Можно вписать любую свою — поле свободное. */
  const MODELS = {
    openai: ["gpt-5.6-luna", "gpt-5.5", "gpt-4o-mini", "gpt-4o"],
    gemini: ["gemini-2.5-flash", "gemini-3.5-flash", "gemini-2.5-pro"],
    anthropic: ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5"]
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

  let cfg = Object.assign(
    { provider: "openai", model: "", key: "" },
    (() => { try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch (e) { return {}; } })()
  );

  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) {} }
  function get() { return { ...cfg }; }
  function set(patch) { Object.assign(cfg, patch); save(); }
  function model() { return (cfg.model || DEFAULT_MODEL[cfg.provider] || "").trim(); }
  function providerLabel() { return LABELS[cfg.provider] || cfg.provider; }
  function models() { return MODELS[cfg.provider] || []; }
  function isReady() { return !!cfg.key && !!model(); }
  function requirement() {
    return isReady()
      ? ""
      : "ИИ не настроен: откройте «Настройки публикации» → блок «ИИ-помощник», " +
        "выберите провайдер и вставьте свой ключ.";
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

  /* ---------- запросы к провайдерам ---------- */
  async function apiMessage(res, name) {
    let msg = res.status + " " + res.statusText;
    try {
      const j = await res.json();
      msg = j?.error?.message || j?.message || j?.error || msg;
    } catch (e) {}
    return name + ": " + msg;
  }

  async function callOpenAI(b64, mime, useJsonFormat = true) {
    const body = {
      model: model(),
      temperature: 0.3,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: [
          { type: "text", text: PROMPT },
          { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }
        ] }
      ]
    };
    const send = jsonFormat => fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify(jsonFormat ? { ...body, response_format: { type: "json_object" } } : body)
    });

    let res = await send(useJsonFormat);
    if (!res.ok && useJsonFormat) {
      const raw = await res.clone().text().catch(() => "");
      if (/response_format|json_object|Unsupported/i.test(raw)) res = await send(false);
    }
    if (!res.ok) throw new Error(await apiMessage(res, "OpenAI"));
    const j = await res.json();
    return j?.choices?.[0]?.message?.content || "";
  }

  async function callGemini(b64, mime) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent?key=${encodeURIComponent(cfg.key)}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mime, data: b64 } }] }],
        generationConfig: { temperature: 0.3, responseMimeType: "application/json" }
      })
    });
    if (!res.ok) throw new Error(await apiMessage(res, "Gemini"));
    const j = await res.json();
    return (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n");
  }

  async function callAnthropic(b64, mime) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 2500,
        system: SYSTEM,
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: mime, data: b64 } },
          { type: "text", text: PROMPT }
        ] }]
      })
    });
    if (!res.ok) throw new Error(await apiMessage(res, "Anthropic"));
    const j = await res.json();
    return (j?.content || []).map(c => c.text || "").join("\n");
  }

  /* ---------- публичные методы ---------- */
  async function analyze(dataURL) {
    if (!isReady()) throw new Error(requirement());
    const { b64, mime } = await prepare(dataURL);
    let text = "";
    if (cfg.provider === "gemini") text = await callGemini(b64, mime);
    else if (cfg.provider === "anthropic") text = await callAnthropic(b64, mime);
    else text = await callOpenAI(b64, mime);
    return parseAnswer(text);
  }

  async function analyzeUrl(url) {
    return analyze(await urlToDataURL(url));
  }

  /* Проверка ключа и модели — маленький текстовый запрос без картинки */
  async function test() {
    if (!cfg.key) throw new Error("не указан ключ");
    if (!model()) throw new Error("не указана модель");
    if (cfg.provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model())}:generateContent?key=${encodeURIComponent(cfg.key)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Ответь JSON: {\"ok\":true}" }] }] })
      });
      if (!res.ok) throw new Error(await apiMessage(res, "Gemini"));
      return "OK";
    }
    if (cfg.provider === "anthropic") {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": cfg.key,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({ model: model(), max_tokens: 16, messages: [{ role: "user", content: "Ответь одним словом: ok" }] })
      });
      if (!res.ok) throw new Error(await apiMessage(res, "Anthropic"));
      return "OK";
    }
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key },
      body: JSON.stringify({ model: model(), max_tokens: 16, messages: [{ role: "user", content: "Ответь одним словом: ok" }] })
    });
    if (!res.ok) throw new Error(await apiMessage(res, "OpenAI"));
    return "OK";
  }

  return {
    get, set, save, model, models, isReady, requirement,
    providerLabel, DEFAULT_MODEL, LABELS,
    analyze, analyzeUrl, test, prepare, urlToDataURL, parseAnswer
  };
})();

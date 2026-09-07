/* =====================================================================
   ЗАЩИТА АДМИН-ПАНЕЛИ ПАРОЛЕМ
   ---------------------------------------------------------------------
   Пароль хранится как SHA-256 хеш с солью (исходный пароль в коде нет).
   После успешного входа сессия хранится в sessionStorage (до закрытия вкладки).
   Чтобы СМЕНИТЬ ПАРОЛЬ — см. инструкцию в конце файла.
   ===================================================================== */

const ADMIN_AUTH = (() => {
  // ------ НАСТРОЙКИ ------
  const SALT = "darles_salt_w79r4l905";
  // HASH = SHA-256(salt + ":" + password). Сменить пароль — см. инструкцию в конце файла.
  // 2026-09-06: пароль сброшен владельцем после блокировки доступа.
  const HASH = "95315a5b76ff56a9488900d611fb5a8360d5924744254bd722461d997e492e5b";
  const SESSION_KEY = "darles_admin_session";
  const SESSION_VERSION = 5; // поднят при добавлении кнопки «показать пароль» и офлайн-распознавания — старые сессии автоматически сбрасываются
  const ATTEMPTS_KEY = "darles_admin_attempts";
  const MAX_ATTEMPTS = 5;
  const LOCKOUT_MS = 5 * 60 * 1000; // 5 минут блокировки после 5 неудачных попыток

  async function sha256(text) {
    const buf = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, "0")).join("");
  }

  function getAttempts() {
    try { return JSON.parse(localStorage.getItem(ATTEMPTS_KEY) || "{}"); }
    catch { return {}; }
  }
  function setAttempts(a) {
    try { localStorage.setItem(ATTEMPTS_KEY, JSON.stringify(a)); } catch {}
  }
  function isLocked() {
    const a = getAttempts();
    if (a.count >= MAX_ATTEMPTS && Date.now() - (a.since || 0) < LOCKOUT_MS) {
      return Math.ceil((LOCKOUT_MS - (Date.now() - a.since)) / 1000);
    }
    return 0;
  }

  function isLoggedIn() {
    try {
      const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || "null");
      return s && s.v === SESSION_VERSION && s.hash === HASH && s.exp > Date.now();
    } catch { return false; }
  }

  function saveSession() {
    // Сессия живёт 24 часа с момента входа (или до закрытия вкладки)
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      v: SESSION_VERSION, hash: HASH, exp: Date.now() + 24 * 60 * 60 * 1000
    }));
  }

  function clearSession() {
    sessionStorage.removeItem(SESSION_KEY);
  }

  async function login(password) {
    const lockLeft = isLocked();
    if (lockLeft > 0) {
      const mm = Math.floor(lockLeft / 60), ss = lockLeft % 60;
      return { ok: false, error: `Слишком много попыток. Подождите ${mm}:${String(ss).padStart(2,"0")}.` };
    }
    const h = await sha256(SALT + ":" + password);
    if (h === HASH) {
      saveSession();
      setAttempts({});
      return { ok: true };
    }
    const a = getAttempts();
    a.count = (a.count || 0) + 1;
    a.since = a.since || Date.now();
    setAttempts(a);
    const left = MAX_ATTEMPTS - a.count;
    if (left <= 0) {
      return { ok: false, error: `Неверный пароль. Слишком много попыток — блокировка на 5 минут.` };
    }
    return { ok: false, error: `Неверный пароль. Осталось попыток: ${left}.` };
  }

  function renderLogin() {
    const lockLeft = isLocked();
    const lockMsg = lockLeft > 0
      ? (() => { const mm = Math.floor(lockLeft/60), ss = lockLeft%60; return `Блокировка: ${mm}:${String(ss).padStart(2,"0")}`; })()
      : "";

    document.body.innerHTML = `
    <div class="auth-wrap">
      <form class="auth-box" id="authForm" autocomplete="off">
        <div class="auth__ico">🔒</div>
        <h1 class="auth__title">Вход в админ-панель</h1>
        <p class="auth__sub">«ДарЛес» — питомник декоративных растений</p>
        <label class="auth__label">
          <span>Пароль</span>
          <div class="auth-pass-wrap">
            <input type="password" id="authPass" placeholder="Введите пароль" autofocus autocomplete="current-password" ${lockLeft>0?"disabled":""}>
            <button class="auth-eye" id="authEye" type="button" aria-label="Показать пароль" title="Показать / скрыть пароль">👁</button>
          </div>
        </label>
        <button class="auth__btn" type="submit" ${lockLeft>0?"disabled":""}>Войти</button>
        <div class="auth__err" id="authErr" ${lockMsg?`style="display:block"`:""}>${lockMsg}</div>
        <a href="index.html" class="auth__back">← Вернуться на сайт</a>
      </form>
    </div>`;

    // Стили для экрана входа
    if (!document.getElementById("authStyles")) {
      const s = document.createElement("style");
      s.id = "authStyles";
      s.textContent = `
        .auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;
          background:linear-gradient(135deg,#e8efe9 0%,#f5f2ec 100%);padding:20px;font-family:'Inter',system-ui,sans-serif}
        .auth-box{background:#fff;border-radius:20px;padding:44px 40px;width:min(400px,100%);
          box-shadow:0 20px 60px rgba(34,67,47,.15);text-align:center}
        .auth__ico{width:64px;height:64px;border-radius:50%;background:#e5efe8;display:flex;
          align-items:center;justify-content:center;font-size:28px;margin:0 auto 18px}
        .auth__title{color:#22432f;margin:0 0 6px;font-size:22px;font-weight:700}
        .auth__sub{color:#6b7c70;margin:0 0 28px;font-size:14px}
        .auth__label{display:block;text-align:left;margin-bottom:20px}
        .auth__label span{display:block;font-size:13px;font-weight:600;color:#22432f;margin-bottom:7px}
        .auth__label input{width:100%;padding:13px 16px;border:2px solid #d4ddd6;border-radius:12px;
          font:inherit;font-size:15px;outline:none;transition:.2s;background:#fafcfa}
        .auth__label input:focus{border-color:#3c6b4c;background:#fff}
        .auth-pass-wrap{position:relative}
        .auth-pass-wrap input{padding-right:52px}
        .auth-eye{position:absolute;right:8px;top:7px;width:36px;height:36px;border:0;border-radius:50%;
          background:transparent;cursor:pointer;font-size:17px;line-height:1;display:flex;align-items:center;justify-content:center;color:#3c6b4c}
        .auth-eye:hover{background:#e5efe8}
        .auth__btn{width:100%;padding:14px;border:0;border-radius:12px;background:#3c6b4c;
          color:#fff;font:inherit;font-size:15px;font-weight:600;cursor:pointer;transition:.2s;margin-top:4px}
        .auth__btn:hover:not(:disabled){background:#2f5540}
        .auth__btn:disabled{opacity:.5;cursor:not-allowed}
        .auth__err{color:#b3261e;font-size:13px;margin-top:14px;min-height:18px;display:none}
        .auth__back{display:inline-block;margin-top:22px;color:#6b7c70;font-size:13px;text-decoration:none}
        .auth__back:hover{color:#3c6b4c}
      `;
      document.head.appendChild(s);
    }

    const form = document.getElementById("authForm");
    const errEl = document.getElementById("authErr");
    const input = document.getElementById("authPass");
    if (input && !input.disabled) input.focus();

    const eye = document.getElementById("authEye");
    if (eye) eye.addEventListener("click", e => {
      e.preventDefault();
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      eye.textContent = show ? "🙈" : "👁";
      eye.setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
    });

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const pass = input.value;
      if (!pass) return;
      const btn = form.querySelector(".auth__btn");
      btn.disabled = true; btn.textContent = "Проверка…";
      const res = await login(pass);
      if (res.ok) {
        location.reload();
      } else {
        errEl.textContent = res.error;
        errEl.style.display = "block";
        input.value = "";
        input.focus();
        btn.disabled = !!isLocked();
        btn.textContent = "Войти";
        if (isLocked()) {
          input.disabled = true;
          // перезагрузим через 5 минут, чтобы разблокировать
          setTimeout(() => location.reload(), LOCKOUT_MS + 1000);
        }
      }
    });
  }

  function requireAuth(onSuccess) {
    if (isLoggedIn()) {
      onSuccess();
    } else {
      // Убираем всё из body и рисуем форму входа
      // Сначала дождёмся загрузки DOM
      const go = () => {
        // Скрываем содержимое пока не загрузим
        document.body.style.visibility = "hidden";
        document.body.innerHTML = "";
        document.body.style.visibility = "";
        renderLogin();
      };
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", go);
      } else {
        go();
      }
    }
  }

  function logout() {
    clearSession();
    location.href = "index.html";
  }

  // Используется админ-панелью для смены пароля без консоли.
  async function hashPassword(password) {
    return sha256(SALT + ":" + password);
  }

  return { requireAuth, logout, isLoggedIn, hashPassword };
})();


/* ---------------------------------------------------------------------
   КАК СМЕНИТЬ ПАРОЛЬ
   ---------------------------------------------------------------------
   1. Откройте консоль браузера на странице admin.html (F12 → Console).
   2. Вставьте этот код и нажмите Enter (замените НОВЫЙ_ПАРОЛЬ на ваш):

        (async (pwd) => {
          const buf = new TextEncoder().encode(
            "darles_salt_w79r4l905:" + pwd
          );
          const h = await crypto.subtle.digest("SHA-256", buf);
          console.log("Новый HASH = " +
            Array.from(new Uint8Array(h))
              .map(b => b.toString(16).padStart(2,"0")).join(""));
        })("НОВЫЙ_ПАРОЛЬ");

   3. Скопируйте выведенный HASH и замените значение константы HASH
      в этом файле (строка с const HASH = "..."), а также в SESSION_KEY
      проверку (используется та же константа).
   4. Сохраните файл и опубликуйте. Войдите с новым паролем.
   --------------------------------------------------------------------- */

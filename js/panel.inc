<div id="admin-app">

<div id="site-header"></div>

<section class="page-head">
  <div class="wrap">
    <div class="crumbs"><a href="index.html">Главная</a> / Админ-панель</div>
    <h2>Админ-панель</h2>
    <p class="lead">Добавляйте растения перетаскиванием фото и простыми полями. Остальное панель сделает сама.</p>
    <div class="admin__status">
      <span id="srvStatus" class="badge badge--gray">Проверяю хостинг…</span>
      <button class="btn btn--ghost btn--sm" id="btnSettings" type="button">Настройки</button>
      <button class="btn btn--ghost btn--sm" id="btnLogout" type="button" title="Вернуться на сайт">На сайт</button>
    </div>
  </div>
</section>

<!-- ================= НАСТРОЙКИ ================= -->
<section class="wrap" id="settings" style="display:none">
  <div class="panel">
    <h3>Настройки</h3>
    <p class="muted">Сайт живёт на хостинге и не зависит от GitHub. Все изменения
      (каталог, фото, ключ ИИ) панель сохраняет напрямую в файлы хостинга:
      <b>data/catalog.json</b>, <b>images/catalog/</b>, <b>api/config.local.php</b>.</p>

    <p style="background:#fff6e6;border:1px solid #f0d9a8;border-radius:12px;padding:12px 16px;margin-top:16px" class="small">
      ⚠️ <b>Пароль на панели отключён</b> — открыть её может любой, кто знает адрес
      <b>/admin.html</b> (включая поисковики). Любому гостю доступны правки каталога
      и настройки ИИ. Если это нежелательно — включите пароль обратно (обратитесь
      к разработчику в чате Arena).
    </p>

    <hr style="margin:26px 0 18px;border:0;border-top:1px solid #e3e9e5">
    <h4>ИИ-помощник (распознавание растений по фото)</h4>
    <p class="muted small">Помощник смотрит на загруженное фото и сам заполняет название, категорию,
      короткую подпись и описание. Вы всё правите руками — и только потом публикуете.
      Запрос идёт через сервер сайта — поэтому ошибки «failed to fetch» нет, а ключ не видят посетители.</p>
    <div class="field-row">
      <label>Провайдер
        <select id="aiProvider">
          <option value="openai">OpenAI</option>
          <option value="gemini">Google Gemini</option>
          <option value="anthropic">Anthropic Claude</option>
        </select>
      </label>
      <label>Модель <span class="muted">(можно вписать свою)</span>
        <input id="aiModel" type="text" list="aiModelList" placeholder="модель по умолчанию" autocomplete="off">
        <datalist id="aiModelList"></datalist>
      </label>
    </div>
    <label>Ключ API <span class="muted">— сохранённый показывается маской, новый вводится сюда</span>
      <input id="aiKey" type="password" placeholder="sk-… / AIza… / sk-ant-…" autocomplete="off">
    </label>
    <label>Свой адрес API (прокси) <span class="muted">— только если сервер хостинга сам не может открыть api.openai.com</span>
      <input id="aiBase" type="text" placeholder="например https://my-proxy.example.com — можно оставить пустым" autocomplete="off">
    </label>
    <p class="muted small">Ключ сохраняется на сервере (в api/config.local.php) и не передаётся никому,
      кроме сервера провайдера; в настройках показывается только маска (sk-…1234).
      Модель смотрит картинку, поэтому провайдер берёт за запрос небольшую плату (обычно доли цента);
      на панель стоит ограничение 30 запросов ИИ в час.
      Ключи: OpenAI — platform.openai.com/api-keys, Gemini — aistudio.google.com/apikey,
      Claude — console.anthropic.com/settings/keys.</p>
    <div class="btn-row">
      <button class="btn btn--sm" id="btnAiSave" type="button">Сохранить и проверить</button>
      <button class="btn btn--ghost btn--sm" id="btnAiForget" type="button">Забыть ключ</button>
    </div>
    <p class="muted small" id="aiTestNote"></p>
  </div>
</section>

<main class="wrap admin">
  <div class="admin__grid">

    <!-- ================= ФОРМА ДОБАВЛЕНИЯ ================= -->
    <section class="panel">
      <h3 id="formTitle">Добавить растение</h3>

      <div class="dropzone" id="dropzone">
        <input type="file" id="fileInput" accept="image/*" multiple hidden>
        <div class="dropzone__hint" id="dzHint">
          <span class="dropzone__ico">📷</span>
          <b>Перетащите фото сюда</b>
          <span>или кликните, чтобы выбрать · можно вставить из буфера (Ctrl+V)</span>
          <span class="muted small">Первое фото — главное. Затем кнопкой ✏️ можно сменить фон и выровнять растение.</span>
        </div>
        <div class="dropzone__thumbs" id="dzThumbs"></div>
      </div>
      <label class="check"><input type="checkbox" id="optTrim" checked>
        Автообработка фото: обрезать белые поля и привести к формату карточки 3:4</label>

      <!-- ===== ИИ-ПОМОЩНИК: определяет растение по фото ===== -->
      <div class="ai-row">
        <button class="btn btn--ai btn--sm" id="btnAI" type="button">🤖 Определить растение по фото</button>
        <button class="btn btn--ghost btn--sm" id="btnAiSettings" type="button">Настроить ИИ</button>
        <span class="muted small" id="aiHint"></span>
      </div>
      <div class="ai-result" id="aiResult" style="display:none"></div>

      <!-- ===== ОФЛАЙН-РАСПОЗНАВАНИЕ (БЕЗ API): по каталогу + поиск описания ===== -->
      <div class="ai-result doc-offline" id="offlineIdPanel" style="display:none">
        <div class="ai-result__head">
          <b>🌿 Определение без API</b>
          <span class="ai-result__conf">по фото и каталогу</span>
        </div>
        <p class="muted small">Работает в браузере: никаких ключей, оплаты и отправки фото. Название, категория, подпись и описание уже заполнены из каталога — проверьте и при необходимости выберите другой вариант.</p>
        <label class="offline-label">Похоже на
          <select id="idMatch"></select>
        </label>
        <p class="muted small">Если нужного описания нет — откройте поисковик и скопируйте текст в поле «Описание».</p>
        <div class="ai-result__actions">
          <button class="btn btn--ghost btn--sm" id="btnOfflineUndo" type="button">Отменить заполнение</button>
          <button class="btn btn--ghost btn--sm" id="btnOfflineHide" type="button">Скрыть</button>
        </div>
        <div class="btn-row" style="margin-top:10px">
          <button class="btn btn--ghost btn--sm" id="btnSearchG" type="button">🔎 Google по названию</button>
          <button class="btn btn--ghost btn--sm" id="btnSearchY" type="button">🔎 Яндекс по названию</button>
          <button class="btn btn--ghost btn--sm" id="btnSearchPhotoY" type="button">🖼 По фото: Яндекс</button>
          <button class="btn btn--ghost btn--sm" id="btnSearchPhotoG" type="button">🖼 По фото: Google Lens</button>
        </div>
      </div>

      <div class="field-row">
        <label>Название *
          <input id="fName" type="text" placeholder="Туя западная «Брабант»">
        </label>
        <label>Категория
          <select id="fCategory">
            <option value="hvoynye">Хвойные</option>
            <option value="listvennye">Лиственные</option>
            <option value="mnogoletnie">Многолетние</option>
          </select>
        </label>
        <label>Цена, ₽ * <span class="muted">(только цифры)</span>
          <input id="fPrice" type="number" min="0" step="50" placeholder="1300">
        </label>
      </div>

      <label class="check"><input type="checkbox" id="fAvailable" checked>
        В наличии <span class="muted">(выключите — и растение на сайте получит отметку «Нет в наличии»)</span></label>

      <label>Короткая подпись в карточке
        <input id="fShort" type="text" placeholder="Быстрорастущая туя для высокой изгороди" maxlength="70">
      </label>

      <label>Описание <span class="muted">(можно просто вставить готовый текст; пустая строка = новый абзац)</span>
        <textarea id="fDesc" rows="9" placeholder="Первый абзац: что это за растение.&#10;&#10;Второй: высота, морозостойкость, почва, освещение.&#10;&#10;Третий: уход и применение в дизайне."></textarea>
      </label>

      <div class="btn-row">
      <button class="btn" id="btnPublish" type="button">Опубликовать на сайт</button>
      <button class="btn btn--ghost" id="btnSaveDraft" type="button">Сохранить черновик</button>
      <button class="btn btn--ghost" id="btnDownload" type="button" title="Скачать копию каталога (darles-catalog.json) — резервный способ перенести данные">Скачать каталог (JSON)</button>
      <button class="btn btn--ghost" id="btnReset" type="button" style="display:none">Отмена</button>
      </div>

      <div class="publog" id="publog" style="display:none"></div>
    </section>

    <!-- ================= ПРЕДПРОСМОТР ================= -->
    <aside class="admin__side">
      <div class="panel panel--sticky">
        <h3>Предпросмотр карточки</h3>
        <div id="preview" class="muted small" style="padding:20px 0">Заполните поля — здесь появится карточка как в каталоге.</div>
      </div>
    </aside>
  </div>

  <!-- ================= КАТАЛОГ (таблица) ================= -->
  <section class="panel" style="margin-top:34px">
    <h3>Каталог товаров <span class="muted small" id="prodCount"></span></h3>
    <p class="muted small" id="tblNote"></p>

    <div class="ptools">
      <input id="tblSearch" type="search" placeholder="Поиск по названию…" autocomplete="off">
      <select id="tblCat">
        <option value="">Все категории</option>
        <option value="hvoynye">Хвойные</option>
        <option value="listvennye">Лиственные</option>
        <option value="mnogoletnie">Многолетние</option>
      </select>
      <select id="tblAvail">
        <option value="">Любое наличие</option>
        <option value="in">Только в наличии</option>
        <option value="out">Только отсутствующие</option>
      </select>
      <button class="btn btn--ghost btn--sm" id="btnAllIn" type="button" title="Включить наличие у всех">Включить все</button>
      <button class="btn btn--ghost btn--sm" id="btnAllOut" type="button" title="Выключить наличие у всех">Выключить все</button>
    </div>

    <div class="admin__table" id="prodTable"></div>
  </section>
</main>

<div id="site-footer"></div>

</div>

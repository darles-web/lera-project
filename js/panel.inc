<div id="admin-app">

<div id="site-header"></div>

<section class="page-head">
  <div class="wrap">
    <div class="crumbs"><a href="index.html">Главная</a> / Админ-панель</div>
    <h2>Админ-панель</h2>
    <p class="lead">Добавляйте растения перетаскиванием фото и простыми полями. Остальное панель сделает сама.</p>
    <div class="admin__status">
      <span id="ghStatus" class="badge badge--gray">Проверяю подключение…</span>
      <button class="btn btn--ghost btn--sm" id="btnSettings" type="button">Настройки публикации</button>
      <button class="btn btn--ghost btn--sm" id="btnLogout" type="button" title="Выйти из админ-панели">Выйти</button>
    </div>
  </div>
</section>

<!-- ================= НАСТРОЙКИ ================= -->
<section class="wrap" id="settings" style="display:none">
  <div class="panel">
    <h3>Публикация на сайт</h3>
    <p class="muted">Чтобы растения появлялись на сайте «в один клик», подключите панель к репозиторию GitHub.</p>
    <div class="field-row">
      <label>Репозиторий
        <input id="cfgRepo" type="text" value="darles-web/lera-project">
      </label>
      <label>Ветка
        <input id="cfgBranch" type="text" value="main">
      </label>
    </div>
    <label>Токен GitHub <span class="muted">(fine-grained, право Contents: Read and write — только для этого репозитория)</span>
      <div class="pass-wrap">
        <input id="cfgToken" type="password" placeholder="github_pat_…" autocomplete="off">
        <button class="pass-eye" id="cfgTokenEye" type="button" aria-label="Показать токен" title="Показать / скрыть">👁</button>
      </div>
      <span class="muted small">Кнопка 👁 — показать/скрыть введённый токен. Это токен GitHub, а не пароль от панели: пароль от входа хранится отдельно.</span>
    </label>
    <p class="muted small">Как получить токен: github.com → Settings → Developer settings →
      Fine-grained tokens → Generate new token → в «Repository access» выберите только lera-project,
      в Permissions → Contents → Read and write. Токен хранится только в вашем браузере и никому не передаётся,
      кроме GitHub. <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">Открыть страницу токенов →</a></p>
    <div class="btn-row">
      <button class="btn btn--sm" id="btnSaveCfg" type="button">Сохранить и проверить</button>
      <button class="btn btn--ghost btn--sm" id="btnForget" type="button">Забыть токен</button>
    </div>
    <p class="muted small">Без токена панель работает в «локальном режиме»: кнопка «Скачать файлы»
      выдаст готовые файлы — их нужно загрузить в репозиторий вручную (кнопка Add file → Upload files).</p>

    <hr style="margin:26px 0 18px;border:0;border-top:1px solid #e3e9e5">
    <h4>Пароль админ-панели</h4>
    <p class="muted small">Смена выполняется прямо на GitHub, если подключён токен с правом записи.
      Вход после смены — уже с новым паролем.</p>
    <div class="btn-row">
      <button class="btn btn--ghost btn--sm" id="btnChangePass" type="button">Сменить пароль</button>
    </div>

    <hr style="margin:26px 0 18px;border:0;border-top:1px solid #e3e9e5">
    <h4>ИИ-помощник (распознавание растений по фото)</h4>
    <p class="muted small">Помощник смотрит на загруженное фото и сам заполняет название, категорию,
      короткую подпись и описание. Вы всё правите руками — и только потом публикуете.</p>
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
    <label>Ключ API
      <input id="aiKey" type="password" placeholder="sk-… / AIza… / sk-ant-…" autocomplete="off">
    </label>
    <p class="muted small">Ключ хранится только в вашем браузере и уходит только на сервер выбранного
      провайдера: запрос идёт напрямую, своего сервера у сайта нет. Модель смотрит картинку,
      поэтому провайдер берёт за запрос небольшую плату (обычно доли цента).
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
        <label>Розничная цена, ₽ * <span class="muted">(только цифры)</span>
          <input id="fPrice" type="number" min="0" step="50" placeholder="1300">
        </label>
      </div>

      <div class="field-row">
        <label>Размер (контейнер)
          <input id="fSize" type="text" list="sizeList" placeholder="C3" autocomplete="off">
          <datalist id="sizeList"></datalist>
        </label>
        <label>Количество в наличии, шт <span class="muted">(пусто = «уточняйте»)</span>
          <input id="fStock" type="number" min="0" step="1" placeholder="100">
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
        <button class="btn btn--ghost" id="btnDownload" type="button">Скачать файлы</button>
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
    <h3>Каталог и наличие <span class="muted small" id="prodCount"></span></h3>
    <p class="muted small">Цену, размер контейнера и количество можно править прямо в таблице —
      изменение уходит на сайт сразу после того, как вы выйдете из поля.
      Кнопка «Изменить» открывает растение в форме сверху: там добавляются фото и описание.</p>
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
      <select id="tblTodo">
        <option value="">Фото и описание: любые</option>
        <option value="nophoto">Только без фото</option>
        <option value="nodesc">Только без описания</option>
      </select>
      <button class="btn btn--ghost btn--sm" id="btnAllIn" type="button" title="Включить наличие у всех">Включить все</button>
      <button class="btn btn--ghost btn--sm" id="btnAllOut" type="button" title="Выключить наличие у всех">Выключить все</button>
    </div>

    <div class="admin__table" id="prodTable"></div>
  </section>
</main>

<div id="site-footer"></div>

</div>

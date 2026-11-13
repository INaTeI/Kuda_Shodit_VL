// QA конструктора: страница открывается с тестового origin, API /api/v1/editor подменён в памяти.
// Запуск: node design/place-constructor/qa.mjs (нужен playwright из frontend/node_modules).
import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "../../frontend/package.json"));
const { chromium } = require("playwright");
const ORIGIN = "http://vdk.test";
const URL = ORIGIN + "/constructor/";
const HTML = fs.readFileSync(path.join(HERE, "index.html"));
const DIR = path.join(HERE, "qa-output") + path.sep;
fs.mkdirSync(DIR, { recursive: true });
const out = (n) => DIR + n;
fs.writeFileSync(out("log.txt"), "");
const ok = (c, m) => fs.appendFileSync(out("log.txt"), `${c ? "PASS" : "FAIL"} ${m}\n`, "utf8");
process.on("unhandledRejection", (e) => { fs.appendFileSync(out("log.txt"), "CRASH " + e.stack + "\n"); process.exit(1); });

/* ───────── Подменённый сервер ───────── */
const CLASSIC = {
  preset: "classic",
  order: ["gallery", "title", "price", "address", "description"],
};
const mock = {
  loggedIn: false, puts: [], uploads: [], csrfMissing: 0, nextPhoto: 1,
  places: {
    pl1: {
      place: {
        id: "pl1", name: "ДЕМО Кофейня у маяка", status: "published", price_rub: 600, price_note: "на человека: кофе и выпечка",
        checked_at: "2026-11-02", address: "ДЕМО, Владивосток, ул. Набережная, 1",
        description: "Демонстрационный текст. Небольшая кофейня на набережной с окнами на бухту.\nЗдесь варят фильтр-кофе и пекут булочки с морской солью.",
        categories: [{ id: "c1", slug: "coffee", name: "Кофейни" }, { id: "c2", slug: "sea", name: "Виды на море" }],
      },
      revision: 1,
      design: null, // заполняется ниже из пресета страницы
    },
    pl2: {
      place: { id: "pl2", name: "ДЕМО Музей маяков", status: "draft", price_rub: null, price_note: "", checked_at: null, address: null, description: "Демонстрационный музей.", categories: [] },
      revision: 0, design: null,
    },
  },
};
const photo = (id, alt) => ({ id, url: `/api/v1/photos/${id}`, alt });
const svg = (n) => {
  const c = ["#7FBFC6", "#E8A87C", "#2F5D50", "#B9C9CF"][n % 4];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560"><rect width="800" height="560" fill="${c}"/><circle cx="600" cy="140" r="70" fill="#fff8"/><path d="M0 420 Q200 330 400 410 T800 380 V560 H0Z" fill="#16343b55"/></svg>`;
};
const json = (route, status, body) => route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });

async function handle(route) {
  const req = route.request(), u = new globalThis.URL(req.url()), p = u.pathname, method = req.method();
  if (u.origin !== ORIGIN) return route.abort();
  if (p === "/constructor/" || p === "/constructor/index.html") return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: HTML });
  const ph = p.match(/^\/api\/v1\/photos\/(\w+)$/);
  if (ph) return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg(parseInt(ph[1].replace(/\D/g, "") || "0", 10)) });
  if (!p.startsWith("/api/v1/editor/")) return json(route, 404, { detail: "Not Found" });
  const csrf = req.headers()["x-vdk-editor"] === "1";
  if (method !== "GET" && !csrf) { mock.csrfMissing++; return json(route, 403, { detail: "Нет заголовка X-VDK-Editor" }); }
  if (p === "/api/v1/editor/login") {
    const b = req.postDataJSON();
    if (b.username !== "admin" || b.password !== "admin1234") return json(route, 401, { detail: "Неверный логин или пароль" });
    mock.loggedIn = true;
    return json(route, 200, { username: "admin", expires_at: "2026-11-14T00:00:00Z" });
  }
  if (p === "/api/v1/editor/logout") { mock.loggedIn = false; return route.fulfill({ status: 204 }); }
  if (!mock.loggedIn) return json(route, 401, { detail: "Нужен вход в конструктор" });
  if (p === "/api/v1/editor/session") return json(route, 200, { username: "admin", expires_at: "2026-11-14T00:00:00Z" });
  if (p === "/api/v1/editor/places") {
    return json(route, 200, Object.values(mock.places).map((x) => ({ id: x.place.id, name: x.place.name, status: x.place.status, has_design: !!x.design, updated_at: null })));
  }
  const m = p.match(/^\/api\/v1\/editor\/places\/(\w+)(\/photos)?$/);
  const item = m && mock.places[m[1]];
  if (!item) return json(route, 404, { detail: "Место не найдено" });
  if (m[2] && method === "POST") {
    mock.uploads.push({ type: req.headers()["content-type"], size: req.postDataBuffer()?.length || 0 });
    return json(route, 201, photo("u" + mock.nextPhoto++, ""));
  }
  if (method === "PUT") {
    const b = req.postDataJSON();
    mock.puts.push(b);
    if (b.expected_revision !== item.revision) return json(route, 409, { detail: "Оформление изменилось после загрузки" });
    item.revision++;
    Object.assign(item.place, { name: b.name, description: b.description, address: b.address });
    item.design = {
      place_id: item.place.id, revision: item.revision, updated_at: "2026-11-13T00:00:00Z", title_accent: b.title_accent,
      page: b.page, card: b.card, photos: b.photos.map((x) => photo(x.id, x.alt)), main_photo_id: b.main_photo_id,
    };
  }
  return json(route, 200, { place: item.place, revision: item.revision, design: item.design });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1900 } });
await page.route("**/*", handle);
const errors = [];
const noise = /fonts\.g|ERR_|status of 40[139]/;
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !noise.test(m.text()) && errors.push(m.text()));
page.on("dialog", (d) => d.accept());

// Демо-оформление первого места берём из пресетов самой страницы
await page.goto(URL);
const blocks = await page.evaluate(() => PAGE_PRESETS.classic.blocks);
mock.places.pl1.design = {
  place_id: "pl1", revision: 1, updated_at: "2026-11-01T00:00:00Z", title_accent: 3,
  page: { ...CLASSIC, blocks }, card: { preset: "light", bg: "white", framed: false, items: ["wave", "coffee", "sunset", "seaview"] },
  photos: [photo("p1", "Утро у воды"), photo("p2", "Закат над бухтой"), photo("p3", "Ночной мост"), photo("p4", "Туман над сопками")],
  main_photo_id: "p1",
};
await page.reload();

/* ───────── Вход ───────── */
await page.waitForSelector("#gate:not([hidden])");
ok(await page.isVisible("#login-form"), "без сессии показан вход, конструктор закрыт");
ok((await page.$("#grid")) === null, "без входа холст не рисуется");
await page.screenshot({ path: out("0-login.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });
await page.click("#login-btn");
ok((await page.textContent("#login-err")).includes("Введите"), "пустая форма даёт подсказку");
await page.fill("#login-user", "admin");
await page.fill("#login-pass", "wrong");
await page.click("#login-btn");
await page.waitForFunction(() => document.querySelector("#login-err").textContent.length > 0);
ok((await page.textContent("#login-err")).includes("Неверный"), "неверный пароль отклонён");
await page.fill("#login-pass", "admin1234");
await page.press("#login-pass", "Enter");
await page.waitForSelector("#grid .blk");
ok(await page.isHidden("#gate"), "после входа открывается конструктор");
ok((await page.$$eval("#place option", (n) => n.length)) === 2, "в списке реальные места из API");
ok((await page.textContent("#status-text")) === "Опубликованная версия", "статус показывает опубликованную версию");
ok(await page.isDisabled("#publish"), "без правок публиковать нечего");

await page.screenshot({ path: out("1-page-edit.png"), clip: { x: 0, y: 0, width: 1440, height: 1100 } });
const topH = await page.$eval(".topbar", (e) => e.getBoundingClientRect().height);
ok(topH < 70, `верхняя панель на ПК в одну строку (${topH}px)`);

// Контраст: все пресеты и все разрешённые пары
const contrast = await page.evaluate(() => {
  const bad = [];
  for (const [k, p] of Object.entries(PAGE_PRESETS)) for (const [id, c] of Object.entries(p.blocks)) {
    const bg = hex(c.bg), t = textHex(c.text, bg), r = ratio(t, bg), a = accentFor(bg, t), ra = ratio(a, bg);
    if (r < 4.5) bad.push(`${k}/${id} текст ${r.toFixed(2)}`);
    if (ra < 3) bad.push(`${k}/${id} акцент ${ra.toFixed(2)}`);
  }
  let pairs = 0;
  for (const b of BG) for (const t of TEXT) { const h = textHex(t.id, b.hex); pairs++; if (ratio(h, b.hex) < 4.5) bad.push(`пара ${b.id}/${t.id}`); }
  for (const b of BG) { const t = autoText(b.hex); if (ratio(t, b.hex) < 4.5) bad.push(`авто ${b.id} ${ratio(t, b.hex).toFixed(2)}`); }
  const min = Math.min(...BG.map((b) => ratio(autoText(b.hex), b.hex)));
  return { bad, pairs, min: min.toFixed(2) };
});
ok(contrast.bad.length === 0, `контраст AA во всех пресетах и ${contrast.pairs} парах, минимум авто ${contrast.min} : 1 ${contrast.bad.join(", ")}`);

await page.click('.blk[data-id="title"] h1');
ok(await page.isVisible("#f-name"), "клик по блоку открывает настройки названия");
await page.fill("#f-name", "ДЕМО Кофейня на сопке");
ok((await page.textContent('.blk[data-id="title"] h1')).includes("на сопке"), "название обновляется на холсте при вводе");
ok((await page.textContent("#status-text")).startsWith("Есть неопубликованные"), "правка отмечается как неопубликованная");
await page.selectOption("#f-accent", "3");
ok((await page.textContent('.blk[data-id="title"] h1 em')) === "сопке", "акцентное слово меняется");
await page.click('label.sw:has(input[name="bg"][value="night"])');
ok(await page.isDisabled('input[name="txt"][value="ink"]'), "тёмный текст недоступен на тёмном фоне");
ok((await page.$eval('.blk[data-id="title"] .blk-inner', (e) => getComputedStyle(e).color)) === "rgb(255, 255, 255)", "авто-текст на «Ночи» белый");
await page.click('[data-setsize="L"]');
ok((await page.getAttribute('.blk[data-id="title"]', "data-size")) === "L", "размер L применён");
await page.screenshot({ path: out("2-title-selected.png"), clip: { x: 0, y: 0, width: 1440, height: 1000 } });
await page.keyboard.press("Escape");
await page.click("#undo");
ok((await page.getAttribute('.blk[data-id="title"]', "data-size")) === "M", "«Отменить» возвращает размер");

await page.click('[data-pagepreset="night"]');
ok((await page.$$eval("#grid .blk", (n) => n.map((x) => x.dataset.id))).join() === "gallery,title,description,price,address", "пресет «Ночной город» задаёт порядок");
await page.screenshot({ path: out("3-preset-night.png"), clip: { x: 0, y: 0, width: 1440, height: 1300 } });
await page.click('[data-pagepreset="classic"]');

await page.hover('.blk[data-id="description"]');
const hb = await (await page.$('.blk[data-id="description"] [data-drag]')).boundingBox();
const gb = await (await page.$('.blk[data-id="gallery"]')).boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2, gb.y + 40, { steps: 12 });
await page.mouse.up();
ok((await page.$$eval("#grid .blk", (n) => n.map((x) => x.dataset.id)))[0] === "description", "перетаскивание ст��вит описание первым");
await page.click("#undo");

await page.focus('.blk[data-id="price"]');
await page.keyboard.press("Tab");
await page.keyboard.press("ArrowUp");
ok((await page.$$eval("#grid .blk", (n) => n.map((x) => x.dataset.id))).indexOf("price") === 1, "ручка ⋮⋮ доступна с клавиатуры, стрелка вверх сдвигает блок");

await page.keyboard.press("Escape");
await page.click('.layers [data-hide="price"]');
await page.click('[data-mode="view"]');
ok((await page.$('.blk[data-id="price"]')) === null, "скрытая цена не видна в просмотре");
ok(await page.isHidden("#panel"), "в просмотре панели нет");
await page.screenshot({ path: out("4-page-view.png"), clip: { x: 0, y: 0, width: 1440, height: 1100 } });
await page.click('[data-mode="edit"]');
ok(await page.isDisabled('.layers [data-hide="title"]'), "название нельзя скрыть");

/* ───────── Фото уходят на сервер ───────── */
await page.click('.blk[data-id="gallery"] .gal-main');
const png = await page.screenshot({ clip: { x: 0, y: 200, width: 400, height: 300 } });
await page.setInputFiles("#file", { name: "x.png", mimeType: "image/png", buffer: png });
await page.waitForFunction(() => document.querySelectorAll(".ph").length === 5);
ok(mock.uploads.length === 1 && mock.uploads[0].type === "image/jpeg" && mock.uploads[0].size > 1000, `фото сжато в JPEG и загружено на сервер (${JSON.stringify(mock.uploads[0])})`);
await page.setInputFiles("#file", { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
const et = await page.textContent(".hint.err").catch(() => "нет");
ok(et.includes("формат"), "неверный формат даёт понятную ошибку: " + et);
ok(mock.uploads.length === 1, "неподходящий файл не отправляется");
await page.click('[data-act="setmain"]');
ok((await page.$$eval(".ph", (n) => n.findIndex((x) => x.querySelector(".tag")))) === 4, "новое фото стало главным");
await page.screenshot({ path: out("5-gallery.png"), clip: { x: 1068, y: 0, width: 372, height: 1300 } });

/* ───────── Карточка ───────── */
await page.click('[data-tab="card"]');
ok((await page.textContent(".meter-val")).startsWith("30"), "стартовый вес 30");
await page.click('[data-decor="star"]');
ok((await page.textContent(".meter-val")).startsWith("45"), "⭐ +15 → 45");
ok((await page.getAttribute('[data-decor="trophy"]', "aria-disabled")) === "true", "🏆 (20) неактивен при свободных 5");
await page.click('[data-decor="trophy"]', { force: true });
ok((await page.textContent("#live")).includes("не помещается"), "нажатие на неактивный объясняет причину");
await page.click('[data-decor="smile"]');
ok((await page.textContent(".meter-val")).startsWith("50"), "лимит 50");
ok(await page.isVisible(".limit-banner"), "плашка «лимит достигнут»");
const st = await page.$$eval(".decor", (n) => ({ un: n.filter((x) => x.getAttribute("aria-pressed") === "false").length, dis: n.filter((x) => x.getAttribute("aria-disabled") === "true" && x.getAttribute("aria-pressed") === "false").length }));
ok(st.un === st.dis, `все невыбранные неактивны (${st.dis} из ${st.un})`);
ok((await page.getAttribute('[data-decor="editor"]', "aria-disabled")) === "true", "«Выбор редакции» не помещается при лимите");
await page.click('[data-cardpreset="night"]');
ok((await page.$eval(".mini img", (e) => e.getAttribute("src"))) === "/api/v1/photos/u1", "карточка взяла новое главное фото");
await page.screenshot({ path: out("6-card-full.png"), clip: { x: 0, y: 0, width: 1440, height: 1250 } });
await page.click('.mini [data-remove="star"]');
ok((await page.textContent(".meter-val")).startsWith("35"), "клик по смайлику на карточке убирает его");
await page.click('[data-cardpreset="polaroid"]');

/* ───────── Публикация ───────── */
await page.click("#publish");
ok((await page.textContent("#toast")).includes("описания у всех фото"), "без описания нового фото публикация не уходит");
ok(mock.puts.length === 0, "PUT не отправлен при незаполненном описании");
await page.click('[data-act="gotogallery"]');
await page.click('[data-photo="u1"]');
await page.fill("#f-alt", "Вид на бухту с террасы");
await page.press("#f-alt", "Tab");
await page.click("#publish");
await page.waitForFunction(() => document.querySelector("#status-text").textContent.startsWith("Опубликовано"));
const put = mock.puts.at(-1);
ok(mock.csrfMissing === 0, "все изменяющие запросы несут X-VDK-Editor");
ok(put.expected_revision === 1 && put.title_accent === 3 && put.name === "ДЕМО Кофейня на сопке", "PUT несёт ревизию, название и акцент");
ok(put.photos.length === 5 && put.main_photo_id === "u1" && put.photos.find((x) => x.id === "u1").alt === "Вид на бухту с термасы".replace("м", ""), "PUT несёт фото, главное и описание");
ok(put.card.preset === "polaroid" && put.page.blocks.price.hidden === true, "PUT несёт оформление карточки и страницы");
ok(Object.keys(put).sort().join() === "address,card,description,expected_revision,main_photo_id,name,page,photos,title_accent", "в PUT нет лишних полей (схема Strict)");
ok(mock.places.pl1.revision === 2 && (await page.isDisabled("#publish")), "после публикации ревизия 2, кнопка неактивна");
await page.screenshot({ path: out("7-published.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });

// Конфликт: кто-то опубликовал раньше
mock.places.pl1.revision = 3;
await page.click('[data-tab="page"]');
await page.click('.blk[data-id="title"] h1');
await page.click('[data-setsize="S"]');
await page.click("#publish");
await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("другой вкладке"));
ok(true, "конфликт ревизий (409) объяснён, правки не потеряны");
ok((await page.textContent("#status-text")).startsWith("Есть неопубликованные"), "после 409 правки остаются неопубликованными");

// Другое место (черновик без оформления); диалог о несохранённых правках принимается
await page.selectOption("#place", "pl2");
await page.waitForFunction(() => document.querySelector("#status-text").textContent.includes("не опубликовано в каталоге"));
ok((await page.textContent("#status-text")).startsWith("Оформление ещё не настроено"), "место без оформления открывается с классическим стилем");
ok(!(await page.isDisabled("#publish")), "для нового оформления публикация доступна сразу");
ok((await page.textContent('.blk[data-id="price"] .amount')) === "Стоимость уточняется", "неизвестная цена не выдумывается");

await page.click("#logout");
await page.waitForSelector("#gate:not([hidden])");
ok(!mock.loggedIn, "выход завершает сессию");

/* ───────── Телефон ───────── */
const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await m.route("**/*", handle);
m.on("pageerror", (e) => errors.push("mobile: " + e.message));
m.on("console", (x) => x.type() === "error" && !noise.test(x.text()) && errors.push("mobile: " + x.text()));
await m.goto(URL + "#pl1");
await m.fill("#login-user", "admin");
await m.fill("#login-pass", "admin1234");
await m.tap("#login-btn");
await m.waitForSelector("#grid .blk");
await m.screenshot({ path: out("8-mobile-page.png") });
ok((await m.$eval(".topbar", (e) => e.getBoundingClientRect().height)) < 110, "верхняя панель на телефоне компактная");
await m.tap('.blk[data-id="title"] h1');
ok(await m.isVisible("#f-name"), "тап по блоку на телефоне открывает лист");
await m.screenshot({ path: out("9-mobile-sheet.png") });
ok((await m.evaluate(() => document.documentElement.scrollWidth)) <= 390, "нет горизонтальной прокрутки на 390px");
await m.tap('[data-tab="card"]');
await m.tap('[data-act="sheet"]');
await m.screenshot({ path: out("10-mobile-card.png") });
const small = await m.$$eval("button, input:not(.sr), select, [role=button]", (n) => n.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 24 || r.height < 24); }).map((e) => e.className || e.tagName));
ok(small.length === 0, "все цели касания ≥ 24px: " + small.join(","));

ok(errors.length === 0, "ошибок в консоли нет " + errors.join(" | "));
await browser.close();
const res = fs.readFileSync(out("log.txt"), "utf8"); console.log(res); process.exit(/^FAIL|^CRASH/m.test(res) ? 1 : 0);

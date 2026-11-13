import { createRequire } from "module";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, "../../frontend/package.json"));
const { chromium } = require("playwright");
const URL = pathToFileURL(path.join(HERE, "index.html")).href;
const DIR = path.join(HERE, "qa-output") + path.sep;
fs.mkdirSync(DIR, { recursive: true });
const out = (n) => DIR + n;
fs.writeFileSync(out("log.txt"), "");
const ok = (c, m) => fs.appendFileSync(out("log.txt"), `${c ? "PASS" : "FAIL"} ${m}\n`, "utf8");
process.on("unhandledRejection", (e) => { fs.appendFileSync(out("log.txt"), "CRASH " + e.stack + "\n"); process.exit(1); });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && !/fonts\.g|ERR_/.test(m.text()) && errors.push(m.text()));
await page.goto(URL);
await page.evaluate(() => localStorage.clear());
await page.reload();
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
await page.click('[data-pagepreset="magazine"]');
await page.screenshot({ path: out("3b-preset-magazine.png"), clip: { x: 0, y: 0, width: 1440, height: 1300 } });
await page.click('[data-pagepreset="classic"]');

await page.hover('.blk[data-id="description"]');
const hb = await (await page.$('.blk[data-id="description"] [data-drag]')).boundingBox();
const gb = await (await page.$('.blk[data-id="gallery"]')).boundingBox();
await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
await page.mouse.down();
await page.mouse.move(gb.x + gb.width / 2, gb.y + 40, { steps: 12 });
await page.screenshot({ path: out("2b-dragging.png"), clip: { x: 0, y: 0, width: 1440, height: 1000 } });
await page.mouse.up();
ok((await page.$$eval("#grid .blk", (n) => n.map((x) => x.dataset.id)))[0] === "description", "перетаскивание ставит описание первым");
await page.click("#undo");

await page.focus('.blk[data-id="price"]');
await page.keyboard.press("Tab");
await page.keyboard.press("ArrowUp");
ok((await page.$$eval("#grid .blk", (n) => n.map((x) => x.dataset.id))).indexOf("price") === 1, "ручка ⋮⋮ доступна с клавиатуры, стрелка вверх сдвигает блок");

await page.keyboard.press("Escape");
await page.click('.layers [data-hide="price"]');
await page.screenshot({ path: out("4a-hidden-edit.png"), clip: { x: 0, y: 0, width: 1440, height: 1100 } });
await page.click('[data-mode="view"]');
ok((await page.$('.blk[data-id="price"]')) === null, "скрытая цена не видна в просмотре");
ok(await page.isHidden("#panel"), "в просмотре панели нет");
await page.screenshot({ path: out("4-page-view.png"), clip: { x: 0, y: 0, width: 1440, height: 1100 } });
await page.click('[data-mode="edit"]');
ok(await page.isDisabled('.layers [data-hide="title"]'), "название нельзя скрыть");

await page.click('.blk[data-id="gallery"] .gal-main');
const png = await page.screenshot({ clip: { x: 0, y: 200, width: 400, height: 300 } });
await page.setInputFiles("#file", { name: "x.png", mimeType: "image/png", buffer: png });
await page.waitForFunction(() => document.querySelectorAll(".ph").length === 5);
ok(true, "загрузка фото добавляет пятое фото");
await page.setInputFiles("#file", { name: "doc.pdf", mimeType: "application/pdf", buffer: Buffer.from("x") });
const et = await page.textContent(".hint.err").catch(() => "нет");
ok(et.includes("формат"), "неверный формат даёт понятную ошибку: " + et);
await page.click('[data-act="setmain"]');
ok((await page.$$eval(".ph", (n) => n.findIndex((x) => x.querySelector(".tag")))) === 4, "новое фото стало главным");
await page.screenshot({ path: out("5-gallery.png"), clip: { x: 1068, y: 0, width: 372, height: 1300 } });

await page.click('[data-tab="card"]');
ok((await page.textContent(".meter-val")).startsWith("30"), "стартовый вес 30");
await page.click('[data-decor="star"]');
ok((await page.textContent(".meter-val")).startsWith("45"), "⭐ +15 → 45");
ok((await page.getAttribute('[data-decor="trophy"]', "aria-disabled")) === "true", "🏆 (20) неактивен при свободных 5");
await page.click('[data-decor="trophy"]', { force: true });
ok((await page.textContent("#live")).includes("не помещается"), "нажатие на неактивный объясняет причину: " + (await page.textContent("#live")));
await page.click('[data-decor="smile"]');
ok((await page.textContent(".meter-val")).startsWith("50"), "лимит 50");
ok(await page.isVisible(".limit-banner"), "плашка «лимит достигнут»");
const st = await page.$$eval(".decor", (n) => ({ un: n.filter((x) => x.getAttribute("aria-pressed") === "false").length, dis: n.filter((x) => x.getAttribute("aria-disabled") === "true" && x.getAttribute("aria-pressed") === "false").length }));
ok(st.un === st.dis, `все невыбранные неактивны (${st.dis} из ${st.un})`);
await page.click('[data-cardpreset="night"]');
ok((await page.$eval(".mini img", (e) => e.src.slice(0, 22))).startsWith("data:image/jpeg"), "карточка взяла новое главное фото");
await page.evaluate(() => { const p = S.place.photos.find((x) => x.id === "p3"); S.place.mainId = "p3"; render(); });
await page.screenshot({ path: out("6-card-full.png"), clip: { x: 0, y: 0, width: 1440, height: 1250 } });
await page.click('.mini [data-remove="star"]');
ok((await page.textContent(".meter-val")).startsWith("35"), "клик по смайлику на карточке убирает его");
await page.click('[data-cardpreset="polaroid"]');
await page.click('[data-mode="view"]');
await page.screenshot({ path: out("7-card-view.png"), clip: { x: 0, y: 0, width: 1440, height: 900 } });
await page.click('[data-mode="edit"]');
await page.selectOption("#role", "moderator");
ok((await page.textContent("#publish .publish-long")) === "Опубликовать", "модератору доступна публикация");
ok((await page.getAttribute('[data-decor="editor"]', "aria-disabled")) === "true", "«Выбор редакции» не помещается при лимите и у модератора");

const m = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
m.on("pageerror", (e) => errors.push("mobile: " + e.message));
await m.goto(URL);
await m.evaluate(() => localStorage.clear());
await m.reload();
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

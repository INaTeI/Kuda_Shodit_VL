import { test, expect } from '@playwright/test';
const place = { id:'11111111-1111-4111-8111-111111111111', name:'Тестовое место', description:'Описание', activity:'Прогулка', address:'Улица', latitude:43.1, longitude:131.9, price_rub:0, price_note:'Без расходов', status:'published', categories:[{slug:'nature',name:'Природа'}], photo_url:null };
test.beforeEach(async ({page}) => {
 await page.route('**/api/v1/**', async route => { const path=new URL(route.request().url()).pathname; let data:any={};
 if(path.endsWith('/categories')) data=place.categories;
 else if(path.endsWith('/places')) data={items:[place],total:1,limit:12,offset:0};
 else if(path.includes('/places/')) data=place;
 else if(path.includes('/constructor-state/')) data={state:null};
 else if(path.endsWith('/profiles')) data={access_token:'test-token',profile:{id:'profile',interests:[],budget_rub:null}};
 else if(path.endsWith('/me')) data={id:'profile',interests:[],budget_rub:null};
 else if(path.endsWith('/place-states')) data=[];
 else if(path.endsWith('/discovery')) data={recommendation_id:'22222222-2222-4222-8222-222222222222',items:[{place,reasons:[],score:0,distance_km:null}],total:1};
 else if(path.endsWith('/events')) data={event_id:route.request().postDataJSON().event_id,duplicate:false,reaction:'like',reaction_revision:1};
 await route.fulfill({json:data}); });
});
test('start swiping without setting preferences', async ({page}) => {
 let preferenceWrites=0;
 await page.route('**/api/v1/me/preferences', async route => { preferenceWrites++; await route.fulfill({json:{id:'profile',interests:[],budget_rub:null}}); });
 await page.goto('/taste'); await page.getByRole('button',{name:'Начать выбор',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Выбирай места карточками'})).toBeVisible();
 expect(preferenceWrites).toBe(0);
});
test('home and category filters', async ({page}) => {
 await page.setViewportSize({width:390,height:844}); await page.goto('/');
 const hero=page.locator('.hero'); const button=hero.getByRole('link',{name:/Смотреть места/});
 await expect(button).toHaveAttribute('href','/catalog'); expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(60);
 await expect(hero.getByText('Выбирать карточками')).toHaveCount(0); await button.click();
 await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 await expect(page.getByRole('dialog').getByText('Бюджет на человека')).toHaveCount(0);
 await expect(page.getByRole('dialog').getByRole('button',{name:/Рядом со мной/})).toHaveCount(0);
});
test('compact map and finish without inner scrolling', async ({page}) => {
 await page.addInitScript(()=>localStorage.setItem('vdk-guest-token','test-token'));
 await page.emulateMedia({reducedMotion:'reduce'}); await page.setViewportSize({width:390,height:844}); await page.goto('/taste');
 await page.getByRole('button',{name:'Начать выбор →'}).click(); await page.getByRole('button',{name:'О месте ↗'}).click();
 const dialog=page.getByRole('dialog'); await expect(dialog.locator('.place-map')).toBeVisible();
 expect((await dialog.locator('.place-map').boundingBox())!.width).toBeLessThanOrEqual(320);
 await dialog.getByRole('button',{name:'Закрыть'}).click(); await page.getByRole('button',{name:'Нравится — вправо'}).click();
 const end=page.locator('.taste-complete-card'); await expect(end).toBeVisible();
 expect(await end.evaluate(el=>el.scrollHeight <= el.clientHeight)).toBe(true);
});
for (const width of [360, 768, 1280]) test(`swipe entry and return to catalog ${width}`, async ({page}) => {
 await page.setViewportSize({width,height:850}); await page.goto('/');
 await expect(page.getByRole('heading',{name:/Один свайп до нового места/})).toBeVisible();
 await expect(page.getByRole('link',{name:'Начать выбирать места свайпами'})).toHaveAttribute('href','/taste');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 await page.getByRole('link',{name:/Смотреть места/}).last().click();
 if (width <= 600) await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 await page.getByRole('button',{name:'+ Природа'}).last().click();
 await page.getByRole('button',{name:'Показать места'}).last().click();
 await page.locator('.card-link').first().click(); await page.goBack();
 if (width <= 600) await page.getByRole('button',{name:'Фильтры',exact:true}).click();
 await expect(page.getByRole('button',{name:'✓ Природа'}).last()).toHaveAttribute('aria-pressed','true');
});
test('return to a scrolled catalog keeps the position', async ({ page }) => {
 await page.route('**/api/v1/places?**', route => route.fulfill({json:{items:Array.from({length:12},(_,i)=>({...place,id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,name:`Место ${i+1}`})),total:12,limit:12,offset:0}}));
 await page.setViewportSize({width:390,height:700});
 await page.goto('/catalog');
 const card=page.locator('.card-link').nth(8);
 await card.scrollIntoViewIfNeeded();
 const before=await page.evaluate(()=>window.scrollY);
 await card.click();
 await page.goBack();
 await expect(page.locator('.card-link')).toHaveCount(12);
 await expect.poll(()=>page.evaluate(()=>window.scrollY)).toBeGreaterThan(before - 100);
});

import { test, expect } from '@playwright/test';
const periods = [
  {period:'Утро',time:'09:00',temperature_c:4,condition:'Ясно',condition_code:1000,is_day:true,wind_kph:18,chance_of_rain:0,chance_of_snow:0},
  {period:'День',time:'15:00',temperature_c:7,condition:'Дождь',condition_code:1183,is_day:true,wind_kph:21.6,chance_of_rain:80,chance_of_snow:0},
  {period:'Вечер',time:'21:00',temperature_c:-2,condition:'Снег',condition_code:1213,is_day:false,wind_kph:10.8,chance_of_rain:0,chance_of_snow:60},
];
test('forecast opens on click, shows conditions, wind and closes with Escape',async({page})=>{
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/v1/weather/current',r=>r.fulfill({json:{temperature_c:4,wind_kph:18,wind_dir:'N'}}));
 await page.route('**/api/v1/weather/forecast',r=>r.fulfill({json:{date:'2026-11-13',sunrise:'07:58',sunset:'17:48',periods}}));
 await page.goto('/');
 await expect(page.getByText('5 м/с', {exact:false})).toContainText('Северный');
 await page.getByRole('button',{name:'Открыть прогноз на сегодня'}).click();
 const dialog=page.getByRole('dialog',{name:'Погода на сегодня'});
 await expect(dialog).toBeVisible();
 for(const text of ['Утро','День','Вечер','09:00','15:00','21:00','Ясно','Дождь','Снег'])await expect(dialog.getByText(text,{exact:true})).toBeVisible();
 await expect(dialog.getByText('Рассвет 07:58',{exact:false})).toBeVisible();
 await expect(dialog.getByText('Закат 17:48',{exact:false})).toBeVisible();
 await expect(dialog.getByText('Ветер 6 м/с',{exact:false})).toBeVisible();
 await expect(dialog.getByText('Дождь 80%',{exact:false})).toBeVisible();
 await expect(dialog.getByText('Снег 60%',{exact:false})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();
 await expect(page.getByRole('button',{name:'Открыть прогноз на сегодня'})).toBeFocused();
});
test('forecast errors remain retryable when current weather is unavailable',async({page})=>{
 await page.route('**/api/v1/weather/current',r=>r.fulfill({status:503,json:{detail:'Нет погоды'}}));
 await page.route('**/api/v1/weather/forecast',r=>r.fulfill({status:503,json:{detail:'Нет прогноза'}}));
 await page.goto('/');await page.getByRole('button',{name:'Открыть прогноз на сегодня'}).click();
 await expect(page.getByRole('alert')).toContainText('Прогноз временно недоступен');
 await expect(page.getByRole('button',{name:'Попробовать снова'})).toBeVisible();
});




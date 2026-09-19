import { test, expect } from '@playwright/test';
import { dateKey } from '../src/app/journal';
test('example journal renders at desktop and mobile sizes',async({page})=>{
  await page.request.post('/api/auth/register',{headers:{'X-Tracks-Request':'1'},data:{name:'Alex',email:`layout-${Date.now()}@example.com`,password:'Layout-Journal-42!'}});
  const seeded=await page.request.post('/api/examples?today='+dateKey(new Date()),{headers:{'X-Tracks-Request':'1'}});expect(seeded.status()).toBe(204);
  await page.setViewportSize({width:1440,height:1100});await page.goto('/');
  await expect(page.getByRole('heading',{name:'German',exact:true})).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('position','fixed');
  await expect(page.locator('.track-grid')).toHaveCSS('display','grid');
  await page.screenshot({path:'../.local/desktop-journal.png',fullPage:true});
  await page.getByRole('button',{name:'Open Running',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Your consistency'})).toBeVisible();
  await page.screenshot({path:'../.local/desktop-track.png',fullPage:false});
  await page.setViewportSize({width:390,height:844});await page.goto('/');
  await expect(page.getByRole('heading',{name:'German',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:'../.local/mobile-journal.png',fullPage:true});
  await page.getByRole('button',{name:'Archived',exact:true}).click();await expect(page.getByRole('heading',{name:'Nothing tucked away yet.'})).toBeVisible();
});

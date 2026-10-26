/** Navegador efímero, solo datos sintéticos. Requiere Playwright y Chrome. */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const url = process.argv[2] || 'http://127.0.0.1:8444/';
(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  try {
    const context = await browser.newContext();
    const errors = [];
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.getByRole('button', { name: 'Configuración', exact: true }).waitFor({timeout:15000});
    const second = await context.newPage();
    await second.goto(url);
    await second.getByRole('heading', {name:'La aplicación está abierta en otra pestaña'}).waitFor();
    await page.close();
    // La petición en cola adquiere el lock automáticamente cuando se cierra la primera.
    await second.getByRole('button',{name:'Configuración',exact:true}).waitFor();
    await second.getByRole('button',{name:'Configuración',exact:true}).click();
    await second.getByRole('heading',{name:'Configuración',exact:true}).waitFor();
    await second.getByLabel('Nombre de la empresa', {exact:true}).fill('QA persistencia');
    await second.waitForTimeout(900);
    const saved = await second.evaluate(() => {
      const index = JSON.parse(localStorage.getItem('planilla_profiles'));
      const raw = localStorage.getItem('planilla_data_'+index.activeId);
      return {index,raw};
    });
    assert.equal(JSON.parse(saved.raw).companyName,'QA persistencia');
    await second.reload();
    await second.getByRole('button',{name:'Configuración',exact:true}).waitFor();
    const after = await second.evaluate(id => localStorage.getItem('planilla_data_'+id),saved.index.activeId);
    assert.equal(after,saved.raw);
    await second.evaluate(id => localStorage.setItem('planilla_data_'+id,'{"employees":['),saved.index.activeId);
    await second.reload();
    await second.getByRole('heading',{name:'Se necesita recuperar los datos'}).waitFor();
    await second.waitForTimeout(2000);
    assert.equal(await second.evaluate(id => localStorage.getItem('planilla_data_'+id),saved.index.activeId),'{"employees":[');
    await second.setViewportSize({width:375,height:812});
    assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    console.log(JSON.stringify({strict_mode_boot:true,single_writer_tabs:true,save_reload:true,corrupt_not_overwritten:true,mobile_recovery_no_overflow:true,page_errors:errors},null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exit(1)});

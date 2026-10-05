/** Real admin UI with intercepted demonstration API responses. No live API is called.
 * PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node docs/screenshots/capture.mjs
 * Optional: SCREENSHOT_BASE_URL=http://localhost:8080 (default).
 */
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
const moduleName = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(moduleName ? pathToFileURL(moduleName).href : 'playwright');
const base = process.env.SCREENSHOT_BASE_URL || 'http://127.0.0.1:8080';
const out = dirname(fileURLToPath(import.meta.url));
await mkdir(out, { recursive: true });
const address = 'TDEMO'+'1'.repeat(29);
const mainAddress = 'TMAIN'+'3'.repeat(29);
const poolAddress = 'TPOOL'+'2'.repeat(29);
const when = '2026-10-05T10:00:00.000Z';
const tx = 'a'.repeat(64);
const explorer = 'https://tronscan.org/#/';
const pageData = items => ({ items, total: items.length, page: 1, pageSize: 25 });
const item = { id:'demo-address', alias:'invoice-001', address, addressHex:'41'+'0'.repeat(40), derivationIndex:0, status:'assigned', onchainStatus:'active', usdtBalance:'25', usdtBalanceRaw:'25000000', balanceCheckedAt:when, lastDepositAt:when, createdAt:when, explorerUrl:explorer+'address/'+address };
const deposit = { id:'demo-deposit', alias:item.alias, address, fromAddress:address, txId:tx, logIndex:0, blockNumber:86844000, amount:'25', amountRaw:'25000000', status:'confirmed', confirmedAt:when, creditedAt:when, sweptAt:null, sweepId:null, rejectReason:null, explorerUrl:explorer+'transaction/'+tx };
const sweep = { id:'demo-sweep', alias:item.alias, address, collectorAddress:mainAddress, amount:'25', amountRaw:'25000000', status:'confirmed', energySource:'itrx', energyEstimated:65000, energyUsed:64300, bandwidthUsed:345, trxFeeBurnedSun:'0', resourceCostSun:'3000000', txId:tx, attempt:1, lastError:null, broadcastAt:when, confirmedAt:when, createdAt:when, updatedAt:when, explorerUrl:explorer+'transaction/'+tx };
const settings = { sweepMinUsdt:'20', sweepMaxAgeHours:72, minDepositUsdt:'0.01', feeLimitSun:'15000000', energyMargin:1.1, energyDailyBudgetSun:'2000000000', sweepMaxPerHour:200, providerOrder:['itrx','own_pool'], burnEnabled:false, leaveDustOnAddress:false, itrxApiKey:'DEMO-KEY-NOT-A-REAL-CREDENTIAL', itrxApiSecret:'', itrxApiSecretSet:true, itrxRentPeriod:'1H', payoutMaxUsdt:'1000', payoutDailyMaxUsdt:'10000' };
const wallet = { initialized:true, network:'mainnet', xpub:'xpub-demo-public-key', addressesIssued:1, collectorAddress:mainAddress, collectorUsdt:'125.5', collectorExternal:false, explorerBase:explorer, main:{ address:mainAddress, explorerUrl:explorer+'address/'+mainAddress, usdtBalance:'125.5', trxBalance:'1', activated:true, isCollector:true }, pool:{ address:poolAddress, explorerUrl:explorer+'address/'+poolAddress, trxBalance:'100', energyAvailable:0, activated:true, minTrx:'100', lowBalance:false } };
const shots = [], errors = [];
const browser = await chromium.launch({ headless:true, ...(process.env.PLAYWRIGHT_CHROMIUM ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM}: {}) });
try {
 for (const lang of ['ru','en']) {
  const context = await browser.newContext({ viewport:{ width:1320, height:950 }, locale:lang==='ru'?'ru-RU':'en-US', timezoneId:'Europe/Moscow', deviceScaleFactor:1 });
  let firstRun=false, initialized=true;
  await context.addInitScript(({lang}) => { localStorage.setItem('usdt-trx.admin.lang',lang); if (location.pathname==='/setup' || location.pathname==='/login') localStorage.removeItem('usdt-trx.admin.token'); else localStorage.setItem('usdt-trx.admin.token','demo-session-not-valid'); }, {lang});
  await context.route('**/*', async route => {
   const url = new URL(route.request().url());
   if (url.origin !== new URL(base).origin) return route.abort();
   if (!url.pathname.startsWith('/admin/v1/')) return route.continue();
   const path=url.pathname.slice('/admin/v1'.length);
   let response;
   if (path==='/me') response={ role:'admin',network:'mainnet',collectorAddress:null,explorerBase:explorer,totpStepUp:false,authKind:'session' };
   else if (path==='/setup/status') response={ needed:firstRun,tokenMissing:false,network:'mainnet',rpc:{urls:['https://api.trongrid.io'],provider:'trongrid',apiKeySet:true,ok:true,block:86844000,latencyMs:180,error:null} };
   else if (path==='/wallet') response=initialized?wallet:{...wallet,initialized:false,xpub:null,main:null,pool:null,addressesIssued:0,collectorAddress:null,collectorUsdt:'0'};
   else if (path==='/settings') response=settings;
   else if (path==='/providers') response=[{ name:'itrx',source:'rental',enabled:true },{ name:'own_pool',source:'own',enabled:true }];
   else if (path==='/providers/itrx/test') response={ok:true,provider:'itrx',unitPriceSun:46,transferCostTrx:'3',balanceTrx:'50',detail:''};
   else if (path==='/recovery/status') response={state:'idle',phase:'',addressesScanned:0,addressesRecovered:0,depositsIngested:0,sweepsRecovered:0,hopsScanned:0,hopsRecovered:0,errors:[]};
   else if (path==='/addresses' && route.request().method()==='POST') response={...item,created:true};
   else if (path==='/addresses') response=pageData([item]);
   else if (path==='/deposits') response=pageData([deposit]);
   else if (path==='/sweeps') response=pageData([sweep]);
   else if (path==='/payouts') response=pageData([]);
   else {errors.push('Unhandled demo API: '+path);return route.fulfill({status:501,json:{message:'No demo fixture'}});}
   return route.fulfill({json:response});
  });
  const page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  async function open(path) { await page.goto(base+path);await page.waitForTimeout(800);await page.locator('.ant-spin-spinning').waitFor({state:'hidden',timeout:10000}).catch(()=>{}); }
  async function shot(name, locator=page) {
   await page.evaluate(lang=>{ document.getElementById('docs-demo')?.remove(); const badge=document.createElement('div'); badge.id='docs-demo';badge.textContent=lang==='ru'?'ПРИМЕР · демонстрационные данные':'EXAMPLE · demonstration data';Object.assign(badge.style,{position:'fixed',bottom:'12px',right:'12px',background:'#102a43',color:'white',padding:'7px 12px',font:'12px system-ui',borderRadius:'6px',zIndex:9999,pointerEvents:'none'});document.body.append(badge); },lang);
   await page.waitForTimeout(200);
   const file=`${name}.${lang}.png`;
   await locator.screenshot({path:resolve(out,file),animations:'disabled'});
   shots.push({file,path:new URL(page.url()).pathname,language:lang,demo:true});
   console.log(file);
  }
  firstRun=true;await open('/setup');await shot('setup-network',page.locator('.ant-card'));
  await page.getByRole('button',{name:/Продолжить.*MAINNET|Continue.*MAINNET/i}).click();await shot('setup-account',page.locator('.ant-card'));
  firstRun=false;initialized=false;await open('/wallet');await shot('wallet-create');
  initialized=true;await open('/wallet');await shot('wallet');
  const poolTitle=lang==='ru'?'Пул':'Pool';
  const poolCard=page.locator('.ant-card').filter({has:page.locator('.ant-card-head-title').filter({hasText:poolTitle})}).first();
  await poolCard.scrollIntoViewIfNeeded();await shot('pool-funding',poolCard);
  await open('/settings');await shot('itrx-settings');
  await page.getByRole('button',{name:lang==='ru'?'Проверить подключение':'Test connection'}).click();await page.waitForTimeout(400);await shot('itrx-connected');
  await open('/wallet');await page.getByRole('button',{name:/Создать адрес|Create address/}).click();
  await page.locator('#alias').fill('invoice-001');await shot('address-create');
  await page.getByRole('button',{name:lang==='ru'?'Создать':'Create',exact:true}).click();await page.waitForTimeout(400);await shot('address-ready');
  await open('/addresses');await shot('addresses');
  await open('/deposits');await shot('deposits');
  await open('/sweeps');await shot('sweeps');
  await open('/payouts?new=1');await page.locator('.ant-modal #externalId').fill('payout-001');await page.locator('#amount').fill('10');await shot('payout-create');
  await context.close();
 }
 if (errors.length) throw Error(errors.join('\n'));
 await writeFile(resolve(out,'manifest.json'),JSON.stringify({baseUrl:base,source:'Built admin app, intercepted demo API; all external requests blocked',screenshots:shots},null,2)+'\n');
} finally { await browser.close(); }

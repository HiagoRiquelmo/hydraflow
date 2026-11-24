'use strict';
// Teste de verdade da tela do watercooler (precisa do cooler ligado): conecta pelo driver do app, manda imagens de
// teste, mede o envio, simula a porta ocupada por outro programa, desconecta e reconecta.
// Uso: node_modules\electron\dist\electron.exe scripts\cooler-test.js
const { app, BrowserWindow } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { CoolerLcd } = require('../src/main/coolerLcd');

app.disableHardwareAcceleration();
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 23)}]`, ...a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** JPEG 480×480 com o texto dado, desenhado num canvas (o mesmo caminho do coolerStream.js do app). */
async function testImage(win, title, sub, hue) {
  const url = await win.webContents.executeJavaScript(`(() => {
    const c = document.createElement('canvas'); c.width = c.height = 480; const x = c.getContext('2d');
    const g = x.createConicGradient(${hue} * Math.PI / 180, 240, 240);
    [0, 1, 2, 3].forEach(i => g.addColorStop(i / 3, 'hsl(' + (${hue} + i * 120) + ',90%,45%)'));
    x.fillStyle = g; x.fillRect(0, 0, 480, 480);
    x.fillStyle = '#000a'; x.beginPath(); x.roundRect(40, 160, 400, 160, 24); x.fill();
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.font = '800 52px Segoe UI'; x.fillText(${JSON.stringify(title)}, 240, 232);
    x.font = '26px Segoe UI'; x.fillText(${JSON.stringify(sub)}, 240, 280);
    return c.toDataURL('image/jpeg', 0.85);
  })()`);
  return Buffer.from(url.split(',')[1], 'base64');
}

/** Outro processo segurando a porta COM (como o ZEUS CAST faria) por `ms`. */
function holdPort(com, ms) {
  const code = `const k=require('koffi').load('kernel32.dll');const C=k.func('intptr __stdcall CreateFileW(str16,uint32,uint32,void*,uint32,uint32,void*)');` +
    `const h=C('\\\\\\\\.\\\\${com}',0xC0000000,0,null,3,0,null);console.log(h===-1?'falhou':'segurando');setTimeout(()=>{},${ms});`;
  const p = spawn(process.execPath, ['-e', code], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: path.join(__dirname, '..') });
  return new Promise(resolve => p.stdout.once('data', d => resolve({ proc: p, ok: String(d).includes('segurando') })));
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await win.loadURL('about:blank');
  const results = [];
  const check = (name, ok, detail = '') => { results.push({ name, ok }); log(ok ? 'OK  ' : 'FALHOU', name, detail); };
  try {
    // 1. detecção e aperto de mão
    let lcd = new CoolerLcd({ onState: s => log('estado:', JSON.stringify({ connected: s.connected, error: s.error })) });
    const found = await lcd.detectAll();
    check('detecção', found.length > 0, JSON.stringify(found.map(f => ({ kind: f.kind, path: f.path, model: f.model }))));
    let t = Date.now();
    let conn = await lcd.ensure(true);
    check('conexão (power/conn/timeout/realtimeDisplay com resposta 200)', !!conn, `${Date.now() - t} ms ${JSON.stringify(conn?.device)}`);
    if (!conn) throw new Error('sem conexão: ' + JSON.stringify(lcd.state.error));

    // 2. imagem parada
    const img1 = await testImage(win, 'HYDRAFLOW', 'teste 1: imagem parada', 200);
    t = Date.now(); const sent = await lcd.frame(img1);
    check('envio de imagem', sent && lcd.state.connected, `${img1.length} bytes em ${Date.now() - t} ms`);
    await sleep(4000);

    // 3. animação: 60 quadros a ~15 por segundo
    const frames = [];
    for (let i = 0; i < 6; i++) frames.push(await testImage(win, 'HYDRAFLOW', `teste 2: animação ${i + 1}/6`, i * 60));
    const times = [];
    for (let i = 0; i < 60; i++) {
      const a = Date.now();
      if (!await lcd.frame(frames[i % frames.length])) break;
      times.push(Date.now() - a);
      await sleep(Math.max(0, 66 - (Date.now() - a)));
    }
    times.sort((x, y) => x - y);
    check('atualização contínua (60 quadros)', times.length === 60 && lcd.state.connected, `envio p50 ${times[30]} ms, máx ${times[times.length - 1]} ms`);
    check('brilho', await conn.setBrightness(60).then(() => true, () => false));
    await conn.setBrightness(100);

    // 4. fechar e reabrir (como fechar e abrir o Hydraflow)
    await lcd.close();
    lcd = new CoolerLcd({});
    t = Date.now(); conn = await lcd.ensure(true);
    check('reconexão depois de fechar', !!conn, `${Date.now() - t} ms`);
    check('envio depois de reconectar', await lcd.frame(await testImage(win, 'HYDRAFLOW', 'teste 3: reconectado', 300)));
    await sleep(3000);
    await lcd.close();

    // 5. porta ocupada por outro programa
    const com = found.find(f => f.kind === 'serial')?.path;
    if (com) {
      const holder = await holdPort(com, 6000);
      const busy = new CoolerLcd({});
      await busy.ensure(true);
      check('porta ocupada vira diagnóstico "busy"', !busy.state.connected && busy.state.error?.code === 'busy', busy.state.error?.message);
      holder.proc.kill();
      await sleep(500);
      const again = await busy.ensure(true);
      check('volta a conectar quando a porta é liberada', !!again);
      if (again) { await busy.frame(await testImage(win, 'HYDRAFLOW', 'teste 4: tudo certo', 120)); await sleep(8000); }
      await busy.close();
    }
  } catch (e) { check('execução', false, e.stack); }
  const failed = results.filter(r => !r.ok).length;
  log(failed ? `${failed} falha(s)` : 'Todos os testes passaram');
  app.exit(failed ? 1 : 0);
});

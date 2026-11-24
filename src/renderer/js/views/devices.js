// Página Dispositivos: grade de dispositivos detectados e página de detalhes.
import { app, on, emit, deviceSettings, saveDevice, deviceName, navigate, defaultTuning } from '../state.js';
import { h, paramControl, slider, switchEl, prompt, confirmDialog, modal, toast, colorInput, moreButton, fillConsole, icon as ico } from '../ui.js';
import { t, has, pluginScope } from '../i18n.js';
import { currentItems, pulse, PULSE_MS } from '../sampler.js';
import { componentKey } from '../layoutModel.js';
import { channelsUsingDefaults } from '../autoSetup.js';
import { instantiate, customStrip, replaceDefaults, componentLabel, componentBrand } from '../components.js';

const P = {
  keyboard: '<rect x="2" y="6" width="20" height="12" rx="2.5"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>',
  mouse: '<rect x="6" y="3" width="12" height="18" rx="6"/><path d="M12 7v4"/>',
  headset: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
  mousepad: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 15h18"/>',
  motherboard: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="6" height="6"/><path d="M16 7h2M16 10h2M7 16h10"/>',
  gpu: '<rect x="2" y="7" width="20" height="10" rx="2"/><circle cx="9" cy="12" r="3"/><circle cx="16" cy="12" r="2"/>',
  ram: '<rect x="2" y="7" width="20" height="9" rx="1.5"/><path d="M6 16v3M10 16v3M14 16v3M18 16v3M6 10h2M11 10h2M16 10h2"/>',
  fan: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2"/><path d="M12 10c0-4 3-5 4-3M14 12c4 0 5 3 3 4M12 14c0 4-3 5-4 3M10 12c-4 0-5-3-3-4"/>',
  lightingcontroller: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 18v3M12 18v3M16 18v3M8 10h8"/>',
  other: '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>'
};
P.aio = P.fan; P.cooler = P.fan; P.ledstrip = P.lightingcontroller; P.light = P.lightingcontroller;
const typeIcon = type => `<svg viewBox="0 0 24 24">${P[type] || P.other}</svg>`;
// rótulos por tipo de dispositivo (devices.type.<tipo>) e de componente (devices.ctype.<Type>); desconhecido aparece como veio
const typeLabel = type => (has(`devices.type.${type}`) ? t(`devices.type.${type}`) : type);
const componentType = type => (has(`devices.ctype.${type}`) ? t(`devices.ctype.${type}`) : type);
const PERIPHERALS = new Set(['keyboard', 'mouse', 'headset', 'mousepad', 'speakers', 'microphone', 'monitor', 'controller', 'headphones']);
const STATUS_CLASS = { running: 'ok', disabled: 'off', error: 'err', stopped: 'off', starting: 'warn' };
const statusLabel = st => (has(`devices.status.${st}`) ? t(`devices.status.${st}`) : st);
const pulseSeconds = () => PULSE_MS / 1000;

// o selo de status só aparece quando há algo fora do normal (erro, iniciando…); "Ativo" e "Desativado" já se veem pelo interruptor
function statusChip(d, s) {
  if (d.status === 'running' || (d.status === 'disabled' && s.enabled === false)) return null;
  return h('span', { class: `chip ${STATUS_CLASS[d.status] || ''}` }, statusLabel(d.status));
}

export function renderDevices(root, opts = {}) {
  const subs = [];
  const sub = (e, f) => subs.push(on(e, f));
  let detailId = opts.deviceId || null;
  let detailTab = 'lighting';

  let renderSubs = [];
  let disposed = false; // a tela foi trocada: respostas assíncronas que chegarem depois são ignoradas
  function render() {
    if (disposed) return;
    renderSubs.forEach(f => f());
    renderSubs = [];
    root.innerHTML = '';
    if (detailId && app.devices.has(detailId)) renderDetail(app.devices.get(detailId));
    else { detailId = null; renderGrid(); }
  }

  function renderGrid() {
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('div', { class: 'grow' }, h('h1', {}, t('devices.title')), h('div', { class: 'page-sub' }, t('devices.subtitle'))),
      h('button', { class: 'btn sm', title: t('devices.wledHint'), onclick: wledDialog }, ico('plus'), t('devices.wled')),
      h('button', { class: 'btn icon ghost', title: t('devices.rescan'), onclick: () => { window.api.engine.cmd('rescan', {}); if (app.ram?.connected) window.api.engine.cmd('ramRedetect', {}); toast(t('devices.scanning')); } }, ico('refresh'))));
    const body = h('div', { class: 'page-body' });
    page.append(body);

    if (app.conflicts.length) body.append(h('div', { class: 'banner', role: 'alert' }, ico('warn'),
      h('div', { class: 'grow' }, h('b', {}, t('devices.conflict')), app.conflicts.join(', '),
        h('div', { class: 'dim' }, t('devices.conflictText'))),
      h('button', { class: 'btn sm', onclick: async () => { app.conflicts = await window.api.system.conflicts(); render(); } }, t('cooler.checkAgain'))));
    if (app.engineInfo.hidAvailable === false) body.append(h('div', { class: 'banner err', role: 'alert' }, ico('error'), h('span', { class: 'grow' }, t('devices.noHid'))));
    if (app.engineInfo.lastError) body.append(h('div', { class: 'banner err', role: 'alert' }, ico('error'), h('span', { class: 'grow' }, app.engineInfo.lastError)));
    const failed = app.engineInfo.errors || [];
    if (failed.length) body.append(h('div', { class: 'banner err', role: 'alert' }, ico('error'),
      h('div', { class: 'grow' }, h('b', {}, t('devices.pluginsFailed', { n: failed.length })),
        failed.slice(0, 5).map(f => h('div', { class: 'dim', style: { wordBreak: 'break-all' } }, `${f.file.split(/[\\/]/).pop()}: ${f.error}`)))));
    if (app.engineInfo.loading) body.append(h('div', { class: 'banner info', role: 'status' }, ico('refresh', 'spin'), h('span', { class: 'grow' }, t('devices.loadingPlugins'))));
    body.append(gpuPanel());

    const devs = [...app.devices.values()];
    const ram = ramCard(); // memórias ainda não ativadas: um cartão junto dos componentes internos
    const groups = [
      [t('devices.groupInternal'), devs.filter(d => !d.virtual && !PERIPHERALS.has(d.descriptor?.deviceType)), ram],
      [t('devices.groupPeripherals'), devs.filter(d => !d.virtual && PERIPHERALS.has(d.descriptor?.deviceType))],
      [t('devices.groupVirtual'), devs.filter(d => d.virtual)]
    ];
    if (!devs.length && !ram) body.append(h('div', { class: 'empty' }, t('devices.none'), h('div', { class: 'dim', style: { marginTop: '8px' } }, t('devices.noneHint'))));
    for (const [title, list, extra] of groups) {
      if (!list.length && !extra) continue;
      body.append(h('div', { class: 'section-title' }, `${title} (${list.length})`));
      const grid = h('div', { class: 'dev-grid' });
      for (const d of list) grid.append(deviceCard(d));
      if (extra) grid.append(extra);
      body.append(grid);
    }
    root.append(page);
  }

  let ramInfo = null;
  let ramError = null;      // { msg, restart }: o que deu errado na última ativação
  let ramConnecting = null; // timer enquanto espera o motor conectar ao auxiliar recém-iniciado
  // auxiliar respondendo mas motor ainda não conectado: mostra "Conectando" (nunca o botão Ativar) e, se em 20 s as
  // memórias não aparecerem, oferece reiniciar
  function waitEngine() {
    if (ramConnecting || app.ram?.connected) return;
    ramConnecting = setTimeout(() => {
      ramConnecting = null;
      if (!app.ram?.connected) ramError = { msg: t('devices.ramNoAnswer'), restart: true };
      if (!disposed && !detailId) render();
    }, 20000);
  }
  const gotRamInfo = s => { ramInfo = { ...ramInfo, ...s }; if (ramInfo.helper) waitEngine(); if (!detailId) render(); };
  window.api.ram.status().then(gotRamInfo);
  subs.push(window.api.ram.onStatus(gotRamInfo));
  subs.push(() => clearTimeout(ramConnecting));
  const restartButton = () => h('button', { class: 'btn primary', onclick: () => window.api.relaunch() }, ico('refresh'), t('devices.restart'));

  /**
   * RGB das memórias como um cartão da grade (mesmo formato dos outros dispositivos), só enquanto não está
   * funcionando — o instalador já deixa tudo ativado; depois disso os pentes aparecem como dispositivos normais.
   */
  function ramCard() {
    const st = app.ram || {};
    if (st.connected) { clearTimeout(ramConnecting); ramConnecting = null; ramError = null; }
    if (st.connected && st.count) return null; // funcionando: os pentes já estão na grade
    const card = (title, chip, text, action) => h('div', { class: 'card dev-card ram-card' },
      h('div', { class: 'dev-icon', html: `<svg viewBox="0 0 24 24">${P.ram}</svg>` }),
      h('div', { class: 'row' }, h('div', { class: 'dev-name grow' }, title), chip),
      h('div', { class: 'dim' }, text),
      action ? h('div', { class: 'row' }, action) : null);
    const chip = (cls, label) => h('span', { class: `chip ${cls}` }, label);
    const scanAgain = () => h('button', { class: 'btn sm', onclick: () => { window.api.engine.cmd('ramRedetect', {}); toast(t('devices.ramScanning')); } }, t('devices.ramScanAgain'));
    // o auxiliar respondeu, mas não achou memórias — ou não abriu o barramento (aí reiniciar costuma resolver)
    if (st.connected) return card(st.error ? t('devices.ramNoAccess') : t('devices.ramNone'), chip('warn', t('devices.ramTitleShort')),
      st.error ? t('devices.ramNoAccessText', { error: st.error }) : t('devices.ramSupport'),
      st.error ? restartButton() : scanAgain());
    if (!ramInfo) return null;
    // "busy" chega do principal como chave de tradução (ram.*); o resto é texto já pronto
    const busyText = b => (b && has(b) ? t(b) : b);
    const ramBusy = busyText(ramInfo.busy) || (ramConnecting ? t('devices.ramConnecting') : null);
    const missing = [!ramInfo.driver && t('devices.ramDriver'), !ramInfo.modules && t('devices.ramModule'), !ramInfo.task && t('devices.ramPermission')].filter(Boolean);
    const text = ramError ? ramError.msg : ramBusy || (missing.length ? t('devices.ramMissing', { list: missing.join(' · ') }) : t('devices.ramText'));
    const action = ramError?.restart ? restartButton()
      : h('button', { class: 'btn sm primary', disabled: !!ramBusy, onclick: enableRam }, ramBusy ? (ramConnecting || ramInfo.helper ? t('devices.connecting') : t('devices.enabling')) : t('devices.enable'));
    return card(t('devices.ramTitleShort'), ramBusy ? chip('warn', ico('refresh', 'spin')) : chip(ramError ? 'err' : 'off', ramError ? t('devices.ramFailed') : t('devices.ramOff')), text, action);
  }

  async function enableRam() {
    ramError = null; ramInfo = { ...ramInfo, busy: 'ram.preparing' }; render();
    const r = await window.api.ram.enable();
    ramInfo = { ...ramInfo, ...await window.api.ram.status() };
    if (!r.ok) { ramError = { msg: r.error, restart: r.restart }; render(); return; }
    waitEngine(); // auxiliar de pé: o motor conecta em instantes e o painel some sozinho (evento 'ram')
    render();
  }

  // controladoras de fita WLED: o motor manda as cores por UDP (protocolo realtime do WLED) só quando mudam
  async function wledDialog() {
    let list = [...(app.store.wled || [])];
    const box = h('div', { class: 'col', style: { width: '560px' } });
    const save = async () => { list = await window.api.wled.set(list); app.store.wled = list; };
    const draw = () => {
      const input = h('input', { class: 'input grow', placeholder: t('devices.wledPlaceholder'), 'aria-label': t('devices.wledAddress') });
      const add = async () => {
        const r = await window.api.wled.probe(input.value);
        if (!r.ok) return toast(r.error, 'err');
        if (list.some(w => w.host === r.host)) return toast(t('devices.wledExists'));
        list.push({ host: r.host, name: r.name, ledCount: r.ledCount });
        await save(); toast(t('devices.wledAdded', { name: r.name, n: r.ledCount })); draw();
      };
      input.onkeydown = e => { if (e.key === 'Enter') add(); };
      box.replaceChildren(
        h('div', { class: 'dim' }, t('devices.wledText')),
        list.length ? null : h('div', { class: 'dim' }, t('devices.wledNone')),
        ...list.map(w => h('div', { class: 'pl-row' },
          h('div', { class: 'grow' }, h('div', {}, w.name || w.host), h('div', { class: 'dim' }, `${w.host} · ${t('lighting.leds', { n: w.ledCount })}`)),
          h('button', { class: 'btn sm danger', onclick: async () => { list = list.filter(x => x !== w); await save(); draw(); } }, t('common.remove')))),
        h('div', { class: 'row', style: { gap: '8px' } }, input, h('button', { class: 'btn primary', onclick: add }, t('common.add'))));
    };
    draw();
    await modal(t('devices.wledTitle'), box, [{ label: t('common.close'), primary: true }]);
  }

  // placas de vídeo: o que a API oficial da NVIDIA informa (com LEDs vira dispositivo na lista; sem LEDs, só esta nota)
  function gpuPanel() {
    const gpus = app.gpus || [];
    const lines = gpus.length ? gpus.map(g => g.vendor === 'amd'
      ? (g.zones ? t('gpu.amdZones', { name: g.name, n: g.zones }) : g.known ? t('gpu.amdSilent', { name: g.name }) : t('gpu.amdNoRgb', { name: g.name }))
      : g.zones ? t('gpu.nvidiaZones', { name: g.name, n: g.zones }) : t('gpu.nvidiaNoZones', { name: g.name })) : [t('gpu.none')];
    return h('details', { class: 'panel', style: { marginBottom: '14px' } },
      h('summary', { style: { cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '10px' } },
        h('span', { class: 'ic', html: `<svg viewBox="0 0 24 24" width="18" height="18">${P.gpu}</svg>` }), t('gpu.title'),
        h('span', { class: 'dim', style: { fontWeight: 400 } }, gpus.map(g => g.name).join(' · '))),
      h('div', { class: 'col', style: { gap: '6px', marginTop: '10px' } }, lines.map(l => h('div', { class: 'dim' }, l)), h('div', { class: 'dim' }, t('gpu.others'))));
  }

  function ledCount(d) {
    const s = deviceSettings(d.id);
    const desc = d.descriptor;
    if (!desc) return 0;
    let n = desc.ledPositions.length + desc.subdevices.reduce((a, x) => a + x.ledPositions.length, 0);
    for (const ch of desc.channels) n += (s.channels[ch.name] || []).reduce((a, c) => a + c.LedCount, 0);
    return n;
  }

  function deviceCard(d) {
    const s = deviceSettings(d.id);
    const type = d.descriptor?.deviceType || 'other';
    const icon = h('div', { class: 'dev-icon', html: typeIcon(type) });
    const open = () => { detailId = d.id; detailTab = 'lighting'; render(); };
    return h('div', { class: `card dev-card ${s.enabled === false ? 'disabled' : ''}`, tabindex: '0', role: 'button', 'aria-label': t('devices.adjust', { name: deviceName(d) }), onclick: open,
      onkeydown: e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } } },
      icon,
      h('div', { class: 'row' }, h('div', { class: 'dev-name grow' }, deviceName(d)), statusChip(d, s)),
      h('div', { class: 'row dim' }, h('span', { class: 'grow' }, [typeLabel(type), t('lighting.leds', { n: ledCount(d) })].join(' · ')),
        h('span', { onclick: e => e.stopPropagation() }, switchEl(s.enabled !== false, v => { setEnabled(d, v); render(); }))));
  }

  function setEnabled(d, v) {
    const s = deviceSettings(d.id);
    s.enabled = v;
    saveDevice(d.id);
    window.api.engine.cmd('setEnabled', { id: d.id, enabled: v });
    toast(v ? t('devices.enabled') : t('devices.disabled'));
  }

  function renderDetail(d) {
    const s = deviceSettings(d.id);
    const desc = d.descriptor;
    const page = h('div', { class: 'page' });
    page.append(h('div', { class: 'page-head' },
      h('button', { class: 'btn icon ghost', title: t('common.back'), onclick: () => { detailId = null; render(); } }, ico('back')),
      h('div', { class: 'grow' },
        h('h1', {}, deviceName(d)),
        s.alias ? h('div', { class: 'dim' }, t('devices.originalName', { name: desc?.name || '' })) : null),
      statusChip(d, s),
      h('div', { class: 'row', title: s.enabled === false ? t('devices.enableDevice') : t('devices.disableDevice') }, h('span', { class: 'dim' }, s.enabled === false ? statusLabel('disabled') : statusLabel('running')),
        switchEl(s.enabled !== false, v => { setEnabled(d, v); render(); })),
      moreButton(() => [
        { label: t('devices.blink'), action: () => { pulse(d.id); toast(t('devices.blinking', { s: pulseSeconds() })); } },
        { label: t('devices.openLayout'), action: () => navigate('lighting', { tab: 'layouts', focusDevice: d.id }) },
        { label: t('effects.renameMenu'), action: async () => {
          const n = await prompt(t('devices.renameTitle'), { label: t('devices.renameLabel'), value: s.alias || '', placeholder: t('devices.renamePlaceholder') });
          if (n !== null) { s.alias = n || undefined; saveDevice(d.id); emit('devices'); render(); }
        } }], { cls: 'btn icon ghost' })));

    // Console e Informações são diagnóstico: ficam juntos numa aba só
    const tabs = ['lighting'];
    if (desc?.channels.length) tabs.push('components');
    tabs.push('paint', 'info');
    if (!tabs.includes(detailTab)) detailTab = 'lighting';
    page.append(h('div', { style: { padding: '0 24px' } }, h('div', { class: 'tabs' },
      tabs.map(k => h('button', { class: `tab ${detailTab === k ? 'active' : ''}`, onclick: () => { detailTab = k; render(); } }, t(`devices.tab.${k}`))))));

    const body = h('div', { class: 'page-body', style: { paddingTop: '16px' } });
    page.append(body);
    const defs = channelsUsingDefaults(d);
    if (defs.length && detailTab !== 'components') body.append(h('div', { class: 'banner info' }, ico('info'),
      h('div', { class: 'grow' }, h('b', {}, t('devices.defaultsInUse')), defs.map(c => c.name).join(', '),
        h('div', { class: 'dim' }, t('devices.defaultsText'))),
      h('button', { class: 'btn sm', onclick: () => { detailTab = 'components'; render(); } }, t('devices.adjustComponents'))));
    if (d.status === 'error') body.append(h('div', { class: 'banner err', role: 'alert' }, ico('error'), h('span', { class: 'grow' }, d.error || t('devices.pluginError')), h('button', { class: 'btn sm', onclick: () => window.api.engine.cmd('reload', { id: d.id }) }, t('devices.reloadPlugin'))));
    if (!desc) body.append(h('div', { class: 'empty' }, t('devices.noGeometry')));
    else ({ lighting: tabLighting, components: tabComponents, paint: tabPaint, info: tabInfo })[detailTab](body, d, s, desc);
    root.append(page);
  }

  function tabLighting(body, d, s, desc) {
    const left = h('div', { class: 'panel' }, h('h3', {}, t('devices.brightnessParams')),
      h('div', { class: 'param' }, h('label', {}, t('lighting.deviceBrightness')), slider({ value: s.brightness, suffix: '%', onInput: v => { s.brightness = v; }, onChange: () => saveDevice(d.id) })));
    const params = (desc.parameters || []).filter(p => !p.hidden); // hidden: guardado pelo plugin, não é ajuste
    const groups = new Map();
    for (const p of params) { const g = p.group || 'geral'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
    for (const [g, list] of groups) {
      const groupLabel = g === 'lighting' ? t('nav.lighting') : g === 'geral' ? t('devices.general') : g === 'avançado' ? t('settings.advanced') : g; // i18n-dado
      if (groups.size > 1) left.append(h('div', { class: 'dim', style: { margin: '10px 0 2px', textTransform: 'uppercase' } }, groupLabel));
      for (const p of list) {
        const val = s.params[p.property] ?? p.default;
        left.append(paramControl(p, val, v => {
          s.params[p.property] = v;
          saveDevice(d.id);
          window.api.engine.cmd('setParam', { id: d.id, name: p.property, value: v });
        }, pluginScope(d)));
      }
    }

    const tune = s.tuning;
    const saveTune = () => saveDevice(d.id);
    const right = h('div', { class: 'panel' },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, t('devices.colorTune')),
        moreButton([
          { label: t('devices.copyTune'), action: () => { navigator.clipboard.writeText(JSON.stringify(tune)); toast(t('devices.tuneCopied')); } },
          { label: t('devices.pasteTune'), action: async () => {
            try { const v = JSON.parse(await navigator.clipboard.readText()); if (!['r', 'g', 'b', 'min'].every(k => Number.isFinite(v[k]))) throw 0; Object.assign(tune, v); saveTune(); render(); toast(t('devices.tunePasted')); }
            catch { toast(t('devices.tuneInvalid'), 'err'); }
          } },
          { label: t('devices.restoreDefault'), action: async () => { if (await confirmDialog(t('devices.restoreTune'), t('devices.restoreTuneText'))) { s.tuning = defaultTuning(); saveTune(); render(); } } }])),
      h('div', { class: 'dim', style: { marginBottom: '8px' } }, t('devices.tuneHint')),
      ...['r', 'g', 'b'].map(c => h('div', { class: 'param' }, h('label', {}, t(`devices.${c}`)),
        slider({ value: tune[c], suffix: '%', onInput: v => { tune[c] = v; }, onChange: saveTune }))),
      h('div', { class: 'param', title: t('devices.minHint') }, h('label', {}, t('devices.min')), slider({ value: tune.min, suffix: '%', onInput: v => { tune.min = v; }, onChange: saveTune })));
    body.append(h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: '14px' } }, left, right));
  }

  function tabComponents(body, d, s, desc) {
    body.append(h('div', { class: 'dim', style: { marginBottom: '12px' } }, t('devices.componentsHint')));
    for (const ch of desc.channels) {
      const chain = s.channels[ch.name] || (s.channels[ch.name] = []);
      const total = chain.reduce((a, c) => a + c.LedCount, 0);
      const limit = ch.ledLimit || 0;
      const save = () => { saveDevice(d.id); emit('devices'); render(); };
      const panel = h('div', { class: 'panel', style: { marginBottom: '14px' } },
        h('div', { class: 'row', style: { marginBottom: '8px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, ch.name),
          h('span', { class: 'dim' }, `${total}${limit ? ' / ' + limit : ''} LEDs`),
          h('button', { class: 'btn sm primary', onclick: () => pickComponent(ch, chain, save) }, ico('plus'), t('devices.component')),
          moreButton([
            { label: t('devices.blinkChannel'), action: () => {
              // canal vazio não tem item no layout para amostrar: quem pisca é o plugin
              if (chain.length) for (const c of chain) pulse(componentKey(d.id, ch.name, c.instanceId));
              else window.api.engine.cmd('pulse', { id: d.id, channel: ch.name, ms: PULSE_MS });
              toast(t('devices.blinkingChannel', { s: pulseSeconds() }));
            } },
            { label: t('devices.addCustomStrip'), action: async () => {
              const n = await prompt(t('devices.customStrip'), { label: t('devices.ledAmount'), placeholder: t('devices.ledAmountPlaceholder'), validate: v => !(Number(v) > 0) ? t('devices.needPositive') : null });
              if (n) { replaceDefaults(chain); chain.push(customStrip(Number(n))); save(); }
            } }])),
        limit ? h('div', { class: `bar ${total > limit ? 'over' : ''}`, style: { marginBottom: '10px' } }, h('div', { style: { width: Math.min(100, total / limit * 100) + '%' } })) : null);
      if (total > limit && limit) panel.append(h('div', { class: 'dim', style: { color: 'var(--danger)', marginBottom: '6px' } }, t('devices.overLimit')));
      const list = h('div', { class: 'chain' });
      if (!chain.length) list.append(h('div', { class: 'dim' }, t('devices.noComponents')));
      chain.forEach((c, i) => {
        list.append(h('div', { class: 'chain-item' },
          h('span', { class: 'dim', style: { width: '20px' } }, i + 1),
          h('div', { class: 'grow' }, h('div', {}, componentLabel(c)), h('div', { class: 'dim' }, [componentBrand(c), t('lighting.leds', { n: c.LedCount }), c.isDefault ? t('devices.placeholder') : null].filter(Boolean).join(' · '))),
          moreButton([
            { label: t('devices.blinkOne'), action: () => pulse(componentKey(d.id, ch.name, c.instanceId)) },
            { label: t('effects.moveUp'), disabled: i === 0, action: () => { [chain[i - 1], chain[i]] = [chain[i], chain[i - 1]]; save(); } },
            { label: t('effects.moveDown'), disabled: i === chain.length - 1, action: () => { [chain[i + 1], chain[i]] = [chain[i], chain[i + 1]]; save(); } },
            { label: t('effects.renameMenu'), action: async () => { const n = await prompt(t('devices.renameComponent'), { value: componentLabel(c) }); if (n) { c.alias = n; save(); } } },
            { label: t('devices.duplicateMenu'), action: async () => {
              const n = await prompt(t('devices.duplicate'), { label: t('devices.howMany'), value: '1', validate: v => !(Number(v) >= 1 && Number(v) <= 32) ? t('devices.between1and32') : null });
              if (n) { for (let k = 0; k < Number(n); k++) chain.splice(i + 1, 0, instantiate(c)); save(); }
            } },
            '-',
            { label: t('common.remove'), action: () => { chain.splice(i, 1); save(); } }])));
      });
      panel.append(list);
      body.append(panel);
    }
  }

  function pickComponent(ch, chain, save) {
    let q = '', sort = 'name', type = '', dialog = null;
    const types = [...new Set(app.components.map(c => c.Type))].sort();
    const list = h('div', { class: 'col', style: { height: '420px', overflow: 'auto', width: '620px' } });
    const draw = () => {
      list.innerHTML = '';
      const ql = q.toLowerCase();
      const items = app.components.filter(c => (!type || c.Type === type) && (!ql || `${componentLabel(c)} ${componentBrand(c)}`.toLowerCase().includes(ql)))
        .sort((a, b) => sort === 'leds' ? a.LedCount - b.LedCount : sort === 'brand' ? componentBrand(a).localeCompare(componentBrand(b)) || componentLabel(a).localeCompare(componentLabel(b)) : componentLabel(a).localeCompare(componentLabel(b)));
      for (const c of items.slice(0, 400)) list.append(h('button', { class: 'chain-item pickable', onclick: () => { replaceDefaults(chain); chain.push(instantiate(c)); dialog?.close(true); save(); toast(t('devices.componentAdded', { name: componentLabel(c) })); } },
        h('div', { class: 'grow' }, h('div', {}, componentLabel(c)), h('div', { class: 'dim' }, `${componentBrand(c)} · ${componentType(c.Type)}`)), h('span', { class: 'chip' }, t('lighting.leds', { n: c.LedCount }))));
      if (!items.length) list.append(h('div', { class: 'empty' }, t('devices.noComponentFound')));
    };
    const body = h('div', { class: 'col' },
      h('div', { class: 'row' },
        h('input', { class: 'input grow', type: 'search', placeholder: t('effects.search'), 'aria-label': t('devices.searchComponent'), oninput: e => { q = e.target.value; draw(); } }),
        h('select', { class: 'input', 'aria-label': t('devices.type'), onchange: e => { type = e.target.value; draw(); } }, h('option', { value: '' }, t('devices.allTypes')), types.map(ty => h('option', { value: ty }, componentType(ty)))),
        h('select', { class: 'input', 'aria-label': t('devices.sort'), onchange: e => { sort = e.target.value; draw(); } }, [['name', t('effects.name')], ['brand', t('devices.brand')], ['leds', t('devices.ledQty')]].map(([v, l]) => h('option', { value: v }, l)))),
      list);
    draw();
    dialog = modal(t('devices.addComponentTitle', { channel: ch.name }), body, [{ label: t('common.cancel'), value: () => null }]);
    return dialog;
  }

  let brush = '#ff0000', erasing = false;
  function tabPaint(body, d, s) {
    const items = currentItems().filter(i => i.deviceId === d.id);
    body.append(h('div', { class: 'panel row wrap', style: { marginBottom: '14px' } },
      h('b', {}, t('devices.brush')), colorInput(brush, v => { brush = v; erasing = false; refreshTools(); }),
      h('button', { class: `btn sm ${!erasing ? 'on' : ''}`, id: 'toolPaint', onclick: () => { erasing = false; refreshTools(); } }, ico('brush'), t('devices.paint')),
      h('button', { class: `btn sm ${erasing ? 'on' : ''}`, id: 'toolErase', onclick: () => { erasing = true; refreshTools(); } }, ico('eraser'), t('devices.erase')),
      h('span', { class: 'grow dim' }, t('devices.paintHint')),
      h('button', { class: 'btn sm danger', onclick: async () => { if (await confirmDialog(t('devices.clearPaint'), t('devices.clearPaintText'), t('lighting.clear'), true)) { s.painting = {}; saveDevice(d.id); render(); } } }, t('devices.clearAll'))));
    function refreshTools() { body.querySelector('#toolPaint')?.classList.toggle('on', !erasing); body.querySelector('#toolErase')?.classList.toggle('on', erasing); }
    if (!items.length) body.append(h('div', { class: 'empty' }, t('devices.nothingToPaint')));
    const cells = [];
    let down = false;
    const apply = (item, i, cell) => {
      const map = s.painting[item.key] || (s.painting[item.key] = {});
      if (erasing) delete map[i]; else map[i] = brush;
      cell.classList.toggle('painted', !!map[i]);
    };
    const up = () => { if (down) { down = false; saveDevice(d.id); } };
    document.addEventListener('pointerup', up);
    renderSubs.push(() => document.removeEventListener('pointerup', up));
    for (const item of items) {
      const cellSize = item.w > 40 ? 12 : 22;
      const grid = h('div', { class: 'led-grid', style: { gridTemplateColumns: `repeat(${item.w}, ${cellSize}px)`, gridAutoRows: `${cellSize}px` } });
      const at = new Map(item.leds.map((p, i) => [p[0] + ',' + p[1], i]));
      for (let y = 0; y < item.h; y++) for (let x = 0; x < item.w; x++) {
        const i = at.get(x + ',' + y);
        if (i === undefined) { grid.append(h('div', { class: 'led-cell none', style: { width: cellSize + 'px', height: cellSize + 'px' } })); continue; }
        const cell = h('div', { class: `led-cell ${s.painting[item.key]?.[i] ? 'painted' : ''}`, title: item.ledNames?.[i] || `LED ${i + 1}`, style: { width: cellSize + 'px', height: cellSize + 'px' },
          onpointerdown: e => { e.preventDefault(); down = true; apply(item, i, cell); },
          onpointerenter: () => { if (down) apply(item, i, cell); } });
        cells.push({ cell, key: item.key, i });
        grid.append(cell);
      }
      body.append(h('div', { class: 'panel', style: { marginBottom: '14px', overflow: 'auto' } }, h('h3', {}, `${item.name} · ${t('lighting.leds', { n: item.leds.length })}`), grid));
    }
    const timer = setInterval(() => {
      for (const c of cells) { const live = app.liveColors.get(c.key); if (live) c.cell.style.background = `rgb(${live[c.i * 3]},${live[c.i * 3 + 1]},${live[c.i * 3 + 2]})`; }
    }, 100);
    renderSubs.push(() => clearInterval(timer));
  }

  function tabConsole(body, d) {
    let level = 'all';
    const con = h('div', { class: 'console', style: { height: '320px' } });
    const draw = () => fillConsole(con, (app.logs.get(d.id) || []).filter(l => level === 'all' || l.level === level).slice(-500));
    body.append(h('div', { class: 'panel' },
      h('div', { class: 'row', style: { marginBottom: '10px' } },
        h('h3', { class: 'grow', style: { margin: 0 } }, t('devices.pluginConsole')),
        h('select', { class: 'input', 'aria-label': t('devices.level'), onchange: e => { level = e.target.value; draw(); } }, [['all', t('devices.allLevels')], ['info', 'Info'], ['warning', t('devices.warnings')], ['error', t('devices.errors')]].map(([v, l]) => h('option', { value: v }, l))),
        moreButton([
          { label: t('devices.copyConsole'), action: () => { navigator.clipboard.writeText((app.logs.get(d.id) || []).map(l => `[${new Date(l.t).toISOString()}] ${l.level}: ${l.msg}`).join('\n')); toast(t('devices.consoleCopied')); } },
          { label: t('devices.clearConsole'), action: () => { app.logs.set(d.id, []); window.api.engine.cmd('clearLogs', { id: d.id }); draw(); } },
          { label: t('devices.reloadPlugin'), action: () => { window.api.engine.cmd('reload', { id: d.id }); toast(t('devices.pluginReloaded')); } }])),
      con));
    window.api.engine.cmd('getLogs', { id: d.id });
    draw();
    renderSubs.push(on('log', id => { if (id === d.id) draw(); }));
  }

  function tabInfo(body, d, s, desc) {
    const ep = d.endpoint || {};
    const hex = n => '0x' + Number(n || 0).toString(16).padStart(4, '0').toUpperCase();
    const hid = d.provider === 'plugin' && !d.virtual;
    const rows = [
      ['ID', d.id], [t('devices.info.plugin'), d.plugin.name], [t('devices.info.pluginFile'), d.plugin.file || '—'], [t('devices.info.author'), desc.publisher || '—'],
      [t('devices.type'), typeLabel(desc.deviceType)], [t('devices.info.status'), statusLabel(d.status) + (d.error ? ` (${d.error})` : '')],
      ...(hid ? [['Vendor / Product', `${hex(ep.vendor_id)} / ${hex(ep.product_id)}`], ['Interface / Usage page / Usage', `${ep.interface} / ${hex(ep.usage_page)} / ${hex(ep.usage)}`]]
        : ep.location ? [[t('devices.info.location'), ep.location]] : []),
      [t('devices.info.product'), ep.product || '—'], [t('devices.info.manufacturer'), ep.manufacturer || '—'],
      [t('devices.info.grid'), `${desc.size[0]} × ${desc.size[1]}`], [t('devices.info.leds'), desc.ledPositions.length],
      [t('devices.info.subdevices'), desc.subdevices.map(x => x.displayName).join(', ') || '—'],
      [t('devices.info.channels'), desc.channels.map(c => `${c.name} (${c.ledLimit})`).join(', ') || '—'],
      [t('devices.info.parameters'), (desc.parameters || []).length], [t('devices.info.rate'), `${desc.frameRate} fps`]
    ];
    body.append(h('div', { class: 'panel', style: { marginBottom: '14px' } },
      h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, t('devices.info.title')),
        moreButton([
          { label: t('devices.copyId'), action: () => { navigator.clipboard.writeText(d.id); toast(t('devices.idCopied')); } },
          hid ? { label: t('devices.showPlugin'), action: () => window.api.shell.showItem(d.plugin.file) } : null])),
      rows.map(([k, v]) => h('div', { class: 'row', style: { padding: '5px 0', borderBottom: '1px solid var(--line)' } },
        h('span', { class: 'dim', style: { width: '240px' } }, k), h('span', { class: 'grow', style: { wordBreak: 'break-all' } }, String(v))))));
    tabConsole(body, d);
  }

  sub('devices', id => {
    // evita reconstruir a página de pintura/console a cada atualização de quadro
    if (detailId && id && id !== detailId) return;
    if (detailId && (detailTab === 'paint' || detailTab === 'info') && id === detailId) return;
    render();
  });
  sub('engineinfo', () => { if (!detailId) render(); });
  sub('ram', async () => { ramInfo = await window.api.ram.status(); if (!detailId) render(); });
  sub('conflicts', () => { if (!detailId) render(); });
  sub('gpus', () => { if (!detailId) render(); });
  render();
  return () => { disposed = true; subs.forEach(u => u()); renderSubs.forEach(u => u()); };
}

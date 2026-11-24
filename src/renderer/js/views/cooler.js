// Aba Watercooler: imagem (parada ou animada) na tela do cooler. Quem manda os quadros é coolerStream.js
// (funciona com a aba fechada); o driver fica no processo principal (src/main/coolerLcd.js).
import { app, on } from '../state.js';
import { h, slider, switchEl, icon as ico } from '../ui.js';
import { t, has } from '../i18n.js';
import { pickFromLibrary } from '../library.js';
import { setCooler } from '../coolerStream.js';

const fileUrl = f => 'file:///' + f.replace(/\\/g, '/').split('/').map((s, i) => i === 0 ? s : encodeURIComponent(s)).join('/');

// estados vindos de cooler:status (src/main/main.js): título em cooler.state.<estado>, texto em cooler.text.<estado>;
// os de falha trazem o detalhe em status.error (já no idioma escolhido)
const stateText = s => (has(`cooler.state.${s}`) ? s : 'missing');

/** Linhas de informação da tela conectada (modelo, porta, firmware). */
function deviceLines(d) {
  if (!d) return [];
  const kind = d.kind === 'hid' ? 'USB HID' : d.kind === 'serial' ? t('cooler.serial') : 'USB';
  return [
    d.name && t(d.untested ? 'cooler.modelUntested' : 'cooler.model', { name: d.name }),
    d.port && t('cooler.connection', { kind, port: d.port }),
    d.firmware && t('cooler.firmware', { firmware: d.firmware, hardware: d.hardware || '?', app: d.app || '?' }),
    d.width && t('cooler.resolution', { w: d.width, h: d.height })
  ].filter(Boolean);
}

export function renderCooler(root) {
  let disposed = false, status = { state: 'checking' };
  const c = () => app.store.cooler;
  const body = h('div', { class: 'page-body' });
  root.append(h('div', { class: 'page' },
    h('div', { class: 'page-head compact' }, h('h1', {}, t('cooler.title'))),
    h('div', { class: 'page-sub', style: { padding: '0 28px 4px' } }, t('cooler.subtitle')),
    body));

  async function check() {
    status = { state: 'checking' }; render();
    status = await window.api.cooler.status().catch(e => ({ state: 'open', error: e.message }));
    render();
  }
  async function save(p) {
    await setCooler(p); // a tela redesenha pelo evento 'cooler'
    if ('enabled' in p) check(); // ligar/desligar muda o estado da conexão
  }

  function render() {
    if (disposed) return;
    const cfg = c();
    const s = stateText(status.state);
    const preview = h('div', { class: 'cooler-screen', style: { filter: `brightness(${cfg.brightness / 100})` } },
      cfg.image ? h('img', { src: fileUrl(cfg.image), alt: t('cooler.chosenImage'), style: { transform: `rotate(${cfg.rotation}deg)`, objectFit: cfg.fit } })
        : h('span', { class: 'dim' }, t('cooler.noImage')));
    body.replaceChildren(h('div', { class: 'cooler-grid' },
      h('div', { class: 'panel cooler-preview' }, h('h3', {}, t('cooler.preview')), preview,
        h('div', { class: 'row', style: { gap: '8px', marginTop: '12px', flexWrap: 'wrap' } },
          // a imagem vem da biblioteca (a mesma da aba Papel de Parede); dá para importar do PC por ali
          h('button', { class: 'btn primary', onclick: async () => {
            const lib = await window.api.library.list();
            const current = lib.usage.cooler;
            const id = await pickFromLibrary({ title: t('cooler.pickImage'), onlyImages: true, current });
            if (id) save({ item: id });
          } }, ico('plus'), cfg.image ? t('cooler.changeImage') : t('cooler.pickImage')),
          h('button', { class: 'btn', onclick: () => save({ rotation: (cfg.rotation + 90) % 360 }) }, t('cooler.rotate')),
          h('button', { class: 'btn', onclick: () => save({ fit: cfg.fit === 'contain' ? 'cover' : 'contain' }) }, cfg.fit === 'contain' ? t('cooler.fitCover') : t('cooler.fitContain'))),
        h('div', { class: 'param', style: { marginTop: '10px' } }, h('label', {}, t('cooler.show')),
          switchEl(cfg.enabled !== false, v => save({ enabled: v }), t('cooler.showLabel'))),
        h('div', { class: 'param' }, h('label', {}, t('cooler.brightness')),
          slider({ min: 10, max: 100, value: cfg.brightness, suffix: '%', onChange: v => save({ brightness: v }) }))),
      h('div', { class: 'panel' }, h('h3', {}, t('cooler.connectionTitle')),
        h('div', { class: `banner ${status.state === 'connected' ? 'info' : status.state === 'checking' || status.state === 'disabled' ? '' : 'err'}` },
          ico(status.state === 'connected' ? 'check' : 'error'), h('span', { class: 'grow' }, h('b', {}, t(`cooler.state.${s}`)))),
        h('p', { class: 'dim' }, has(`cooler.text.${s}`) ? t(`cooler.text.${s}`) : ''),
        status.error ? h('p', { class: 'dim' }, t('cooler.detail', { error: status.error })) : null,
        ...deviceLines(status.device).map(l => h('p', { class: 'dim', style: { wordBreak: 'break-all', margin: '2px 0' } }, l)),
        h('button', { class: 'btn', onclick: check, disabled: status.state === 'checking' }, t('cooler.checkAgain')))));
  }

  // o principal avisa quando conecta ou cai (reconexão automática): a tela acompanha sem precisar clicar
  const off = window.api.cooler.onState(s => {
    if (s.connected && status.state !== 'connected') { status = { state: 'connected', device: s.device }; render(); }
    else if (!s.connected && status.state === 'connected') { status = s.error && s.error.code !== 'missing' ? { state: s.error.code, device: s.device, error: s.error.message } : { state: 'missing' }; render(); }
  });
  // ajustes mudados (aqui, na biblioteca, ou a imagem em uso foi excluída): a prévia acompanha
  const offCooler = on('cooler', render);
  check();
  return () => { disposed = true; off(); offCooler(); };
}

// Aba Ambiente da Tela: liga/desliga o modo em que os LEDs seguem o monitor, mostra o que eles estão vendo
// e reúne os ajustes da imagem e da reação ao som (clima da música do PC).
import { app, on, set, get, effectById } from '../state.js';
import { h, paramControl, switchEl, toast } from '../ui.js';
import { runner } from '../effectRunner.js';
import { CANVAS_W, CANVAS_H } from '../canvas.js';
import { t } from '../i18n.js';
import * as pb from '../playback.js';
import { createMixer } from '../mixer.js';
import { AXIS_GRADIENTS } from '../soundReact.js';
import { isSoundMode, SCREEN_PARAMS } from '../screenSource.js';

export function renderScreen(root) {
  const subs = [];
  const fx = app.effects.find(e => e.screen);
  if (!fx) { root.append(h('div', { class: 'page' }, h('div', { class: 'empty' }, t('screen.missing')))); return null; }

  const isOn = () => get('activeEffect') === fx.id;
  async function toggle(want) {
    if (want) {
      if (!isOn()) set('screenPrevEffect', get('activeEffect'), { silent: true });
      if (await pb.applyEffect(fx.id)) toast(t('screen.turnedOn'));
    } else {
      // o efeito anterior pode ter sido removido: cai para a Cor Sólida; só avisa "desligado" se desligou de fato
      let back = effectById(app.store.screenPrevEffect);
      if (!back || back.screen) back = pb.fallbackEffect();
      let ok = !!back && await pb.applyEffect(back.id);
      if (!ok && back && isOn()) { const fb = pb.fallbackEffect(); ok = !!fb && fb.id !== back.id && await pb.applyEffect(fb.id); }
      if (ok) toast(t('screen.turnedOff'));
    }
    renderSide(); // a chave mostra o estado real (inclusive quando a troca falhou)
  }

  const canvas = h('canvas', { width: CANVAS_W, height: CANVAS_H });
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(CANVAS_W, CANVAS_H);
  const offNote = h('div', { class: 'paused' }, h('span', { class: 'paused-pill' }, t('screen.offNote')));
  // "Som do PC": no lugar da prévia da tela, o mixer com as colunas de volume nas cores da música (mixer.js)
  const mixerLayer = h('div', { class: 'mixer-layer' });
  const explain = h('div', { class: 'dim' }, t('screen.explain'));
  const side = h('div', { class: 'lt-side' });
  const status = h('div', { class: 'dim', 'aria-live': 'polite' });
  const meter = h('div', { class: 'sr-meter' }, h('i'));
  // clima da música: duas réguas fixas (Triste ↔ Alegre e Calmo ↔ Raiva), cada uma pintada com a sua gama de cor;
  // só a bolinha branca anda. Embaixo, o tom da música (maior/menor) e as três cores que estão indo para os LEDs.
  const grad = stops => `linear-gradient(90deg, ${stops.map((c, i) => `rgb(${c.join(',')}) ${Math.round(i * 100 / (stops.length - 1))}%`).join(', ')})`;
  const axis = (left, right, stops) => {
    const dot = h('i');
    const el = h('div', { class: 'sr-axis' }, h('div', { class: 'sr-axis-labels' }, h('span', {}, left), h('span', {}, right)),
      h('div', { class: 'sr-axis-bar', style: { background: grad(stops) } }, dot));
    return { dot, el };
  };
  const vAxis = axis(t('screen.axisSad'), t('screen.axisHappy'), AXIS_GRADIENTS.valence);
  const aAxis = axis(t('screen.axisCalm'), t('screen.axisAngry'), AXIS_GRADIENTS.agitation);
  const swatches = h('div', { class: 'sr-swatches', title: t('screen.toneNow') }, h('i'), h('i'), h('i'));
  const keyLine = h('div', { class: 'sr-key', title: t('screen.keyHint') });
  const moodBox = h('div', { class: 'sr-mood' }, vAxis.el, aAxis.el, keyLine, h('div', { class: 'dim sr-tone-label' }, t('screen.toneNow')), swatches);
  root.append(h('div', { class: 'lt' },
    h('div', { class: 'lt-main' },
      h('div', { class: 'lt-head' }, h('div', { class: 'grow' }, h('h1', {}, t('screen.title')),
        h('div', { class: 'page-sub' }, t('screen.subtitle')))),
      h('div', { class: 'lt-stage' }, h('div', { class: 'stage' }, canvas, mixerLayer, offNote)),
      h('div', { class: 'lt-below' }, h('div', { class: 'panel' }, explain))),
    side));

  function renderSide() {
    const params = pb.paramsFor(fx);
    const control = name => {
      const p = fx.properties.find(x => x.property === name);
      return p ? paramControl(p, params[name], v => { pb.setEffectParam(fx, name, v); if (name === 'react') renderSide(); }, 'screen') : null;
    };
    const sound = isSoundMode(params);
    // (replaceChildren escreveria "null" como texto no lugar dos painéis que não se aplicam)
    side.replaceChildren(...[
      // ligar + escolher a função (Tela ou Som do PC)
      h('div', { class: 'panel' }, h('h3', {}, t('screen.title')),
        h('div', { class: 'param' }, h('label', {}, t('screen.on')), switchEl(isOn(), v => toggle(v), t('screen.toggleLabel'))),
        control('react'),
        // o único aviso que fica: explica por que a tela "some" com Som do PC
        sound ? h('div', { class: 'dim', style: { marginTop: '6px' } }, t('screen.reactSoundOnly')) : null),
      // Imagem: só na função Tela
      !sound ? h('div', { class: 'panel' }, h('h3', {}, t('screen.image')), SCREEN_PARAMS.image.map(control)) : null,
      sound ? h('div', { class: 'panel' }, h('h3', {}, t('screen.react')), SCREEN_PARAMS.sound.map(control),
        h('div', { style: { marginTop: '10px' } }, h('div', { class: 'dim' }, t('screen.soundNow')), meter, status, moodBox)) : null,
      // calibração da emoção: sempre à vista com Som do PC (sem sanfona)
      sound ? h('div', { class: 'panel' }, h('h3', {}, t('screen.calibTitle')),
        h('div', { class: 'dim', style: { fontSize: '12px', margin: '0 0 6px' } }, t('screen.calibHelp')),
        SCREEN_PARAMS.calib.map(control)) : null
    ].filter(Boolean));
    offNote.classList.toggle('hidden', isOn());
    syncMixer(isOn() && sound);
  }

  // mixer ligado: a prévia da tela some e os quadros inteiros (256 KB cada) deixam de ser pedidos
  let stopMixer = null, releaseFrames = runner.wantFrames();
  function syncMixer(on) {
    if (on && !stopMixer) {
      stopMixer = createMixer(mixerLayer, () => {
        const snd = runner.frame?.sound;
        return snd ? { bands: snd.bands, peaks: snd.peaks, palette: snd.info?.palette, silent: snd.info?.silent ?? true } : null;
      });
      releaseFrames?.(); releaseFrames = null;
    } else if (!on && stopMixer) {
      stopMixer(); stopMixer = null;
      releaseFrames = runner.wantFrames();
    }
    mixerLayer.parentElement?.classList.toggle('mixer-on', !!stopMixer);
    explain.textContent = t(stopMixer ? 'screen.explainMixer' : 'screen.explain');
  }
  subs.push(() => { stopMixer?.(); releaseFrames?.(); });

  // o que o detector está ouvindo, para a pessoa saber se está funcionando
  const poll = setInterval(() => {
    if (document.hidden) return; // janela minimizada ou na bandeja: ninguém vê o painel
    const info = isOn() ? runner.frame?.reactInfo : null;
    if (!info || !meter.isConnected) return;
    meter.firstChild.style.width = `${Math.round((info.level || 0) * 100)}%`;
    const live = info.audio && info.palette && !info.silent;
    status.textContent = !info.audio ? t('screen.noAudio') : !live ? t('screen.waitingMusic') : '';
    status.classList.toggle('hidden', !!live);
    moodBox.classList.toggle('off', !live);
    if (info.palette) {
      // réguas fixas: só a bolinha anda
      vAxis.dot.style.left = `${Math.round((info.valence ?? 0.5) * 100)}%`;
      aAxis.dot.style.left = `${Math.round((info.agitation ?? 0.5) * 100)}%`;
      keyLine.textContent = t(info.key === 'major' ? 'screen.keyMajor' : info.key === 'minor' ? 'screen.keyMinor' : 'screen.keyUnknown');
      keyLine.dataset.key = info.key || '';
      info.palette.forEach((c, i) => { swatches.children[i].style.background = `rgb(${c.join(',')})`; });
      swatches.classList.toggle('beat', !!info.beat);
    }
  }, 150);

  subs.push(on('frame', px => { if (isOn()) { img.data.set(px); ctx.putImageData(img, 0, 0); } }));
  subs.push(on('effect', renderSide));
  renderSide();
  return () => { clearInterval(poll); subs.forEach(u => u()); };
}

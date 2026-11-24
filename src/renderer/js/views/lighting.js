// Página Iluminação: prévia ao vivo + ajustes ("Tocando agora" fica no painel lateral, com a troca automática).
// Um seletor deslizante alterna entre o modo Efeito (ajustes do efeito escolhido na aba Efeitos) e o modo Layout.
import { app, on, set, deviceSettings, saveDevice, deviceName, navigate } from '../state.js';
import { h, paramControl, slider, switchEl, prompt, confirmDialog, modal, toast, fmtTime, moreButton, requiredName, fillConsole, icon as ico } from '../ui.js';
import { t, fxName, fxDescription, fxScope } from '../i18n.js';
import { runner } from '../effectRunner.js';
import { CANVAS_W, CANVAS_H } from '../canvas.js';
import * as pb from '../playback.js';
import { currentItems } from '../sampler.js';
import * as L from '../layoutModel.js';
import { createLayoutEditor } from '../layoutEditor.js';
import { addToPlaylistDialog } from '../playlists.js';
import { hardwareSaveDialog } from '../hardwareSave.js';
import { lofiSvg, LOFI_COUNT, LOFI_SCENE_MS } from '../lofi.js';
import { renderEffects } from './effects.js';
import { isSoundMode, screenParamShown } from '../screenSource.js';

/** Nome mostrado de um layout: o "Padrão" criado pelo app aparece traduzido (o nome guardado não muda). */
const layoutLabel = n => (n === 'Padrão' ? t('lighting.defaultLayout') : n); // i18n-dado

export function renderLighting(root, opts = {}) {
  const subs = [];
  const sub = (e, f) => subs.push(on(e, f));
  let tab = opts.tab || app.store.ui.lightingTab;
  let editor = null;
  let selection = [];

  const canvas = h('canvas', { width: CANVAS_W, height: CANVAS_H });
  const ctx = canvas.getContext('2d');
  const overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const pausedEl = h('div', { class: 'paused hidden', onclick: () => pb.setPaused(false) }, h('span', { class: 'paused-pill' }, ico('play', 'fill'), t('lighting.pausedPill')));
  // Ambiente da Tela ligado + modo Efeito: no lugar da prévia, uma cena Lo-Fi (src/renderer/js/lofi.js)
  const lofiLayer = h('div', { class: 'lofi-layer', 'aria-hidden': 'true' });
  const stage = h('div', { class: 'stage' }, canvas, overlay, pausedEl, lofiLayer);
  const player = h('div', { class: 'player in-panel' }); // mora no painel lateral, junto da troca automática
  const below = h('div', { class: 'lt-below' });
  // biblioteca de efeitos (Todos, Favoritos, Playlists, Descobrir) logo abaixo da prévia, só na subaba Efeitos.
  // Contêiner próprio: trocar de efeito redesenha "below", e a busca/rolagem da biblioteca continuam onde estavam.
  const library = h('div', { class: 'lt-library' });
  const side = h('div', { class: 'lt-side' });
  const modeToggle = h('div', { class: 'mode-toggle' });
  const subtitle = h('div', { class: 'page-sub' });
  root.append(h('div', { class: 'lt' },
    h('div', { class: 'lt-main' },
      h('div', { class: 'lt-head' }, h('div', { class: 'grow' }, h('h1', {}, t('lighting.title')), subtitle), modeToggle),
      h('div', { class: 'lt-stage' }, stage),
      below, library),
    side));
  let disposeLibrary = null;
  function syncLibrary() {
    if (tab === 'effects' && !disposeLibrary) disposeLibrary = renderEffects(library, { embedded: true }) || (() => {});
    else if (tab !== 'effects' && disposeLibrary) { disposeLibrary(); disposeLibrary = null; library.replaceChildren(); }
  }
  subs.push(() => disposeLibrary?.());

  const pTitle = h('div', { class: 'player-title' });
  const pSub = h('div', { class: 'player-sub' });
  const pPlay = h('button', { class: 'pbtn play', title: t('lighting.playPause'), onclick: () => pb.setPaused(!app.store.canvasPaused) });
  const pShuffle = h('button', { class: 'pbtn', title: t('lighting.shuffle'), onclick: () => pb.setShuffle(!app.store.timer.shuffle) }, ico('shuffle', 'fill'));
  player.append(
    h('div', { class: 'player-now' }, pTitle, pSub),
    h('div', { class: 'player-ctrls' }, pShuffle,
      h('button', { class: 'pbtn', title: t('lighting.previous'), onclick: () => pb.previous() }, ico('prev', 'fill')),
      pPlay,
      h('button', { class: 'pbtn', title: t('lighting.next'), onclick: () => pb.next() }, ico('next', 'fill')),
      // espaço do tamanho de um botão: equilibra o botão de ordem aleatória do outro lado e centraliza o play
      h('span', { class: 'pbtn pbtn-spacer', 'aria-hidden': 'true' })));
  function renderPlayer() {
    const fx = pb.activeEffect();
    const tm = app.store.timer;
    const pl = tm.playlistId ? (app.store.playlists || []).find(p => p.id === tm.playlistId) : null;
    pTitle.textContent = fx ? fxName(fx) : t('lighting.noEffect');
    pSub.textContent = app.store.canvasPaused ? t('lighting.paused')
      : tm.active ? (pl ? t('lighting.nextInPlaylist', { time: fmtTime(pb.timerRemainingMs()), playlist: pl.name }) : t('lighting.nextIn', { time: fmtTime(pb.timerRemainingMs()) }))
      : fx ? t('lighting.by', { publisher: fx.publisher }) : '';
    const icon = app.store.canvasPaused ? 'play' : 'pauseSolid';
    if (pPlay.dataset.icon !== icon) { pPlay.dataset.icon = icon; pPlay.replaceChildren(ico(icon, 'fill')); } // 'timertick' chama a cada 1 s
    pShuffle.classList.toggle('on', !!tm.shuffle);
  }
  for (const e of ['effect', 'timer', 'timertick', 'paused']) sub(e, renderPlayer);
  renderPlayer();

  const img = ctx.createImageData(CANVAS_W, CANVAS_H);
  sub('frame', px => { img.data.set(px); ctx.putImageData(img, 0, 0); });
  // quadros inteiros só enquanto a prévia está à vista (com a cena Lo-Fi na frente, ninguém os vê)
  let releaseFrames = null;
  const wantPreview = on => {
    if (on && !releaseFrames) releaseFrames = runner.wantFrames();
    else if (!on && releaseFrames) { releaseFrames(); releaseFrames = null; }
  };
  subs.push(() => wantPreview(false));
  img.data.set(runner.latest); ctx.putImageData(img, 0, 0);

  // cena Lo-Fi: troca com transição; a escolhida fica guardada; pausa com a janela escondida
  let lofiIndex = Number.isInteger(app.store.ui.lofiScene) ? app.store.ui.lofiScene : Math.floor(Math.random() * LOFI_COUNT);
  const lofiActive = () => tab === 'effects' && !!pb.activeEffect()?.screen;
  // As cenas formam um "dia" e passam sozinhas (LOFI_SCENE_MS cada): a próxima surge por cima da atual num
  // esmaecimento longo e a anterior sai quando a nova já cobriu tudo. O relógio só anda com a cena visível.
  let lofiTimer = null;
  const sceneEl = i => { const d = document.createElement('div'); d.className = 'lofi-scene'; d.innerHTML = lofiSvg(i); return d; };
  function lofiClock() {
    const run = lofiActive() && !document.hidden;
    if (run && !lofiTimer) lofiTimer = setInterval(nextLofi, LOFI_SCENE_MS);
    else if (!run && lofiTimer) { clearInterval(lofiTimer); lofiTimer = null; }
  }
  function syncLofi() {
    const on = lofiActive();
    if (on && !lofiLayer.firstChild) lofiLayer.append(sceneEl(lofiIndex));
    stage.classList.toggle('lofi-on', on);
    wantPreview(!on);
    lofiClock();
  }
  function nextLofi() {
    lofiIndex = (lofiIndex + 1) % LOFI_COUNT;
    set('ui.lofiScene', lofiIndex, { silent: true });
    const next = sceneEl(lofiIndex);
    lofiLayer.append(next);
    requestAnimationFrame(() => next.classList.add('in'));
    // a anterior sai depois que a nova terminou de aparecer (duração do esmaecimento no CSS: 1,6 s)
    setTimeout(() => { while (lofiLayer.firstChild && lofiLayer.firstChild !== next) lofiLayer.firstChild.remove(); }, 1800);
  }
  const onVisibility = () => { lofiLayer.classList.toggle('lofi-paused', document.hidden); lofiClock(); };
  document.addEventListener('visibilitychange', onVisibility);
  subs.push(() => document.removeEventListener('visibilitychange', onVisibility));
  subs.push(() => { clearInterval(lofiTimer); lofiTimer = null; });
  const updateStageBits = () => pausedEl.classList.toggle('hidden', !app.store.canvasPaused);
  sub('paused', updateStageBits);
  updateStageBits();

  function brightnessPanel() {
    return h('div', { class: 'panel' }, h('h3', {}, t('lighting.brightness')),
      h('div', { class: 'param', title: t('lighting.intensityHint') }, h('label', {}, t('lighting.intensity')),
        slider({ value: L.globalBrightness(), suffix: '%', onInput: v => L.setGlobalBrightness(v), onChange: v => L.setGlobalBrightness(v, { persist: true }) })));
  }

  function renderToggle() {
    modeToggle.innerHTML = '';
    modeToggle.classList.toggle('right', tab === 'layouts');
    modeToggle.append(
      h('span', { class: 'mt-thumb' }),
      h('button', { class: `mt-opt ${tab === 'effects' ? 'on' : ''}`, onclick: () => setTab('effects') }, t('lighting.modeEffect')),
      h('button', { class: `mt-opt ${tab === 'layouts' ? 'on' : ''}`, onclick: () => setTab('layouts') }, t('lighting.modeLayout')));
    modeToggle.title = t('lighting.modeHint');
  }

  function setTab(next) {
    tab = next;
    set('ui.lightingTab', next, { silent: true });
    renderToggle();
    subtitle.textContent = next === 'effects' ? t('lighting.subEffect') : t('lighting.subLayout');
    editor?.dispose();
    editor = null;
    overlay.innerHTML = '';
    overlay.style.pointerEvents = next === 'layouts' ? 'auto' : 'none';
    syncLofi();
    syncLibrary();
    if (next === 'effects') { renderEffectBelow(); renderEffectSide(); }
    else {
      editor = createLayoutEditor(overlay, { onSelect: keys => { selection = keys; renderLayoutBelow(); renderLayoutSide(); } });
      if (opts.focusDevice) {
        editor.setSelection(currentItems().filter(i => i.deviceId === opts.focusDevice).map(i => i.key));
        opts.focusDevice = null;
      }
      renderLayoutSide();
      renderLayoutBelow();
    }
  }

  let consoleOpen = false;
  function renderEffectBelow() {
    below.innerHTML = '';
    const fx = pb.activeEffect();
    if (!fx) {
      below.append(h('div', { class: 'empty' }, t('lighting.nothingPlaying'), h('div', { style: { marginTop: '12px' } }, h('button', { class: 'btn primary', onclick: () => library.scrollIntoView({ behavior: 'smooth' }) }, t('lighting.pickInEffects')))));
      return;
    }
    if (fx.screen) {
      // Ambiente da Tela: a cena Lo-Fi ocupa a prévia; aqui só o que está acontecendo e os atalhos
      below.append(h('div', { class: 'lt-fx' },
        h('div', { class: 'grow' }, h('div', { class: 'lt-fx-name' }, fxName(fx)), h('div', { class: 'muted', style: { marginTop: '4px' } }, t(isSoundMode(pb.paramsFor(fx)) ? 'lighting.lofiOnSound' : 'lighting.lofiOnScreen'))),
        h('div', { class: 'row' },
          h('button', { class: 'btn sm primary', onclick: () => navigate('screen') }, t('lighting.openScreen')))));
      return;
    }
    const fav = pb.isFavorite(fx.id);
    const desc = fxDescription(fx);
    below.append(h('div', { class: 'lt-fx' },
      h('div', { class: 'grow' },
        h('div', { class: 'lt-fx-name' }, fxName(fx)),
        desc ? h('div', { class: 'muted', style: { marginTop: '4px' } }, desc) : null),
      h('div', { class: 'row' },
        h('button', { class: `star ${fav ? 'on' : ''}`, title: fav ? t('effects.unfavorite') : t('effects.favorite'), 'aria-pressed': String(fav), onclick: () => { pb.toggleFavorite(fx.id); renderEffectBelow(); } }, ico('star')),
        moreButton(() => [
          { label: t('effects.addToPlaylist'), action: () => addToPlaylistDialog(fx.id) },
          { label: consoleOpen ? t('lighting.hideConsole') : t('lighting.showConsole'), action: () => { consoleOpen = !consoleOpen; renderEffectBelow(); } }]))));
    if (consoleOpen) {
      const con = h('div', { class: 'console' });
      const draw = () => fillConsole(con, runner.consoleLines);
      draw();
      renderEffectBelow.drawConsole = draw;
      below.append(h('div', { class: 'panel', style: { marginTop: '12px' } },
        h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, t('lighting.console')), h('button', { class: 'btn sm', onclick: () => runner.clearConsole() }, t('lighting.clear'))),
        h('div', { style: { height: '8px' } }), con));
    } else renderEffectBelow.drawConsole = null;
  }

  function renderEffectSide() {
    side.innerHTML = '';
    side.append(brightnessPanel());
    const fx = pb.activeEffect();
    if (fx) {
      const params = pb.paramsFor(fx);
      const paramsPanel = h('div', { class: 'panel' }, h('h3', {}, t('lighting.effectSettings')));
      // velocidade da animação: funciona em qualquer efeito; some quando o efeito já traz a sua própria e no
      // Ambiente da Tela (que segue a tela, não tem animação)
      if (!pb.hasOwnSpeed(fx) && !fx.screen) {
        paramsPanel.append(h('div', { class: 'param', title: t('lighting.speedHint') }, h('label', {}, t('lighting.speed')),
          slider({ min: 10, max: 300, step: 5, value: pb.speedFor(fx), suffix: '%', onInput: v => pb.setEffectSpeed(fx, v) })));
      }
      for (const p of fx.properties) {
        if (fx.screen && !screenParamShown(p.property, params)) continue; // Ambiente da Tela: só os da função escolhida
        paramsPanel.append(paramControl(p, params[p.property], v => { pb.setEffectParam(fx, p.property, v); if (p.property === 'react') renderEffectSide(); }, fxScope(fx)));
      }

      const presets = pb.presetsFor(fx);
      const names = Object.keys(presets);
      const presetSel = h('select', { class: 'input grow' }, h('option', { value: '' }, names.length ? t('lighting.pickPreset') : t('lighting.noPresets')), names.map(n => h('option', { value: n }, n)));
      presetSel.onchange = () => { if (presetSel.value) { pb.applyPreset(fx, presetSel.value); toast(t('lighting.presetApplied', { name: presetSel.value })); } };
      const presetPanel = h('div', { class: 'panel col' }, h('h3', {}, t('lighting.presets')),
        h('div', { class: 'row' }, presetSel,
          h('button', { class: 'btn sm', title: t('lighting.savePresetHint'), onclick: async () => {
            const name = await prompt(t('lighting.savePreset'), { label: t('lighting.presetName'), placeholder: t('lighting.presetPlaceholder'), validate: requiredName });
            if (name) { pb.savePreset(fx, name); toast(t('lighting.presetSaved')); renderEffectSide(); }
          } }, t('common.save')),
          moreButton(() => [
            { label: presetSel.value ? t('lighting.deleteNamed', { name: presetSel.value }) : t('lighting.deletePresetPick'), disabled: !presetSel.value, action: async () => {
              const n = presetSel.value;
              if (await confirmDialog(t('lighting.deletePreset'), t('lighting.deletePresetText', { name: n }), t('common.delete'), true)) { pb.deletePreset(fx, n); renderEffectSide(); }
            } },
            { label: t('lighting.resetDefaults'), action: async () => { if (await confirmDialog(t('lighting.resetTitle'), t('lighting.resetText'))) pb.resetEffectParams(fx); } }])),
        h('div', { class: 'dim' }, t('lighting.presetsHint')));
      // gravar na memória do próprio hardware (continua com o app fechado), onde o dispositivo suporta
      const savePanel = h('div', { class: 'panel col' }, h('h3', {}, t('hwsave.panelTitle')),
        h('button', { class: 'btn', title: t('hwsave.buttonHint'), onclick: hardwareSaveDialog }, ico('download'), t('hwsave.button')),
        h('div', { class: 'dim' }, t('hwsave.buttonHint')));
      side.append(paramsPanel, presetPanel, savePanel);
    }

    const tm = app.store.timer;
    const pls = app.store.playlists || [];
    const unitSel = h('select', { class: 'input' }, [['1', t('lighting.seconds')], ['60', t('lighting.minutes')], ['3600', t('lighting.hours')]].map(([v, l]) => h('option', { value: v }, l)));
    const best = tm.intervalSec % 3600 === 0 ? 3600 : tm.intervalSec % 60 === 0 ? 60 : 1;
    unitSel.value = String(best);
    const amount = h('input', { class: 'input num', type: 'number', min: 1, value: tm.intervalSec / best, 'aria-label': t('lighting.every') });
    const plSel = h('select', { class: 'input grow', 'aria-label': t('lighting.queue') }, h('option', { value: '' }, t('lighting.allEffects')), pls.map(p => h('option', { value: p.id, selected: p.id === tm.playlistId }, p.name)));
    const remaining = h('span', { class: 'dim' });
    side.append(h('div', { class: 'panel col', id: 'autoSwitch' },
      h('h3', {}, t('lighting.nowPlaying')), player,
      h('div', { class: 'sep' }),
      h('h3', {}, t('lighting.autoSwitch')),
      h('div', { class: 'row' }, h('span', { class: 'dim', style: { width: '48px' } }, t('lighting.every')), amount, unitSel),
      h('div', { class: 'row' }, h('span', { class: 'dim', style: { width: '48px' } }, t('lighting.queue')), plSel),
      h('div', { class: 'row' },
        tm.active
          ? h('button', { class: 'btn sm danger', onclick: () => { pb.stopTimer(); renderEffectSide(); } }, ico('stop', 'fill'), t('effects.stop'))
          : h('button', { class: 'btn sm primary', onclick: () => { pb.startTimer(Number(amount.value) * Number(unitSel.value), plSel.value || null); renderEffectSide(); } }, ico('play', 'fill'), t('lighting.start')),
        remaining)));
    const tick = () => { remaining.textContent = app.store.timer.active ? t('lighting.nextInLower', { time: fmtTime(pb.timerRemainingMs()) }) : ''; };
    tick();
    renderEffectSide.tick = tick;
  }

  sub('effect', () => { syncLofi(); if (tab === 'effects') { renderEffectBelow(); renderEffectSide(); } });
  sub('timer', () => { if (tab === 'effects') renderEffectSide(); });
  sub('timertick', () => renderEffectSide.tick?.());
  sub('fxconsole', () => renderEffectBelow.drawConsole?.());

  function renderLayoutSide() {
    side.innerHTML = '';
    const Ls = app.store.layouts;
    const dirty = L.isDirty();
    const sel = h('select', { class: 'input grow', 'aria-label': t('lighting.layout'), onchange: async e => {
      if (L.isDirty() && !await confirmDialog(t('lighting.unsavedTitle'), t('lighting.unsavedText'), t('lighting.switch'))) { e.target.value = Ls.current; return; }
      L.loadLayout(e.target.value); editor?.setSelection([]); renderLayoutSide();
    } }, L.layoutNames().map(n => h('option', { value: n, selected: n === Ls.current }, layoutLabel(n))));
    const validName = v => requiredName(v) || (/[\\/]/.test(v) ? t('lighting.badName') : null);
    side.append(
      brightnessPanel(),
      h('div', { class: 'panel col' },
        h('div', { class: 'row' }, h('h3', { class: 'grow', style: { margin: 0 } }, t('lighting.layout')),
          dirty ? h('span', { class: 'chip warn' }, t('lighting.notSaved')) : null,
          h('button', { class: 'btn sm ghost icon', title: t('lighting.undo'), onclick: () => editor?.undo() }, ico('undo')),
          h('button', { class: 'btn sm ghost icon', title: t('lighting.redo'), onclick: () => editor?.redo() }, ico('redo'))),
        h('div', { class: 'row' }, sel,
          dirty ? h('button', { class: 'btn sm primary', onclick: () => { L.saveLayout(); toast(t('lighting.layoutSaved')); renderLayoutSide(); } }, t('common.save')) : null,
          moreButton(() => [
            { label: t('lighting.saveAsMenu'), action: async () => {
              const n = await prompt(t('lighting.saveAs'), { label: t('lighting.newLayoutName'), validate: validName });
              if (n) { L.saveLayout(n); toast(t('lighting.layoutCreated', { name: n })); renderLayoutSide(); }
            } },
            { label: t('lighting.newEmptyMenu'), action: async () => {
              const n = await prompt(t('lighting.newEmpty'), { label: t('effects.name'), validate: v => validName(v) || (Ls.list[v] ? t('lighting.exists') : null) });
              if (n) { L.newLayout(n); renderLayoutSide(); editor?.render(); }
            } },
            { label: t('lighting.discard'), disabled: !L.isDirty(), action: () => { L.loadLayout(Ls.current); editor?.render(); renderLayoutSide(); toast(t('lighting.discarded')); } },
            '-',
            { label: t('lighting.autoArrange'), action: async () => {
              if (!await confirmDialog(t('lighting.autoArrange'), t('lighting.autoArrangeText'), t('lighting.arrange'))) return;
              L.autoArrange(currentItems()); editor?.render(); renderLayoutSide(); toast(t('lighting.arranged'));
            } },
            { label: t('lighting.shortcuts'), action: shortcutsHelp },
            '-',
            { label: t('lighting.deleteNamed', { name: layoutLabel(Ls.current) }), disabled: L.layoutNames().length < 2, action: async () => {
              if (await confirmDialog(t('lighting.deleteLayout'), t('lighting.deleteLayoutText', { name: layoutLabel(Ls.current) }), t('common.delete'), true)) { L.deleteLayout(Ls.current); editor?.render(); renderLayoutSide(); }
            } }])),
        h('div', { class: 'param' }, h('label', {}, t('lighting.layoutBrightness')), slider({ value: L.layoutBrightness(), suffix: '%', onInput: v => L.setLayoutBrightness(v), onChange: v => L.setLayoutBrightness(v, { persist: true }) })),
        h('div', { class: 'row' }, h('span', { class: 'grow muted' }, t('lighting.showLeds')), switchEl(app.store.ui.showLeds !== false, v => { set('ui.showLeds', v, { silent: true }); editor?.render(); })),
        h('div', { class: 'row' }, h('span', { class: 'grow muted' }, t('lighting.showGrid')), switchEl(app.store.ui.showGrid !== false, v => { set('ui.showGrid', v, { silent: true }); editor?.render(); }))));

    const items = currentItems();
    const tree = h('div', { class: 'panel dev-tree' });
    const groups = new Map();
    for (const it of items) { if (!groups.has(it.deviceId)) groups.set(it.deviceId, []); groups.get(it.deviceId).push(it); }
    const allHidden = items.length && items.every(i => L.itemTransform(i).hidden);
    tree.append(h('div', { class: 'row', style: { marginBottom: '6px' } }, h('h3', { class: 'grow', style: { margin: 0 } }, t('lighting.items', { n: items.length })),
      h('button', { class: 'btn sm ghost', onclick: () => { for (const i of items) L.itemTransform(i).hidden = !allHidden; L.persistWorking(); editor?.render(); renderLayoutSide(); } }, allHidden ? t('lighting.showAll') : t('lighting.hideAll'))));
    if (!items.length) tree.append(h('div', { class: 'dim' }, t('lighting.noDevices')));
    for (const [devId, list] of groups) {
      const dev = app.devices.get(devId);
      const grp = h('div', { class: 'grp' });
      grp.append(h('div', { class: 'dim', style: { padding: '4px 6px' } }, dev ? deviceName(dev) : devId));
      for (const it of list) {
        const tf = L.itemTransform(it);
        grp.append(h('div', { class: `node child ${selection.includes(it.key) ? 'sel' : ''}`, onclick: e => {
          if (tf.hidden) return;
          editor?.setSelection(e.ctrlKey ? [...new Set([...selection, it.key])] : [it.key]);
        } },
          h('button', { class: 'eye', title: tf.hidden ? t('lighting.show') : t('lighting.hide'), onclick: e => { e.stopPropagation(); tf.hidden = !tf.hidden; L.persistWorking(); editor?.render(); renderLayoutSide(); } }, ico(tf.hidden ? 'eyeOff' : 'eye')),
          h('span', { class: 'grow', style: { opacity: tf.hidden ? 0.5 : 1 } }, it.name),
          h('span', { class: 'dim' }, `${it.leds.length}`)));
      }
      tree.append(grp);
    }
    side.append(tree);
  }

  function shortcutsHelp() {
    const rows = ['click', 'drag', 'arrows', 'alt', 'qe', 'shiftRotate', 'undo', 'copy', 'selectAll', 'esc', 'right']
      .map(k => [t(`lighting.key.${k}`), t(`lighting.keyDo.${k}`)]);
    modal(t('lighting.shortcutsTitle'), h('div', { class: 'col' }, rows.map(([k, v]) => h('div', { class: 'row' }, h('b', { style: { width: '200px' } }, k), h('span', { class: 'muted' }, v)))), [{ label: t('common.close'), primary: true }]);
  }

  // forma livre (cobrinha): fitas dos conectores ARGB e pentes de memória. Moldar = arrastar a cabeça ou a cauda e o
  // corpo segue célula por célula, como no jogo da cobrinha (U com pontas retas, zigue-zague, espiral…)
  function shapePanel(items) {
    if (items.length !== 1 || !L.canShape(items[0])) return null;
    const it = items[0], tf = L.itemTransform(it), on = editor.shaping() === it.key, ruler = on && editor.tool() === 'ruler';
    return h('div', { class: 'col', style: { marginTop: '10px', gap: '6px' } },
      h('div', { class: 'row wrap' },
        h('button', { class: `btn sm ${on ? 'primary' : ''}`, onclick: () => { editor.shape(on ? null : it.key); renderLayoutBelow(); } }, on ? t('lighting.shapeDone') : t('lighting.shapeEdit')),
        on ? h('button', { class: `btn sm ${ruler ? 'primary' : ''}`, 'aria-pressed': String(ruler), title: t('lighting.shapeRulerTip'), onclick: () => { editor.setTool(ruler ? 'snake' : 'ruler'); renderLayoutBelow(); } }, t(ruler ? 'lighting.shapeRulerOff' : 'lighting.shapeRuler')) : null,
        L.hasPath(it, tf) ? h('button', { class: 'btn sm ghost', onclick: () => { editor.straighten(); renderLayoutBelow(); } }, t('lighting.shapeReset')) : null),
      ruler
        // régua: explica o que ela faz e os dois passos, com a legenda das cores do canvas
        ? h('div', { class: 'ruler-help' },
            h('b', {}, t('lighting.rulerTitle')),
            h('div', { class: 'dim' }, t('lighting.rulerWhat')),
            h('ol', {}, h('li', {}, t('lighting.rulerHow1')), h('li', {}, t('lighting.rulerHow2'))),
            h('div', { class: 'ruler-legend' },
              h('span', {}, h('i', { class: 'sw sw-a' }), t('lighting.rulerLegendStart')),
              h('span', {}, h('i', { class: 'sw sw-range' }), t('lighting.rulerLegendRange')),
              h('span', {}, h('i', { class: 'sw sw-preview' }), t('lighting.rulerLegendPreview'))),
            h('div', { class: 'dim' }, t('lighting.rulerNote')))
        : h('div', { class: 'dim' }, t(on ? 'lighting.shapeEditing' : 'lighting.shapeHint')));
  }

  function renderLayoutBelow() {
    below.innerHTML = '';
    const items = currentItems().filter(i => selection.includes(i.key));
    if (!items.length) {
      below.append(h('div', { class: 'panel muted' }, t('lighting.layoutHelp')));
      return;
    }
    const first = items[0];
    const tf = L.itemTransform(first);
    const multi = items.length > 1;
    const numIn = (label, key, step = 1) => h('div', { class: 'row' }, h('span', { class: 'dim', style: { width: '56px' } }, label),
      h('input', { class: 'input num', type: 'number', step, value: +(+tf[key]).toFixed(2), 'aria-label': label, onchange: e => { const v = Number(e.target.value); editor.mutate(tt => { tt[key] = key === 'rotation' ? ((v % 360) + 360) % 360 : key === 'scale' ? Math.max(0.5, v) : v; }); renderLayoutBelow(); } }));
    const devS = deviceSettings(first.deviceId);
    const info = [t('lighting.grid', { w: first.w, h: first.h }), t('lighting.leds', { n: first.leds.length }),
      first.kind === 'component' ? t('lighting.componentOf', { channel: first.channel }) : null].filter(Boolean).join(' · ');
    below.append(h('div', { class: 'panel' },
      h('div', { class: 'row wrap', style: { marginBottom: '12px' } },
        h('b', { class: 'grow' }, multi ? t('lighting.selected', { n: items.length }) : first.name),
        h('button', { class: 'btn sm', onclick: () => editor.center() }, t('lighting.center')),
        moreButton(() => [
          { label: t('lighting.resetPosition'), action: () => { editor.reset(); renderLayoutBelow(); } },
          multi ? { label: t('lighting.alignH'), action: () => editor.align('h') } : null,
          multi ? { label: t('lighting.alignV'), action: () => editor.align('v') } : null,
          !multi ? { label: t('lighting.openDevice'), action: () => navigate('devices', { deviceId: first.deviceId }) } : null])),
      h('div', { class: 'row wrap', style: { gap: '16px' } }, numIn('X', 'x', 0.5), numIn('Y', 'y', 0.5), numIn(t('lighting.scale'), 'scale', 0.25), numIn(t('lighting.rotation'), 'rotation', 1),
        h('div', { class: 'row' }, h('span', { class: 'dim' }, t('lighting.invertX')), switchEl(tf.invertX, v => editor.mutate(tt => { tt.invertX = v; }))),
        h('div', { class: 'row' }, h('span', { class: 'dim' }, t('lighting.invertY')), switchEl(tf.invertY, v => editor.mutate(tt => { tt.invertY = v; })))),
      shapePanel(items),
      h('div', { class: 'param', style: { marginTop: '8px' } }, h('label', {}, multi ? t('lighting.devicesBrightness') : t('lighting.deviceBrightness')),
        slider({ value: devS.brightness, suffix: '%', onInput: v => { for (const it of items) deviceSettings(it.deviceId).brightness = v; }, onChange: () => { for (const id of new Set(items.map(i => i.deviceId))) saveDevice(id); } })),
      h('div', { class: 'dim' }, info)));
  }
  sub('layoutchange', () => { if (tab === 'layouts') { renderLayoutBelow(); renderLayoutSide(); } });
  sub('devices', () => { if (tab === 'layouts') { editor?.render(); renderLayoutSide(); } });
  sub('layout', () => { if (tab === 'layouts') { editor?.render(); renderLayoutSide(); } });

  setTab(tab);
  return () => { subs.forEach(u => u()); editor?.dispose(); };
}

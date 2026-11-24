// Editor de layout sobre o canvas do efeito (SVG em coordenadas 320x200).
import { app, deviceSettings, saveDevice, emit } from './state.js';
import { svg, contextMenu, toast } from './ui.js';
import { currentItems } from './sampler.js';
import { working, persistWorking, itemTransform, itemBounds, ledLocalAt, hasPath, canShape, defaultPath, localBox, localCenter, localToCanvas, canvasToLocal, snakeTo, straightenRange, pathOverlaps } from './layoutModel.js';
import { CANVAS_W, CANVAS_H } from './canvas.js';
import { t as tr } from './i18n.js'; // "t" aqui é sempre a transformação de um item

export function createLayoutEditor(svgEl, { onSelect } = {}) {
  svgEl.setAttribute('viewBox', `0 0 ${CANVAS_W} ${CANVAS_H}`);
  svgEl.setAttribute('preserveAspectRatio', 'none');
  // o mesmo <svg> recebe um editor novo a cada volta à aba Layout: dispose() tira todos os ouvintes deste
  const off = new AbortController();
  let selected = new Set();
  let undo = [], redo = [];
  let ledRefs = [];
  let drag = null;
  let marquee = null;
  let clipboard = null;
  let shapeKey = null;   // item sendo moldado (forma livre, cobrinha)
  let groups = new Map(); // key → <g> do item: arrastar só muda o transform, sem redesenhar tudo
  let tool = 'snake';     // no modo moldar: 'snake' (arrastar as pontas) ou 'ruler' (régua: endireitar um trecho)
  let ruler = { a: null, hover: null }; // régua: LED de início marcado e LED sob o cursor (índices na fita)

  const pt = e => {
    const r = svgEl.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * CANVAS_W, (e.clientY - r.top) / r.height * CANVAS_H];
  };
  const snapshot = () => JSON.stringify(working().items);
  const pushUndo = (snap = snapshot()) => { undo.push(snap); if (undo.length > 100) undo.shift(); redo = []; };
  const commit = () => { persistWorking(); emit('layoutchange'); };
  const items = () => currentItems().filter(i => !itemTransform(i).hidden);
  const byKey = k => currentItems().find(i => i.key === k);

  function setSelection(keys, additive = false) {
    selected = additive ? new Set([...selected, ...keys]) : new Set(keys);
    if (shapeKey && !selected.has(shapeKey)) shapeKey = null; // escolheu outro item: sai do modo moldar
    render();
    onSelect?.([...selected]);
  }

  const groupTransform = (item, t) => { const [cx, cy] = localCenter(item, t); return `translate(${t.x} ${t.y}) rotate(${t.rotation || 0} ${cx} ${cy})`; };

  function render() {
    svgEl.innerHTML = '';
    svgEl.classList.toggle('ruler', !!shapeKey && tool === 'ruler');
    ledRefs = [];
    groups = new Map();
    const showLeds = app.store.ui?.showLeds !== false;
    if (app.store.ui?.showGrid !== false) {
      const g = svg('g', { opacity: 0.25 });
      for (let x = 0; x <= CANVAS_W; x += 20) g.append(svg('line', { x1: x, y1: 0, x2: x, y2: CANVAS_H, stroke: '#fff', 'stroke-width': x % 80 === 0 ? 0.5 : 0.2 }));
      for (let y = 0; y <= CANVAS_H; y += 20) g.append(svg('line', { x1: 0, y1: y, x2: CANVAS_W, y2: y, stroke: '#fff', 'stroke-width': y % 80 === 0 ? 0.5 : 0.2 }));
      svgEl.append(g);
    }
    const list = items().sort((a, b) => (itemTransform(a).z || 0) - (itemTransform(b).z || 0));
    for (const item of list) {
      const t = itemTransform(item);
      const bx = localBox(item, t), [cx] = localCenter(item, t);
      const sel = selected.has(item.key), shaping = shapeKey === item.key;
      const g = svg('g', { class: `li-item ${sel ? 'sel' : ''} ${shaping ? 'shaping' : ''}`, transform: groupTransform(item, t) });
      if (hasPath(item, t) || shaping) {
        // forma livre: o corpo é o próprio traçado (linha grossa passando pelos LEDs, também é a área de arrastar)
        const d = item.leds.map((_, i) => { const [x, y] = ledLocalAt(item, t, i); return `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`; }).join(' ');
        g.append(svg('path', { class: 'body-curve', d, 'stroke-width': Math.max(1.5, t.scale) }));
      } else g.append(svg('rect', { class: 'body', x: bx.x0, y: bx.y0, width: bx.x1 - bx.x0, height: bx.y1 - bx.y0, rx: Math.min(3, t.scale / 2) }));
      if (showLeds) {
        const r = Math.max(0.6, Math.min(t.scale * 0.36, 4));
        item.leds.forEach((_, i) => {
          const [lx, ly] = ledLocalAt(item, t, i);
          const c = svg('circle', { cx: lx, cy: ly, r, fill: '#000', stroke: '#ffffff40', 'stroke-width': 0.3 });
          g.append(c);
          ledRefs.push({ el: c, key: item.key, i });
        });
      }
      g.append(svg('text', { x: bx.x0 + 1, y: bx.y0 - 2 }, item.name));
      if (shaping && tool === 'ruler') { const layer = svg('g', { class: 'li-ruler-layer' }); drawRuler(layer, item, t); g.append(layer); }
      if (shaping && drag?.mode === 'snake' && drag.axis && !drag.free) {
        // trilho: a linha em que a ponta está travada
        const n = item.leds.length, [ex, ey] = ledLocalAt(item, t, drag.head ? 0 : n - 1), F = 2000;
        g.append(svg('line', drag.axis === 'x' ? { class: 'li-guide', x1: ex - F, y1: ey, x2: ex + F, y2: ey } : { class: 'li-guide', x1: ex, y1: ey - F, x2: ex, y2: ey + F }));
      }
      if (shaping && tool === 'ruler') { /* na régua as pontas são LEDs como os outros (dá para escolher a ponta como início ou fim) */ }
      else if (shaping) {
        // cabeça e cauda: arraste qualquer ponta e o corpo vem atrás, célula por célula
        const n = item.leds.length, rr = Math.max(2.4, t.scale * 0.7);
        for (const [i, act] of [[0, 'snake-head'], [n - 1, 'snake-tail']]) {
          const [hx, hy] = ledLocalAt(item, t, i);
          g.append(svg('circle', { class: `li-snake-end ${act}`, cx: hx, cy: hy, r: rr, 'data-act': act, 'data-key': item.key }));
        }
      } else if (sel) {
        g.append(svg('line', { class: 'li-rot-stem', x1: cx, y1: bx.y0, x2: cx, y2: bx.y0 - 9 }));
        g.append(svg('circle', { class: 'li-rot', cx, cy: bx.y0 - 10, r: 2.6, 'data-act': 'rotate', 'data-key': item.key }));
        g.append(svg('rect', { class: 'li-handle', x: bx.x1 - 2.5, y: bx.y1 - 2.5, width: 5, height: 5, 'data-act': 'scale', 'data-key': item.key }));
      }
      g.dataset.key = item.key;
      groups.set(item.key, g);
      svgEl.append(g);
    }
    if (marquee) svgEl.append(svg('rect', { class: 'li-marquee', x: marquee.x, y: marquee.y, width: marquee.w, height: marquee.h }));
    if (shapeKey && tool === 'ruler') {
      // instrução do passo atual, no próprio canvas
      const msg = ruler.a == null ? tr('lighting.rulerStep1') : tr('lighting.rulerStep2');
      svgEl.append(svg('text', { class: 'li-banner', x: CANVAS_W / 2, y: 9 }, msg));
    }
    paintLeds(); // as bolinhas já nascem com a cor atual (antes: pretas até a próxima pintura → piscava ao arrastar)
  }

  function paintLeds() {
    for (const r of ledRefs) {
      const c = app.liveColors.get(r.key);
      if (!c) continue;
      r.el.setAttribute('fill', `rgb(${c[r.i * 3]},${c[r.i * 3 + 1]},${c[r.i * 3 + 2]})`);
    }
  }
  const ledTimer = setInterval(paintLeds, 80);

  svgEl.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const p = pt(e);
    const act = e.target.dataset?.act;
    const g = e.target.closest('.li-item');
    svgEl.setPointerCapture(e.pointerId);
    if (act === 'snake-head' || act === 'snake-tail') {
      const item = byKey(e.target.dataset.key), t = itemTransform(item), before = snapshot();
      if (!hasPath(item, t)) { t.path = defaultPath(item, t); t.invertX = t.invertY = false; }
      drag = { mode: 'snake', before, item, t, head: act === 'snake-head' };
      return;
    }
    if (shapeKey && tool === 'ruler') {
      // régua: 1º clique marca o início, 2º clique (ou soltar depois de arrastar) marca o fim e endireita.
      // Clicar fora da fita só cancela o início: nunca move nem desmarca nada.
      const item = byKey(shapeKey);
      if (!item) return;
      const t = itemTransform(item), hit = rulerHit(item, t, p);
      if (hit == null) { if (ruler.a != null) { ruler.a = null; render(); } return; }
      if (ruler.a == null) { ruler.a = ruler.hover = hit; drag = { mode: 'ruler', item, t, start: hit }; }
      else applyRuler(item, t, ruler.a, hit);
      render();
      return;
    }
    if (act === 'scale' || act === 'rotate') {
      const item = byKey(e.target.dataset.key);
      const t = itemTransform(item);
      const center = localToCanvas(item, t, localCenter(item, t));
      const cells = localCenter(item, t).map(v => v / t.scale); // centro em células: não muda com a escala
      drag = { mode: act, before: snapshot(), item, t, center, cells, s0: t.scale, d0: Math.hypot(p[0] - center[0], p[1] - center[1]) || 1 };
      return;
    }
    if (g) {
      const key = g.dataset.key;
      if (key === shapeKey) return; // moldando: a fita fica presa no lugar (antes um clique no corpo arrastava a fita inteira para fora da tela)
      if (e.ctrlKey || e.shiftKey) {
        const s = new Set(selected); s.has(key) ? s.delete(key) : s.add(key);
        setSelection([...s]);
      } else if (!selected.has(key)) setSelection([key]);
      drag = { mode: 'move', before: snapshot(), p0: p, starts: [...selected].map(k => ({ k, x: itemTransform(byKey(k)).x, y: itemTransform(byKey(k)).y })).filter(s => byKey(s.k)) };
      return;
    }
    if (!e.ctrlKey && !e.shiftKey) setSelection([]);
    drag = { mode: 'marquee', p0: p, base: e.ctrlKey || e.shiftKey ? [...selected] : [] };
  }, { signal: off.signal });

  svgEl.addEventListener('pointermove', e => {
    if (shapeKey && tool === 'ruler' && (!drag || drag.mode === 'ruler')) {
      // régua: o LED sob o cursor ganha destaque e, com o início marcado, aparece a prévia de como a fita vai ficar
      const item = byKey(shapeKey);
      if (!item) return;
      const h = rulerHit(item, itemTransform(item), pt(e));
      if (drag && h != null && h !== drag.start) drag.moved = true;
      if (h !== ruler.hover) { ruler.hover = h; refreshRuler(); }
      return;
    }
    if (!drag) return;
    let p = pt(e);
    if (drag.mode === 'move') {
      let dx = p[0] - drag.p0[0], dy = p[1] - drag.p0[1];
      if (e.altKey) { dx = Math.round(dx / 5) * 5; dy = Math.round(dy / 5) * 5; }
      for (const s of drag.starts) {
        const it = byKey(s.k), t = itemTransform(it);
        t.x = +(s.x + dx).toFixed(2); t.y = +(s.y + dy).toFixed(2);
        groups.get(s.k)?.setAttribute('transform', groupTransform(it, t));
      }
      drag.moved = true;
    } else if (drag.mode === 'scale') {
      const d = Math.hypot(p[0] - drag.center[0], p[1] - drag.center[1]);
      const ns = Math.max(0.5, Math.min(60, +(drag.s0 * d / drag.d0).toFixed(2)));
      const { item, t } = drag;
      t.scale = ns;
      t.x = +(drag.center[0] - drag.cells[0] * ns).toFixed(2);
      t.y = +(drag.center[1] - drag.cells[1] * ns).toFixed(2);
      drag.moved = true;
      render();
    } else if (drag.mode === 'rotate') {
      let a = Math.atan2(p[1] - drag.center[1], p[0] - drag.center[0]) * 180 / Math.PI + 90;
      a = ((a % 360) + 360) % 360;
      if (!e.shiftKey) a = Math.round(a / 15) * 15 % 360;
      drag.t.rotation = Math.round(a);
      drag.moved = true;
      render();
    } else if (drag.mode === 'snake') {
      const { item, t } = drag;
      p = [Math.max(0, Math.min(CANVAS_W, p[0])), Math.max(0, Math.min(CANVAS_H, p[1]))]; // a ponta não sai do canvas
      const [lx, ly] = canvasToLocal(item, t, p);
      const fx = lx / t.scale - 0.5, fy = ly / t.scale - 0.5; // em células (centro da célula = inteiro)
      const target = [Math.round(fx), Math.round(fy)];
      const end = drag.head ? t.path[0] : t.path[t.path.length - 1];
      let next;
      drag.free = e.altKey;
      if (drag.free) next = snakeTo(t.path, drag.head, target); // Alt: mão livre, segue o cursor como antes
      else {
        // trilho: a ponta anda travada num eixo; tremidas pequenas do mouse são ignoradas. Só vira quando o cursor
        // se afasta de verdade da linha, e aí faz um canto em L limpo (termina a reta e sobe/desce reto).
        const ddx = fx - end[0], ddy = fy - end[1];
        if (!drag.axis) {
          if (Math.max(Math.abs(ddx), Math.abs(ddy)) < 0.6) return;
          drag.axis = Math.abs(ddx) >= Math.abs(ddy) ? 'x' : 'y';
        }
        const off = drag.axis === 'x' ? Math.abs(ddy) : Math.abs(ddx);
        const tol = Math.max(1.5, 5 / t.scale);
        if (off <= tol || e.shiftKey) next = snakeTo(t.path, drag.head, drag.axis === 'x' ? [target[0], end[1]] : [end[0], target[1]]);
        else {
          const corner = drag.axis === 'x' ? [target[0], end[1]] : [end[0], target[1]];
          next = snakeTo(snakeTo(t.path, drag.head, corner), drag.head, target);
          drag.axis = drag.axis === 'x' ? 'y' : 'x';
        }
      }
      if (next.join(';') === t.path.join(';')) { if (drag.axis !== drag.shownAxis) { drag.shownAxis = drag.axis; render(); } return; }
      drag.shownAxis = drag.axis;
      applyPath(item, t, next);
      drag.moved = true;
      render();
    } else if (drag.mode === 'marquee') {
      const x = Math.min(p[0], drag.p0[0]), y = Math.min(p[1], drag.p0[1]);
      marquee = { x, y, w: Math.abs(p[0] - drag.p0[0]), h: Math.abs(p[1] - drag.p0[1]) };
      const hit = items().filter(i => { const b = itemBounds(i, itemTransform(i)); return b.x < x + marquee.w && b.x + b.w > x && b.y < y + marquee.h && b.y + b.h > y; }).map(i => i.key);
      selected = new Set([...drag.base, ...hit]);
      render();
    }
  }, { signal: off.signal });

  svgEl.addEventListener('pointerup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'marquee') { marquee = null; render(); onSelect?.([...selected]); }
    else if (d.mode === 'ruler') {
      // arrastou de um LED a outro: endireita ao soltar. Só clicou: o início fica marcado esperando o 2º clique.
      if (d.moved && ruler.hover != null && ruler.hover !== ruler.a) { applyRuler(d.item, d.t, ruler.a, ruler.hover); render(); }
    } else {
      let fixed = false;
      if (d.mode === 'move' && d.moved) for (const s of d.starts) { const it = byKey(s.k); if (it && keepVisible(it, itemTransform(it))) fixed = true; }
      if (d.mode === 'snake' && d.moved) fixed = keepVisible(d.item, d.t);
      if (d.moved) { pushUndo(d.before); commit(); } // clique sem arrastar não mexe no histórico
      if (d.mode === 'snake' || fixed) render(); // tira a linha-guia do trilho / mostra o item trazido de volta
    }
  }, { signal: off.signal });

  svgEl.addEventListener('contextmenu', e => {
    e.preventDefault();
    const g = e.target.closest('.li-item');
    if (g && !selected.has(g.dataset.key)) setSelection([g.dataset.key]);
    if (!selected.size) return;
    contextMenu(e.clientX, e.clientY, menuItems());
  }, { signal: off.signal });

  function mutate(fn) {
    if (!selected.size) return;
    pushUndo();
    for (const k of selected) { const it = byKey(k); if (it) fn(itemTransform(it), it); }
    commit();
    render();
  }

  function center() {
    mutate((t, it) => { const [cx, cy] = localCenter(it, t); t.x = +(CANVAS_W / 2 - cx).toFixed(2); t.y = +(CANVAS_H / 2 - cy).toFixed(2); });
  }
  function reset() {
    mutate((t, it) => { delete working().items[it.key]; });
  }
  function align(axis) {
    const sel = [...selected].map(byKey).filter(Boolean);
    if (sel.length < 2) return;
    const ref = itemTransform(sel[0]);
    const refC = axis === 'h' ? ref.y + sel[0].h * ref.scale / 2 : ref.x + sel[0].w * ref.scale / 2;
    mutate((t, it) => { if (axis === 'h') t.y = +(refC - it.h * t.scale / 2).toFixed(2); else t.x = +(refC - it.w * t.scale / 2).toFixed(2); });
  }
  function zOrder(top) {
    const all = currentItems().map(i => itemTransform(i).z || 0);
    const z = top ? Math.max(0, ...all) + 1 : Math.min(0, ...all) - 1;
    mutate(t => { t.z = z; });
  }
  function hideSelected() { mutate(t => { t.hidden = true; }); setSelection([]); }
  function hideOthers() {
    pushUndo();
    for (const it of currentItems()) if (!selected.has(it.key)) itemTransform(it).hidden = true;
    commit(); render();
  }
  function copy() {
    if (selected.size !== 1) { toast(tr('layout.copyOne')); return; }
    const it = byKey([...selected][0]);
    const t = itemTransform(it);
    clipboard = { scale: t.scale, rotation: t.rotation, invertX: t.invertX, invertY: t.invertY, brightness: deviceSettings(it.deviceId).brightness };
    toast(tr('layout.copied'));
  }
  function paste() {
    if (!clipboard) return;
    mutate((t, it) => {
      t.scale = clipboard.scale; t.rotation = clipboard.rotation; t.invertX = clipboard.invertX; t.invertY = clipboard.invertY;
      const s = deviceSettings(it.deviceId); s.brightness = clipboard.brightness; saveDevice(it.deviceId);
    });
    toast(tr('layout.pasted'));
  }
  function nudge(dx, dy) { mutate((t, it) => { t.x = +(t.x + dx).toFixed(2); t.y = +(t.y + dy).toFixed(2); keepVisible(it, t); }); }
  function rotateBy(d) { mutate(t => { t.rotation = (((t.rotation || 0) + d) % 360 + 360) % 360; }); }

  function menuItems() {
    const multi = selected.size > 1;
    return [
      { label: tr('lighting.center'), action: center },
      { label: tr('lighting.resetPosition'), action: reset },
      { label: tr('layout.flipX'), action: () => mutate(t => { t.invertX = !t.invertX; }) },
      { label: tr('layout.flipY'), action: () => mutate(t => { t.invertY = !t.invertY; }) },
      { label: tr('cooler.rotate'), action: () => rotateBy(90) },
      '-',
      { label: tr('layout.front'), action: () => zOrder(true) },
      { label: tr('layout.back'), action: () => zOrder(false) },
      { label: tr('lighting.alignH'), disabled: !multi, action: () => align('h') },
      { label: tr('lighting.alignV'), disabled: !multi, action: () => align('v') },
      '-',
      { label: tr('lighting.hide'), action: hideSelected },
      { label: tr('layout.hideOthers'), action: hideOthers },
      { label: tr('layout.copy'), disabled: multi, action: copy },
      { label: tr('layout.paste'), disabled: !clipboard, action: paste }
    ];
  }

  function onKey(e) {
    if (/input|select|textarea/i.test(document.activeElement?.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'z' && !e.shiftKey) { doUndo(); e.preventDefault(); }
    else if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { doRedo(); e.preventDefault(); }
    else if (e.ctrlKey && k === 'c') copy();
    else if (e.ctrlKey && k === 'v') paste();
    else if (e.ctrlKey && k === 'a') { setSelection(items().map(i => i.key)); e.preventDefault(); }
    else if (k === 'escape') {
      if (shapeKey && tool === 'ruler' && ruler.a != null) { ruler.a = null; render(); }
      else if (shapeKey && tool === 'ruler') { setTool('snake'); emit('layoutchange'); }
      else if (shapeKey) { shape(null); emit('layoutchange'); } else setSelection([]);
    }
    else if (k === 'r' && shapeKey && !e.ctrlKey) { setTool(tool === 'ruler' ? 'snake' : 'ruler'); emit('layoutchange'); }
    else if (k.startsWith('arrow') && selected.size) {
      const s = e.shiftKey ? 10 : 1;
      nudge(k === 'arrowleft' ? -s : k === 'arrowright' ? s : 0, k === 'arrowup' ? -s : k === 'arrowdown' ? s : 0);
      e.preventDefault();
    } else if (k === 'q' && selected.size) rotateBy(-15);
    else if (k === 'e' && selected.size) rotateBy(15);
  }
  document.addEventListener('keydown', onKey, { signal: off.signal });

  function doUndo() { if (!undo.length) return; redo.push(snapshot()); working().items = JSON.parse(undo.pop()); commit(); render(); }
  function doRedo() { if (!redo.length) return; undo.push(snapshot()); working().items = JSON.parse(redo.pop()); commit(); render(); }

  /** LED da fita mais perto do ponto (canvas), com a distância em px do canvas. */
  function nearestLed(item, t, p) {
    const [lx, ly] = canvasToLocal(item, t, p);
    let best = null;
    item.leds.forEach((_, i) => { const [x, y] = ledLocalAt(item, t, i), d = Math.hypot(x - lx, y - ly); if (!best || d < best.d) best = { i, d }; });
    return best;
  }
  /** Troca a forma; a origem da grade (que não se move) fica no mesmo lugar do canvas, senão o item escorrega quando está girado. */
  function applyPath(item, t, next) {
    const before = localToCanvas(item, t, [0, 0]);
    t.path = next;
    const after = localToCanvas(item, t, [0, 0]);
    t.x = +(t.x + before[0] - after[0]).toFixed(3); t.y = +(t.y + before[1] - after[1]).toFixed(3);
  }
  const warnOverlap = path => { if (pathOverlaps(path)) toast(tr('lighting.shapeOverlap')); };

  /**
   * Item que ficou (quase) todo fora do canvas some da tela e não dá mais para clicar nele: traz de volta para dentro.
   * Deixar só um pedaço para fora continua permitido. Retorna true se mexeu.
   */
  function keepVisible(item, t) {
    const b = itemBounds(item, t), M = 6;
    const visW = Math.min(b.x + b.w, CANVAS_W) - Math.max(b.x, 0), visH = Math.min(b.y + b.h, CANVAS_H) - Math.max(b.y, 0);
    if (visW >= Math.min(M, b.w) && visH >= Math.min(M, b.h)) return false;
    const fit = (pos, size, max) => size >= max ? (max - size) / 2 - pos : Math.min(Math.max(pos, 0), max - size) - pos;
    t.x = +(t.x + fit(b.x, b.w, CANVAS_W)).toFixed(2);
    t.y = +(t.y + fit(b.y, b.h, CANVAS_H)).toFixed(2);
    return true;
  }

  // ---- régua: desfaz voltas feitas sem querer (o trecho entre dois LEDs vira uma reta)
  /** LED da fita sob o ponto (canvas), ou null se o cursor não está em cima da fita. */
  function rulerHit(item, t, p) {
    const hit = nearestLed(item, t, p);
    return hit && hit.d <= Math.max(1.6 * t.scale, 4) ? hit.i : null;
  }
  const cellsOf = (item, t) => hasPath(item, t) ? t.path : defaultPath(item, t);
  const polyline = (cells, s, from = 0, to = cells.length - 1) => {
    const d = [];
    for (let i = from; i <= to; i++) d.push(`${i > from ? 'L' : 'M'}${((cells[i][0] + 0.5) * s).toFixed(2)} ${((cells[i][1] + 0.5) * s).toFixed(2)}`);
    return d.join(' ');
  };
  function drawRuler(g, item, t) {
    const { a, hover } = ruler, s = t.scale, cells = cellsOf(item, t), rr = Math.max(2, s * 0.62);
    const at = i => [(cells[i][0] + 0.5) * s, (cells[i][1] + 0.5) * s];
    if (a != null && hover != null && hover !== a) {
      const [i, j] = a < hover ? [a, hover] : [hover, a];
      const next = straightenRange(cells, i, j);
      // trecho que vai ser endireitado (vermelho) e a prévia tracejada de como a fita inteira fica depois do clique
      g.append(svg('path', { class: 'li-range', d: polyline(cells, s, i, j), 'stroke-width': Math.max(2, s * 0.95) }));
      g.append(svg('path', { class: 'li-preview', d: polyline(next, s), 'stroke-width': Math.max(0.8, s * 0.35) }));
      for (const k of [i, j]) { const [x, y] = [(next[k][0] + 0.5) * s, (next[k][1] + 0.5) * s]; g.append(svg('circle', { class: 'li-preview-end', cx: x, cy: y, r: rr * 0.55 })); }
    }
    if (hover != null && hover !== a) { const [x, y] = at(hover); g.append(svg('circle', { class: 'li-ruler-hover', cx: x, cy: y, r: rr })); }
    if (a != null) {
      const [x, y] = at(a);
      g.append(svg('circle', { class: 'li-ruler-a', cx: x, cy: y, r: rr }));
    }
  }
  /** Só a camada da régua e a instrução do topo (mover o mouse não redesenha o canvas inteiro). */
  function refreshRuler() {
    const item = byKey(shapeKey), g = groups.get(shapeKey), old = g?.querySelector('.li-ruler-layer');
    if (!item || !old) { render(); return; }
    const layer = svg('g', { class: 'li-ruler-layer' });
    drawRuler(layer, item, itemTransform(item));
    old.replaceWith(layer);
    const banner = svgEl.querySelector('.li-banner');
    if (banner) banner.textContent = ruler.a == null ? tr('lighting.rulerStep1') : tr('lighting.rulerStep2');
  }
  function applyRuler(item, t, i, j) {
    ruler.a = null;
    if (i === j) return; // clicou de novo no início: cancela
    const before = snapshot();
    if (!hasPath(item, t)) { t.path = defaultPath(item, t); t.invertX = t.invertY = false; }
    const next = straightenRange(t.path, i, j);
    if (next.join(';') === t.path.join(';')) { toast(tr('lighting.rulerAlready')); return; }
    applyPath(item, t, next);
    keepVisible(item, t);
    pushUndo(before); commit(); warnOverlap(next);
  }

  /** Modo moldar (cobrinha) para um item que aceita forma livre; null sai do modo. */
  function shape(key) {
    shapeKey = key && canShape(byKey(key) || {}) ? key : null;
    if (shapeKey) selected = new Set([shapeKey]);
    else tool = 'snake';
    ruler = { a: null, hover: null };
    render();
  }
  /** Ferramenta do modo moldar: 'snake' (pontas) ou 'ruler' (régua). */
  function setTool(name) { tool = name === 'ruler' ? 'ruler' : 'snake'; ruler = { a: null, hover: null }; render(); }
  /** Volta o item à forma original do dispositivo. */
  function straighten() { mutate((t, it) => { delete t.path; keepVisible(it, t); }); }

  // itens que já estavam perdidos fora da tela (layouts salvos antes desta correção) voltam para dentro
  if (currentItems().reduce((n, it) => keepVisible(it, itemTransform(it)) ? n + 1 : n, 0)) persistWorking();

  render();
  return {
    render, setSelection, mutate, center, reset, align, undo: doUndo, redo: doRedo, shape, straighten, shaping: () => shapeKey,
    tool: () => tool, setTool,
    dispose() { clearInterval(ledTimer); off.abort(); }
  };
}

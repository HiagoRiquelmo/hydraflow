// Modelo de layout: itens posicionáveis (dispositivo, subdispositivo, componente) e geometria.
import { app, get, set, deviceSettings, deviceName, emit } from './state.js';
import { CANVAS_W, CANVAS_H } from './canvas.js';
import { componentLabel } from './components.js';

const emptyLayout = () => ({ brightness: 100, items: {} });

/** Chave do item de layout de um componente na cadeia de um canal. */
export const componentKey = (deviceId, channel, instanceId) => `${deviceId}::ch::${channel}::${instanceId}`;

/** Gera a lista de itens de layout a partir dos dispositivos ativos. */
export function buildItems() {
  const items = [];
  for (const dev of app.devices.values()) {
    const d = dev.descriptor;
    if (!d) continue;
    const s = deviceSettings(dev.id);
    if (s.enabled === false || dev.status === 'disabled') continue;
    const baseName = deviceName(dev);
    const hasChildren = d.subdevices.length > 0 || d.channels.length > 0;
    if (d.ledPositions.length > 0 || !hasChildren) {
      items.push({
        key: dev.id, kind: 'device', deviceId: dev.id, name: baseName, snake: dev.provider === 'ram',
        w: d.size[0], h: d.size[1], leds: d.ledPositions,
        ledNames: d.ledNames, defaultPosition: d.defaultPosition, defaultScale: d.defaultScale
      });
    }
    for (const sd of d.subdevices) {
      items.push({
        key: `${dev.id}::sub::${sd.name}`, kind: 'sub', deviceId: dev.id, subName: sd.name,
        name: sd.displayName || sd.name, w: sd.size[0], h: sd.size[1], leds: sd.ledPositions, ledNames: sd.ledNames
      });
    }
    // posicionamento automático: cada canal ocupa uma faixa horizontal do canvas,
    // com seus componentes lado a lado na ordem da cadeia
    const chans = d.channels.filter(ch => (s.channels[ch.name] || []).length);
    const rowH = CANVAS_H / Math.max(1, chans.length);
    chans.forEach((ch, ci) => {
      const chain = s.channels[ch.name] || [];
      const sumW = chain.reduce((a, c) => a + c.Width, 0) + (chain.length - 1);
      const maxH = Math.max(...chain.map(c => c.Height));
      const scale = +Math.max(1, Math.min(10, CANVAS_W * 0.92 / sumW, rowH * 0.8 / maxH)).toFixed(2);
      let x = (CANVAS_W - sumW * scale) / 2;
      for (const comp of chain) {
        items.push({
          key: componentKey(dev.id, ch.name, comp.instanceId), kind: 'component', deviceId: dev.id, channel: ch.name,
          instanceId: comp.instanceId, name: `${componentLabel(comp)} (${ch.name})`, isDefault: !!comp.isDefault,
          snake: (comp.Height === 1 && comp.Width > 2) || (comp.Width === 1 && comp.Height > 2), // fita: uma linha de LEDs
          w: comp.Width, h: comp.Height, leds: comp.LedCoordinates, ledNames: comp.LedNames, mapping: comp.LedMapping,
          autoPlace: { x: +x.toFixed(2), y: +(ci * rowH + (rowH - comp.Height * scale) / 2).toFixed(2), scale }
        });
        x += (comp.Width + 1) * scale;
      }
    });
  }
  return items;
}

export function working() {
  const L = app.store.layouts;
  if (!L.working) {
    const saved = L.list[L.current] || emptyLayout();
    L.working = JSON.parse(JSON.stringify(saved));
  }
  return L.working;
}

export function persistWorking() { set('layouts.working', working(), { silent: true }); }

let placeCount = 0;
/** Retorna (criando com padrões se necessário) a transformação do item. */
export function itemTransform(item) {
  const W = working();
  let t = W.items[item.key];
  if (!t && item.autoPlace) {
    t = W.items[item.key] = { ...item.autoPlace, rotation: 0, invertX: false, invertY: false, hidden: false, z: 0 };
    persistWorking();
  }
  if (!t) {
    const scale = Number(item.defaultScale) || Math.max(2, Math.min(12, Math.floor(Math.min(CANVAS_W * 0.8 / item.w, CANVAS_H * 0.5 / item.h))));
    let x, y;
    if (Array.isArray(item.defaultPosition)) [x, y] = item.defaultPosition;
    else {
      const k = placeCount++ % 6;
      x = (CANVAS_W - item.w * scale) / 2 + (k - 2.5) * 10;
      y = (CANVAS_H - item.h * scale) / 2 + (k - 2.5) * 10;
    }
    t = W.items[item.key] = { x, y, scale, rotation: 0, invertX: false, invertY: false, hidden: false, z: 0 };
    persistWorking();
  }
  return t;
}

// ---- forma livre (estilo cobrinha): fitas de LED dos conectores ARGB da placa-mãe e pentes de memória.
// t.path = [[x, y], ...]: a célula (na grade do item, 1 = um LED) de cada LED, na ordem da fita. Sem t.path, vale a
// forma original do dispositivo. A forma entra aqui, na posição de cada LED, então o desenho do editor e as cores
// lidas do efeito seguem o mesmo traçado.
export const canShape = item => item.snake === true;
export const hasPath = (item, t) => canShape(item) && Array.isArray(t.path) && t.path.length === item.leds.length;

/** Forma original como caminho de células (com o espelhamento atual), ponto de partida para moldar. */
export function defaultPath(item, t) {
  return item.leds.map(([x, y]) => [t.invertX ? item.w - 1 - x : x, t.invertY ? item.h - 1 - y : y]);
}

/** Posição do LED (pela célula da grade) dentro do item, antes da rotação e do deslocamento, com espelhamento. */
export function ledLocal(item, t, lx, ly) {
  const s = t.scale, W = item.w * s, H = item.h * s;
  let px = (lx + 0.5) * s, py = (ly + 0.5) * s;
  if (t.invertX) px = W - px;
  if (t.invertY) py = H - py;
  return [px, py];
}
/** Posição local do LED i (pela forma livre, se houver). */
export function ledLocalAt(item, t, i) {
  if (hasPath(item, t)) { const [x, y] = t.path[i]; return [(x + 0.5) * t.scale, (y + 0.5) * t.scale]; }
  const [lx, ly] = item.leds[i];
  return ledLocal(item, t, lx, ly);
}

/** Caixa do item em coordenadas locais (px): a grade original, ou as células ocupadas pela forma livre. */
export function localBox(item, t) {
  const s = t.scale;
  if (!hasPath(item, t)) return { x0: 0, y0: 0, x1: item.w * s, y1: item.h * s };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of t.path) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0: x0 * s, y0: y0 * s, x1: (x1 + 1) * s, y1: (y1 + 1) * s };
}
/** Centro local (px) em torno do qual o item gira. */
export function localCenter(item, t) { const b = localBox(item, t); return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2]; }

/** Ponto local (px) → canvas (rotação em torno do centro + deslocamento). */
export function localToCanvas(item, t, [px, py]) {
  const [cx, cy] = localCenter(item, t);
  const a = (t.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const dx = px - cx, dy = py - cy;
  return [t.x + cx + dx * cos - dy * sin, t.y + cy + dx * sin + dy * cos];
}
/** Canvas → ponto local (px): o inverso de localToCanvas. */
export function canvasToLocal(item, t, [x, y]) {
  const [cx, cy] = localCenter(item, t);
  const a = -(t.rotation || 0) * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
  const dx = x - t.x - cx, dy = y - t.y - cy;
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** Converte posição de LED (célula da grade do item) em coordenada do canvas. */
export function ledToCanvas(item, t, lx, ly) { return localToCanvas(item, t, ledLocal(item, t, lx, ly)); }
/** Coordenada do canvas do LED i (respeita a forma livre). */
export function ledIndexToCanvas(item, t, i) { return localToCanvas(item, t, ledLocalAt(item, t, i)); }

/**
 * Um passo da "cobrinha": a cabeça (ou a cauda) anda célula por célula até o alvo e o corpo vem atrás, como no jogo.
 * Nunca entra numa célula ocupada pela própria fita (tenta o outro eixo; sem saída, para ali).
 */
export function snakeTo(path, fromHead, target) {
  let p = fromHead ? path.slice() : path.slice().reverse();
  for (let n = 0; n < 400; n++) {
    const [hx, hy] = p[0], dx = target[0] - hx, dy = target[1] - hy;
    if (!dx && !dy) break;
    const body = new Set(p.slice(0, -1).map(q => q[0] + ',' + q[1])); // a ponta de trás sai do lugar neste passo
    const tries = Math.abs(dx) >= Math.abs(dy) ? [[Math.sign(dx), 0], [0, Math.sign(dy)]] : [[0, Math.sign(dy)], [Math.sign(dx), 0]];
    const step = tries.find(([sx, sy]) => (sx || sy) && !body.has((hx + sx) + ',' + (hy + sy)));
    if (!step) break;
    p = [[hx + step[0], hy + step[1]], ...p.slice(0, -1)];
  }
  return fromHead ? p : p.reverse();
}

/** Direção (passo unitário num eixo) do ponto a até o ponto b: o eixo de maior distância; sem distância, o fallback. */
function axisStep(a, b, fallback = [1, 0]) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (!dx && !dy) return fallback;
  return Math.abs(dx) >= Math.abs(dy) ? [Math.sign(dx), 0] : [0, Math.sign(dy)];
}

/**
 * Régua: o trecho i..j vira uma linha reta no eixo dominante, com o mesmo número de LEDs (como esticar o pedaço
 * torto de uma fita de verdade: ele fica mais comprido). O resto da fita acompanha sem mudar de forma; fica parado o
 * lado com mais LEDs, para mexer o mínimo no desenho.
 */
export function straightenRange(path, i, j) {
  if (i > j) [i, j] = [j, i];
  const n = path.length;
  if (j - i < 1) return path;
  const out = path.map(p => p.slice());
  const a = path[i], b = path[j];
  // direção da fita logo antes do trecho (ou logo depois, se o trecho começa na ponta)
  const before = i > 0 ? [a[0] - path[i - 1][0], a[1] - path[i - 1][1]] : j < n - 1 ? [path[j + 1][0] - b[0], path[j + 1][1] - b[1]] : [path[i + 1][0] - a[0], path[i + 1][1] - a[1]];
  // trecho que volta quase ao mesmo lugar (laço, volta em U): o início e o fim não dizem a direção, então continua a
  // reta que vinha antes da volta. Senão, a reta vai do início em direção ao fim.
  const net = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
  const [sx, sy] = net * 3 < j - i ? axisStep([0, 0], before) : axisStep(a, b, before);
  if (i >= n - 1 - j) {
    for (let k = i + 1; k <= j; k++) out[k] = [a[0] + sx * (k - i), a[1] + sy * (k - i)];
    const ox = out[j][0] - b[0], oy = out[j][1] - b[1];
    for (let k = j + 1; k < n; k++) out[k] = [path[k][0] + ox, path[k][1] + oy];
  } else {
    for (let k = j - 1; k >= i; k--) out[k] = [b[0] - sx * (j - k), b[1] - sy * (j - k)];
    const ox = out[i][0] - a[0], oy = out[i][1] - a[1];
    for (let k = 0; k < i; k++) out[k] = [path[k][0] + ox, path[k][1] + oy];
  }
  return out;
}

/** A fita passa duas vezes pela mesma célula? */
export const pathOverlaps = path => new Set(path.map(p => p[0] + ',' + p[1])).size !== path.length;

/** Caixa delimitadora (canvas) do item considerando rotação. */
export function itemBounds(item, t) {
  const bx = localBox(item, t);
  const pts = [[bx.x0, bx.y0], [bx.x1, bx.y0], [bx.x0, bx.y1], [bx.x1, bx.y1]].map(p => localToCanvas(item, t, p));
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Organiza os itens sem sobreposição (empacotamento em prateleiras), ajustando a escala para caber no canvas.
 * Componentes de um mesmo canal ficam juntos, na ordem da cadeia.
 */
export function autoArrange(items) {
  const W = working();
  const M = 4;
  const list = items.map(it => ({ it, base: Number(it.defaultScale) || Math.max(2, Math.min(10, CANVAS_W / 2 / Math.max(it.w, it.h * CANVAS_W / CANVAS_H))) }));
  list.sort((a, b) => (a.it.kind === 'component') - (b.it.kind === 'component') || (b.it.w * b.it.h * b.base ** 2) - (a.it.w * a.it.h * a.base ** 2));
  const tryPack = f => {
    let x = M, y = M, rowH = 0;
    const pos = [];
    for (const { it, base } of list) {
      const s = Math.max(1, base * f), w = it.w * s, h = it.h * s;
      if (x + w > CANVAS_W - M && x > M) { x = M; y += rowH + M; rowH = 0; }
      if (w > CANVAS_W - 2 * M) return null;
      pos.push({ it, x, y, s });
      x += w + M; rowH = Math.max(rowH, h);
    }
    return y + rowH <= CANVAS_H - M ? pos : null;
  };
  let f = 1.6, pos = null;
  while (f > 0.05 && !(pos = tryPack(f))) f *= 0.9;
  if (!pos) return false;
  for (const p of pos) {
    const t = W.items[p.it.key] || {};
    W.items[p.it.key] = { ...t, x: +p.x.toFixed(2), y: +p.y.toFixed(2), scale: +p.s.toFixed(2), rotation: 0, invertX: !!t.invertX, invertY: !!t.invertY, hidden: false, z: 0 };
  }
  persistWorking();
  return true;
}

export function layoutNames() { return Object.keys(app.store.layouts.list); }

export function isDirty() {
  const L = app.store.layouts;
  return JSON.stringify(L.list[L.current] || {}) !== JSON.stringify(working());
}

export function saveLayout(name = app.store.layouts.current) {
  const L = app.store.layouts;
  L.list[name] = JSON.parse(JSON.stringify(working()));
  L.current = name;
  set('layouts', L);
  emit('layout');
}

export function loadLayout(name) {
  const L = app.store.layouts;
  if (!L.list[name]) return;
  L.current = name;
  L.working = JSON.parse(JSON.stringify(L.list[name]));
  set('layouts', L);
  emit('layout');
}

/** Cria um layout vazio e passa a usá-lo. */
export function newLayout(name) {
  app.store.layouts.list[name] = emptyLayout();
  loadLayout(name);
}

export function deleteLayout(name) {
  const L = app.store.layouts;
  delete L.list[name];
  if (!Object.keys(L.list).length) L.list['Padrão'] = emptyLayout(); // i18n-dado
  if (L.current === name) { L.current = Object.keys(L.list)[0]; L.working = JSON.parse(JSON.stringify(L.list[L.current])); }
  set('layouts', L);
  emit('layout');
}

export function layoutBrightness() { return Number(working().brightness ?? 100); }
/** Arrastando o controle: só aplica; ao soltar (persist): grava o layout inteiro uma vez. */
export function setLayoutBrightness(v, { persist = false } = {}) { working().brightness = v; if (persist) persistWorking(); }

export function globalBrightness() { return Number(get('globalBrightness') ?? 100); }
export function setGlobalBrightness(v, { persist = false } = {}) {
  if (persist) set('globalBrightness', v); else app.store.globalBrightness = v;
}

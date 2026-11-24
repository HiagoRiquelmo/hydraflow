// Mixer da tela Ambiente da Tela com "Som do PC": colunas de volume por faixa de frequência (grave → agudo), em
// segmentos como os de uma mesa de som, pintadas com a paleta do clima da música que está tocando (as três cores
// sobem de baixo para cima, como verde → amarelo → vermelho num mixer de verdade). Em cima de cada coluna, o
// "teto": o pico recente, que segura um instante e cai devagar. Cores sólidas, sem degradê (mesma linguagem do app).
// Leve: ~30 quadros/s num canvas, só enquanto está na tela; para quando a tela fecha ou a janela se esconde.

const SEGMENTS = 9; // menos fileiras: cubos maiores, quase quadrados
const IDLE = 'rgba(255, 255, 255, 0.05)';
const CAP = '#E4E4E1';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/**
 * Vizinho de cor: gira o matiz ~40° na direção "quente" (vermelho → laranja → âmbar, azul → ciano) e acende um
 * pouco, mantendo a saturação. (1.1: antes clareava rumo ao branco, e vermelho clareado vira salmão/rosa.)
 */
function neighbor(c) {
  const [r, g, b] = c.map(v => v / 255), mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + (h * 60 >= 200 && h * 60 < 300 ? -40 : 40) + 360) % 360; // azul/roxo gira para o ciano; o resto para o quente
  const s = Math.max(0.6, d / (mx || 1)), v = Math.min(1, mx * 1.15 + 0.08);
  const f = n => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return [f(5), f(3), f(1)];
}
/**
 * As três cores do clima às vezes saem quase iguais (ou o clímax roxo/índigo/marinho): aí o mixer parecia ter uma
 * ou duas cores. Cada faixa precisa ser visivelmente diferente da de baixo — quando não é, vira a vizinha de cor da
 * anterior.
 */
function distinct(pal) {
  const out = pal.map(c => c.slice());
  for (let i = 1; i < 3; i++) {
    for (let j = 0; j < i; j++) if (dist(out[i], out[j]) < 70) { out[i] = neighbor(out[i - 1]); break; }
  }
  return out;
}

/** container: elemento onde o canvas fica; source(): { bands, peaks, palette, silent } ou null. Devolve destroy(). */
export function createMixer(container, source) {
  const canvas = document.createElement('canvas');
  canvas.className = 'mixer-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  container.append(canvas);
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;
  let shown = ''; // o que está desenhado: só redesenha quando um segmento, um teto ou uma cor muda
  const fit = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = container.clientWidth; h = container.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr)); canvas.height = Math.max(1, Math.round(h * dpr));
    shown = '';
  };
  const ro = new ResizeObserver(fit); ro.observe(container); fit();

  const round = (x, y, rw, rh, r) => { ctx.beginPath(); ctx.roundRect(x, y, rw, rh, r); ctx.fill(); };

  function draw() {
    if (w < 60 || h < 60) { fit(); if (w < 60 || h < 60) return; } // camada ainda escondida / sem tamanho
    const s = source();
    const on = s && !s.silent;
    const lits = [], caps = [];
    for (let b = 0; b < (s?.bands?.length || 16); b++) {
      lits.push(on ? Math.round((s.bands[b] || 0) * SEGMENTS) : 0);
      caps.push(on && s.peaks[b] > 0.02 ? Math.min(SEGMENTS, Math.max(1, Math.round(s.peaks[b] * SEGMENTS))) : 0);
    }
    const key = `${lits}|${caps}|${s?.palette}`;
    if (key === shown) return;
    shown = key;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const n = s?.bands?.length || 16;
    const padX = Math.max(18, w * 0.05), padTop = Math.max(22, h * 0.09), padBottom = Math.max(18, h * 0.07);
    const colGap = Math.max(6, (w - padX * 2) * 0.012);
    const colW = (w - padX * 2 - colGap * (n - 1)) / n;
    const segGap = Math.max(3, h * 0.008);
    const segH = (h - padTop - padBottom - segGap * (SEGMENTS - 1)) / SEGMENTS;
    if (colW < 2 || segH < 2) return;
    const r = Math.max(0, Math.min(6, segH / 2.5, colW / 6));
    const pal = distinct(s?.palette || [[120, 120, 130], [150, 150, 160], [190, 190, 200]]);
    // três faixas como num mixer de verdade (verde → amarelo → vermelho): 4 segmentos embaixo, 3 no meio, 2 no topo
    // (antes o topo tinha 1 segmento só, que quase nunca acendia — na prática apareciam 2 cores)
    const css = pal.map(c => `rgb(${c[0]},${c[1]},${c[2]})`);
    const color = k => css[k < 4 ? 0 : k < 7 ? 1 : 2];
    for (let b = 0; b < n; b++) {
      const x = padX + b * (colW + colGap);
      const lit = lits[b];
      for (let k = 0; k < SEGMENTS; k++) {
        const y = h - padBottom - (k + 1) * segH - k * segGap;
        ctx.fillStyle = k < lit ? color(k) : IDLE;
        round(x, y, colW, segH, r);
      }
      // teto: fino, na altura do pico recente
      if (caps[b]) {
        const pk = caps[b];
        const y = h - padBottom - pk * (segH + segGap) - Math.max(3, segGap * 1.2);
        ctx.fillStyle = CAP;
        round(x, y, colW, Math.max(3, segH * 0.28), r);
      }
    }
  }

  let timer = null;
  const tick = () => { if (!document.hidden) draw(); };
  timer = setInterval(tick, 33);
  draw();
  return () => { clearInterval(timer); ro.disconnect(); canvas.remove(); };
}

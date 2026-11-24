// Efeitos rodam em iframes isolados (effect-host.html) e devolvem quadros RGBA do canvas.
import { emit, on } from './state.js';
import { ScreenFrame } from './screenSource.js';
import { t } from './i18n.js';

import { CANVAS_W, CANVAS_H } from './canvas.js';

/**
 * Um efeito rodando num iframe. Fala o protocolo do effect-host.html:
 * host → 'ready'; nós → 'load' { html, cfg }; host → 'frame' | 'samples' | 'console';
 * nós → 'param' | 'speed' | 'pause' | 'full' (liga/desliga quadros inteiros) | 'gather' (pixels sob os LEDs).
 * O host só captura o canvas quando alguém quer quadros (cfg.full) ou amostras (cfg.gather).
 */
export class EffectFrame {
  /**
   * fit: 'width' (prévia acompanha a largura do contêiner), 'cover' (preenche o contêiner inteiro, cortando as sobras —
   * cartões em pé) ou 'none' (tamanho real, para hosts invisíveis).
   */
  constructor(container, { html, cfg = {}, onFrame, onSamples, onConsole, fit = 'width' }) {
    this.container = container;
    this.fitMode = fit;
    this.cfg = { fps: 60, ...cfg, w: CANVAS_W, h: CANVAS_H };
    const f = this.iframe = document.createElement('iframe');
    f.setAttribute('sandbox', 'allow-scripts');
    f.setAttribute('title', t('playback.frameTitle'));
    f.src = 'effect-host.html';
    Object.assign(f.style, { width: CANVAS_W + 'px', height: CANVAS_H + 'px', border: '0', position: 'absolute', left: '0', top: '0', transformOrigin: '0 0', pointerEvents: 'none' });
    this.onMsg = e => {
      if (e.source !== f.contentWindow) return;
      const d = e.data || {};
      if (d.__fx === 'ready') {
        // o 'load' vira JSON dentro do host (Int32Array não sobrevive): a tabela de amostragem vai à parte
        const { gather, ...cfg } = this.cfg;
        this.post({ __fx: 'load', html, cfg });
        if (gather) this.post({ __fx: 'gather', gather });
      }
      else if (d.__fx === 'frame' && d.data instanceof ArrayBuffer && d.data.byteLength === CANVAS_W * CANVAS_H * 4) onFrame?.(new Uint8ClampedArray(d.data));
      else if (d.__fx === 'samples' && d.data instanceof ArrayBuffer) onSamples?.(d.v, new Uint8Array(d.data));
      else if (d.__fx === 'console') onConsole?.(d);
    };
    window.addEventListener('message', this.onMsg);
    container.append(f);
    this.syncDriver();
    if (fit !== 'none') {
      this.ro = new ResizeObserver(() => this.fit());
      this.ro.observe(container);
      this.fit();
    }
  }

  fit() {
    const cw = this.container.clientWidth, ch = this.container.clientHeight;
    if (this.fitMode !== 'cover') { this.iframe.style.transform = `scale(${cw / CANVAS_W})`; return; }
    const k = Math.max(cw / CANVAS_W, ch / CANVAS_H);
    this.iframe.style.transform = `translate(${(cw - CANVAS_W * k) / 2}px, ${(ch - CANVAS_H * k) / 2}px) scale(${k})`;
  }

  post(msg) { this.iframe.contentWindow?.postMessage(msg, '*'); }

  /**
   * Efeito ativo: o iframe fica fora da tela (o Chromium não pinta nada dele, ~3% de um núcleo a menos) e lá os timers
   * do navegador seriam segurados em 1/s — então a janela marca o ritmo com uma mensagem por quadro. Só enquanto
   * alguém lê o efeito (dispositivos ou prévia); pausado, 4×/s bastam para um ajuste mudado chegar aos LEDs.
   */
  syncDriver() {
    if (this.fitMode !== 'none') return; // prévias visíveis marcam o próprio ritmo
    const wanted = this.cfg.full || this.cfg.gather?.idx?.length > 0;
    const ms = !wanted ? 0 : this.cfg.paused ? 250 : 1000 / this.cfg.fps;
    if (ms === this.driverMs) return;
    clearInterval(this.driver); this.driver = null; this.driverMs = ms;
    if (ms) this.driver = setInterval(() => this.post({ __fx: 'tick' }), ms);
  }

  /** Também vale para um 'load' que ainda não aconteceu. */
  setParam(name, value) { this.cfg.params = { ...this.cfg.params, [name]: value }; this.post({ __fx: 'param', name, value }); }
  setSpeed(value) { this.cfg.speed = value; this.post({ __fx: 'speed', value }); }
  setPaused(paused) { this.cfg.paused = paused; this.post({ __fx: 'pause', paused }); this.syncDriver(); }
  setFull(on) { this.cfg.full = on; this.post({ __fx: 'full', on }); this.syncDriver(); }
  setGather(gather) { this.cfg.gather = gather; this.post({ __fx: 'gather', gather }); this.syncDriver(); }

  destroy() { clearInterval(this.driver); window.removeEventListener('message', this.onMsg); this.ro?.disconnect(); this.iframe.remove(); }
}

export function framePng(px) {
  const c = document.createElement('canvas');
  c.width = CANVAS_W; c.height = CANVAS_H;
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px), CANVAS_W, CANVAS_H), 0, 0);
  return c.toDataURL('image/png');
}

/**
 * O efeito ativo: é dele que saem as cores enviadas aos dispositivos.
 * Para os dispositivos ele manda só as amostras sob os LEDs ('samples'); quadros inteiros ('frame')
 * só enquanto alguém pediu com wantFrames() — atravessar 256 KB por quadro entre processos é o que mais pesa.
 */
class EffectRunner {
  constructor() {
    this.host = null;
    this.frame = null;
    this.paused = false;
    this.latest = new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4); // último quadro inteiro recebido
    this.samples = null;      // { v, data } últimas amostras sob os LEDs
    this.gather = null;       // { v, idx } tabela atual de amostragem
    this.lastSampleAt = 0;
    this.frameWanted = 0;     // quantos pediram quadros inteiros
    this.consoleLines = [];
  }

  mount(hostEl) { this.host = hostEl; }

  /** Liga os quadros inteiros enquanto houver interessados. Devolve a função que desliga. */
  wantFrames() {
    if (this.frameWanted++ === 0) this.frame?.setFull(true);
    let done = false;
    return () => { if (!done && --this.frameWanted === 0) this.frame?.setFull(false); done = true; };
  }

  /** O próximo quadro inteiro (ou null se nenhum chegar em 3 s). */
  nextFrame() {
    return new Promise(resolve => {
      const release = this.wantFrames();
      const finish = px => { clearTimeout(t); off(); release(); resolve(px); };
      const t = setTimeout(() => finish(null), 3000);
      const off = on('frame', finish);
    });
  }

  /** idx: deslocamento RGBA de cada pixel a amostrar (-1 = nenhum). */
  setGather(idx) {
    this.gather = { v: (this.gather?.v || 0) + 1, idx };
    this.frame?.setGather(this.gather);
  }

  /** screen: o efeito é o Ambiente da Tela (marcado pelo catálogo) — a fonte das cores vira a captura da tela. */
  load(html, params, speed = 1, { screen = false } = {}) {
    this.frame?.destroy();
    this.clearConsole();
    // cores do efeito anterior não valem para o novo (se o novo falhar, os LEDs não ficam presos nelas)
    this.samples = null; this.lastSampleAt = 0;
    // a imagem do efeito anterior também não vale: a última captura do Ambiente da Tela (que pode mostrar a própria
    // janela do Hydraflow, com a cena Lo-Fi) ficava na prévia da Iluminação até o novo efeito mandar um quadro
    this.latest = new Uint8ClampedArray(CANVAS_W * CANVAS_H * 4);
    emit('frame', this.latest);
    // quadros/amostras que ainda cheguem da fonte anterior (já destruída) são ignorados
    const token = this.token = {};
    const mine = () => this.token === token;
    const Source = screen ? ScreenFrame : EffectFrame;
    this.frame = new Source(this.host, {
      html, fit: 'none',
      cfg: { params: { ...params }, speed, paused: this.paused, captureFps: 30, full: this.frameWanted > 0, gather: this.gather },
      onFrame: px => { if (!mine()) return; this.latest = px; emit('frame', px); },
      onSamples: (v, data, realtime) => { if (!mine()) return; this.samples = { v, data, realtime }; this.lastSampleAt = performance.now(); emit('samples', this.samples); },
      onConsole: d => {
        if (d.level === 'clear') this.consoleLines = [];
        else {
          this.consoleLines.push({ t: Date.now(), level: d.level, msg: String(d.msg).slice(0, 2000) });
          if (this.consoleLines.length > 400) this.consoleLines.splice(0, 100);
        }
        emit('fxconsole', d);
      }
    });
  }

  clearConsole() { this.consoleLines = []; emit('fxconsole', null); }
  setParam(name, value) { this.frame?.setParam(name, value); }
  setSpeed(s) { this.frame?.setSpeed(s); }
  setPaused(p) { this.paused = !!p; this.frame?.setPaused(this.paused); }
}

export const runner = new EffectRunner();

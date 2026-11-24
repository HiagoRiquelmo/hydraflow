// Ambiente da Tela: em vez de rodar um efeito, captura a tela do PC e manda para os LEDs as cores que estão
// embaixo de cada um (uma explosão clara no jogo acende o setup; uma cena escura apaga).
// Tem a mesma interface do EffectFrame (setParam, setSpeed, setPaused, setFull, setGather, destroy), então o
// EffectRunner troca um pelo outro sem o resto do app perceber. A imagem capturada nunca sai deste processo.
// Os parâmetros (e seus padrões) vêm do <meta> de effects/Basicos/Ambiente da Tela.html.
import { CANVAS_W as W, CANVAS_H as H } from './canvas.js';
import { SoundReact, moodColor } from './soundReact.js';
import { t } from './i18n.js';

// "Detalhe" (na ordem das opções do <meta>): tamanho da miniatura em que a tela é reduzida — cada pixel dela é a
// média de uma região, e ampliar de volta com suavização espalha essa média sob os LEDs
const DETAIL = [[1, 1], [16, 10], [40, 25], [96, 60]];
const DETAIL_VALUES = ['Uma cor só', 'Baixo', 'Médio', 'Alto']; // i18n-dado
// redução com média de verdade; mudar o tamanho de um canvas zera este ajuste, então vale de novo a cada mudança
const smooth = c => { c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; };

// "Reagir ao som" tem duas funções: 'Nenhuma' (Tela: os LEDs copiam o monitor) e 'Som do PC' (só a música).
// Os valores guardados são os do <meta values> do efeito, iguais em qualquer idioma.
export const isSoundMode = p => p.react === 'Som do PC'; // i18n-dado
/** Ajustes de cada função; as telas (Ambiente da Tela e Iluminação) mostram 'react' e só os da função escolhida. */
export const SCREEN_PARAMS = {
  image: ['detail', 'saturation', 'brightness', 'smoothing'],
  sound: ['reactBrightness', 'pulseIntensity'],
  calib: ['biasValence', 'biasEnergy'] // biasEnergy = "Calibrar Calmo ↔ Raiva" (chave antiga, ajuste salvo vale)
};
export const screenParamShown = (name, p) => name === 'react' || (isSoundMode(p) ? [...SCREEN_PARAMS.sound, ...SCREEN_PARAMS.calib] : SCREEN_PARAMS.image).includes(name);

export class ScreenFrame {
  constructor(_container, { cfg = {}, onFrame, onSamples, onConsole }) {
    this.fps = cfg.captureFps || 30;
    this.p = { ...cfg.params };
    this.on = { onFrame, onSamples, onConsole };
    this.full = !!cfg.full; this.gather = cfg.gather || null; this.paused = !!cfg.paused;
    this.dirty = true; // processa uma vez mesmo pausado (efeito recém-escolhido, layout ou ajuste mudou)
    this.state = null; this.lastSent = null; this.dead = false;
    this.half = document.createElement('canvas'); this.halfCtx = this.half.getContext('2d');
    this.small = document.createElement('canvas'); this.smallCtx = this.small.getContext('2d');
    this.big = document.createElement('canvas'); this.big.width = W; this.big.height = H;
    this.bigCtx = this.big.getContext('2d', { willReadFrequently: true });
    [this.halfCtx, this.smallCtx, this.bigCtx].forEach(smooth);
    if (this.musicOnly) this.syncSound(); else this.start();
    this.loop();
  }

  /**
   * "Som do PC": as luzes contam SÓ a música. O fundo é neutro (preto) — antes as cores da tela (papel de parede do
   * Windows, janelas) vazavam para os LEDs por baixo da paleta. Nesse modo a captura da tela nem roda.
   */
  get musicOnly() { return isSoundMode(this.p); }

  /** Liga/desliga a captura da tela conforme o modo (só imagem ↔ só música). */
  syncCapture() {
    if (this.dead) return;
    if (this.musicOnly) { clearTimeout(this.retry); if (this.native) this.dropNative(); this.stop(); this.video = null; }
    else if (!this.native && !this.video && !this.stream) this.start();
  }

  // 1º: captura nativa DXGI (src/capture/dxgiCapture.js) — baixa latência, a placa de vídeo faz a média;
  // se não der (placa sem suporte, área de trabalho remota), cai para a captura do Chromium (startVideo)
  // A partida é assíncrona: se a pessoa trocar para "Som do PC" (ou desligar) no meio dela, a captura que acabou de
  // subir é devolvida na hora — antes ela ficava rodando escondida (CPU e placa de vídeo) até fechar o app.
  get wantsScreen() { return !this.dead && !this.musicOnly; }
  async start() {
    if (this.starting) return; // syncCapture chamado de novo enquanto a partida anterior não terminou
    this.starting = true;
    try { await this.startNow(); } finally { this.starting = false; }
  }
  async startNow() {
    if (!this.wantsScreen) return;
    try {
      // teto de 125 quadros/s: a captura nativa lê cada quadro assim que o Windows o apresenta (o laço daqui, a
      // this.fps, só cobre ajustes e a reação ao som)
      const r = await window.api.screen.startNative(125);
      if (!this.wantsScreen) { if (r?.ok) window.api.screen.stopNative(); return; }
      if (r?.ok) {
        this.native = document.createElement('canvas');
        this.nativeCtx = this.native.getContext('2d');
        this.offFrame = window.api.screen.onFrame(f => this.onNativeFrame(f));
        this.offStatus = window.api.screen.onNativeStatus(s => {
          if (s.ok || this.dead || !this.native) return;
          this.dropNative();
          this.on.onConsole?.({ level: 'warn', msg: t('screen.nativeStopped', { error: s.error }) });
          this.startVideo();
        });
        this.syncSound();
        return;
      }
      this.on.onConsole?.({ level: 'warn', msg: t('screen.nativeUnavailable', { error: r?.error || '?' }) });
    } catch (e) { this.on.onConsole?.({ level: 'warn', msg: t('screen.nativeUnavailable', { error: e.message || '?' }) }); }
    await this.startVideo();
  }

  /** Quadro novo da captura nativa: processa na hora (menor atraso entre a tela e os LEDs). */
  onNativeFrame(f) {
    if (this.dead || !this.native) return;
    if (this.native.width !== f.w || this.native.height !== f.h) { this.native.width = f.w; this.native.height = f.h; }
    this.nativeCtx.putImageData(new ImageData(new Uint8ClampedArray(f.data.buffer, f.data.byteOffset, f.w * f.h * 4), f.w, f.h), 0, 0);
    this.hasFrame = true;
    if (!this.paused && (this.gather || this.full)) { this.dirty = false; this.process(); }
  }

  dropNative() { this.offFrame?.(); this.offStatus?.(); this.offFrame = this.offStatus = null; this.native = null; this.hasFrame = false; window.api.screen.stopNative(); }

  /** Som do PC (para "Reagir a jogos"): o Windows só entrega o som junto de uma captura de tela; a imagem é descartada. */
  async audio() {
    if (this.stream?.getAudioTracks().length) return this.stream;
    if (this.audioStream) return this.audioStream;
    const id = await window.api.screen.source();
    const s = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: 32, maxHeight: 18, maxFrameRate: 1 } } });
    s.getVideoTracks().forEach(t => t.stop());
    if (this.dead) { s.getTracks().forEach(t => t.stop()); return null; }
    return (this.audioStream = s);
  }

  async startVideo() {
    if (!this.wantsScreen) return; // tentativa agendada de antes da troca de modo
    try {
      const id = await window.api.screen.source();
      if (!id) throw new Error(t('screen.noScreen'));
      // a captura já sai pequena do próprio Windows: pouco trabalho por quadro. O som do PC vem junto (para
      // "Reagir a jogos"); se o Windows não liberar o som, segue só com a imagem.
      const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: id, maxWidth: W, maxHeight: H, maxFrameRate: this.fps } };
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { mandatory: { chromeMediaSource: 'desktop' } }, video })
        .catch(() => navigator.mediaDevices.getUserMedia({ audio: false, video }));
      if (!this.wantsScreen) { stream.getTracks().forEach(t => t.stop()); return; }
      this.stream = stream;
      // monitor desligado, resolução trocada, PC bloqueado: a captura termina — tenta de novo
      stream.getVideoTracks()[0].onended = () => { if (!this.dead) { this.stop(); this.retry = setTimeout(() => this.startVideo(), 2000); } };
      this.video = Object.assign(document.createElement('video'), { muted: true, srcObject: stream });
      await this.video.play();
      this.syncSound();
    } catch (e) {
      if (this.dead) return; // destruído no meio do caminho: o erro não é do efeito seguinte
      this.on.onConsole?.({ level: 'error', msg: t('screen.captureError', { error: e.message || e }) });
      this.retry = setTimeout(() => this.startVideo(), 5000);
    }
  }

  // timer, não requestVideoFrameCallback: com a janela minimizada o Chromium segura esse callback em ~1 por segundo.
  // Captura nativa: os quadros já chegam prontos (onNativeFrame); o timer só cobre ajuste mudado e a reação ao som.
  loop() {
    const ms = 1000 / this.fps;
    const step = () => {
      if (this.dead) return;
      const t0 = performance.now();
      const music = this.musicOnly;
      const ready = music || (this.native ? this.hasFrame : this.video?.readyState >= 2);
      // com reação ao som a cor precisa mexer mesmo com a tela parada — mas sem repetir um quadro recém-processado
      const due = (music || this.native) ? (this.dirty || (this.sound && !this.paused && t0 - (this.lastProcess || 0) > ms * 0.8)) : (!this.paused || this.dirty);
      if (ready && due && (this.gather || this.full)) { this.dirty = false; this.process(); }
      // ninguém lendo a imagem (sem dispositivos, ou só o mixer na tela): o clima da música segue atualizando
      else if (this.sound && !this.paused && !(this.gather || this.full)) this.sound.state(this.p);
      this.timer = setTimeout(step, Math.max(1, ms - (performance.now() - t0)));
    };
    step();
  }

  /** Liga a análise do som só enquanto um modo de reação estiver escolhido. */
  async syncSound() {
    const want = this.musicOnly;
    if (want && !this.sound) {
      const s = await this.audio().catch(() => null);
      if (!s?.getAudioTracks().length || this.sound || this.dead || !this.musicOnly) return;
      this.audioCtx = new AudioContext();
      this.sound = new SoundReact(this.audioCtx, this.audioCtx.createMediaStreamSource(s));
    } else if (!want && this.sound) this.stopSound();
  }
  stopSound() { this.sound?.destroy(); this.sound = null; this.audioCtx?.close(); this.audioCtx = null; }

  /** Para a tela do Ambiente da Tela: se há som capturado e o clima que o detector está ouvindo. */
  get reactInfo() {
    const s = this.stream?.getAudioTracks().length ? this.stream : this.audioStream;
    return { audio: !!s?.getAudioTracks().length, ...(this.sound?.info || {}) };
  }

  process() {
    this.lastProcess = performance.now();
    if (this.musicOnly) { this.processMusic(); return; }
    const [sw, sh] = DETAIL[Math.max(0, DETAIL_VALUES.indexOf(this.p.detail))] || DETAIL[2];
    const src = this.native || this.video;
    if (this.small.width !== sw || this.small.height !== sh) { this.small.width = sw; this.small.height = sh; smooth(this.smallCtx); }
    if (this.native) {
      // já é a média feita pela placa de vídeo (~120×68): só falta chegar ao "Detalhe" escolhido
      this.smallCtx.drawImage(this.native, 0, 0, sw, sh);
    } else {
      // reduz em dois passos (metade, depois o tamanho final) com qualidade alta: média de verdade, não 2×2 pixels soltos
      const vw = src.videoWidth || W, vh = src.videoHeight || H;
      const hw = Math.max(sw, vw >> 2), hh = Math.max(sh, vh >> 2);
      if (this.half.width !== hw || this.half.height !== hh) { this.half.width = hw; this.half.height = hh; smooth(this.halfCtx); }
      this.halfCtx.drawImage(src, 0, 0, hw, hh);
      this.smallCtx.drawImage(this.half, 0, 0, sw, sh);
    }
    // os LEDs leem direto da miniatura (poucos KB); a imagem 320×200 só existe quando a prévia está na tela
    if (this.gather) this.sendSamples(this.smallCtx.getImageData(0, 0, sw, sh).data, sw, sh);
    if (this.full) {
      this.bigCtx.drawImage(this.small, 0, 0, W, H);
      const data = this.bigCtx.getImageData(0, 0, W, H).data;
      for (let i = 0; i < data.length; i += 4) this.grade(data, i, data, i);
      this.on.onFrame?.(data);
    }
  }

  /**
   * "Som do PC": cada LED recebe a cor da paleta do clima na posição horizontal dele, vezes o "Brilho" da pessoa e
   * a presença da música (sem música, os LEDs apagam devagar). A tela não entra.
   */
  processMusic() {
    const re = this.sound && !this.paused ? this.sound.state(this.p) : null;
    const k = re ? Math.max(0.05, Math.min(1, (this.p.reactBrightness ?? 100) / 100)) * (re.presence ?? 1) : 0;
    const m = this.mc || (this.mc = [0, 0, 0]);
    if (this.gather) {
      const { v, idx } = this.gather, xs = this.ledX(), out = new Uint8Array(idx.length * 3);
      for (let i = 0, o = 0; i < idx.length; i++, o += 3) {
        if (idx[i] < 0 || !k) continue; // LED fora do layout (ou sem música): apagado
        moodColor(re, xs[i], m);
        for (let c = 0; c < 3; c++) out[o + c] = Math.round(Math.min(255, m[c] * k));
      }
      this.send(v, out);
    }
    if (this.full) {
      // prévia: a mesma paleta de ponta a ponta (uma coluna por x, repetida nas linhas)
      const img = this.musicImg || (this.musicImg = new ImageData(W, H)), d = img.data, row = W * 4;
      for (let x = 0; x < W; x++) {
        if (k) moodColor(re, x / W, m); else m[0] = m[1] = m[2] = 0;
        const i = x * 4; d[i] = m[0] * k; d[i + 1] = m[1] * k; d[i + 2] = m[2] * k; d[i + 3] = 255;
      }
      for (let y = 1; y < H; y++) d.copyWithin(y * row, 0, row);
      this.on.onFrame?.(new Uint8ClampedArray(d));
    }
  }

  /** Posição horizontal (0..1) de cada LED na tabela de amostragem atual. */
  ledX() {
    if (this.ledXv === this.gather.v) return this.ledXs;
    const idx = this.gather.idx, xs = new Float32Array(idx.length);
    for (let i = 0; i < idx.length; i++) if (idx[i] >= 0) xs[i] = ((idx[i] / 4) % W) / W;
    this.ledXv = this.gather.v; this.ledXs = xs;
    return xs;
  }

  /** Manda as cores aos LEDs só se mudaram. realtime: quadro de tela (vai na hora, sem o limite de ritmo dos efeitos). */
  send(v, out, realtime = false) {
    const ls = this.lastSent;
    if (ls && ls.v === v && ls.d.length === out.length && ls.d.every((x, i) => x === out[i])) return;
    this.lastSent = { v, d: out };
    this.on.onSamples?.(v, out, realtime);
  }

  /** Para cada LED: os 4 pixels vizinhos da miniatura e o peso de cada um (mistura suave entre regiões). */
  taps(sw, sh) {
    const key = `${this.gather.v}:${sw}x${sh}`;
    if (this.tapKey === key) return this.tapList;
    const idx = this.gather.idx, list = new Float32Array(idx.length * 8);
    for (let i = 0; i < idx.length; i++) {
      if (idx[i] < 0) { list[i * 8] = -1; continue; }
      const px = idx[i] / 4, x = px % W, y = (px - x) / W;
      const fx = Math.max(0, Math.min(sw - 1, (x + 0.5) * sw / W - 0.5)), fy = Math.max(0, Math.min(sh - 1, (y + 0.5) * sh / H - 0.5));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      list.set([(y0 * sw + x0) * 4, (y0 * sw + x1) * 4, (y1 * sw + x0) * 4, (y1 * sw + x1) * 4,
        (1 - ax) * (1 - ay), ax * (1 - ay), (1 - ax) * ay, ax * ay], i * 8);
    }
    this.tapKey = key; this.tapList = list;
    return list;
  }

  /** Saturação e brilho da imagem (src → dst, 3 canais a partir dos índices dados). */
  grade(src, si, dst, di) {
    const s = this.p.saturation / 100, b = this.p.brightness / 100;
    const l = 0.299 * src[si] + 0.587 * src[si + 1] + 0.114 * src[si + 2];
    for (let c = 0; c < 3; c++) dst[di + c] = Math.min(255, Math.max(0, (l + (src[si + c] - l) * s) * b));
  }

  sendSamples(small, sw, sh) {
    const { v, idx } = this.gather;
    const t = this.taps(sw, sh), mix = [0, 0, 0], cur = new Float32Array(idx.length * 3);
    for (let i = 0, o = 0; i < idx.length; i++, o += 3) {
      const b = i * 8;
      if (t[b] < 0) continue;
      for (let c = 0; c < 3; c++) mix[c] = small[t[b] + c] * t[b + 4] + small[t[b + 1] + c] * t[b + 5] + small[t[b + 2] + c] * t[b + 6] + small[t[b + 3] + c] * t[b + 7];
      this.grade(mix, 0, cur, o);
    }
    // suavização: acender é quase imediato (o clarão aparece na hora), apagar é gradual
    const k = this.p.smoothing / 100, st = this.state?.v === v ? this.state.d : null;
    if (k > 0 && st) for (let i = 0; i < cur.length; i++) cur[i] = st[i] + (cur[i] - st[i]) * (cur[i] > st[i] ? 1 - k * 0.3 : 1 - k * 0.92);
    this.state = { v, d: cur };
    const out = new Uint8Array(cur.length);
    for (let i = 0; i < cur.length; i++) out[i] = Math.round(cur[i]); // LED fora do layout: fica 0 (apagado)
    this.send(v, out, true);
  }

  setParam(name, value) { this.p[name] = value; this.dirty = true; if (name === 'react') { this.syncSound(); this.syncCapture(); } }
  setSpeed() {}
  setPaused(paused) { this.paused = !!paused; this.dirty = true; }
  setFull(on) { this.full = !!on; this.dirty = true; }
  setGather(gather) { this.gather = gather; this.state = null; this.lastSent = null; this.dirty = true; }
  stop() { this.stream?.getTracks().forEach(t => t.stop()); this.stream = null; if (this.video) this.video.srcObject = null; }
  destroy() {
    this.dead = true; clearTimeout(this.timer); clearTimeout(this.retry); this.stopSound(); this.stop();
    if (this.native) this.dropNative();
    this.audioStream?.getTracks().forEach(t => t.stop()); this.audioStream = null;
  }
}

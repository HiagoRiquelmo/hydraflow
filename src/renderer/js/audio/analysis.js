// CAMADA 1 — ANÁLISE DO ÁUDIO
// Recebe o som do PC (um nó do Web Audio) e mede, 50 vezes por segundo, características acústicas confiáveis.
// Não interpreta emoção nenhuma: só entrega números para a camada 2 (emotion.js). Tudo local; nada é enviado.
//
// Medidas (todas em `features`, atualizadas a cada passo de 20 ms; as harmônicas a cada 100 ms):
//   loudness      nível RMS em dB (rápido ~0,25 s) e o nível típico da música (~20 s, controle de ganho)
//   dynRange      faixa dinâmica dos últimos ~10 s (dB entre os trechos fortes e os fracos)
//   centroid      centroide espectral (Hz): timbre escuro ↔ brilhante
//   flux          fluxo espectral normalizado (0..1): o quanto o som está se transformando
//   percRatio     separação harmônico/percussivo (aproximação por mediana temporal): fração percussiva da energia
//   onsetRate     ataques por segundo (notas, batidas); beats = batidas do grave; bpm = andamento
//   flat, hf      planicidade (distorção/grito deixam o espectro "sujo") e fração de agudo áspero (2–6 kHz)
//   chroma        cromagrama (12 notas): tom maior/menor, acordes, power chords, dissonância, clareza harmônica
//   voice, lead   voz/melodia principal comparada ao acorde; linha solista trocando de nota depressa
//   bands/peaks   16 faixas do grave ao agudo para o mixer da tela
export const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
export const ema = (prev, next, dt, tau) => prev + (next - prev) * (1 - Math.exp(-dt / tau));
const BANDS = 16;

// perfis de tonalidade (Krumhansl & Kessler, 1982), a partir da tônica
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
// aspereza de cada intervalo (semitons 0..11; aproximação das curvas de Plomp-Levelt)
const ROUGH = [0, 1, 0.55, 0.2, 0.12, 0.05, 0.75, 0.05, 0.12, 0.2, 0.55, 1];
// nota da melodia em relação à tônica do acorde → choque com ele (acorde maior / menor)
const CLASH_MAJOR = [0, 1, 0.25, 0.85, 0, 0.3, 1, 0, 0.7, 0.25, 0.2, 0.55];
const CLASH_MINOR = [0, 1, 0.25, 0, 0.9, 0.3, 1, 0, 0.35, 0.3, 0.2, 0.75];

function corr(chroma, profile, tonic) {
  let mx = 0, my = 0;
  for (let i = 0; i < 12; i++) { mx += chroma[i]; my += profile[i]; }
  mx /= 12; my /= 12;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < 12; i++) {
    const x = chroma[(i + tonic) % 12] - mx, y = profile[i] - my;
    sxy += x * y; sxx += x * x; syy += y * y;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}

export class AudioAnalyzer {
  /** ctx: AudioContext; source: nó com o som. onFrame(dt, now) é chamado a cada passo (para a camada 2). */
  constructor(ctx, source) {
    this.an = ctx.createAnalyser();            // volume, ataques, timbre (resposta rápida)
    this.an.fftSize = 2048;
    this.an.smoothingTimeConstant = 0;
    this.anK = ctx.createAnalyser();           // notas (resolução de ~6 Hz para separar semitons no grave)
    this.anK.fftSize = 8192;
    this.anK.smoothingTimeConstant = 0.6;
    source.connect(this.an);
    source.connect(this.anK);
    const hz = ctx.sampleRate / this.an.fftSize;
    this.hz = hz; this.hzK = ctx.sampleRate / this.anK.fftSize;
    this.freq = new Float32Array(this.an.frequencyBinCount);
    this.freqK = new Float32Array(this.anK.frequencyBinCount);
    this.time = new Float32Array(this.an.fftSize);
    this.prev = new Float32Array(this.an.frequencyBinCount);
    this.harm = new Float32Array(this.an.frequencyBinCount); // parte "estável" de cada faixa (separação H/P)
    this.binMax = Math.min(this.freq.length - 1, Math.round(9000 / hz));
    this.bass = [Math.max(1, Math.round(35 / hz)), Math.round(160 / hz)];

    this.db = -100; this.dbFast = -100; this.dbLong = -30;
    this.fluxHist = []; this.bfluxHist = []; this.onsets = []; this.beats = [];
    this.lastOnset = 0; this.lastBeat = 0; this.beatAmp = 0;
    this.centroid = 1500; this.bpm = 0; this.fluxLevel = 0; this.fluxAvg = 1; this.percRatio = 0.3;
    this.dbRing = []; this.dynRange = 8; this.ringTimer = 0;
    this.chroma = new Float32Array(12); this.modeScore = 0;
    this.chordChroma = new Float32Array(12); this.minorRatio = 0.25; this.clarity = 0.5;
    this.presence = 0; this.silentSince = 0; this.quiet = true; this.musicTime = 0;
    this.flat = 0.15; this.hf = 0.1; this.vocRatio = 0.4; this.diss = 0.05;
    this.chordRoot = -1; this.chordMinor = false; this.chordClear = false; this.powerRatio = 0;
    this.voicePres = 0; this.voiceClash = 0.2;
    this.leadSemi = null; this.leadRate = 0; this.leadPres = 0;
    this.lastTick = performance.now(); this.tick = 0;
    // mixer: 16 faixas em escala de oitavas, com o nível típico de cada uma (o mixer mostra o quanto ela sobe/desce)
    this.bandEdges = Array.from({ length: BANDS + 1 }, (_, i) => Math.max(1, Math.round(45 * Math.pow(12000 / 45, i / BANDS) / hz)));
    this.bands = new Float32Array(BANDS); this.peaks = new Float32Array(BANDS); this.peakHold = new Float64Array(BANDS);
    this.bandAvg = new Float32Array(BANDS).fill(-60); this.bandDev = new Float32Array(BANDS).fill(6);
    this.listeners = [];
    this.bandsReadAt = 0;
    this.timer = setInterval(() => this.step(performance.now()), 20);
  }

  /** Inscreve quem quer ser avisado a cada passo (dt em s, now em ms). */
  onStep(fn) { this.listeners.push(fn); }

  step(now) {
    const dt = Math.min(0.2, (now - this.lastTick) / 1000); this.lastTick = now;
    this.an.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (const v of this.time) sum += v * v;
    this.db = 20 * Math.log10(Math.sqrt(sum / this.time.length) + 1e-9);
    this.dbFast = ema(this.dbFast, this.db, dt, 0.25);
    const silent = this.db < -62;
    this.silent = silent;
    // nível típico da música (~20 s); nos primeiros segundos de uma música aprende rápido — senão o começo de toda
    // música parecia mais forte (ou mais fraco) do que é, comparado ao nível da anterior
    if (!silent) this.dbLong = ema(this.dbLong, this.db, dt, this.musicTime < 6 ? 1.2 : 20);
    if (silent) { if (!this.silentSince) this.silentSince = now; } else this.silentSince = 0;
    this.quiet = !!(this.silentSince && now - this.silentSince > 1200);
    this.presence = ema(this.presence, this.quiet ? 0 : 1, dt, this.quiet ? 0.8 : 0.3);
    if (this.quiet) this.musicTime = 0; else if (!silent) this.musicTime += dt; // silêncio = música nova

    this.spectrum(now, dt, silent);
    this.updateDynamics(dt, silent);
    // faixas do mixer: só enquanto alguém as leu há pouco (o mixer na tela); na bandeja não são calculadas
    if (now - this.bandsReadAt < 1000) this.updateBands(now, this.quiet);
    if (++this.tick % 5 === 0) { this.updateChroma(); this.updateTempo(); }
    for (const fn of this.listeners) fn(dt, now);
  }

  /**
   * Uma passada no espectro: fluxo (geral e só no grave), centroide, planicidade, agudo áspero, faixa da voz e a
   * separação harmônico/percussivo. Separação H/P (aproximada, tempo real): a parte harmônica de cada faixa é o
   * que se mantém (média lenta, como o filtro de mediana "horizontal" do HPSS de Fitzgerald); o que salta acima
   * dela num quadro é percussivo (ataques de bateria espalham energia por todas as faixas de uma vez).
   */
  spectrum(now, dt, silent) {
    this.an.getFloatFrequencyData(this.freq);
    let rising = 0, flux = 0, bflux = 0, num = 0, den = 0, lsum = 0, psum = 0, nflat = 0, hfE = 0, totE = 0, vocE = 0, perc = 0, all = 0;
    for (let i = 1; i <= this.binMax; i++) {
      const amp = Math.pow(10, this.freq[i] / 20);
      const m = Math.log1p(1000 * amp); // magnitude comprimida: independe do volume
      const d = m - this.prev[i];
      this.prev[i] = m;
      if (d > 0) { flux += d; if (i >= this.bass[0] && i <= this.bass[1]) bflux += d; if (d > 0.3) rising++; }
      const h = this.harm[i] = this.harm[i] + (Math.min(m, this.harm[i] * 1.5 + 0.05) - this.harm[i]) * 0.12;
      perc += Math.max(0, m - h * 1.15); all += m;
      const f = i * this.hz;
      if (f > 60) { num += f * m; den += m; }
      if (f >= 60 && f <= 6000) {
        const pw = amp * amp;
        totE += pw;
        if (f >= 2000) hfE += pw;
        if (f >= 300 && f <= 3400) vocE += pw;
        // planicidade só na faixa da guitarra e da voz (300–2500 Hz): distorção e grito sujam esta faixa;
        // chimbal e pratos ficam acima dela
        if (f >= 300 && f <= 2500) { lsum += Math.log(pw + 1e-14); psum += pw; nflat++; }
      }
    }
    // quadros de ataque (batidas) não entram na medida de distorção: caixa e chimbal são ruído, mas passageiro
    const transient = flux > this.fluxAvg * 1.6;
    if (!silent) {
      if (den > 0) this.centroid = ema(this.centroid, num / den, dt, 1.5);
      if (nflat && totE > 0 && !transient) {
        this.flat = ema(this.flat, Math.exp(lsum / nflat) / (psum / nflat + 1e-14), dt, 1.5);
        this.hf = ema(this.hf, hfE / totE, dt, 1.5);
        this.vocRatio = ema(this.vocRatio, vocE / totE, dt, 1);
      }
      if (all > 0) this.percRatio = ema(this.percRatio, clamp(perc / all * 2.2), dt, 2);
      // fluxo relativo ao típico da própria música (~8 s) e absoluto: movimentação sonora 0..1
      this.fluxAvg = ema(this.fluxAvg, flux, dt, 8);
      this.fluxLevel = ema(this.fluxLevel, clamp(0.5 * flux / (this.fluxAvg * 2 + 1e-6) + 0.5 * clamp(flux / 60)), dt, 0.8);
    }
    // ataque de verdade sobe em várias faixas ao mesmo tempo; duas notas próximas "batendo" (pads, drones) fazem
    // o volume oscilar em poucas faixas e inventavam ataques e um BPM
    const broad = rising >= 12;
    const onset = this.peak(this.fluxHist, flux, 1.5) && broad;
    // batida = ataque com o grave sendo parte relevante dele (bumbo); notas dedilhadas não marcam o tempo
    const beat = this.peak(this.bfluxHist, bflux, 1.6) && rising >= 6 && bflux > 0.04 * flux;
    if (!silent && onset && now - this.lastOnset > 100) { this.lastOnset = now; this.onsets.push(now); }
    if (!silent && beat && now - this.lastBeat > 230) {
      const ref = this.bfluxHist.reduce((a, b) => a + b, 0) / this.bfluxHist.length || 1;
      this.beatAmp = clamp(0.45 + 0.25 * (bflux / ref - 1)); // força da batida em relação às recentes
      this.lastBeat = now; this.beats.push(now);
    }
    while (this.onsets.length && now - this.onsets[0] > 4000) this.onsets.shift();
    while (this.beats.length && now - this.beats[0] > 8000) this.beats.shift();
  }

  /** Faixa dinâmica: diferença entre os trechos fortes (p90) e fracos (p10) do nível dos últimos ~10 s. */
  updateDynamics(dt, silent) {
    this.ringTimer += dt;
    if (this.ringTimer < 0.1) return;
    this.ringTimer = 0;
    if (!silent) { this.dbRing.push(this.dbFast); if (this.dbRing.length > 100) this.dbRing.shift(); }
    if (this.dbRing.length >= 20 && this.tick % 25 === 0) {
      const s = [...this.dbRing].sort((a, b) => a - b);
      this.dynRange = s[Math.floor(s.length * 0.9)] - s[Math.floor(s.length * 0.1)];
    }
  }

  /** Nível de cada faixa (0..1) para o mixer. Sobe na hora, desce suave; o teto segura 0,6 s e cai. */
  updateBands(now, quiet) {
    for (let b = 0; b < BANDS; b++) {
      const i0 = this.bandEdges[b], i1 = Math.max(i0 + 1, this.bandEdges[b + 1]);
      let p = 0;
      for (let i = i0; i < i1 && i < this.freq.length; i++) p += Math.pow(10, this.freq[i] / 10);
      const db = 10 * Math.log10(p / (i1 - i0) + 1e-12);
      const f = Math.sqrt(i0 * i1) * this.hz;
      const dbT = db + 3 * Math.log2(f / 200);
      const abs = clamp((dbT + 78) / 52);
      this.bandAvg[b] += (dbT - this.bandAvg[b]) * 0.008;
      this.bandDev[b] += (Math.abs(dbT - this.bandAvg[b]) - this.bandDev[b]) * 0.008;
      const rel = clamp(0.5 + (dbT - this.bandAvg[b]) / (4 * this.bandDev[b] + 6));
      const v = quiet ? 0 : clamp(0.18 * rel + 0.95 * abs - 0.04); // 1,5x o movimento original
      this.bands[b] = v > this.bands[b] ? v : Math.max(v, this.bands[b] - 0.038);
      if (this.bands[b] >= this.peaks[b]) { this.peaks[b] = this.bands[b]; this.peakHold[b] = now + 600; }
      else if (now > this.peakHold[b]) this.peaks[b] = Math.max(this.bands[b], this.peaks[b] - 0.012);
    }
  }

  /** Detector de pico com limiar adaptativo (média + k·desvio do último ~1 s). */
  peak(hist, v, k) {
    hist.push(v); if (hist.length > 50) hist.shift();
    if (hist.length < 10) return false;
    let m = 0; for (const x of hist) m += x; m /= hist.length;
    let s = 0; for (const x of hist) s += (x - m) * (x - m); s = Math.sqrt(s / hist.length);
    // mínimo absoluto: em música parada (pads, drones) o "fluxo" é quase só ruído, e o limiar adaptativo sozinho
    // inventava ataques e um BPM que não existe
    return v > m + k * s && v > m * 1.3 + 0.5 && v > 2.5;
  }

  /** Cromagrama (~7 s para o tom, ~0,5 s para o acorde do momento). */
  updateChroma() {
    this.anK.getFloatFrequencyData(this.freqK);
    const c = new Float32Array(12), F = this.freqK, hz = this.hzK;
    const i0 = Math.ceil(65 / hz), i1 = Math.min(F.length - 2, Math.floor(4200 / hz));
    let tot = 0;
    // picos (notas); depois, supressão de harmônicos: o 3º, 5º, 6º e 7º harmônicos de uma nota caem em OUTRAS
    // notas (quinta, terça MAIOR, sétima) — o 5º harmônico do Lá é um Dó#, e um Lá menor de guitarra, sintetizador
    // ou metais parecia Lá maior. Pico que é 5º ou 7º harmônico de um pico mais grave e forte conta pouco.
    const pk = [];
    for (let i = i0; i <= i1; i++) {
      if (F[i] < -85 || F[i] < F[i - 1] || F[i] < F[i + 1]) continue;
      pk.push([i * hz, Math.pow(10, F[i] / 20)]);
    }
    for (let a = 0; a < pk.length; a++) {
      const [f, p] = pk[a];
      let w = 1;
      for (let b = 0; b < a && w > 0.2; b++) {
        const [f0, p0] = pk[b];
        if (p0 < 0.25 * p) continue;
        const k = Math.round(f / f0);
        // só 5º e 7º (terça maior e sétima falsas); 3º e 6º caem na quinta, que o acorde precisa ter mesmo
        if ((k === 5 || k === 7) && Math.abs(f / f0 - k) < 0.025 * k) w = 0.15;
      }
      const pc = ((Math.round(12 * Math.log2(f / 261.63)) % 12) + 12) % 12;
      c[pc] += p * w; tot += p * w;
    }
    if (tot <= 0) return;
    for (let i = 0; i < 12; i++) {
      this.chroma[i] = this.chroma[i] * 0.986 + (c[i] / tot) * 0.014;
      this.chordChroma[i] = this.chordChroma[i] * 0.8 + (c[i] / tot) * 0.2;
    }
    this.updateChord();
    this.updateDissonance();
    this.updateVoice();
    let maj = -1, min = -1;
    for (let t = 0; t < 12; t++) { maj = Math.max(maj, corr(this.chroma, MAJOR, t)); min = Math.max(min, corr(this.chroma, MINOR, t)); }
    this.modeScore = clamp((maj - min) * 5, -1, 1); // + maior, − menor
  }

  /**
   * Acorde do momento e, ao longo de ~12 s, a fração do tempo em acordes MENORES (sinal de melancolia mais confiável
   * que o tom: muita música triste está em tom maior, mas mora nos acordes menores). Power chords (sem terça, base
   * do rock/metal) não contam como maior nem menor. `clarity` = quanto do tempo há uma tríade clara (~6 s).
   */
  updateChord() {
    const c = this.chordChroma;
    let best = 0, minor = false, sum = 0, bestMaj = 0, bestMin = 0;
    for (let i = 0; i < 12; i++) sum += c[i];
    if (sum <= 0) return;
    for (let r = 0; r < 12; r++) {
      const maj = c[r] + c[(r + 4) % 12] + c[(r + 7) % 12], min = c[r] + c[(r + 3) % 12] + c[(r + 7) % 12];
      if (maj > best) { best = maj; minor = false; }
      if (min > best) { best = min; minor = true; }
      if (maj > bestMaj) bestMaj = maj;
      if (min > bestMin) bestMin = min;
    }
    this.chordClear = best / sum >= 0.5;
    // acorde com sétima (Dó-Mi-Sol-Si contém Mi menor; Lá-Dó-Mi-Sol contém Dó maior): maior e menor quase empatados
    // = ambíguo, não conta como nenhum dos dois (pads de música ambiente liam "triste")
    const ambiguous = Math.abs(bestMaj - bestMin) < 0.08 * best;
    this.clarity += ((this.chordClear ? 1 : 0) - this.clarity) * 0.016;
    if (!this.chordClear) return;
    let root = 0;
    for (let r = 0; r < 12; r++) {
      const s = c[r] + c[(r + (minor ? 3 : 4)) % 12] + c[(r + 7) % 12];
      if (s >= best - 1e-9) { root = r; break; }
    }
    this.chordRoot = root; this.chordMinor = minor;
    const fifth = c[root] + c[(root + 7) % 12], third = Math.max(c[(root + 3) % 12], c[(root + 4) % 12]);
    // (os harmônicos naturais de piano e violão reforçam a quinta: com 0,42 acordes limpos passavam por power chord)
    const power = third < 0.28 * fifth;
    this.powerRatio += ((power ? 1 : 0) - this.powerRatio) * 0.01;
    if (power || ambiguous) return;
    this.minorRatio += ((minor ? 1 : 0) - this.minorRatio) * 0.008;
  }

  /** Solo: linha de melodia destacada (250–2000 Hz) trocando de nota depressa (trocas/s, ~1,5 s). */
  updateLead() {
    const F = this.freqK, hz = this.hzK;
    const i0 = Math.ceil(250 / hz), i1 = Math.floor(2000 / hz);
    let best = -200, bi = -1;
    const vals = [];
    for (let i = i0; i <= i1; i++) {
      vals.push(F[i]);
      if (F[i] > best && F[i] >= F[i - 1] && F[i] >= F[i + 1]) { best = F[i]; bi = i; }
    }
    vals.sort((a, b) => a - b);
    const clear = bi > 0 && best > -72 && best - vals[vals.length >> 1] > 22;
    this.leadPres = this.leadPres * 0.9 + (clear ? 1 : 0) * 0.1;
    let changed = 0;
    if (clear) {
      const semi = Math.round(12 * Math.log2((bi * hz) / 261.63));
      if (this.leadSemi !== null && semi !== this.leadSemi) changed = 1;
      this.leadSemi = semi;
    }
    this.leadRate = this.leadRate * 0.93 + changed * 10 * 0.07;
  }

  /**
   * Aspereza do que soa agora (~1 s), só entre as notas que de fato se destacam (as 4 mais fortes) e na medida em
   * que o som é tonal: ruído de bateria espalha energia pelas 12 notas por igual, o que parecia um acorde
   * dissonantíssimo em qualquer música com chimbal.
   */
  updateDissonance() {
    const c = this.chordChroma;
    let s = 0;
    for (let i = 0; i < 12; i++) s += c[i];
    if (s <= 0) return;
    const top = [...c.keys()].sort((a, b) => c[b] - c[a]).slice(0, 4);
    let ts = 0, d = 0;
    for (const i of top) ts += c[i];
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) d += c[top[a]] * c[top[b]] * ROUGH[Math.abs(top[a] - top[b])];
    const tonal = clamp((ts / s - 0.5) / 0.3);
    this.diss = this.diss * 0.9 + (ts > 0 ? d / (ts * ts) : 0) * tonal * 0.1;
  }

  /** Voz/melodia principal (150–1100 Hz) comparada ao acorde do momento: casada ou "brigando" com a harmonia. */
  updateVoice() {
    this.updateLead();
    const F = this.freqK, hz = this.hzK;
    const i0 = Math.ceil(150 / hz), i1 = Math.floor(1100 / hz);
    let best = -200, bi = -1;
    const vals = [];
    for (let i = i0; i <= i1; i++) {
      vals.push(F[i]);
      if (F[i] > best && F[i] >= F[i - 1] && F[i] >= F[i + 1]) { best = F[i]; bi = i; }
    }
    vals.sort((a, b) => a - b);
    const clear = bi > 0 && best > -70 && best - vals[vals.length >> 1] > 24 && this.vocRatio > 0.3;
    this.voicePres = this.voicePres * 0.95 + (clear ? 1 : 0) * 0.05;
    if (!clear || !this.chordClear || this.chordRoot < 0) return;
    const pc = ((Math.round(12 * Math.log2((bi * hz) / 261.63)) % 12) + 12) % 12;
    const rel = (pc - this.chordRoot + 12) % 12;
    this.voiceClash = this.voiceClash * 0.97 + (this.chordMinor ? CLASH_MINOR : CLASH_MAJOR)[rel] * 0.03;
  }

  /** Andamento pelo intervalo entre batidas do grave (70–180 BPM); sem batida, "ritmo livre" (0). */
  updateTempo() {
    const src = this.beats;
    if (src.length < 5) { this.bpm = this.bpm < 30 ? 0 : ema(this.bpm, 0, 0.1, 1.2); return; }
    const hist = new Map();
    for (let i = 1; i < src.length; i++) {
      for (let j = 1; j <= 2 && i - j >= 0; j++) {
        let iv = (src[i] - src[i - j]) / 1000;
        if (iv <= 0.1) continue;
        while (iv < 0.333) iv *= 2;
        while (iv > 0.857) iv /= 2;
        const b = Math.round(iv / 0.02);
        hist.set(b, (hist.get(b) || 0) + (j === 1 ? 1 : 0.5));
      }
    }
    let best = 0, bv = 0;
    for (const [b, v] of hist) { const s = v + 0.5 * ((hist.get(b - 1) || 0) + (hist.get(b + 1) || 0)); if (s > bv) { bv = s; best = b; } }
    const bpm = best ? 60 / (best * 0.02) : 0;
    this.bpm = this.bpm ? ema(this.bpm, bpm, 0.1, 1.5) : bpm;
  }

  /** Retrato das medidas para a camada 2 (valores já normalizados onde faz sentido). */
  get features() {
    return {
      silent: this.silent, quiet: this.quiet, presence: this.presence, musicTime: this.musicTime,
      dbFast: this.dbFast, dbLong: this.dbLong, dynRange: this.dynRange,
      centroid: this.centroid, flux: this.fluxLevel, percRatio: this.percRatio,
      onsetRate: this.onsets.length / 4, beats: this.beats.length, lastBeat: this.lastBeat, beatAmp: this.beatAmp, bpm: this.bpm,
      flat: this.flat, hf: this.hf, vocRatio: this.vocRatio, diss: this.diss,
      modeScore: this.modeScore, minorRatio: this.minorRatio, powerRatio: this.powerRatio, clarity: this.clarity,
      voicePres: this.voicePres, voiceClash: this.voiceClash, leadRate: this.leadRate, leadPres: this.leadPres
    };
  }

  destroy() { clearInterval(this.timer); try { this.an.disconnect(); this.anK.disconnect(); } catch {} }
}

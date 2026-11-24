// CAMADA 2 — INTERPRETAÇÃO EMOCIONAL
// Lê as medidas da camada 1 (analysis.js) e estima TRÊS eixos independentes, cada um de 0 a 1:
//   valence  Tristeza 0 ↔ 0,5 neutra ↔ 1 Alegria   (o "jeito" da música: acordes menores x maiores, voz, timbre)
//   energy   Calma 0 ↔ 1 Intensidade                (volume relativo, ataques, movimentação, percussão, andamento)
//   tension  Serenidade 0 ↔ 1 Agressividade         (aspereza, distorção, dissonância, voz contra a harmonia)
// Nenhuma medida decide sozinha: rápido não quer dizer alegre, alto não quer dizer agressivo, grave não quer
// dizer triste, energia alta não quer dizer tensão. Os eixos podem assumir qualquer combinação (intensa e alegre,
// calma e tensa, triste e intensa...).
//
// É uma ESTIMATIVA ACÚSTICA, não uma leitura infalível de emoção: o áudio não diz o que a letra diz, e o mesmo
// timbre pode soar diferente para pessoas diferentes. Por isso cada eixo vem com uma confiança (0..1); com pouca
// confiança as cores ficam perto do meio da régua.
//
// Ritmos diferentes: as medidas chegam 50x/s, mas a interpretação roda 10x/s e cada eixo anda devagar (segundos),
// para que uma nota ou uma batida não mudem o sentimento. As batidas continuam indo direto para a camada 3.
import { clamp, ema } from './analysis.js';

export class EmotionEngine {
  constructor() {
    this.valence = 0.5; this.energy = 0.3; this.tension = 0.3;
    this.conf = { valence: 0, energy: 0, tension: 0, agitation: 0 };
    this.loud = 0.5; this.heavy = 0; this.climax = 0; this.distortion = 0;
    this.eBase = 0.4; this.centroidBase = 1500;
    this.hist = { valence: [], energy: [], tension: [] }; // alvos recentes (~4 s) → estabilidade
    // tom da música: 'major' | 'minor' | null (ainda não dá para dizer); só troca depois de ~2 s de acordo
    this.key = null; this.keyCandidate = null; this.keyFor = 0;
  }

  /** f: medidas da camada 1; step: segundos desde a última interpretação (~0,1 s). */
  update(f, step) {
    if (f.quiet) { this.climax = ema(this.climax, 0, step, 0.5); this.decayConfidence(step); return; }
    if (f.silent) return;
    const feat = this.derive(f, step);
    this.updateKey(f, feat, step);
    const tv = this.targetValence(f, feat), te = this.targetEnergy(f, feat), tt = this.targetTension(f, feat);
    this.track('valence', tv); this.track('energy', te); this.track('tension', tt);
    this.valence = ema(this.valence, tv, step, 4);
    this.energy = ema(this.energy, te, step, te > this.energy ? 1.5 : 2.4);  // sobe mais rápido do que cai
    this.tension = ema(this.tension, tt, step, tt > this.tension ? 2.2 : 3.6);
    this.updateClimax(f, feat, step);
    this.updateConfidence(f, feat, step);
  }

  /**
   * Tom maior ou menor. A correlação com os perfis de tom (modeScore) sozinha confunde tons relativos (Dó maior x
   * Lá menor têm as mesmas notas); a fração do tempo em acordes menores (minorRatio) desempata — em música de tom
   * menor o acorde do tom, menor, é o que mais soa. Power chords sem terça (rock/metal) e harmonia pouco clara
   * deixam o tom indefinido. O modeScore oscila de uma frase para outra: a soma é suavizada (~3 s) e o tom só troca
   * depois de ~3 s seguidos apontando para o outro lado.
   */
  updateKey(f, x, dt) {
    if (f.musicTime < 1) this.keyScore = 0; // música nova: começa do zero
    this.keyScore = ema(this.keyScore || 0, 0.5 * f.modeScore + 2.2 * (0.33 - f.minorRatio), dt, 3);
    const readable = f.musicTime > 6 && f.clarity > 0.3 && x.power < 0.5;
    const c = !readable ? null : this.keyScore > 0.12 ? 'major' : this.keyScore < -0.12 ? 'minor' : this.key;
    if (c === this.key) { this.keyCandidate = c; this.keyFor = 0; return; }
    if (c !== this.keyCandidate) { this.keyCandidate = c; this.keyFor = 0; }
    this.keyFor += dt;
    if (this.keyFor >= 3) { this.key = c; this.keyFor = 0; }
  }

  /** Medidas intermediárias usadas por mais de um eixo. */
  derive(f, dt) {
    // volume: a música de hoje é masterizada sempre alta — manda a variação em relação ao nível típico dela
    const abs = clamp((f.dbFast + 50) / 38), rel = clamp(0.5 + (f.dbFast - f.dbLong) / 12);
    this.loud = 0.35 * abs + 0.65 * rel;
    const density = clamp(f.onsetRate / 5);                 // ataques por segundo (0..5+)
    const bright = clamp((f.centroid - 900) / 2600);        // timbre escuro ↔ brilhante
    const tempo = f.bpm ? clamp((f.bpm - 70) / 95) : 0.35;
    // espectro "sujo" na faixa da guitarra e da voz (300–2500 Hz, sem os quadros de batida): distorção e grito.
    // Medido em GRAVAÇÕES REAIS pelo Som do PC (os sons sintéticos enganavam — produção cheia com voz, pratos e
    // reverb já suja o espectro): piano/violão/lo-fi 0,01–0,03; eletrônica 0,06–0,23; pop produzido ~0,25;
    // rock com guitarra ~0,30; metal ~0,46
    const noisy = clamp((f.flat - 0.15) / 0.35);
    // agudo forte só é "áspero" com o espectro sujo junto (metal: agudo 0,21; pop e rock ~0,10)
    const harsh = clamp((f.hf - 0.06) / 0.14) * clamp((f.flat - 0.15) / 0.25);
    const rough = clamp((f.diss - 0.06) / 0.12);
    const vp = clamp((f.voicePres - 0.3) / 0.4);
    const clash = vp * clamp((f.voiceClash - 0.25) / 0.5);
    // power chord só "vale" com guitarra distorcida junto (sem distorção, quinta forte é só harmônico natural)
    const power = f.powerRatio * clamp(noisy * 1.5);
    this.distortion = Math.max(harsh, noisy, 0.8 * power);
    return { density, bright, tempo, harsh, noisy, rough, vp, clash, power };
  }

  /**
   * Valência (calibrada com "Freakin' Out" — tom maior, 124 BPM, melancólica): acordes menores pesam mais que o
   * tom; power chords anulam o "maior"; voz brigando com os acordes puxa para o lado triste/tenso. Andamento e
   * timbre quase nada — e a energia não entra (triste e intensa continua triste).
   */
  targetValence(f, x) {
    const pw = x.power;
    // consonância com harmonia clara puxa um pouco para o lado leve; brilho do timbre conta um pouco mais que antes
    const consonance = (1 - x.rough) * f.clarity - 0.5;
    // tom já firme (updateKey, o mesmo que a tela mostra): menor puxa as cores para o lado triste, maior para o alegre
    const key = this.key === 'major' ? 0.07 : this.key === 'minor' ? -0.07 : 0;
    return clamp(0.5 + 0.09 * f.modeScore * (1 - pw) - 0.85 * (f.minorRatio - 0.30) * (1 - 0.5 * pw) + 0.10 * (x.bright - 0.45) + 0.04 * (x.tempo - 0.5)
      + 0.05 * consonance - 0.08 * x.vp * (f.voiceClash - 0.3) - 0.22 * pw + key);
  }

  /**
   * Energia: volume relativo + densidade de ataques + movimentação espectral (fluxo) + percussão + brilho +
   * andamento. Um breakdown (meio-tempo, grave, pesado) derruba andamento e brilho mas é dos trechos mais intensos:
   * o peso dele segura a energia lá em cima só enquanto dura.
   */
  targetEnergy(f, x) {
    // batida regular (bumbo marcando o tempo) é das pistas mais fortes de energia; batidas no grave nos últimos 8 s
    const pulse = clamp(f.beats / 8 / 2.5);
    const e = 0.18 * this.loud + 0.24 * x.density + 0.14 * f.flux + 0.10 * f.percRatio + 0.08 * x.bright + 0.14 * x.tempo + 0.12 * pulse;
    // dinâmica muito comprimida e alta (parede de som) soma um pouco; música bem dinâmica e baixa agora, tira
    const wall = clamp((10 - f.dynRange) / 8) * clamp((f.dbFast + 30) / 20) * 0.06;
    // a soma fica naturalmente entre ~0,25 (piano parado) e ~0,65 (metal): estica em torno do meio
    const s = clamp(0.5 + (e + wall - 0.42) * 1.6);
    return clamp(Math.max(s, clamp(this.heavy / 0.25) * (0.55 + 0.35 * this.heavy)));
  }

  /**
   * Tensão: o quanto a música soa áspera, pressionada ou agressiva — independente da energia. Fontes: dissonância
   * dos acordes, distorção/grito (agudo áspero, espectro "sujo"), voz contra a harmonia, power chords, harmonia
   * instável (sem tríade clara com notas soando). Uma música calma pode ser tensa (suspense: grave escuro,
   * dissonante, sem resolver); uma rápida e limpa pode ser serena. Distorção em música alegre (pop punk) pesa
   * menos que em música sombria. Serenidade: consonante, lisa, sem choque, harmonia clara.
   */
  targetTension(f, x) {
    const unstable = clamp((0.55 - f.clarity) / 0.4) * clamp((f.voicePres + f.leadPres) / 0.6 + 0.3);
    const dist = Math.max(x.noisy, x.harsh, 0.8 * x.power);
    // distorção em música calma (lo-fi, chiado de vinil) pesa menos — só a distorção: calma e dissonante
    // (suspense) continua tensa
    const drive = clamp((this.energy - 0.3) / 0.4);
    // trilha sombria: timbre muito escuro E pulsando com movimento (piano triste parado também é escuro, mas é
    // calmo). Acordes menores reforçam; não são exigidos porque o tom de drones graves é instável de medir
    const dark = clamp((1300 - f.centroid) / 600) * clamp((this.energy - 0.4) / 0.15) * (0.5 + 0.5 * clamp((f.minorRatio - 0.2) / 0.25));
    const raw = 0.80 * dist * (0.7 + 0.3 * drive) + 0.40 * x.rough + 0.16 * x.clash + 0.10 * unstable + 0.55 * dark + 0.12 * x.density * dist;
    const serene = (1 - x.rough) * (1 - x.noisy) * (1 - 0.8 * x.harsh) * (1 - x.clash) * (0.6 + 0.4 * f.clarity);
    // música alegre segura um pouco a tensão (pop punk não é fúria); sombria soma um pouco
    const mood = 1 - 0.3 * clamp((this.valence - 0.5) / 0.3) + 0.1 * clamp((0.5 - this.valence) / 0.3);
    const abs = clamp(0.05 + raw * mood - 0.08 * serene);
    // variação dentro da música: o trecho mais pesado que o normal DELA sobe, o mais leve desce — assim a
    // régua acompanha verso/refrão em vez de ficar parada num nível
    if (this.tRef === undefined || f.musicTime < 3) this.tRef = abs;
    this.tRef = ema(this.tRef, abs, 0.1, 25);
    return clamp(abs + 0.5 * (abs - this.tRef));
  }

  /** Clímax: solo, breakdown ou explosão acima do normal da própria música (só com ela já intensa). */
  updateClimax(f, x, dt) {
    const warm = f.musicTime > 12; // os primeiros 12 s só ensinam a base
    const tau = warm ? 25 : 2;
    this.eBase = ema(this.eBase, this.energy, dt, tau);
    this.centroidBase = ema(this.centroidBase, f.centroid, dt, tau);
    if (!warm) { this.climax = ema(this.climax, 0, dt, 1); this.heavy = ema(this.heavy, 0, dt, 1); return; }
    const intense = clamp((this.energy - 0.5) / 0.15);
    // solo: melodia trocando de nota depressa, MAIS forte que o normal e de preferência distorcida (um dedilhado
    // limpo também troca de nota depressa)
    const solo = clamp((f.leadRate - 1.2) / 1.8) * clamp((f.leadPres - 0.3) / 0.4) * intense * clamp((this.loud - 0.45) / 0.2) * (0.4 + 0.6 * this.distortion);
    const beats = f.beats >= 4 ? 1 : 0;
    const breakdown = beats * clamp((this.centroidBase - f.centroid) / 700) * clamp((this.loud - 0.55) / 0.2) * (0.7 + 0.3 * this.distortion);
    this.heavy = ema(this.heavy, breakdown, dt, breakdown > this.heavy ? 0.4 : 1.5);
    const surge = clamp((this.energy - this.eBase - 0.05) / 0.12) * intense * (0.3 + 0.7 * Math.max(this.distortion, this.tension));
    // explosão (refrão que entra forte) conta menos e passa: solo e breakdown é que são o clímax de verdade
    this.surgeBase = ema(this.surgeBase ?? this.energy, this.energy, dt, 8);
    const burst = clamp((this.energy - this.surgeBase - 0.05) / 0.12) * intense * (0.3 + 0.7 * Math.max(this.distortion, this.tension));
    const target = clamp(Math.max(solo, breakdown, 0.55 * Math.min(surge, burst)));
    this.climax = ema(this.climax, target, dt, target > this.climax ? 0.5 : 2.5);
  }

  track(axis, v) { const h = this.hist[axis]; h.push(v); if (h.length > 40) h.shift(); }
  spread(axis) {
    const h = this.hist[axis]; if (h.length < 5) return 1;
    let m = 0; for (const v of h) m += v; m /= h.length;
    let s = 0; for (const v of h) s += (v - m) * (v - m); return Math.sqrt(s / h.length);
  }

  /**
   * Confiança de cada eixo: tempo de música ouvido (os primeiros segundos sempre incertos), estabilidade dos alvos
   * (oscilando muito = o áudio não está dizendo uma coisa só) e a qualidade das pistas de cada eixo — valência
   * precisa de harmonia clara (acordes reconhecíveis); tensão, de sinais nítidos de um lado ou de outro.
   */
  updateConfidence(f, x, dt) {
    const warm = clamp(f.musicTime / 8);
    const stab = a => clamp(1 - (this.spread(a) - 0.04) / 0.12);
    const cues = {
      valence: clamp(0.35 + 0.65 * Math.max(f.clarity, f.powerRatio)),
      energy: 1,
      tension: clamp(0.45 + 1.2 * Math.abs(this.tension - 0.35))
    };
    for (const a of ['valence', 'energy', 'tension']) this.conf[a] = ema(this.conf[a], warm * stab(a) * cues[a] * f.presence, dt, 1.5);
    this.conf.agitation = (this.conf.energy + this.conf.tension) / 2;
  }
  decayConfidence(dt) { for (const a of ['valence', 'energy', 'tension', 'agitation']) this.conf[a] = ema(this.conf[a] || 0, 0, dt, 0.8); }

  /**
   * Eixos com a calibração da pessoa (−50..50 → ±0,25): é ajuste de preferência, a análise continua mandando.
   * A tela mostra dois eixos: Triste ↔ Alegre (valência) e Calmo ↔ Raiva (agitação = metade energia, metade
   * tensão — rápida e limpa fica no meio, pesada e distorcida chega na ponta). Energia e tensão continuam medidas
   * por baixo (movimento, pulsação, clímax).
   */
  axes(opts = {}) {
    const b = opts.bias || {};
    return {
      valence: clamp(this.valence + (b.valence || 0) / 200),
      energy: this.energy,
      tension: this.tension,
      agitation: clamp(0.5 * this.energy + 0.5 * this.tension + (b.agitation || 0) / 200)
    };
  }
}

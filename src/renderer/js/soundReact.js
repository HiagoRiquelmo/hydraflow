// "Som do PC" do Ambiente da Tela: os LEDs contam a EMOÇÃO da música que está tocando, não só o volume.
// Este arquivo só junta as três camadas (cada uma num módulo, para poderem evoluir sem mexer nas outras):
//   1. audio/analysis.js  análise do áudio (50x/s): volume, dinâmica, timbre, fluxo, harmônico/percussivo,
//                         ataques, BPM, acordes, voz, mixer
//   2. audio/emotion.js   interpretação emocional (10x/s, devagar): valência, energia, tensão, confiança, tom, clímax
//   3. audio/lighting.js  motor de iluminação (a cada quadro): cores, brilho, pulsação, velocidade
// Para o resto do app (screenSource.js, mixer, tela do Ambiente da Tela): state(), info, bands, peaks.
import { AudioAnalyzer } from './audio/analysis.js';
import { EmotionEngine } from './audio/emotion.js';
import { LightingEngine, moodColor, AXIS_GRADIENTS } from './audio/lighting.js';

export { moodColor, AXIS_GRADIENTS };

export class SoundReact {
  /** ctx: AudioContext; source: nó com o som. */
  constructor(ctx, source) {
    this.audio = new AudioAnalyzer(ctx, source);
    this.emotion = new EmotionEngine();
    this.light = new LightingEngine();
    this.info = { level: 0, silent: true };
    // a interpretação lê as medidas a cada ~100 ms (as batidas vão direto para a iluminação, sem esperar)
    let acc = 0;
    this.audio.onStep(dt => { acc += dt; if (acc >= 0.1) { this.emotion.update(this.audio.features, acc); acc = 0; } });
  }

  get bands() { this.audio.bandsReadAt = performance.now(); return this.audio.bands; }
  get peaks() { return this.audio.peaks; }

  /** p: parâmetros do efeito (pulseIntensity, biasValence, biasEnergy). Devolve { palette, phase, env, presence, dip }. */
  state(p, now = performance.now()) {
    const em = this.emotion, f = this.audio.features;
    const out = this.light.compute(em, f, p, now);
    const ax = em.axes(this.light.opts(p));
    this.info = {
      level: f.presence * (em.loud || 0), silent: f.presence < 0.2,
      valence: ax.valence, agitation: ax.agitation, key: em.key,
      palette: out.palette, beat: this.light.pulse > 0.2
    };
    return out;
  }

  destroy() { this.audio.destroy(); }
}

// CAMADA 3 — MOTOR DE ILUMINAÇÃO RGB
// Converte os eixos da camada 2 (emotion.js) e as batidas da camada 1 em parâmetros de luz:
//   palette  três cores que deslizam pela fita
//   env      brilho de 0 a 1 (clima + dinâmica da música + pulsação); o "Brilho" da pessoa multiplica por fora
//   phase    posição da paleta na fita (velocidade = movimentação da música)
// Comportamentos separados: pulsação (batidas), intensidade luminosa (dinâmica), velocidade (energia),
// transição de cores (mudança emocional, lenta).
//
// Cores (modelo de dois eixos definido pelo dono do projeto, 1.2.0):
//   Triste ↔ Alegre    azul na ponta esquerda, amarelo na ponta direita
//   Calmo ↔ Raiva      ciano → vermelho carmesim → roxo
// A paleta é: cor do eixo Triste ↔ Alegre, a mistura das duas e a cor do eixo Calmo ↔ Raiva. Música calma:
// movimento lento e brilho baixo mesmo com batidas fortes; agressiva: pulsos firmes, sem estroboscópio (pulso com
// duração mínima e intervalo mínimo).
import { clamp, ema } from './analysis.js';

// régua com cores em posições livres → 21 paradas iguais (de 5% em 5%), que a tela pinta direto num degradê
function ramp(keys, n = 21) {
  return Array.from({ length: n }, (_, i) => {
    const x = i / (n - 1);
    let k = 0; while (k < keys.length - 2 && x > keys[k + 1][0]) k++;
    const [x0, a] = keys[k], [x1, b] = keys[k + 1], f = x1 > x0 ? clamp((x - x0) / (x1 - x0)) : 0;
    return [0, 1, 2].map(c => Math.round(a[c] + (b[c] - a[c]) * f));
  });
}
const BLUE = [30, 90, 225], YELLOW = [255, 200, 20];
const CYAN = [0, 200, 225], CRIMSON = [200, 12, 45], PURPLE = [115, 30, 200];
// Gamas de cor de cada eixo (pintam as réguas da tela e dão as cores da paleta)
export const AXIS_GRADIENTS = {
  // azul puro até 42%, amarelo puro de 58% em diante. A passagem segue a roda de cores (azul → verde → amarelo) —
  // a mistura direta daria cinza bem onde cai a maioria das músicas (valência ~0,5) —, com o verde bem discreto
  // (pedido do dono do projeto, 1.2.1)
  valence: ramp([[0, BLUE], [0.42, BLUE], [0.5, [95, 150, 150]], [0.58, YELLOW], [1, YELLOW]]),
  // ciano até 15%, carmesim em 60% (música animada fica por aqui), roxo puro de 90% em diante (pesada e distorcida)
  agitation: ramp([[0, CYAN], [0.15, CYAN], [0.6, CRIMSON], [0.9, PURPLE], [1, PURPLE]])
};
function gradientAt(stops, t) {
  const p = clamp(t) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(p)), f = p - i;
  return [0, 1, 2].map(c => stops[i][c] + (stops[i + 1][c] - stops[i][c]) * f);
}

const mix = (a, b, t) => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);
const hue = c => { const [r, g, b] = c, mx = Math.max(r, g, b), mn = Math.min(r, g, b); if (mx === mn) return -1; const d = mx - mn; return mx === r ? ((g - b) / d + 6) % 6 * 60 : mx === g ? ((b - r) / d + 2) * 60 : ((r - g) / d + 4) * 60; };
/** Ajusta a saturação para `s` (0..1) sem mudar matiz nem brilho máximo (sobe ou desce). */
function saturateTo(c, s) {
  const mx = Math.max(c[0], c[1], c[2]), mn = Math.min(c[0], c[1], c[2]);
  if (mx <= 0 || mx === mn) return c;
  const cur = (mx - mn) / mx, k = s / cur;
  return c.map(v => clamp(mx - (mx - v) * k, 0, 255));
}
/** Rosa claro nunca: cor na faixa magenta/rosa clara e pouco saturada vira magenta escuro (só acento). */
function noLightPink(c) {
  const h = hue(c), mx = Math.max(...c), mn = Math.min(...c);
  if (h < 290 || h > 350 || mx < 120) return c;
  const s = (mx - mn) / mx;
  if (s > 0.85 && mx < 190) return c;
  const k = 170 / mx;
  return saturateTo(c.map(v => v * Math.min(1, k)), 0.95);
}

// Força fixa dos movimentos (antes "Intensidade dos efeitos", 60%): velocidade da paleta e "respiração" da música calma
const MOTION = 0.6;
// Brilho de base nunca passa disto: sobra espaço para o pulso subir acima dele
const BASE_MAX = 0.7;

export class LightingEngine {
  constructor() {
    this.palette = [[20, 30, 90], [20, 50, 120], [0, 80, 110]];
    this.phase = 0; this.lastState = 0; this.bright = 0.6; this.motion = 0.3;
    this.lastFlash = 0; this.pulse = 0;
  }

  /**
   * Paleta-alvo: cor da régua Triste ↔ Alegre na posição v, cor da régua Calmo ↔ Raiva na posição a, e a
   * mistura das duas entre elas. e (energia) só decide brilho e movimento.
   */
  target(v, a, e, conf, climax) {
    // só nos primeiros segundos (confiança muito baixa) o eixo fica perto do meio, para não chutar uma cor
    const k = c => clamp((c ?? 0) / 0.35);
    v = 0.5 + (v - 0.5) * k(conf.valence);
    a = 0.4 + (a - 0.4) * k(conf.agitation);
    // clímax (solo, breakdown, explosão) empurra para a ponta roxa
    a += (1 - a) * 0.6 * climax;
    const cv = gradientAt(AXIS_GRADIENTS.valence, v), ca = gradientAt(AXIS_GRADIENTS.agitation, a);
    // a mistura vem com a saturação reforçada: azul + carmesim = violeta, amarelo + roxo = laranja-avermelhado
    // (sem reforço sairia cinza, marrom ou rosado)
    const pal = [cv, saturateTo(mix(cv, ca, 0.5), 0.85), ca].map(noLightPink);
    return { pal, b: 0.45 + 0.55 * e, m: 0.1 + 0.8 * (0.6 * e + 0.4 * a) };
  }

  /**
   * em: EmotionEngine; f: medidas da camada 1; p: parâmetros do efeito (pulseIntensity, biasValence/biasEnergy).
   * Devolve { palette, phase, env, presence, dip }.
   */
  compute(em, f, p, now = performance.now()) {
    const dt = this.lastState ? Math.min(0.2, (now - this.lastState) / 1000) : 0; this.lastState = now;
    const { valence: v, energy: e, agitation: a } = em.axes(this.opts(p));
    const cx = em.climax, pr = f.presence;

    // transição de cores: duas etapas de suavização em série (a mudança começa devagar, acelera e chega devagar,
    // sem o "tranco" inicial de uma etapa só), ~4 s, e um limite de velocidade por canal — nenhuma troca de clima
    // vira salto, nem a entrada do clímax
    const tg = this.target(v, a, e, em.conf, cx);
    const tau = cx > 0.5 ? 1.5 : 2;
    const k = 1 - Math.exp(-dt / tau);
    if (!this.mid) this.mid = this.palette.map(c => c.slice());
    this.mid = this.mid.map((col, j) => col.map((c, ch) => c + (tg.pal[j][ch] - c) * k));
    const maxStep = 70 * dt; // no máximo ~70 níveis (de 255) por segundo
    this.palette = this.palette.map((col, j) => col.map((c, ch) => { const d = (this.mid[j][ch] - c) * k; return c + Math.max(-maxStep, Math.min(maxStep, d)); }));
    this.bright = ema(this.bright, tg.b, dt, 2);
    this.motion = ema(this.motion, tg.m, dt, 2.5);

    // velocidade: a paleta desliza pela fita conforme a movimentação (energia, fluxo, clímax)
    const speed = (0.012 + 0.16 * this.motion + 0.06 * f.flux * e + 0.2 * cx) * (0.4 + 1.2 * MOTION);
    this.phase = (this.phase + dt * speed) % 1;

    // pulsação: só as batidas do grave. Forma do pulso (quando acende, quanto dura, quanto cai) vem só da música —
    // energia decide a força (música calma = pulso discreto mesmo com batida forte). Antiestroboscópio: pulso dura
    // ≥140 ms e não reacende antes de 280 ms.
    const sinceBeat = now - f.lastBeat;
    if (f.lastBeat && f.lastBeat !== this.lastBeatSeen && f.lastBeat - this.lastFlash >= 280) { this.lastFlash = f.lastBeat; this.beatAmp = f.beatAmp; }
    this.lastBeatSeen = f.lastBeat;
    const decay = Math.max(140, 120 + 300 * (1 - e) - 40 * cx);
    const shape = (this.beatAmp || 0) * Math.exp(-(now - this.lastFlash) / decay) * (0.1 + 0.9 * e * e);
    this.pulse = this.lastFlash && sinceBeat < 2000 ? shape : 0;
    // música calma "respira" devagar no andamento em vez de piscar
    const breathe = f.bpm ? 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * (f.bpm / 60) / 2) : 0.5 + 0.5 * Math.sin(now / 1600);
    const loud = em.loud || 0;
    // brilho de base: clima + dinâmica da música (+ respiração e clímax), com folga para o pulso
    const base = clamp(this.bright * (0.55 + 0.45 * loud) * (1 - 0.1 * MOTION) + 0.12 * MOTION * breathe * (1 - e) + 0.15 * cx, 0, BASE_MAX);
    // "Intensidade do pulso" só muda a AMPLITUDE: o quanto o pico sobe acima do brilho de base, numa fração da folga
    // até o máximo — nunca bate no teto, então a forma do pulso (instante, duração, queda) não muda com o ajuste
    const amp = clamp((p.pulseIntensity ?? 50) / 100);
    const env = base + (1 - base) * amp * Math.min(1, 1.6 * this.pulse);
    const pal = this.palette.map(col => col.map(c => Math.round(clamp(c, 0, 255))));
    // passagem entre cores distantes na fita: o meio escurece em vez de virar outra cor (rosa no vermelho↔azul)
    const dip = [0, 1, 2].map(i => {
      const ha = hue(pal[i]), hb = hue(pal[(i + 1) % 3]);
      if (ha < 0 || hb < 0) return 0;
      const dh = Math.min(Math.abs(ha - hb), 360 - Math.abs(ha - hb));
      return 0.6 * clamp((dh - 70) / 60);
    });
    return { palette: pal, phase: this.phase, env, presence: pr, dip };
  }

  opts(p = {}) {
    // o controle guardado como "biasEnergy" é "Calibrar Calmo ↔ Raiva" (mesma chave: ajuste já feito vale)
    return { bias: { valence: +p.biasValence || 0, agitation: +p.biasEnergy || 0 } };
  }
}

/** Cor da paleta (3 cores em ciclo) na posição x (0..1) da fita, já multiplicada por env. Escreve em out[0..2]. */
export function moodColor(re, x, out) {
  const p = ((x + re.phase) % 1) * 3, i = Math.floor(p), f = p - i;
  const A = re.palette[i % 3], B = re.palette[(i + 1) % 3];
  const t = f * f * (3 - 2 * f); // curva em S: a fita não tem "degraus"
  const k = re.env * (1 - (re.dip ? re.dip[i % 3] : 0) * 4 * t * (1 - t));
  for (let c = 0; c < 3; c++) out[c] = (A[c] + (B[c] - A[c]) * t) * k;
  return out;
}

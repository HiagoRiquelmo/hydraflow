// Prévias de efeitos que não enviam nada aos dispositivos.
import { EffectFrame, framePng } from './effectRunner.js';

/** effect: { html, params } (como vem de api.explore.read). fit: 'width' (palco 16:10) ou 'cover' (cartão em pé). */
export function mountPreview(container, effect, fit = 'width') {
  return new EffectFrame(container, { html: effect.html, fit, cfg: { params: effect.params, fps: 30 } });
}

/** Miniatura PNG: roda o efeito alguns instantes num host invisível e fotografa o último quadro. */
function captureThumbnail(effect, waitMs = 1500) {
  return new Promise(resolve => {
    const box = document.createElement('div');
    box.className = 'fx-host';
    document.body.append(box);
    let last = null;
    const f = new EffectFrame(box, { html: effect.html, fit: 'none', cfg: { params: effect.params, captureFps: 10, full: true }, onFrame: px => { last = px; } });
    setTimeout(() => {
      f.destroy(); box.remove();
      resolve(last ? framePng(last) : null);
    }, waitMs);
  });
}

// Miniaturas para efeitos sem imagem: uma por vez, cada uma só uma vez. load() devolve { html, params }.
const thumbJobs = new Map(); // thumbId -> Promise<url|null>
let thumbChain = Promise.resolve();
export function queueThumb(thumbId, name, load) {
  if (!thumbJobs.has(thumbId)) {
    const job = thumbChain.then(async () => {
      const data = await captureThumbnail(await load());
      return data ? window.api.effects.saveThumb(thumbId, data) : null;
    }).catch(e => { console.warn('Miniatura de', name, e); return null; });
    thumbJobs.set(thumbId, job);
    thumbChain = job;
  }
  return thumbJobs.get(thumbId);
}

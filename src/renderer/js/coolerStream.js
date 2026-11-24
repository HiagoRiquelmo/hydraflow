// Mantém a imagem escolhida na tela do watercooler, com ou sem a aba aberta.
// Imagem parada: reenviada a cada 3 s (a tela fica no modo "ao vivo" e precisa de quadros).
// GIF/WebP animado: quadro a quadro no ritmo do arquivo (até 15 por segundo).
// O processo principal descarta quadros quando não há cooler conectado (e procura de novo a cada 15 s).
import { app, on, emit } from './state.js';

const SIZE = 480;
let gen = 0; // cada reinício invalida o laço anterior

async function decode(bytes, file) {
  const type = /\.gif$/i.test(file) ? 'image/gif' : /\.webp$/i.test(file) ? 'image/webp' : /\.png$/i.test(file) ? 'image/png' : 'image/jpeg';
  // animado: WebCodecs ImageDecoder entrega cada quadro com a duração dele
  if ((type === 'image/gif' || type === 'image/webp') && 'ImageDecoder' in window) {
    const dec = new ImageDecoder({ data: bytes, type });
    await dec.tracks.ready;
    const count = dec.tracks.selectedTrack.frameCount;
    if (count > 1) return { dec, count };
    dec.close();
  }
  return { still: await createImageBitmap(new Blob([bytes], { type })) };
}

function draw(ctx, img, cfg) {
  const w = img.displayWidth || img.width, hgt = img.displayHeight || img.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, SIZE, SIZE);
  const s = cfg.fit === 'contain' ? Math.min(SIZE / w, SIZE / hgt) : Math.max(SIZE / w, SIZE / hgt);
  ctx.save();
  ctx.translate(SIZE / 2, SIZE / 2);
  ctx.rotate((cfg.rotation || 0) * Math.PI / 180);
  ctx.drawImage(img, -w * s / 2, -hgt * s / 2, w * s, hgt * s);
  ctx.restore();
}

/** JPEG do canvas (ArrayBuffer), ou null. */
async function encode(canvas) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.85));
  return blob ? blob.arrayBuffer() : null;
}

/** Manda um JPEG. false = o cooler não está conectado. */
const send = jpeg => (jpeg ? window.api.cooler.frame(jpeg) : true);

// GIF em loop: cada quadro é decodificado, desenhado e codificado em JPEG só na primeira volta; depois só reenvia
// (até este limite de memória — um GIF enorme volta a codificar a cada volta)
const CACHE_LIMIT = 48 * 1024 * 1024;

const wait = ms => new Promise(r => setTimeout(r, ms));

async function restartCoolerStream() {
  const my = ++gen;
  const cfg = app.store.cooler || {};
  if (!cfg.enabled || !cfg.image) return;
  // nada é decodificado nem codificado enquanto não há cooler (ready() é barato: o principal só procura de fato a
  // cada 15 s a 2 min, ou 3 s depois de uma queda)
  while (my === gen && !(await window.api.cooler.ready())) await wait(5000);
  if (my !== gen) return;
  let src;
  try { src = await decode(await window.api.cooler.imageData(), cfg.image); }
  catch (e) { console.warn('Watercooler: imagem não pôde ser lida:', e.message); return; }
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  let connected = true;
  if (src.still) {
    draw(ctx, src.still, cfg);
    src.still.close?.();
    const jpeg = await encode(canvas); // codificada uma vez só
    while (my === gen && connected) { connected = await send(jpeg); if (connected) await wait(3000); }
  } else {
    const cache = new Array(src.count); // { jpeg, dur } por quadro
    let cached = 0;
    for (let i = 0; my === gen && connected; i = (i + 1) % src.count) {
      const t0 = performance.now();
      let f = cache[i];
      if (!f) {
        const { image } = await src.dec.decode({ frameIndex: i });
        draw(ctx, image, cfg);
        f = { dur: Math.max(66, (image.duration || 100000) / 1000), jpeg: null }; // duração em µs → ms, no máximo 15 por segundo
        image.close();
        f.jpeg = await encode(canvas);
        if (f.jpeg && cached + f.jpeg.byteLength <= CACHE_LIMIT) { cache[i] = f; cached += f.jpeg.byteLength; }
      }
      connected = await send(f.jpeg);
      await wait(Math.max(0, f.dur - (performance.now() - t0)));
    }
    src.dec.close();
  }
  if (my === gen && !connected) restartCoolerStream(); // cooler sumiu: volta a esperar por ele
}

/** Muda os ajustes do cooler (o principal grava e devolve o resultado); quem mostra ou manda a imagem ouve 'cooler'. */
export async function setCooler(patch) {
  app.store.cooler = await window.api.cooler.set(patch);
  emit('cooler');
  return app.store.cooler;
}

export function startCoolerStream() {
  on('cooler', restartCoolerStream);
  // a imagem em uso foi excluída na biblioteca (com a aba fechada também): para de mandar
  window.api.cooler.onImageCleared(() => { if (app.store.cooler) app.store.cooler.image = null; emit('cooler'); });
  restartCoolerStream();
}

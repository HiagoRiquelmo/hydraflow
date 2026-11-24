// Mostra o arquivo escolhido (vídeo em loop, sem som, ou imagem animada) cobrindo o monitor.
const q = new URLSearchParams(location.search);
const src = q.get('src') || '';
const isVideo = /\.(mp4|webm|mov|m4v|mkv)$/i.test(src);
const fit = { contain: 'contain', fill: 'fill' }[q.get('fit')] || 'cover';
const el = document.createElement(isVideo ? 'video' : 'img');
el.id = 'm';
// cover = preenche cortando as sobras; fill = estica para caber exatamente; contain = inteira, com faixas pretas
el.style.objectFit = fit;
if (isVideo) Object.assign(el, { muted: true, loop: true, autoplay: true, playsInline: true });
el.src = src;
document.body.append(el);
const report = () => window.wallpaper?.size(innerWidth * devicePixelRatio, innerHeight * devicePixelRatio);
addEventListener('resize', report);
setTimeout(report, 300); setTimeout(report, 1500); // depois que a janela foi para trás dos ícones

// Pausado, o último quadro continua na tela (nada de fundo preto ao voltar para a área de trabalho):
// - vídeo: pause() já congela o quadro atual;
// - imagem animada: o Chromium continua animando um <img> visível, então o quadro atual vai para um canvas
//   e o <img> sai da pintura até voltar.
let still = null;
function freezeImage() {
  const c = still || (still = Object.assign(document.createElement('canvas'), { id: 'still' }));
  c.width = innerWidth * devicePixelRatio; c.height = innerHeight * devicePixelRatio;
  c.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
  const iw = el.naturalWidth, ih = el.naturalHeight, cw = c.width, ch = c.height;
  if (!iw || !ih) return;
  const s = fit === 'fill' ? null : fit === 'contain' ? Math.min(cw / iw, ch / ih) : Math.max(cw / iw, ch / ih);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch);
  if (s) ctx.drawImage(el, (cw - iw * s) / 2, (ch - ih * s) / 2, iw * s, ih * s); else ctx.drawImage(el, 0, 0, cw, ch);
  document.body.append(c);
}

window.wallpaper?.onPause(p => {
  if (isVideo) { if (p) el.pause(); else el.play().catch(() => {}); return; }
  if (p) { freezeImage(); el.style.display = 'none'; }
  else { el.style.display = ''; still?.remove(); }
});

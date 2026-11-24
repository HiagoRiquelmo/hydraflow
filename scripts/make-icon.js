'use strict';
// Gera o ícone do Hydraflow em todos os tamanhos a partir de build/icon-source.png (arte mestra quadrada, 1024 px,
// já enquadrada e com cantos arredondados).
// Saída: build/icon.png (512), build/icons/<n>.png e build/icon.ico (16–256, entradas PNG).
// Roda no Electron que o projeto já usa (npm run icon) — nenhuma dependência nova: o Chromium reduz a imagem num
// canvas (em etapas de metade, para os tamanhos pequenos ficarem nítidos) e o .ico é montado aqui mesmo.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];

/** Monta um .ico com imagens PNG (formato aceito desde o Windows Vista, inclusive pelo NSIS e pelo electron-builder). */
function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = 6 + dir.length;
  images.forEach(({ size, png }, i) => {
    const e = i * 16;
    dir[e] = size >= 256 ? 0 : size; dir[e + 1] = size >= 256 ? 0 : size; // 0 = 256
    dir[e + 2] = 0; dir[e + 3] = 0;
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(png.length, e + 8); dir.writeUInt32LE(offset, e + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map(i => i.png)]);
}

async function render(win, size) {
  const url = 'data:image/png;base64,' + fs.readFileSync(path.join(BUILD, 'icon-source.png')).toString('base64');
  const b64 = await win.webContents.executeJavaScript(`new Promise((ok, fail) => {
    const img = new Image();
    img.onload = () => {
      let src = img, w = img.width;
      while (w / 2 >= ${size}) { // reduz pela metade até perto do tamanho final
        w = Math.round(w / 2);
        const c = document.createElement('canvas'); c.width = c.height = w;
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, w);
        src = c;
      }
      const c = document.createElement('canvas'); c.width = c.height = ${size};
      const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(src, 0, 0, ${size}, ${size});
      ok(c.toDataURL('image/png').split(',')[1]);
    };
    img.onerror = () => fail(new Error('icon-source.png inválido'));
    img.src = ${JSON.stringify(url)};
  })`);
  return Buffer.from(b64, 'base64');
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html,<meta charset="utf-8">');
  fs.mkdirSync(path.join(BUILD, 'icons'), { recursive: true });
  const images = [];
  for (const size of ICO_SIZES) {
    const png = await render(win, size);
    fs.writeFileSync(path.join(BUILD, 'icons', `${size}.png`), png);
    images.push({ size, png });
  }
  const big = await render(win, 512);
  fs.writeFileSync(path.join(BUILD, 'icons', '512.png'), big);
  fs.writeFileSync(path.join(BUILD, 'icon.png'), big);
  fs.writeFileSync(path.join(BUILD, 'icon.ico'), buildIco(images));
  console.log(`build/icon.ico (${ICO_SIZES.join(', ')} px), build/icon.png (512 px) e build/icons/*.png gerados`);
  app.exit(0);
}).catch(e => { console.error(e); app.exit(1); });

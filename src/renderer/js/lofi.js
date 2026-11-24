// Cenas Lo-Fi (SVG animado, desenho próprio do Hydraflow) mostradas na Iluminação enquanto o Ambiente da Tela está
// ligado. Mesma personagem e mesmo quarto em todas: cabelo escuro, fone verde-água, moletom roxo.
// Leveza: animações em poucos passos por segundo (steps), só transform/opacity, e tudo pausa com a janela escondida
// (classe .lofi-paused). Cada cena tem as próprias classes (prefixo lfN-) para não misturar animações.

const C = {
  sky: '#120f2e', wall: '#221a4d', wall2: '#2b2160', floor: '#18123a', desk: '#3a2c6e', deskTop: '#4a3a86',
  skin: '#f4c9ad', blush: '#f19aa0', hair: '#2a1b3d', hoodie: '#7b5cff', hoodie2: '#6247e0', phones: '#2ee6c5',
  glow: '#ffd98a', screen: '#5ef0d6', white: '#f5f0ff'
};

// Hora do dia (as cenas contam um dia, da manhã à noite): céu da janela, sol ou lua, estrelas, luzes da cidade
// e uma luz de ambiente por cima de tudo (tint), que esquenta ou esfria o quarto inteiro.
const TIME = {
  morning: { sky: ['#ffb68f', '#ffe1b0'], body: 'sun', sunY: 70, stars: false, city: false, bld: '#c9879a', tint: ['#ffb37a', .10] },
  day: { sky: ['#6fc2ff', '#bfe6ff'], body: 'sun', sunY: 36, stars: false, city: false, bld: '#7d8fd0', tint: ['#fff3c4', .07] },
  sunset: { sky: ['#ff6f91', '#ffb86b'], body: 'sun', sunY: 78, stars: false, city: true, bld: '#5b3a7a', tint: ['#ff7a59', .12] },
  night: { sky: [C.sky, '#2a2068'], body: 'moon', sunY: 40, stars: true, city: true, bld: '#3a2f7a', tint: null }
};

// quarto: parede com textura, quadro, estante com livros e planta, janela com céu e cortinas, rodapé, chão de tábuas,
// tapete e tomada. inWindow: desenho extra dentro da janela (pássaros, chuva), recortado por ela.
const room = (id, { window = true, rain = false, time = 'night', inWindow = '' } = {}) => {
  const T = TIME[time];
  return `
  <defs>
    <linearGradient id="${id}-led" x1="0" x2="1"><stop offset="0" stop-color="#ff4fd8"/><stop offset=".33" stop-color="#7b5cff"/><stop offset=".66" stop-color="#2ee6c5"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient>
    <linearGradient id="${id}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${T.sky[0]}"/><stop offset="1" stop-color="${T.sky[1]}"/></linearGradient>
    <radialGradient id="${id}-lamp" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${C.glow}" stop-opacity=".55"/><stop offset="1" stop-color="${C.glow}" stop-opacity="0"/></radialGradient>
    <clipPath id="${id}-win"><rect x="196" y="22" width="96" height="70" rx="6"/></clipPath>
  </defs>
  <rect width="320" height="200" fill="${C.wall}"/>
  <g fill="#fff" opacity=".045">${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 20 + 8}" y="0" width="2" height="146"/>`).join('')}</g>
  <rect y="150" width="320" height="50" fill="${C.floor}"/>
  <g stroke="#0f0b29" stroke-width="1" opacity=".7"><line x1="0" y1="164" x2="320" y2="164"/><line x1="0" y1="180" x2="320" y2="180"/>
    ${[40, 120, 200, 280].map(x => `<line x1="${x}" y1="150" x2="${x}" y2="164"/>`).join('')}${[0, 80, 160, 240].map(x => `<line x1="${x + 20}" y1="164" x2="${x + 20}" y2="180"/>`).join('')}${[60, 140, 220, 300].map(x => `<line x1="${x}" y1="180" x2="${x}" y2="200"/>`).join('')}</g>
  <rect y="146" width="320" height="5" fill="${C.wall2}"/><rect y="146" width="320" height="1" fill="#ffffff" opacity=".08"/>
  <ellipse cx="122" cy="191" rx="74" ry="8" fill="#3a2a72"/><ellipse cx="122" cy="191" rx="62" ry="5.5" fill="none" stroke="#5a46a8" stroke-width="1.2" stroke-dasharray="4 3"/>
  <g transform="translate(16 22)"><rect width="50" height="36" rx="2" fill="#15102e" stroke="#8f7ce0" stroke-width="2.4"/>
    <rect x="4" y="4" width="42" height="28" fill="#2a2068"/><circle cx="34" cy="11" r="4" fill="#ffd98a"/>
    <path d="M4 32 L16 18 L24 26 L32 16 L46 32 Z" fill="#5b4bb0"/><path d="M4 32 L12 24 L20 32 Z" fill="#7b5cff"/></g>
  <rect x="10" y="88" width="66" height="4" rx="1.5" fill="${C.deskTop}"/><path d="M14 92 l4 6 M72 92 l-4 6" stroke="${C.desk}" stroke-width="2.4"/>
  <g><rect x="14" y="70" width="6" height="18" fill="#ff8fb8"/><rect x="21" y="73" width="5" height="15" fill="#5ec2ff"/><rect x="27" y="68" width="7" height="20" fill="#ffd166"/>
    <rect x="35" y="74" width="5" height="14" fill="#6bd18b"/><rect x="41" y="76" width="12" height="4" fill="#c9bfff" transform="rotate(-12 41 76)"/>
    <rect x="16" y="73" width="2" height="9" fill="#fff" opacity=".35"/><rect x="29" y="72" width="3" height="11" fill="#fff" opacity=".3"/></g>
  <path d="M60 88 L72 88 L70 80 L62 80 Z" fill="#c97b5a"/><path d="M66 80 q-6 -6 -4 -12 q4 4 4 12 M66 80 q4 -8 9 -9 q-1 6 -9 9" fill="#6bd18b"/>
  <g transform="translate(70 124)"><rect width="9" height="12" rx="2" fill="#3a2f7a"/><circle cx="3" cy="6" r="1" fill="#15102e"/><circle cx="6" cy="6" r="1" fill="#15102e"/></g>
  ${window ? `<g clip-path="url(#${id}-win)">
    <rect x="196" y="22" width="96" height="70" fill="url(#${id}-sky)"/>
    ${T.body === 'moon'
      ? `<circle cx="270" cy="40" r="9" fill="#fff4d6" opacity=".9"/>`
      : `<g class="${id}-sun"><circle cx="262" cy="${T.sunY}" r="16" fill="#fff6c9" opacity=".35"/><circle cx="262" cy="${T.sunY}" r="10" fill="#fff1b8"/></g>`}
    ${T.stars ? `<g class="${id}-stars" fill="#fff"><circle cx="212" cy="34" r="1"/><circle cx="232" cy="52" r="1.2"/><circle cx="250" cy="30" r=".9"/><circle cx="284" cy="66" r="1"/><circle cx="222" cy="72" r=".8"/></g>` : ''}
    ${T.body === 'sun' ? `<g class="${id}-clouds" fill="#fff" opacity=".75"><ellipse cx="214" cy="40" rx="12" ry="4"/><ellipse cx="222" cy="37" rx="8" ry="4"/><ellipse cx="282" cy="54" rx="10" ry="3.4"/></g>` : ''}
    <g fill="${T.bld}"><rect x="196" y="70" width="18" height="22"/><rect x="216" y="62" width="14" height="30"/><rect x="232" y="74" width="20" height="18"/><rect x="254" y="58" width="12" height="34"/><rect x="268" y="68" width="24" height="24"/></g>
    ${T.city ? `<g class="${id}-city" fill="${C.glow}"><rect x="220" y="66" width="2" height="2"/><rect x="258" y="62" width="2" height="2"/><rect x="274" y="74" width="2" height="2"/><rect x="236" y="78" width="2" height="2"/><rect x="200" y="76" width="2" height="2"/></g>` : ''}
    ${inWindow}
    ${rain ? `<g class="${id}-rain" stroke="#9fb4ff" stroke-width="1" opacity=".7">${Array.from({ length: 14 }, (_, i) => `<line x1="${200 + i * 7}" y1="${(i * 23) % 60 + 10}" x2="${197 + i * 7}" y2="${(i * 23) % 60 + 20}"/>`).join('')}</g>` : ''}
  </g>
  <rect x="196" y="22" width="96" height="70" rx="6" fill="none" stroke="${C.wall2}" stroke-width="5"/>
  <line x1="244" y1="22" x2="244" y2="92" stroke="${C.wall2}" stroke-width="3"/>
  <rect x="192" y="92" width="104" height="4" rx="1.5" fill="${C.wall2}"/>
  <rect x="186" y="14" width="116" height="3" rx="1.5" fill="#8f7ce0"/>
  <path d="M186 16 Q194 50 188 100 L200 100 Q204 56 198 16 Z" fill="#c9a8ff" opacity=".85"/><path d="M190 18 Q196 56 192 98" stroke="#a684f0" stroke-width="1.2" fill="none"/>
  <path d="M302 16 Q294 50 300 100 L288 100 Q284 56 290 16 Z" fill="#c9a8ff" opacity=".85"/><path d="M298 18 Q292 56 296 98" stroke="#a684f0" stroke-width="1.2" fill="none"/>` : ''}`;
};

// luz de ambiente da hora do dia, desenhada por cima da cena inteira
const tint = (time = 'night') => TIME[time].tint ? `<rect width="320" height="200" fill="${TIME[time].tint[0]}" opacity="${TIME[time].tint[1]}" style="mix-blend-mode:soft-light"/><rect width="320" height="200" fill="${TIME[time].tint[0]}" opacity="${TIME[time].tint[1] / 2}"/>` : '';

// Stop-motion: duas (ou mais) poses desenhadas, trocadas em quadros fixos, sem interpolação: a classe ${id}-pN
// mostra a pose N durante 1/n do ciclo. Assim o movimento "pula" como num filme de bonecos.
const poseCss = (id, n, dur) => `
  .${id}-p0,.${id}-p1,.${id}-p2{opacity:0;animation:${id}-pose ${dur}s linear infinite}
  ${Array.from({ length: n }, (_, i) => `.${id}-p${i}{animation-delay:${(-dur * (n - i) / n).toFixed(2)}s}`).join('')}
  @keyframes ${id}-pose{0%,${(100 / n - 0.01).toFixed(2)}%{opacity:1}${(100 / n).toFixed(2)}%,100%{opacity:0}}`;
const arm = (d, hx, hy, extra = '') => `<path d="${d}" stroke="${C.hoodie}" stroke-width="10" stroke-linecap="round" fill="none"/><circle cx="${hx}" cy="${hy}" r="5" fill="${C.skin}"/>${extra}`;

// mesa à direita da personagem
const desk = () => `
  <rect x="150" y="138" width="160" height="9" rx="3" fill="${C.deskTop}"/><rect x="152" y="138" width="156" height="1.6" rx=".8" fill="#fff" opacity=".12"/>
  <rect x="160" y="147" width="8" height="40" fill="${C.desk}"/><rect x="292" y="147" width="8" height="40" fill="${C.desk}"/>
  <rect x="252" y="147" width="40" height="15" rx="2" fill="${C.desk}"/><rect x="266" y="153" width="12" height="2.4" rx="1.2" fill="#8f7ce0"/>`;

// personagem de perfil (olhando para a direita). Cabeça e corpo separados: a cena "dormindo" deita a cabeça.
const head = (id, { eyes = 'open', cls = '', transform = '' } = {}) => `
  <g class="${cls}" ${transform ? `transform="${transform}"` : 'style="transform-origin:122px 104px"'}>
    <path d="M150 82 Q150 106 128 109 Q104 109 101 88 Q99 62 125 60 Q150 60 150 82 Z" fill="${C.skin}"/>
    <path d="M152 82 Q154 54 126 52 Q98 52 95 80 Q93 100 97 112 Q104 116 112 110 Q108 98 110 88 Q114 76 130 74 Q142 74 150 86 Z" fill="${C.hair}"/>
    <path d="M151 84 Q150 70 136 68 Q138 80 148 90 Z" fill="${C.hair}"/>
    <path d="M106 70 Q122 56 142 62" stroke="#5a4080" stroke-width="2" fill="none" stroke-linecap="round" opacity=".8"/>
    <path d="M100 88 Q100 100 104 108" stroke="#4a3466" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"/>
    ${eyes === 'open'
      ? `<ellipse class="${id}-blink" cx="139" cy="89" rx="2.4" ry="3.2" fill="${C.hair}"/>`
      : `<path d="M135 90 Q139 93 143 90" stroke="${C.hair}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`}
    <ellipse cx="142" cy="98" rx="4" ry="2.4" fill="${C.blush}" opacity=".6"/>
    <path d="M100 82 Q120 42 150 66" stroke="${C.phones}" stroke-width="5" fill="none" stroke-linecap="round"/>
    <rect x="103" y="82" width="15" height="19" rx="6" fill="${C.phones}"/><rect x="106" y="85" width="9" height="13" rx="4" fill="#1aa894"/>
  </g>`;
const body = () => `
  <path d="M86 186 Q84 140 104 122 Q120 112 138 120 Q152 132 150 186 Z" fill="${C.hoodie}"/>
  <path d="M104 124 Q114 150 112 186" stroke="${C.hoodie2}" stroke-width="3" fill="none"/>
  <path d="M96 162 Q116 156 140 162 L138 176 Q116 171 98 176 Z" fill="${C.hoodie2}"/><path d="M98 163 Q116 158 139 163" stroke="#9a82ff" stroke-width="1" fill="none"/>
  <path d="M106 120 Q100 124 98 132" stroke="${C.hoodie2}" stroke-width="4" fill="none" stroke-linecap="round"/>
  <rect x="116" y="104" width="12" height="16" rx="5" fill="${C.skin}"/>
  <path d="M119 120 l-2 14 M126 120 l2 13" stroke="#ece6ff" stroke-width="1.3" stroke-linecap="round"/><circle cx="117" cy="135" r="1.3" fill="#ece6ff"/><circle cx="128" cy="134" r="1.3" fill="#ece6ff"/>`;
const girl = (id, opts = {}) => body() + head(id, { eyes: opts.eyes, cls: opts.head || '' });

const beam = id => `<defs><linearGradient id="${id}-beamg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe6a8" stop-opacity=".35"/><stop offset="1" stop-color="#ffe6a8" stop-opacity="0"/></linearGradient></defs>
  <polygon class="${id}-beam" points="198,92 290,92 252,186 136,186" fill="url(#${id}-beamg)" style="mix-blend-mode:screen"/>`;

const SCENES = [
  // manhã: o despertador toca, ela se espreguiça, boceja e esfrega os olhos (3 poses)
  { key: 'wake', time: 'morning', svg: id => `
    ${room(id, { time: 'morning' })}${beam(id)}${desk()}
    <g transform="translate(262 128)"><g class="${id}-clock">
      <circle cx="-6" cy="-9" r="3" fill="#ffd166"/><circle cx="6" cy="-9" r="3" fill="#ffd166"/>
      <circle r="8" fill="#ff8fb8"/><circle r="5.5" fill="${C.white}"/>
      <line x1="0" y1="0" x2="0" y2="-4" stroke="${C.hair}" stroke-width="1.2"/><line x1="0" y1="0" x2="3" y2="1" stroke="${C.hair}" stroke-width="1.2"/>
      <line x1="-5" y1="7" x2="-7" y2="10" stroke="#ff8fb8" stroke-width="2"/><line x1="5" y1="7" x2="7" y2="10" stroke="#ff8fb8" stroke-width="2"/>
    </g></g>
    <g class="${id}-ring" fill="none" stroke="#ffd166" stroke-width="1.4" stroke-linecap="round"><path d="M276 116 q4 4 0 8"/><path d="M280 113 q6 7 0 14"/><path d="M248 116 q-4 4 0 8"/></g>
    ${body()}
    <g class="${id}-p1">${arm('M108 126 Q92 100 102 62', 102, 58)}${arm('M134 122 Q160 100 146 56', 146, 52)}</g>
    ${head(id, { eyes: 'closed' })}
    <g class="${id}-p0">${arm('M138 126 Q150 134 160 138', 163, 138)}</g>
    <g class="${id}-p1"><ellipse cx="146" cy="101" rx="2.4" ry="3.2" fill="#7a2a44"/></g>
    <g class="${id}-p2">${arm('M138 126 Q162 120 148 94', 147, 91)}</g>`,
    css: id => `${poseCss(id, 3, 3.6)}
      .${id}-clock{animation:${id}-shake 3.6s steps(1) infinite}
      @keyframes ${id}-shake{0%{transform:rotate(-12deg)}5%{transform:rotate(12deg)}10%{transform:rotate(-12deg)}15%{transform:rotate(12deg)}20%{transform:rotate(-12deg)}25%,100%{transform:rotate(0)}}
      .${id}-ring{animation:${id}-ringing 3.6s steps(1) infinite}
      @keyframes ${id}-ringing{0%,25%{opacity:1}26%,100%{opacity:0}}
      .${id}-beam{animation:${id}-beam 4s steps(4) infinite}
      @keyframes ${id}-beam{50%{opacity:.16}}` },

  // 1. estudando: escreve num caderno, abajur aceso, vapor saindo da caneca
  { key: 'study', time: 'day', svg: id => `
    ${room(id, { time: 'day' })}${desk()}
    <circle cx="282" cy="96" r="46" fill="url(#${id}-lamp)" class="${id}-glow"/>
    <path d="M276 138 L282 104 L294 100" stroke="#6a5bb0" stroke-width="3" fill="none"/><path d="M286 92 L304 98 L296 110 Z" fill="#8f7ce0"/>
    <rect x="186" y="130" width="46" height="8" rx="2" fill="${C.white}"/><rect x="190" y="132" width="38" height="1.5" fill="#c9bfff"/><rect x="190" y="135" width="30" height="1.5" fill="#c9bfff"/>
    <rect x="246" y="122" width="14" height="16" rx="3" fill="#ff8fb8"/><path d="M260 126 q6 0 6 5 q0 5 -6 5" stroke="#ff8fb8" stroke-width="2" fill="none"/>
    <g class="${id}-steam" stroke="#e8e0ff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"><path d="M250 118 q-3 -5 0 -10 q3 -5 0 -10"/><path d="M256 118 q-3 -5 0 -10 q3 -5 0 -10"/></g>
    ${girl(id)}
    <g class="${id}-hand"><path d="M140 128 Q164 128 190 130" stroke="${C.hoodie}" stroke-width="10" stroke-linecap="round" fill="none"/><circle cx="193" cy="130" r="5" fill="${C.skin}"/><line x1="194" y1="131" x2="204" y2="122" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/></g>`,
    css: id => `
      .${id}-hand{animation:${id}-write 1.2s steps(6) infinite}
      @keyframes ${id}-write{0%,100%{transform:translate(0,0)}25%{transform:translate(5px,-1px)}50%{transform:translate(10px,0)}75%{transform:translate(4px,1px)}}
      .${id}-steam{animation:${id}-steam 3s steps(12) infinite}
      @keyframes ${id}-steam{0%{transform:translateY(4px);opacity:0}30%{opacity:.7}100%{transform:translateY(-10px);opacity:0}}
      .${id}-glow{animation:${id}-glow 4s ease-in-out infinite}
      @keyframes ${id}-glow{50%{opacity:.75}}` },

  // tarde: rega as plantas; o regador inclina e volta (2 poses), gotas caem, a planta cresce aos trancos
  { key: 'plants', time: 'day', svg: id => `
    ${room(id, { time: 'day' })}${beam(id)}${desk()}
    <g class="${id}-grow"><path d="M213 126 q-10 -8 -12 -18 q8 2 12 14 Z" fill="#6bd18b"/><path d="M213 126 q8 -12 16 -14 q-2 10 -16 16 Z" fill="#4fbf7a"/><path d="M213 126 q-1 -14 4 -22 q3 10 -4 22 Z" fill="#8ee6a6"/></g>
    <path d="M204 124 L222 124 L219 138 L207 138 Z" fill="#c97b5a"/><rect x="202" y="122" width="22" height="4" rx="1.5" fill="#e0956f"/>
    <rect x="276" y="116" width="7" height="16" rx="3.5" fill="#6bd18b"/><rect x="271" y="120" width="5" height="8" rx="2.5" fill="#6bd18b"/><path d="M270 130 L290 130 L287 138 L273 138 Z" fill="#9b7cf0"/>
    <g class="${id}-drops" fill="#7fd4ff"><circle cx="209" cy="119" r="1.3"/><circle cx="212" cy="122" r="1.1"/><circle cx="207" cy="124" r="1"/></g>
    ${girl(id)}
    <g class="${id}-p0">${arm('M140 128 Q160 120 176 114', 178, 114)}
      <g transform="translate(178 114) rotate(25)"><rect x="2" y="-6" width="18" height="12" rx="3" fill="#5ec2ff"/><path d="M20 -2 L30 -10" stroke="#5ec2ff" stroke-width="3" stroke-linecap="round"/><path d="M4 -5 q-2 -9 10 -8" stroke="#3a9fe0" stroke-width="2.2" fill="none"/></g></g>
    <g class="${id}-p1">${arm('M140 128 Q158 126 172 122', 175, 122)}
      <g transform="translate(175 122) rotate(-6)"><rect x="2" y="-6" width="18" height="12" rx="3" fill="#5ec2ff"/><path d="M20 -2 L30 -10" stroke="#5ec2ff" stroke-width="3" stroke-linecap="round"/><path d="M4 -5 q-2 -9 10 -8" stroke="#3a9fe0" stroke-width="2.2" fill="none"/></g></g>`,
    css: id => `${poseCss(id, 2, 2.4)}
      .${id}-drops{animation:${id}-drops 2.4s steps(1) infinite}
      @keyframes ${id}-drops{0%{transform:translateY(0);opacity:1}12%{transform:translateY(2px)}25%{transform:translateY(4px)}37%{transform:translateY(6px);opacity:1}50%,100%{opacity:0}}
      .${id}-grow{transform-origin:213px 126px;animation:${id}-grow 7.2s steps(1) infinite}
      @keyframes ${id}-grow{0%{transform:scale(.8)}33%{transform:scale(.9)}66%,100%{transform:scale(1)}}
      .${id}-clouds{animation:${id}-clouds 8s steps(8) infinite}
      @keyframes ${id}-clouds{to{transform:translateX(10px)}}` },

  // pôr do sol: pinta um quadro; o pincel pula de ponto em ponto (3 poses) e o desenho aparece aos poucos
  { key: 'paint', time: 'sunset', svg: id => `
    ${room(id, { time: 'sunset', inWindow: `<g class="${id}-birds" stroke="#4a2d5e" stroke-width="1.2" fill="none" stroke-linecap="round"><path d="M0 40 q3 -3 6 0 q3 -3 6 0"/><path d="M14 32 q2.4 -2.4 4.8 0 q2.4 -2.4 4.8 0"/></g>` })}${desk()}
    <path d="M214 138 L222 132 M246 138 L238 132" stroke="#6a5bb0" stroke-width="3" stroke-linecap="round"/>
    <rect x="198" y="86" width="54" height="48" rx="2" fill="${C.white}" stroke="#8f7ce0" stroke-width="3"/>
    <g fill="none" stroke-linecap="round" stroke-width="2.6">
      <circle class="${id}-s1" cx="236" cy="100" r="6" stroke="#ffb86b" stroke-dasharray="40" />
      <path class="${id}-s2" d="M204 124 q8 -12 16 0 t16 0 t12 -4" stroke="#ff6f91" stroke-dasharray="70"/>
      <path class="${id}-s3" d="M206 112 l10 -10 l8 8 l6 -6" stroke="#7b5cff" stroke-dasharray="40"/>
    </g>
    ${girl(id)}
    <g class="${id}-p0">${arm('M140 128 Q170 124 196 114', 199, 113, `<line x1="199" y1="113" x2="208" y2="104" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/>`)}</g>
    <g class="${id}-p1">${arm('M140 128 Q172 116 200 102', 203, 101, `<line x1="203" y1="101" x2="214" y2="96" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/>`)}</g>
    <g class="${id}-p2">${arm('M140 128 Q170 130 198 124', 201, 124, `<line x1="201" y1="124" x2="212" y2="120" stroke="#ffd166" stroke-width="2.4" stroke-linecap="round"/>`)}</g>`,
    css: id => `${poseCss(id, 3, 1.5)}
      .${id}-s1,.${id}-s2,.${id}-s3{animation:${id}-draw 7.5s steps(10) infinite}
      .${id}-s1{--l:40px}.${id}-s2{--l:70px;animation-delay:-2.5s}.${id}-s3{--l:40px;animation-delay:-5s}
      @keyframes ${id}-draw{0%{stroke-dashoffset:var(--l)}60%,100%{stroke-dashoffset:0}}
      .${id}-birds{animation:${id}-birds 9s steps(18) infinite}
      @keyframes ${id}-birds{from{transform:translateX(186px)}to{transform:translateX(300px)}}
      .${id}-city rect{animation:${id}-city 3s steps(2) infinite}
      @keyframes ${id}-city{50%{opacity:.3}}` },

  // 2. ouvindo música: cabeça no ritmo, notas subindo, disco girando
  { key: 'music', time: 'sunset', svg: id => `
    ${room(id, { time: 'sunset' })}${desk()}
    <g transform="translate(250 124)"><rect x="-30" y="2" width="60" height="12" rx="3" fill="#5a47a8"/><g class="${id}-disc" style="transform-origin:0 0"><ellipse cx="0" cy="0" rx="26" ry="7" fill="#15102e"/><ellipse cx="0" cy="0" rx="8" ry="2.4" fill="${C.phones}"/><path d="M-20 -1 A20 5 0 0 1 0 -5" stroke="#3b3270" stroke-width="1" fill="none"/></g></g>
    <g class="${id}-notes" fill="${C.phones}">
      <g class="${id}-n1"><circle cx="176" cy="96" r="3"/><rect x="178" y="82" width="1.6" height="14"/></g>
      <g class="${id}-n2" fill="#ff8fd6"><circle cx="196" cy="84" r="3"/><rect x="198" y="70" width="1.6" height="14"/><rect x="198" y="70" width="7" height="1.6"/></g>
      <g class="${id}-n3" fill="#ffd166"><circle cx="164" cy="74" r="2.6"/><rect x="166" y="62" width="1.4" height="12"/></g>
    </g>
    ${girl(id, { eyes: 'closed', head: `${id}-bob` })}
    <path d="M140 132 Q160 134 176 136" stroke="${C.hoodie}" stroke-width="10" stroke-linecap="round" fill="none"/><circle cx="179" cy="136" r="5" fill="${C.skin}"/>`,
    css: id => `
      .${id}-bob{animation:${id}-bob .9s steps(2) infinite}
      @keyframes ${id}-bob{0%,100%{transform:rotate(0)}50%{transform:rotate(5deg)}}
      .${id}-disc{animation:${id}-spin 1.6s steps(8) infinite}
      @keyframes ${id}-spin{to{transform:rotate(360deg)}}
      .${id}-n1,.${id}-n2,.${id}-n3{animation:${id}-note 3s steps(15) infinite}
      .${id}-n2{animation-delay:-1s}.${id}-n3{animation-delay:-2s}
      @keyframes ${id}-note{0%{transform:translateY(10px);opacity:0}20%{opacity:1}100%{transform:translateY(-22px);opacity:0}}` },

  // noite: lámen na mesa; os hashis vão da tigela à boca (2 poses), vapor subindo
  { key: 'noodles', svg: id => `
    ${room(id)}${desk()}
    <circle cx="204" cy="118" r="34" fill="url(#${id}-lamp)" opacity=".5"/>
    <path d="M182 126 Q184 140 204 140 Q224 140 226 126 Z" fill="#ff8fb8"/><path d="M190 132 h28" stroke="#ffd1e3" stroke-width="1.6" stroke-dasharray="3 3"/>
    <ellipse cx="204" cy="126" rx="22" ry="4" fill="#ffe6b0"/><circle cx="196" cy="125.5" r="3" fill="#fff" /><circle cx="196" cy="125.5" r="1.4" fill="#ffd166"/><rect x="208" y="123" width="8" height="3" rx="1" fill="#6bd18b"/>
    <g class="${id}-steam" stroke="#e8e0ff" stroke-width="1.6" fill="none" stroke-linecap="round" opacity=".7"><path d="M198 120 q-3 -5 0 -10 q3 -5 0 -10"/><path d="M206 120 q-3 -5 0 -10 q3 -5 0 -10"/><path d="M214 120 q-3 -5 0 -10 q3 -5 0 -10"/></g>
    ${girl(id, { eyes: 'closed' })}
    <g class="${id}-p0">${arm('M140 128 Q166 126 190 118', 192, 118, `<g stroke="#c97b5a" stroke-width="1.6" stroke-linecap="round"><line x1="192" y1="115" x2="204" y2="127"/><line x1="195" y1="114" x2="208" y2="125"/></g>`)}</g>
    <g class="${id}-p1">${arm('M140 128 Q166 120 162 106', 162, 104, `<g stroke="#c97b5a" stroke-width="1.6" stroke-linecap="round"><line x1="162" y1="102" x2="150" y2="97"/><line x1="164" y1="104" x2="151" y2="100"/></g><path d="M151 99 q2 4 -1 8 q-2 4 1 8" stroke="#ffe6b0" stroke-width="1.6" fill="none"/>`)}</g>`,
    css: id => `${poseCss(id, 2, 1.6)}
      .${id}-steam{animation:${id}-steam 3s steps(12) infinite}
      @keyframes ${id}-steam{0%{transform:translateY(4px);opacity:0}30%{opacity:.7}100%{transform:translateY(-10px);opacity:0}}
      .${id}-stars{animation:${id}-twinkle 2.4s steps(3) infinite}
      @keyframes ${id}-twinkle{50%{opacity:.3}}` },

  // 3. dormindo: cabeça apoiada na mesa, "z z z", gatinho respirando, estrelas piscando
  { key: 'sleep', svg: id => `
    ${room(id)}${desk()}
    <circle cx="282" cy="96" r="40" fill="url(#${id}-lamp)" opacity=".5"/>
    <g transform="translate(256 120)"><g class="${id}-cat" style="transform-origin:0 18px"><ellipse cx="0" cy="12" rx="20" ry="9" fill="#e9e1ff"/><circle cx="16" cy="6" r="7" fill="#e9e1ff"/><path d="M11 1 L13 -6 L17 0 Z M18 0 L22 -6 L23 2 Z" fill="#e9e1ff"/><path d="M13 7 q2 1.5 4 0" stroke="#8a7fc0" stroke-width="1" fill="none"/><path d="M-20 14 q-10 -2 -8 -10" stroke="#e9e1ff" stroke-width="4" fill="none" stroke-linecap="round"/></g></g>
    <path d="M88 186 Q88 146 110 132 Q132 122 156 128 L160 150 Q152 170 150 186 Z" fill="${C.hoodie}"/>
    <path d="M108 136 Q118 158 116 186" stroke="${C.hoodie2}" stroke-width="3" fill="none"/>
    <rect x="150" y="122" width="70" height="17" rx="8.5" fill="${C.hoodie}"/><rect x="160" y="126" width="56" height="9" rx="4.5" fill="${C.hoodie2}"/>
    ${head(id, { eyes: 'closed', transform: 'translate(54 34) rotate(64 125 84)' })}
    <g class="${id}-z" fill="${C.white}" font-family="Segoe UI, sans-serif" font-weight="700">
      <text class="${id}-z1" x="196" y="96" font-size="10">z</text><text class="${id}-z2" x="206" y="84" font-size="13">z</text><text class="${id}-z3" x="218" y="70" font-size="16">Z</text>
    </g>`,
    css: id => `
      .${id}-cat{animation:${id}-breathe 3.2s steps(8) infinite}
      @keyframes ${id}-breathe{50%{transform:scaleY(1.08)}}
      .${id}-z1,.${id}-z2,.${id}-z3{animation:${id}-z 3s steps(10) infinite}
      .${id}-z2{animation-delay:-1s}.${id}-z3{animation-delay:-2s}
      @keyframes ${id}-z{0%{opacity:0;transform:translate(0,6px)}30%{opacity:1}100%{opacity:0;transform:translate(6px,-10px)}}
      .${id}-stars{animation:${id}-twinkle 2.4s steps(3) infinite}
      @keyframes ${id}-twinkle{50%{opacity:.3}}` },

  // 4. chuva na janela: janela grande, chuva caindo, luzes da cidade, caneca nas mãos
  { key: 'rain', svg: id => `
    ${room(id, { rain: true })}
    <rect x="190" y="92" width="108" height="8" rx="3" fill="${C.deskTop}"/>
    <path d="M240 92 q6 -10 12 0 Z" fill="#6bd18b"/><rect x="243" y="86" width="6" height="6" rx="2" fill="#c97b5a"/>
    ${girl(id)}
    <g transform="translate(150 122)"><rect x="0" y="-4" width="14" height="14" rx="3" fill="#ffd166"/><path d="M14 0 q5 0 5 4 q0 4 -5 4" stroke="#ffd166" stroke-width="2" fill="none"/>
      <g class="${id}-steam" stroke="#e8e0ff" stroke-width="1.4" fill="none" opacity=".7"><path d="M4 -6 q-3 -4 0 -8 q3 -4 0 -8"/><path d="M10 -6 q-3 -4 0 -8 q3 -4 0 -8"/></g></g>
    <path d="M140 128 Q148 128 150 124" stroke="${C.hoodie}" stroke-width="10" stroke-linecap="round" fill="none"/>`,
    css: id => `
      .${id}-rain{animation:${id}-rain .6s steps(4) infinite}
      @keyframes ${id}-rain{from{transform:translate(0,-20px)}to{transform:translate(-4px,20px)}}
      .${id}-city rect{animation:${id}-city 3s steps(2) infinite}
      .${id}-city rect:nth-child(2n){animation-delay:-1.5s}
      @keyframes ${id}-city{50%{opacity:.25}}
      .${id}-steam{animation:${id}-steam 3s steps(12) infinite}
      @keyframes ${id}-steam{0%{transform:translateY(3px);opacity:0}30%{opacity:.7}100%{transform:translateY(-8px);opacity:0}}` },

  // 5. no computador: monitor com código rolando, teclado RGB em onda, digitando
  { key: 'computer', svg: id => `
    ${room(id, { window: false })}${desk()}
    <g transform="translate(206 70)">
      <rect x="0" y="0" width="84" height="56" rx="5" fill="#141033" stroke="#4a3a86" stroke-width="3"/>
      <rect x="4" y="4" width="76" height="48" rx="2" fill="#0d0a24" class="${id}-screen"/>
      <clipPath id="${id}-code"><rect x="4" y="4" width="76" height="48"/></clipPath>
      <g clip-path="url(#${id}-code)"><g class="${id}-lines">${Array.from({ length: 12 }, (_, i) => `<rect x="${8 + (i % 3) * 6}" y="${8 + i * 8}" width="${20 + ((i * 17) % 36)}" height="3" rx="1.5" fill="${['#5ef0d6', '#ff8fd6', '#c9bfff', '#ffd166'][i % 4]}" opacity=".85"/>`).join('')}</g></g>
      <rect x="6" y="40" width="3" height="6" fill="${C.screen}" class="${id}-cursor"/>
      <rect x="36" y="56" width="12" height="10" fill="#3a2c6e"/><rect x="26" y="66" width="32" height="4" rx="2" fill="#3a2c6e"/>
    </g>
    <ellipse cx="248" cy="98" rx="52" ry="40" fill="${C.screen}" opacity=".05" class="${id}-glow"/>
    <defs><linearGradient id="${id}-kb" gradientUnits="userSpaceOnUse" x1="170" x2="250" spreadMethod="repeat"><stop offset="0" stop-color="#ff4fd8"/><stop offset=".33" stop-color="#7b5cff"/><stop offset=".66" stop-color="#2ee6c5"/><stop offset="1" stop-color="#ff4fd8"/></linearGradient></defs>
    <rect x="176" y="131" width="62" height="7" rx="2" fill="#1b1540"/>
    <g class="${id}-kbwrap"><rect x="178" y="132.5" width="58" height="4" rx="1" fill="url(#${id}-kb)" opacity=".9"/></g>
    ${girl(id)}
    <g class="${id}-type1"><path d="M140 128 Q160 130 184 132" stroke="${C.hoodie}" stroke-width="10" stroke-linecap="round" fill="none"/><circle cx="187" cy="132" r="5" fill="${C.skin}"/></g>`,
    css: id => `
      .${id}-lines{animation:${id}-scroll 6s steps(24) infinite}
      @keyframes ${id}-scroll{from{transform:translateY(0)}to{transform:translateY(-48px)}}
      .${id}-cursor{animation:${id}-blink 1s steps(2) infinite}
      @keyframes ${id}-blink{50%{opacity:0}}
      .${id}-glow{animation:${id}-glow 3s steps(6) infinite}
      @keyframes ${id}-glow{50%{opacity:.12}}
      .${id}-kbwrap{animation:${id}-kb 2s steps(10) infinite}
      @keyframes ${id}-kb{50%{opacity:.55}}
      .${id}-type1{animation:${id}-type .5s steps(2) infinite}
      @keyframes ${id}-type{50%{transform:translate(3px,1px)}}` }
];

// LED da parede (comum às cenas) e piscar dos olhos
const commonCss = id => `
  .${id}-blink{animation:${id}-eye 4s steps(1) infinite;transform-origin:138px 86px}
  @keyframes ${id}-eye{0%,92%,100%{transform:scaleY(1)}94%{transform:scaleY(.1)}}
  .lofi-paused *{animation-play-state:paused!important}`;

// A ordem do "filme": um dia inteiro, da manhã até dormir, e recomeça.
const STORY = ['wake', 'study', 'plants', 'paint', 'music', 'computer', 'rain', 'noodles', 'sleep'].map(k => SCENES.find(s => s.key === k));

export const LOFI_COUNT = STORY.length;
/** Quanto tempo cada cena fica antes de o filme cortar para a próxima. */
export const LOFI_SCENE_MS = 9000;

/** SVG (texto) da cena i, na ordem do dia. */
export function lofiSvg(i) {
  const s = STORY[((i % STORY.length) + STORY.length) % STORY.length];
  const id = `lf${i}`;
  return `<svg viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg" role="img" preserveAspectRatio="xMidYMid slice"><style>${commonCss(id)}${s.css(id)}</style>${s.svg(id)}${tint(s.time)}</svg>`;
}

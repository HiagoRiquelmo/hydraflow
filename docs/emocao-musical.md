# Iluminação pela emoção da música (Ambiente da Tela → "Som do PC")

Versão 1.1. Tudo roda localmente, no próprio áudio do PC; nada é enviado para fora e nenhuma dependência nova foi
instalada.

## Arquitetura em três camadas

| Camada | Arquivo | Ritmo | O que faz |
|---|---|---|---|
| 1. Análise do áudio | `src/renderer/js/audio/analysis.js` | 50×/s (notas: 10×/s) | Volume RMS e nível típico, faixa dinâmica, centroide espectral, fluxo espectral, separação harmônico/percussivo (aproximada), ataques, batidas, BPM, cromagrama com supressão de harmônicos, acordes (maior/menor/power chord/ambíguo), dissonância, distorção (planicidade 300–2500 Hz fora das batidas), voz/melodia contra o acorde, linha solista, faixas do mixer |
| 2. Interpretação emocional | `src/renderer/js/audio/emotion.js` | 10×/s, eixos com suavização de segundos | Três eixos independentes (0..1): **valência** (tristeza ↔ alegria), **energia** (calma ↔ intensidade), **tensão** (serenidade ↔ agressividade); confiança por eixo; sentimento predominante com histerese (~2 s); clímax (solo, breakdown, explosão) |
| 3. Motor de iluminação | `src/renderer/js/audio/lighting.js` | a cada quadro | Paleta (cor predominante + 2 secundárias) pela mistura de pontos de referência no espaço dos três eixos + tinta de cada eixo; saturação; brilho (dinâmica + pulso, com teto); pulsação nas batidas com antiestroboscópio; velocidade pela movimentação; transições graduais |

`src/renderer/js/soundReact.js` só junta as três camadas e mantém a interface antiga (`state()`, `info`, `bands`,
`peaks`), então o resto do app (mixer, papel de parede, cooler, dispositivos) não mudou.

## Controles (2.0)

- **Brilho** (`reactBrightness`, 5–100%): multiplica o brilho de tudo que vai aos LEDs, pulsos incluídos.
- **Intensidade do pulso** (`pulseIntensity`, 0–100%): só a AMPLITUDE do clarão nas batidas — o pico sobe uma
  fração da folga entre o brilho de base e o máximo (`env = base + (1 − base) · intensidade · forma`). Instante,
  duração e queda do pulso vêm só da música; o brilho de base fica em no máximo 70% para sobrar folga e o pico nunca
  bater no teto (bater mudaria a forma). Conferido: 25/50/100% → picos +0,11/+0,22/+0,43 nos mesmos instantes e com
  a mesma meia-vida (130 ms).
- **Calibração da emoção** (2 controles, −50..50): desloca cada eixo em até ±0,25, como preferência pessoal.

Saíram na 2.0: Sensibilidade musical, Intensidade dos efeitos e Suavização das transições (o motor usa valores fixos:
movimento 60%, transição de cor de ~4 s).

## Tom maior / menor (2.0)

`EmotionEngine.updateKey`: soma suavizada (~3 s) da correlação com os perfis de tom (`modeScore`) e da fração do
tempo em acordes menores (`minorRatio`, que desempata tons relativos como Dó maior x Lá menor). Só decide com ≥6 s de
música, harmonia clara e sem power chords dominando; troca depois de ~3 s seguidos. A tela mostra "Tom maior",
"Tom menor" ou "identificando…", e o tom firme puxa a valência ±0,07 (menor → cores do lado triste, maior → alegre).
Medido com piano triste real: "Tom menor" estável, valência 0,31–0,46.

## Modelo de dois eixos (1.2.0)

A tela e as cores passaram a usar só dois eixos, definidos pelo dono do projeto:

- **Triste ↔ Alegre**: azul puro até 42%, passagem por um verde-azulado discreto de 42% a 58%, amarelo puro de
  58% em diante.
- **Calmo ↔ Raiva** (antes "Agressivo"): ciano até 15%, vermelho carmesim em 60%, roxo puro de 90% em diante. O valor é metade
  energia, metade tensão (camada 2): música animada e limpa fica no carmesim; pesada e distorcida chega no roxo.
  O clímax empurra para o roxo.

A fita leva três cores: a de Triste ↔ Alegre, a mistura das duas (com a saturação reforçada) e a de Calmo ↔
Agressivo. Energia continua decidindo brilho, movimento e pulsação. A calibração ficou com dois controles; o
"Calibrar Calmo ↔ Agressivo" usa a chave antiga `biasEnergy`, e `biasTension` saiu.

Medido com faixas reais pelo Som do PC: piano triste → Triste/Calmo (azul, Calmo ↔ Agressivo 0,28); pop alegre →
0,62 (carmesim); heavy metal → 0,95 (roxo, "Agressividade"). A leitura Triste ↔ Alegre do pop variou entre neutra
e triste de uma execução para outra (limitação do tom maior/menor, abaixo).

## Calibração com gravações reais (1.1.1)

Na 1.1.0 a tensão ficava em "Agressividade" quase o tempo todo com música real: a medida de distorção (espectro
"sujo" em 300–2500 Hz) tinha sido calibrada com sons sintéticos puros, e qualquer produção cheia (voz, pratos,
reverb, guitarras) já passava do limite. Foi recalibrada tocando faixas livres de direitos (Pixabay) pelo Som do PC:

| Faixa real | Planicidade | Tensão 1.1.0 | Tensão 1.1.1 (mediana; faixa 10–90%) |
|---|---|---|---|
| Heavy metal | 0,46 | 0,78 | 0,98 (0,81–0,98) |
| Rock animado | 0,30 | 0,92 | 0,38 (0,31–0,68) |
| Pop alegre | 0,25 | 0,84 | 0,28 (0,20–0,33) |
| Eletrônica (EDM) | 0,12 | 0,69 | 0,04 (0,00–0,25) |
| Lo-fi | 0,03 | 0,23 | — (sem mudança: medidas abaixo dos limites) |
| Violão calmo | 0,03 | 0,09 | — |
| Piano triste | 0,01 | 0,15 | — |

Também na 1.1.1: a tensão acompanha a variação dentro da própria música (trecho mais pesado que o normal dela sobe,
mais leve desce); trilha muito escura e pulsando soma tensão; transições de cor em duas etapas (~4 s, com limite
de velocidade por canal); régua Triste ↔ Alegre com o azul até ~40% e verde suave no meio.

## Testes (sintéticos, nível igual para todos — referência da 1.1.0; a 1.1.1 foi calibrada com áudio real)

| Música de teste | Valência | Energia | Tensão | Emoção | Cores |
|---|---|---|---|---|---|
| Piano triste e lento | 0,33 | 0,21 | 0,17 | Tristeza | azul, ciano |
| Clássica tranquila | 0,44 | 0,20 | 0,01 | Tranquilidade / tristeza | ciano, azul |
| Pop alegre (120 BPM) | 0,44 | 0,67 | 0,02 | Energia | verde-água, ciano, amarelo, azul |
| Eletrônica (130 BPM) | 0,53 | 0,65 | 0,81 | Agressividade | vermelho, laranja |
| Heavy metal | 0,57 | 0,78 | 0,85 | Agressividade | vermelho, laranja |
| Suspense | 0,45 | 0,21 | 0,68 | Tensão / suspense | azul-marinho, carmesim, vinho |
| Ambiente | 0,51 | 0,23 | 0,08 | Tranquilidade | ciano, verde-água |
| Triste e intensa (120 BPM) | 0,41 | 0,65 | 0,10 | Tristeza intensa | azul, ciano, verde |
| Metal (120 BPM) | 0,55 | 0,66 | 0,81 | Agressividade | vermelho, laranja |
| Rock: intro → refrão → final | 0,58 → 0,62 → 0,63 | 0,60 → 0,82 → 0,11 | 0,06 → 0,75 → 0,04 | leve → agressiva → serena | verde/amarelo → vermelho/laranja → verde-água/ciano |

Critérios: mesmo BPM (120) e mesmo volume dão iluminações diferentes (pop, triste e intensa, metal); os três eixos
assumem valores independentes; o rock muda de cor por trecho; triste e intensa não vira alegre; rápido não vira
agressivo sem distorção/dissonância. Controles: Intensidade dos efeitos 0 → 100 multiplica pulso e velocidade por
~4; Suavização 0 → 100 reduz o maior salto de cor por quadro de 9 para 3 (em 255); calibração +50 muda a leitura.
Desempenho: 0,14 ms por passo de análise (≈0,7% de um núcleo).

## Limitações conhecidas

- É uma **estimativa acústica**, não reconhecimento de emoção humana: não entende letra, contexto nem gênero, e a
  mesma música pode ser sentida de formas diferentes. Por isso há confiança e "incerto" no painel.
- A estimativa de **tom** confunde maior/menor relativos (Dó maior × Lá menor); por isso pesa pouco. A valência vem
  principalmente da proporção de acordes menores, e música alegre com muitos acordes menores (ou triste em acordes
  maiores) pode ser lida perto do neutro. No teste sintético, o pop alegre ficou em 0,44 (neutro).
- Trilha de suspense real é difícil: o tom de drones graves oscila entre maior e menor de uma medição para outra, e
  a tensão dela pode sair baixa.
- Os primeiros ~8 s de cada música têm confiança baixa (a análise ainda está aprendendo o "normal" da música).
- Os testes foram feitos com sinais sintéticos; com música real os números mudam. A calibração existe para o
  ajuste fino de cada pessoa.
- Foram avaliados modelos prontos de reconhecimento de emoção (Essentia: licença não comercial; YAMNet: Apache 2.0,
  ~4 MB, com classes de clima musical). Ficaram de fora a pedido do dono do projeto (sem dependências novas); o
  YAMNet pode entrar depois como "segunda opinião" na camada 2 sem mexer nas outras.

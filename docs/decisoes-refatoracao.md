# Registro de decisões — refatoração "untangle-codebase" (18/11/2026)

Backup de antes: `%USERPROFILE%\RGBStudio-backups\hydraflow-antes-untangle-2026-11-18.zip`.
Extras escolhidos: **Comentários** e **Testes**.

## Correções (cada uma acima dos problemas que resolve)

- **A1. O motor trata todo dispositivo do mesmo jeito através de um "provedor" (`plugin`, `openrgb`, `ram`)** com os mesmos métodos (`publish`, `setEnabled`, `reload`), então a lista, o liga/desliga e o recarregar deixaram de ter um `if` por tipo.
  - `engine.js` `publicDevice`, `setEnabled` e `reload` tinham um ramo por provedor.
  - "Remover todos os dispositivos do provedor X" estava copiado 5 vezes → `removeProvider()`.
  - Limite de 33 ms copiado em `orgbRender` e `ramRender` → `throttled()`.
  - `if (rt.provider) continue` espalhado em `scan`, `rescan` e `shutdown`.

- **A2. Um módulo guarda o contrato do auxiliar de memória** (`src/smbus/protocol.js`: nome da tarefa, caminhos, cliente do soquete com autenticação).
  - Caminhos do auxiliar copiados em `main.js`, `helperMain.js` e `ramSupport.js`.
  - `TASK = 'HydraflowMemoriaRGB'` copiado em `ramSupport.js` e `helper.js`.
  - Cliente do soquete escrito duas vezes (`engine.js` e `ramSupport.stopHelper`).

- **A3. Um jeito só de rodar PowerShell e de pausar** (`src/common/powershell.js`, `src/common/sleepSync.js`).
  - `queryPowerShell` (main), `ps` (ramSupport) e `execFile('powershell.exe')` (helper).
  - Pausa com `Atomics.wait` copiada em `pluginHost.js` e `bus.js`.

- **A4. O catálogo de efeitos é dono dos seus arquivos** (miniaturas, importar, remover, extensões de imagem, URLs `file://` via `pathToFileURL`/`fileURLToPath`).
  - Nome SHA-1 da miniatura calculado em `main.js` e `effects.js`.
  - Conversões `'file:///' + …` feitas à mão em 4 lugares, e o inverso com `decodeURI` em 2.
  - Lista de extensões de imagem copiada 3 vezes.
  - Remoção de efeito dentro do handler IPC em vez do catálogo.

- **A5. Só o processo principal entende efeitos e ids**: itens do Explorar chegam com `effectId` e com os parâmetros já lidos; depois de obter/remover, a tela recarrega a lista.
  - `views/effects.js` remontava o id (`'user:' + arquivo`).
  - `js/effectMeta.js` era um segundo leitor de `<meta>` (removido).
  - `cat.items` era remendado à mão após instalar/desinstalar.

- **A6. O Store guarda todos os padrões e é a única fonte de configuração**, inclusive do que o motor precisa saber (`engineConfig` em `main.js`).
  - `main.js` lia o `config.json` direto para decidir a GPU.
  - Padrões do OpenRGB fora do Store; `ram.enabled` lido de dois jeitos.
  - Caso especial `virtualDevices` no canal `engine:cmd` (e gravação dupla em `app.js`).
  - Efeito padrão escolhido pelo nome (`'Onda Espectral'`) → padrão do Store.
  - Chaves mortas `pluginSource`, `ui.libraryTab`, `ui.effectSort`.

- **A7. Uma classe `EffectFrame` fala o protocolo do iframe de efeito** (efeito ativo, prévia e miniatura); o tamanho do canvas vai ao host como configuração.
  - `effectRunner.js` e `effectPreview.js` repetiam o handshake do iframe.
  - 320×200 fixo em `effectPreview.js`, `playback.js` e `effect-host.html`.
  - Geração do PNG da miniatura copiada → `framePng()`.

- **A8. A geometria dos componentes fica num lugar só** (`renderer/js/components.js`); o principal só carrega os `.json` do usuário.
  - Formato de fita montado em `autoSetup.js` e `main/components.js` (+ IPC `components:customStrip`).
  - Chave de item `dev::ch::canal::id` copiada → `componentKey()`.

- **A9. Navegação pelo barramento de estado** (`navigate()` em `state.js`) em vez de `window.__navigate`.

- **A10. O motor publica o estado inicial sozinho**: some o comando `openrgbStatus` e a mensagem `hello`; o caminho do log de desligamento vem do principal.

- **A11. Descoberta de plugins compartilhada** (`src/engine/discovery.js`) entre o motor e `scripts/detect.js`; uma só E/S "nula" (`nullIo`).

- **A12. Status da RAM chega como patch** e é mesclado — some o caso especial de mensagem só com `busy`.

- **A13. `modal()` expõe `close` e trata Enter**: `prompt` e o seletor de componente deixaram de procurar o diálogo no DOM.

- **A14. Sobras removidas**: espera por `pluginStatus` (nada definia), `uninstallTask`, `hasValidate`, `emit('brightness')` sem ouvinte, API do editor sem uso, exports sem uso, IPC sem uso (`folders:open`, `system:info`, `shell:openExternal`, `explore:installed`), remapeamento de telas antigas, `import()` dinâmico sem ciclo, ícones do player fora do registro de `ui.js`, cor antiga `#20d6c7` fixa no editor (agora classes CSS), layout vazio repetido 4 vezes, reescrita do autor antigo rodando a cada abertura (agora só na migração).

## Casos especiais que ficam (o sistema precisa deles)
- Alternativa que roda o auxiliar no próprio processo se o `spawn` falhar.
- Ignorar no OpenRGB controladores que já têm plugin próprio ou RAM nativa.
- "Piscar canal" sem componentes passa pelo motor (não há item no layout para amostrar).
- Checagem de `<canvas` ao instalar um efeito do catálogo.
- Migração RGB Studio → Hydraflow.
- Cópia do `config.json` para `.corrompido` se ele não puder ser lido.

## Extras
- **Testes:** `scripts/check.js` era a única verificação; a parte de efeitos só imprimia e nunca falhava. Agora falha se um efeito não for lido, se um padrão tiver o tipo errado ou estiver fora da lista de valores, e se um plugin tiver geometria inválida ou LED fora da grade.
- **Comentários:** 72 removidos (divisórias de seção e frases que repetiam a linha seguinte). Ficaram os que explicam algo de fora do código: fatos de hardware, protocolo, formato de arquivo, decisões de produto.

## Segunda rodada (revisão por subagentes)
Bugs corrigidos:
- Depois de suspender/retomar o PC, o motor ficava parado (laços e conexões não voltavam) e o auxiliar de memória não era reiniciado. Agora há a mensagem `resume`. (Bug antigo, de antes da refatoração.)
- `explore.js`: a variável local `fileUrl` escondia a função importada; um índice local com imagem quebraria o catálogo inteiro. (Introduzido nesta refatoração e corrigido.)
- RAM: erros do SMBus agora aparecem na interface; ao desconectar, as memórias do OpenRGB voltam a valer; cores são reenviadas após redetectar.
- Pastas extras de efeitos: ids estáveis (hash da pasta) em vez da posição na lista.
- Editor de layout: um clique sem arrastar apagava o histórico de refazer.
- Fila de miniaturas do Descobrir enfileirava o mesmo item várias vezes e repetia falhas para sempre.
- Diagnóstico mostrava "0x0000 / undefined" para dispositivos do OpenRGB e da RAM.
- Plugins que não carregam agora aparecem num aviso em Dispositivos (antes eram descartados).

Estrutura:
- `setConfig()` é o único caminho de gravação no principal, e avisa o motor (inclui as pastas de plugins).
- Ajustes de dispositivo têm um só escritor: o motor lê o que foi salvo e os comandos só aplicam ao dispositivo vivo.
- Linha de comando do auxiliar em `protocol.js` (`helperArgs` / `parseHelperArgs`); `safeId()` para ids que viram caminhos do store.
- Miniaturas do Descobrir derivadas pelo catálogo (`thumbId`/`thumb`); some a chave `exploreThumbs` do store.
- Interface: `pulse()`, `defaultTuning()`, `componentLabel()`, `onlyDefaults/replaceDefaults` em components.js, `statusChip()`, `setEffects()`, `closeAllModals()`, `EffectFrame` com opção `fit`, `runner.clearConsole()`, ícone `search` no registro, `moreButton` reaproveitado.
- Sobras removidas: `ram:disable`/`stopHelper` (sem tela que use), `ram:redetect` (passa direto pelo motor), `components:changed`, campos de status nunca lidos, eventos sem ouvinte (`presets`, `favorites`, `playlists`), `debounce`, `hasPrevious`, ramos inalcançáveis do painel do OpenRGB, `version` do store, `close()` do barramento.

Deixado de lado de propósito (baixo ganho): o evento `devices` usado para "lista do motor mudou" e "ajuste salvo"; espera fixa de 2,5 s antes de fotografar a miniatura do efeito ativo; botões do OpenRGB repetidos entre Ajustes e Dispositivos.

## Leveza em segundo plano (19/11/2026)
Medição: o JavaScript da janela e do efeito ficava 99% ocioso; o custo estava em mover o quadro inteiro
(320×200 RGBA = 256 KB, 30 vezes por segundo) do processo do efeito para o da janela.
- O host do efeito agora devolve só os pixels sob os LEDs (tabela `gather` montada pelo sampler): 912 bytes por quadro em vez de 256 KB.
- Quadros inteiros só enquanto alguém pede (`runner.wantFrames()`): a prévia da Iluminação e a miniatura.
- Prévias que ninguém lê (Descobrir) não capturam nada; efeito pausado não recaptura um quadro que não muda.
- Cores iguais às anteriores não são reenviadas, nem do efeito para a janela nem da janela para o motor (reenvio a cada 1 s, caso o motor reinicie).
- Captura lê direto do canvas 2D do efeito quando o tamanho bate (sem cópia intermediária).
- Testado e descartado (sem ganho mensurável): esconder o canvas da pintura; rodar a composição dentro do processo principal (`in-process-gpu`).

Resultado (janela minimizada, CPU somando todos os processos):
| Situação | Antes | Depois |
|---|---|---|
| Efeito estático (Cor Sólida) | ~8% (custo fixo do quadro) | 1,5% |
| Efeito pesado (Lâmpada de Lava) | 8,7% | 5–7% (varia com o próprio efeito) |

O que sobra é o desenho do próprio efeito. Reduzir de 60 para 30 chamadas por segundo deixaria lentos os efeitos que avançam "por quadro", então ficou como está.

## Versão 0.8 (19/11/2026)
- **Efeitos para baixar em vez de pré-instalados.** Só a Cor Sólida (e o Ambiente da Tela, que é um modo do app) ficam em `effects/`; os outros foram para o pacote `efeitos-extras/`, que aparece no Descobrir. "Todos" mostra só o que está instalado; o Descobrir tem filtro por categoria e "Baixar todos" (IPC `explore:installMany`, que relê a biblioteca uma vez só).
  - Cada item movido guarda `formerId` (a id antiga). `migrateBuiltinToExtras()` instala, na abertura, só os efeitos que a pessoa usava (tocando, favoritos, playlists, presets) e troca as ids com `renameEffectIds()`, o mesmo caminho da migração anterior. Uma falha ali nunca impede o app de abrir.
  - `scripts/check.js` valida o pacote: índice, arquivos, capas, ids únicas e parâmetros.
- **Ambiente da Tela.** Uma fonte de cores com a mesma interface do `EffectFrame` (`screenSource.js`); o `EffectRunner` escolhe a fonte pela linha `<meta screen-capture="true" />` do efeito, então o resto do app (amostragem, prévia, pausa, parâmetros) não sabe a diferença. A captura usa a tela principal (`screen:source`), já reduzida pelo Windows; reduzir para uma miniatura e ampliar com suavização dá a média de cada região ("Detalhe"). A imagem nunca sai da janela.
  - Laço por timer: com a janela minimizada o Chromium segura `requestVideoFrameCallback` em ~1 por segundo.
  - Custo medido (minimizado): ~10% de um núcleo, quase todo na captura do Windows; parecido com um efeito animado.
- **Revisão por subagentes (estrutura, bugs, leveza) — corrigido:**
  - "É o modo tela?" decidido uma vez, no catálogo (`fx.screen`, só para efeitos que vêm com o app — um efeito baixado não liga a captura). Sai a detecção solta de `tags` que ninguém lia.
  - Efeito sumido cai na Cor Sólida (`fallbackEffect()`), nunca no Ambiente da Tela; o timer/próximo/aleatório sem playlist pula o modo tela; o modo tela não gera miniatura (seria uma foto da área de trabalho) nem mostra o controle de velocidade.
  - Modo tela: processa uma vez mesmo pausado quando algo muda (layout, ajuste, efeito novo); média de verdade na redução (dois passos, qualidade alta); LEDs leem a miniatura com mistura suave entre regiões, a imagem 320×200 só existe com a prévia aberta; suavização em ponto flutuante; captura que termina (monitor, bloqueio) recomeça sozinha; padrões só no `<meta>` do efeito.
  - Trocar de efeito limpa as cores do anterior (se o novo falhar, os LEDs não ficam presos nelas).
  - Instalações em fila dentro do `Explore` (antes, duas ao mesmo tempo criavam "Efeito (2)" ou perdiam registros); a lista de itens é trocada inteira no fim da busca; "Baixar todos" trava os outros botões e respeita busca/categoria; ajustes feitos antes (id antiga) passam para a id nova ao baixar (`adoptSettings`); preset vazio não conta como "em uso".
  - Tamanho do canvas em `canvas.js` (geometria não importa mais o executor de efeitos).
  - **Motor só escreve no hardware quando as cores mudam** (quadro novo, piscada ou comando); antes regravava tudo ~30 vezes por segundo mesmo parado. A janela já reenviava as cores a cada 1 s, o que serve de "mantenha vivo".
  - Status do OpenRGB/RAM só vai à janela quando muda (com o OpenRGB fechado, a tela de Dispositivos abria um PowerShell a cada 5 s).
  - Host do efeito não captura quando não há LEDs; bolinha "Tocando" anima 3 vezes e para; corretor ortográfico desligado; aviso de erro do motor some quando ele reinicia; aviso de HID duplicado removido.
  - Cópias de backup que estavam dentro de `src/` foram para `RGBStudio-backups\backups-de-dentro-do-src`.
  - Medido (minimizado): Cor Sólida 1,35%; Ambiente da Tela com a tela parada 1,8% (antes ~11%).
- **Deixado de lado de propósito** (muito trabalho para o ganho, ou risco no hardware): mover o efeito para uma janela oculta separada da interface; canal direto janela↔motor (`MessageChannelMain`); listagem de HID assíncrona; leitura só da região dos LEDs no host do efeito; juntar as camadas antigas do CSS e remover classes sem uso; mensagens do motor marcadas como estado/evento; avisar a janela quando o principal grava no store; unificar os construtores de descritor de dispositivo e o protocolo do auxiliar de memória.
- **Tela do watercooler (Gamdias AURA GL360 LCD):** não implementado. O cooler aparece no Windows como "Unknown USB Device (Port Reset Failed)" e o protocolo da tela não é público.

## Versão 0.8.1 (19/11/2026)
- **Descobrir mostra só o que não está instalado** (ou tem versão nova); baixar move o efeito para "Todos". O Ambiente da Tela saiu da biblioteca (`library()` em views/effects.js) e ganhou aba própria.
- **Abas novas abaixo de Iluminação:** Ambiente da Tela, Papel de Parede, Watercooler.
- **Ambiente da Tela reage a jogos pelo som** (`soundReact.js`): o som do Windows vem junto com a captura da tela (`chromeMediaSource: 'desktop'` no áudio). "Som do PC" faz o brilho seguir o volume; "Valorant (spike)" reconhece bipes (tom puro, curto, sempre na mesma altura, 1,2–6 kHz), muda a cor do amarelo ao vermelho conforme o ritmo acelera e segura vermelho no estrondo que vem logo depois dos bipes rápidos. Nada lê dados do jogo. Testado com sinal sintético (bipes acelerando + ruído); no jogo de verdade, ainda não. A reação entra depois da suavização, para as piscadas ficarem secas.
- **Papel de parede animado** (`src/wallpaper`): processo separado com a placa de vídeo ligada (o app principal continua sem GPU), uma janela por monitor pendurada atrás dos ícones (Progman/WorkerW, com o caminho do Windows 11 24H2+ e o antigo), via `koffi`. Pausa quando um app em tela cheia está na frente. O app o encerra apagando um arquivo de controle (`papel-de-parede-*.run`; app Electron no Windows não tem entrada padrão utilizável) e ele também sai se o app morrer; ao sair, pede ao Windows para redesenhar o papel de parede normal. Medido: ~6,5% de um núcleo com um vídeo visível.
- **Watercooler:** aba com diagnóstico do USB (Get-PnpDevice) e a imagem escolhida (rotação, brilho) guardada no store. O envio para a tela não existe: o Windows não lê o cooler deste PC e o protocolo não é público.

## Versão 0.9.0 (19/11/2026)
- **Tela do watercooler funcionando de verdade (código pronto; falta o USB do cooler voltar):** protocolo das telas
  Gamdias levantado do ZEUS CAST (docs/protocolo-tela-gamdias.md) e implementado em `src/main/coolerLcd.js`
  (HID via node-hid; serial via kernel32/koffi, sem módulo extra). O histórico de dispositivos do Windows confirma
  que o cooler deste PC é o `1B80:B547`. `coolerStream.js` manda imagem parada (a cada 3 s) ou GIF quadro a quadro;
  nada é decodificado enquanto não há cooler (procura a cada 15 s pelo registro, ~100 ms, sem PowerShell).
  `scripts/check.js` confere moldura, soma, escape e pedaços HID.
- **Papel de parede cobre a tela inteira:** o Chromium reservava ~7 px de margem invisível em janelas sem moldura.
  A página informa os pixels que recebeu e a janela cresce o que faltou (vale para qualquer resolução/escala);
  estilos de moldura removidos com `SWP_FRAMECHANGED`; vigia a cada 3 s (Explorer reiniciado, resolução trocada).
  Novo ajuste "Esticar" (cobre sem cortar).
- **Captura nativa DXGI** (`src/capture/dxgiCapture.js`, utilityProcess): Desktop Duplication + mipmaps na placa;
  só ~120×68 vem para a CPU. Quadros só quando a tela muda, processados na chegada. Volta à captura do Chromium
  se falhar. O som (reação a jogos) é capturado à parte, descartando a imagem.
- **WLED** no motor: controladoras de fita na rede como dispositivos (DNRGB/UDP 21324), adicionadas por IP em
  Dispositivos → Fita WLED (o app confere em `/json/info`). Testado com um WLED simulado.
- Medido: captura nativa ~3% de um núcleo (tela mudando); o GIF do cooler era decodificado 15x/s sem cooler
  conectado — corrigido.

## Etapa 0.10, fases A e B (19/11/2026)
Plano completo em `docs/auditoria-etapa-0.10.md`. Backup antes: `RGBStudio-backups\hydraflow-antes-etapa-0.10-2026-11-19.zip`.
Medição de referência (app 0.9.0 instalado, 30 s, `scripts/measure.ps1`): 15,7% de um núcleo, 459 MB privados, 13 processos.

- **Tela do watercooler funcionando.** O AURA GL360 deste PC aparece como `1B80:B547` com a interface `MI_00` como
  **porta serial (COM3)**, e o app só procurava esse ID como HID (serial só em `1D6B:0111`). Agora procura as portas COM
  de qualquer interface dos modelos conhecidos (`GAMDIAS_MODELS`) e também o HID.
  - Cada comando confere a resposta `200` (`parseReply`: moldura, escape, soma). Modelo, firmware, hardware e app da
    tela são lidos do `conn` e aparecem na aba.
  - Diagnósticos separados (`LcdError.code`): busy (porta aberta por outro programa: erro 5 do `CreateFile`; a porta COM
    é sempre exclusiva no Windows), gone, open, no-response, protocol, send; além de usb-error, incompatible e missing.
  - Reconexão: 3 s depois de uma queda (antes 15 s). "Mostrar no cooler" desligado: o principal recusa quadros e a
    verificação só detecta, sem abrir a porta.
  - GIF em loop: cada quadro é codificado em JPEG uma vez e reaproveitado (antes: decodificar + codificar 15x/s para sempre).
  - Testado no hardware (`scripts/cooler-test.js`): detecção, aperto de mão em ~290 ms, imagem de 16 KB em 2 ms,
    60 quadros a 15/s sem falha, brilho, fechar e reabrir, porta ocupada → "busy" e volta quando liberada; no app:
    reiniciar reconecta sozinho. A tela não confirma quadros (nenhuma resposta depois de um JPEG), mas continua
    respondendo `200` aos comandos depois de 60 quadros.
- **RAM: botão "Ativar" voltando.** Duas causas:
  1. O `Iniciar Hydraflow.cmd` (electron.exe) e o app instalado (Hydraflow.exe) usavam a mesma tarefa agendada, que só
     valia para um executável: cada troca invalidava a permissão, o auxiliar não subia na abertura e o painel pedia
     "Ativar" (e o UAC) de novo. Agora cada executável tem a sua tarefa (`taskName(exe)`); a de nome antigo continua
     valendo para quem ela aponta.
  2. "Auxiliar de pé" era decidido pelo PID do `smbus.json`: arquivo que sobrou + PID reaproveitado = app achando que
     estava tudo certo, sem nunca conectar. Agora é uma conexão autenticada (`probeHelper`); arquivo órfão é apagado.
  - Tarefa registrada por XML com o SID do usuário (o `Register-ScheduledTask` com os cmdlets `New-ScheduledTask*`
    falhou duas vezes com "The parameter is incorrect" no `memoria.log`).
  - Ativação não roda duas vezes; na abertura o painel mostra "Conectando" em vez do botão.
  - Testado: auxiliar real responde em 3 ms; arquivo velho com PID vivo e token errado são recusados; app reiniciado
    reconecta aos 2 pentes. **Falta:** ativação do zero com o UAC na versão de desenvolvimento (precisa de você).
- **Papel de parede preto ao voltar do navegador.** Uma janela maximizada no Windows 11 passa ~8 px de cada borda e era
  tratada como tela cheia: o vídeo era escondido (`visibility: hidden`) e só voltava na conferência seguinte (a cada 2 s).
  - Agora `coveredMonitors()` distingue tela cheia (sem moldura, do tamanho do monitor, ou `SHQueryUserNotificationState`)
    de maximizada; a pausa é por monitor e reage na hora à troca de janela (`SetWinEventHook`). Pausado, o último quadro
    continua na tela (vídeo: `pause()`; GIF: quadro copiado num canvas). Ajuste novo opcional: pausar também atrás de
    janela maximizada.
  - O Chromium do processo do papel de parede não descarta mais a janela coberta (`CalculateNativeWinOcclusion` desligado).
  - Medido pela captura DXGI: o brilho da área do papel de parede volta ao normal 10–25 ms depois de fechar a janela da
    frente (antes: segundos de preto). CPU do papel de parede: 0% atrás de tela cheia, continua tocando atrás de maximizada.

## Etapa 0.10, fase C — idiomas (19/11/2026)
- **pt-BR (padrão), English e Español**, escolhidos em Ajustes → Aplicativo → Idioma; troca na hora (janela, bandeja,
  motor, captura e papel de parede), guardada em `app.language`.
- Textos em `src/locales/<idioma>/<área>.json` (chave `área.nome`, variáveis `{x}`, plural `{one, other}` por `n`).
  Um módulo só lê e formata: `src/common/i18n.js` (principal, motor, auxiliar, captura, papel de parede); a janela
  recebe o dicionário pelo preload (`window.api.i18n`) e usa `src/renderer/js/i18n.js` (`t`, `setLanguage`, evento
  `lang`, textos fixos do index.html por `data-i18n`).
- Valores guardados não mudam com o idioma (layout "Padrão", nomes dos componentes genéricos, opções dos parâmetros
  como "Som do PC"): são traduzidos só ao mostrar (marcados `// i18n-dado`). Configurações antigas aparecem traduzidas.
- Traduzidos também: parâmetros dos efeitos e plugins que vêm com o app (`fx.json`), os 40 efeitos do pacote do
  Descobrir, inclusive depois de baixados (`extras.json`, o principal marca `extrasId`), e as mensagens de erro do
  cooler, da RAM, do motor, da captura e do papel de parede (os módulos recebem o tradutor ou devolvem uma chave).
- `npm run check` falha se uma chave usada no código não existir, se en/es tiverem chaves, variáveis ou plurais
  diferentes do pt-BR, se um efeito do pacote ficar sem tradução, ou se sobrar texto em português fixo na interface.
- Testado no app: troca pelos Ajustes para en e es em todas as abas (incluindo nomes dos pentes vindos do motor),
  reinício mantendo o idioma, outro ajuste depois da troca não desfaz o idioma, nenhum erro no console.
- Ficam no idioma original de propósito: efeitos e plugins de terceiros (texto do autor), o `memoria.log` e os
  consoles de diagnóstico dos plugins. O auxiliar elevado lê o idioma ao iniciar (uma troca vale no próximo início).
  O instalador (NSIS) continua só em português — entra na fase do ícone/empacotamento.

## Etapa 0.10, fase D — Ambiente da Tela: atraso tela → LEDs (19/11/2026)
**Medição embutida** (antes de mudar qualquer coisa): cada quadro de tela leva o `LastPresentTime` do DXGI (relógio QPC,
`src/common/clock.js`) até o motor, que mede captura, amostragem, transporte entre processos, fila do dispositivo,
escrita no hardware e o total. Painel "Diagnóstico de atraso" na aba Ambiente da Tela (só mede com ele aberto);
o auxiliar da RAM informa o tempo do SMBus (`stats`).

Antes (medido no app, conteúdo normal da tela): **total 104 ms (p50) / 166 ms (p95)**. Onde estava:
- escrita HID síncrona na thread do motor: a ASUS Aura leva 45 ms por quadro e o Wooting 16 ms, um esperando o
  outro (fila de 60 ms no teclado) — e o motor travado também atrasava a chegada das mensagens (13 ms / 60 ms p95);
- laço de captura dormindo até completar 1/30 s: 18 ms (p50) entre o Windows apresentar e o quadro ser lido.

Mudanças:
- **Uma thread de escrita por dispositivo HID** (`src/engine/hidWorker.js`): as escritas do `Render()` vão para ela;
  "mais recente vence" (quadros que chegam durante uma escrita viram um só); o ritmo é o do próprio hardware.
  Fora do `Render()` (inicializar, ler resposta, desligar, ajustes) a E/S continua síncrona, esperando a thread
  terminar — os dois plugins incluídos só escrevem no `Render()` (conferido). Sem `worker_threads`, volta ao síncrono.
- **Motor por evento**: quadro novo ou thread livre renderiza na hora (`scheduleRender`), sem esperar o tique de 15 ms.
- **Captura sem espera fixa**: cada volta espera o próximo quadro do Windows e lê na hora (teto de 125/s).
- Amostragem da janela deixa passar todo quadro de tela (antes descartava os que chegavam a menos de 30 ms).
- ASUS: canal sem mudança não é reenviado (o modo direto mantém a cor); envio completo a cada 2 s.

Depois (pior caso: janela de teste em tela cheia trocando de cor 60×/s, todos os LEDs mudando a cada quadro):
| | p50 | p95 | gravações/s |
|---|---|---|---|
| Teclado Wooting | 17 ms | 18 ms | 36 |
| Memórias (até o auxiliar) | 0,9 ms | 32 ms | 27 (limite de 33 ms do SMBus) |
| Placa ASUS | 61 ms | 79 ms | 21 (hardware: ~4,5 ms por pacote de 20 LEDs) |
| Captura + amostragem + transporte | 0,8 ms | 1 ms | — |
Conteúdo normal da tela: total 104 → 17–19 ms (p50), 166 → 74 ms (p95).

Consumo (app minimizado): em repouso 8,7% de um núcleo, dos quais 6,3% são o vídeo do papel de parede (núcleo do
Hydraflow ~2,4%); GPU da captura ~0%. No estresse: ~8% o app + 19% o auxiliar da RAM (SMBus a 27 gravações/s por
pente — fica para a fase H). GPU da captura: 0,3%.

Avaliado e **não feito**, com o número na mão:
- Canais diretos (MessageChannel) captura→janela→motor: o transporte caiu para 0,35 ms sozinho quando o motor
  deixou de travar; não há ganho mensurável para a complexidade.
- Staging duplo / compute shader por zona / Windows Graphics Capture: captura inteira em 0,33 ms (p50).
- O que sobra é o hardware: a ASUS aceita ~1 pacote a cada 4,5 ms; com fitas padrão de 60 LEDs nos 3 canais ARGB
  são 10 pacotes. Escolher os componentes reais (menos LEDs) reduz o atraso dela na mesma proporção.

Pendente: tempo do SMBus da RAM (o auxiliar rodando é o da versão instalada; aparece depois que ele for reiniciado
pelo app novo). Eventos de jogo (spike do Valorant por imagem/som, APIs oficiais de CS2/LoL) ficam para depois,
como no plano.

## Etapa 0.10, fase E — biblioteca de mídia (19/11/2026)
- **`src/main/library.js`**: imagens, GIFs e vídeos são **copiados** para `%APPDATA%\Hydraflow\biblioteca`, com o nome
  pelo conteúdo (SHA-256): importar o mesmo arquivo de novo não duplica; mover ou apagar o original não afeta o app.
  Índice `biblioteca.json` (nome, tipo, tamanho, data); arquivo apagado por fora some da lista.
- O papel de parede e a tela do watercooler guardam o caminho do arquivo **dentro** da biblioteca (`wallpaper.file`,
  `cooler.image`); a lista antiga `wallpaper.list` (só caminhos para os originais) acabou. Migração na abertura:
  o que estava configurado é copiado e passa a apontar para a cópia (os originais não são tocados).
- Excluir: se o arquivo está em uso (papel de parede ligado, imagem do cooler), o app avisa onde; confirmando, desliga
  quem usa, espera o processo do papel de parede soltar o arquivo e apaga (testado com o vídeo tocando: 167 ms).
- Miniaturas pelo Windows (`nativeImage.createThumbnailFromPath`, as mesmas do Explorer — vídeo, GIF e imagem),
  geradas uma vez e guardadas: a grade não toca GIFs nem vídeos.
- Tela: a aba Papel de Parede tem os ajustes e a biblioteca (filtros Tudo/Vídeos/Animadas/Imagens, busca, espaço
  usado, renomear, usar como papel de parede, mostrar no watercooler, excluir, arrastar arquivos do Explorer para
  importar). A aba Watercooler escolhe a imagem na mesma biblioteca (com "Adicionar do PC" e arrastar).
- Corrigido junto: em `wled:probe` uma variável `t` (timer) escondia o tradutor desde a fase C — as mensagens
  "não parece um WLED" / "sem resposta" quebrariam.
- Testado no app: migração (vídeo de 33 MB + GIF do cooler), duplicata recusada, formato não suportado recusado,
  miniaturas dos três tipos, aviso de uso, exclusão forçada desligando o papel de parede, papel de parede devolvido,
  filtros, seletor do cooler só com imagens, nenhum erro no console.

## Etapa 0.10, fase F — salvar no dispositivo e placas de vídeo (19/11/2026)
**Salvar no dispositivo** (botão no painel de efeito da Iluminação): grava na memória do próprio hardware o que está
tocando. O motor publica em cada dispositivo `hardwareSave` = `{ supported, modes }` ou `{ supported: false, reason }`;
nada é simulado — só grava onde o hardware tem memória e o protocolo é conhecido:
| Dispositivo | Grava? | Como |
|---|---|---|
| Placa ASUS Aura USB | sim | o mesmo caminho que o app já usava ao fechar: `0x35` modo + `0x36` cores + `0x3F 0x55` grava na placa. "Cores de agora" ou "modo parecido com o efeito"; volta ao modo direto em seguida; "Ao fechar o app" vira "Gravado no dispositivo" (o fechamento regrava o mesmo plano, em vez de outro) |
| WLED | sim | API JSON oficial: estado (Solid/Breathe/Rainbow com a cor média) → `psave` no preset 250 "Hydraflow" → preset de inicialização (`cfg.def.ps`) |
| Placa de vídeo NVIDIA com zonas | sim | API oficial, `bDefault` (padrão da placa) |
| Memória Corsair (controladora "Corsair DRAM") | **não** | sem gravação documentada; o OpenRGB também não grava (tabela oficial: Save ❌). O "Device Memory Mode" do iCUE usa protocolo fechado — gravar às cegas na memória do pente arrisca o hardware |
| Teclado Wooting | **não** | o SDK de RGB é volátil; os perfis do Wootility usam protocolo não público. Ao fechar, ele já volta à iluminação própria |
Contrato para plugins: `export function HardwareSaveModes()` e `export function SaveToDevice({ mode })` → `{ ok, detail, params }`
(params: ajustes que o plugin mudou; o motor aplica e o principal grava). Parâmetro com `hidden: true` não aparece na tela.

**Placas de vídeo sem OpenRGB** (`src/engine/gpu/`): primeiro módulo é a **API oficial de iluminação da NVIDIA**
(NVAPI "Client Illumination Zones", a mesma do app da NVIDIA; layout das estruturas pelos cabeçalhos públicos), via koffi.
Não escreve em endereço I2C nenhum: o driver da NVIDIA fala com o controlador da placa. Placa com zonas RGB vira
dispositivo (cores ao vivo a até 30/s, só quando mudam); sem zonas, aparece só como informação em Dispositivos.
- Testado na RTX 5080 deste PC (só leitura): driver carregado, placa listada com nome e IDs PCI, **0 zonas** (a placa
  não tem RGB). A escrita não pôde ser testada (sem hardware com LEDs).
- Pesquisado e **não implementado** (sem hardware para validar, e escrever no barramento I2C da placa errada pode
  mexer em outros chips): os protocolos I2C por fabricante que o OpenRGB usa (ASUS Aura GPU, MSI, Gigabyte RGB Fusion,
  EVGA, Zotac…, pela `NvAPI_I2CWriteEx` / `ADL2_Display_WriteAndReadI2C`), e as placas AMD (não há API oficial de
  iluminação da AMD). Entram como novos módulos em `src/engine/gpu/` (cada um: lista de placas pelo ID PCI de
  subsistema antes de qualquer acesso → zonas → cores); até lá, o OpenRGB continua opcional para elas.

Testado no app: capacidade de cada dispositivo (ASUS sim, Wooting/RAM não com o motivo), gravação no WLED contra um
WLED simulado (os 3 POSTs certos), janela "Salvar no dispositivo" aberta e cancelada, painel de placas de vídeo,
nenhum erro no console. **Falta (precisa de autorização):** gravar de verdade na placa ASUS.

## Etapa 0.10, fase G — lentidão, cenas Lo-Fi e ícone novo (19/11/2026)
**Lentidão (medida antes de mexer).** A interface em si estava rápida (troca de aba 5–33 ms, quadros a 16,6 ms);
o que travava era o processo principal esperando o Windows:
| O quê | Antes | Depois | Causa e correção |
|---|---|---|---|
| Janela começa a carregar | 1,2–1,7 s após abrir | 129 ms | consulta CIM do PowerShell (placa-mãe, Windows) antes de criar a janela → janela primeiro, dados lidos do registro (`reg.exe`) em seguida |
| `ram.status` | 1064 ms | 55 ms (15 ms em cache) | `schtasks` + PowerShell a cada chamada → `src/common/winsys.js` (tarefa em XML, cache) |
| Aplicativos em conflito | 219 ms | 4 ms | `tasklist` → lista de processos pela API do Windows (koffi, cache de 2 s) |
| `openrgb.info` | 207 ms | 0 ms | mesma lista de processos |
| Modo Layout da Iluminação (prévia ao vivo) | 75,8% de um núcleo | 28,1% | `backdrop-filter: blur` nas ilhas fixas (menu, painel lateral, player): cada quadro da prévia obrigava o Chromium a refazer o desfoque (processo da GPU 56% → 7,6%). Fundo quase opaco no lugar, visualmente igual |
Medido isolando cada suspeito com CSS injetado: sem desfoque 22,8%; sem o SVG do editor 78,5% (o SVG não pesa).
Corrigido junto: com o Ambiente da Tela ligado, reiniciar o app (troca de idioma) derrubava o processo principal
("Object has been destroyed") — os quadros da captura iam para a janela já destruída; agora passam por `toRenderer()`.

**Cenas Lo-Fi** (`src/renderer/js/lofi.js`): 5 cenas em SVG desenhadas para o app (estudo, música, sono, chuva,
computador), animadas só com CSS (`steps()` para o ar "desenho animado" e menos quadros). Aparecem na Iluminação no
lugar da prévia quando o efeito é o Ambiente da Tela, com troca suave e botão "Outra cena" (lembrada em
`ui.lofiScene`); pausam com a janela escondida. Custo: **5,4%** de um núcleo no total contra **75,8%** da prévia ao
vivo — a cena não pede quadros ao motor, a prévia sim.

**Ícone novo** (`build/icon.svg`, `build/icon-small.svg`): fone Lo-Fi com o arco em degradê RGB (menta → azul → lilás
→ rosa), uma onda d'água entre as conchas (o "flow") e lua com estrelas, sobre o quadrado escuro do tema. Versão
simplificada desenhada à parte para 16–32 px (traços grossos, sem detalhes). `npm run icon` gera tudo no Electron do
próprio projeto (sem dependência nova): `build/icon.ico` (16, 20, 24, 32, 40, 48, 64, 96, 128, 256 px, entradas PNG),
`build/icon.png` (512) e `build/icons/*.png`. Usado na janela, bandeja (o Windows escolhe o tamanho certo do .ico, em
vez de encolher o PNG de 512), executável, instalador, desinstalador e atalhos (`build.win.icon`). O instalador só
recebe o ícone novo no próximo `npm run dist`.

## Etapa 0.10, fase H — organização do código (Untangle, só limpeza) e otimização (19/11/2026)
Método da skill Untangle: três agentes mapearam o código inteiro (sistema, motor, janela) perguntando "estas peças
mudam juntas?"; as correções saíram desse mapa; um quarto agente revisou o resultado contra o código antigo.
Backup antes de mexer: `RGBStudio-backups\antes-fase-H-20261119-1800.zip`.

**Uma correção por trás de vários problemas — o motor:**
- *Problemas:* cada fonte de dispositivos (plugins HID, OpenRGB, RAM, WLED, placa de vídeo) era ligada à mão em ~15
  lugares do `engine.js` (render, init, resume, rescan, shutdown, gravar no dispositivo, logs, ajustes, piscar, quem é
  dono de um controlador do OpenRGB); logs, ajustes e piscar só funcionavam para plugins; o formato das ids e do
  descritor estava copiado em cinco lugares; amostrar as cores do quadro, em cinco; "só manda se mudou", em três.
- *Correção:* `src/engine/providers/*.js`, um provedor por fonte, todos com a mesma interface (documentada em
  `devices.js`). O `engine.js` passou de 848 para ~170 linhas e só percorre os provedores. Peças comuns em
  `devices.js` (`deviceId`, `lineDescriptor`, `sampleLeds`, `rateLimit`, `changeTracker`, `statusHolder`).
- *Bugs que caíram junto:* id de fita WLED com os pontos do IP (`wled:192.168.0.5` virava caminho aninhado no store:
  os ajustes dela nunca eram achados — migração `wledIds` leva a posição nos layouts para a id nova); todo
  dispositivo HID contava como "com thread de escrita" mesmo quando a thread não subiu (ia a cada 8 ms em vez do
  ritmo do plugin); erro de gravação da placa de vídeo nunca era limpo; nomes de WLED e zonas da placa de vídeo
  não mudavam de idioma; trocar o idioma refazia a varredura de dispositivos; um controlador do OpenRGB podia ser
  controlado junto com a placa NVIDIA pela API oficial.

**Mensagens entre processos:** os tipos do motor estavam listados à mão no principal (`ENGINE_EVENTS`) e a janela
podia mandar qualquer comando ao motor, inclusive `init` e `shutdown`. Agora `src/engine/protocol.js` declara tudo,
o principal só repassa os comandos da janela que estão na lista, e o `npm run check` confere os três lados.

**Processo principal:** migrações de versões antigas (0.7–0.9, ~130 linhas) foram para `src/main/migrations.js`;
o diagnóstico do cooler (estado + USB pelo Windows) foi para `CoolerLcd.status()`, onde estão os modelos (a lista
de IDs USB estava duplicada no `main.js`); `powershell.js` juntou-se ao `winsys.js`; o principal não lê mais o
formato interno do Descobrir (`Explore.installedExtras()`); listas de extensões de vídeo e o idioma padrão vêm de
uma fonte só. *Bugs:* parar e religar a captura de tela em menos de 500 ms deixava o processo novo órfão e mostrava
"captura parou"; `explore-installed.json` ilegível era tratado como vazio e a instalação seguinte apagava o
registro de tudo (agora fica guardado como `.bad`); desligar o OpenRGB mostrava "conexão encerrada" como erro.

**Janela:** playlists saíram de dentro da tela Efeitos para `js/playlists.js` (a Iluminação importava de outra
tela); o editor de layout foi para `js/` (é um componente, não uma tela); validador de nome (4 cópias) e preencher
console (2 cópias) em `ui.js`; os ajustes do cooler mudam num lugar só (`setCooler`, antes 3 cópias que gravavam o
store à mão); exports mortos e 32 regras de CSS de classes que nenhum código produz (2,6 KB). Texto fixo em
português que escapava da tradução ("Tocando playlist …") corrigido.

**Medido (Iluminação no modo Efeito, mesmo papel de parede de vídeo):** CPU total 8,6% → 7,6% de um núcleo
(igual, dentro da variação); motor e janela sem mudança mensurável de memória — a diferença no total (384 → 531 MB)
está no processo de vídeo do papel de parede (135 → 241 MB, não mexido nesta fase, varia com o vídeo) e na medida
"antes" ter sido feita com a memória já devolvida ao Windows. Entrega das cores igual à fase F: Wooting 17 ms,
RAM ~1 ms até o auxiliar, ASUS 61 ms (p50, tela mudando 60×/s). Modo Layout: 75,8% → 28,1% (fase G). O auxiliar da
RAM (19% sob estresse) gasta o tempo dentro do driver do SMBus, esperando o hardware: só cairia mandando menos
atualizações às memórias, então ficou.

**Ficou de fora, de propósito ou para depois:**
- Regras de CSS antigas sobrescritas por camadas novas (v2 → v5) com seletores mais fortes: removê-las muda
  detalhes visuais (ex.: botão de ícone 36×32 em vez de 36×36), então pede uma revisão visual com você.
- Sufixo com o nome do plugin na id HID só quando há dois plugins para o mesmo aparelho: mudar trocaria ids salvas.
- `hidRealtimeChunks` (tela Gamdias por HID) conta pedaços com `floor(n/1000)+1`, que erra para tamanhos múltiplos
  de 1000; veio do ZEUS CAST e não há cooler HID aqui para conferir — fica como está.
- Esperas por tempo que dependem de hardware/sistema (reconectar a cada 5 s, 15 s sem cooler, 2 s para o motor
  parar): são o comportamento pedido, não remendos.

Testado no app: 4 dispositivos de volta após cada mudança, entrega de cores por dispositivo (com a tela piscando
60×/s), Rescan sem apagar as cores, troca de idioma renomeando os pentes, cooler conectado, biblioteca, Descobrir,
comando proibido recusado, todas as abas, editor de layout, console de dispositivo, nenhum erro no console.

## Verificação
- Sintaxe de todos os arquivos, `npm run check` e o app rodando: mesmos 4 dispositivos de antes (ASUS, Wooting, 2 pentes de RAM via o novo cliente), quadros e cores chegando aos itens de layout, sem erros no console.
- Fluxos testados no app: navegação, Descobrir (com `effectId`), prévia, `prompt` com Enter e validação, `modal().close()`, detalhe de dispositivo (componentes e diagnóstico), modo Layout.
- Não testado: ativação da RAM do zero (driver, módulo e permissão), importar efeito pelo diálogo de arquivo, OpenRGB conectado (não está instalado aqui).

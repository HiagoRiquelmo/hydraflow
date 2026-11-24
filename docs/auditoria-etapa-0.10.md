# Auditoria técnica e plano: etapa 0.10 (19/11/2026)

Escopo: os objetivos 0 a 11 do pedido de refinamento. Nada foi alterado no código do app nesta fase: só leitura,
medições e uma sonda na tela do cooler (aperto de mão, sem gravar nada).

## Arquitetura atual (resumo)

- Electron 45, JavaScript puro (sem framework), `koffi` (chamadas a DLLs do Windows) e `node-hid` 3.4.
- Processos: principal (`src/main`), janela (`src/renderer`, **sem GPU**: `app.gpu = false` no config), motor de
  dispositivos (`src/engine`, utilityProcess), captura DXGI (`src/capture`, utilityProcess), papel de parede
  (processo Electron próprio, com GPU) e auxiliar elevado da RAM (`src/smbus`, via PawnIO).
- Sem Git na máquina; não há histórico de commits. O backup `.zip` citado em `decisoes-refatoracao.md` não existe
  mais; só restam cópias soltas em `RGBStudio-backups\backups-de-dentro-do-src`.
- A Skill **untangle-codebase** existe em `~/.claude/skills`, já foi usada em 18/11 (ver `decisoes-refatoracao.md`)
  mas não aparece na lista de Skills desta sessão: dá para segui-la lendo o `SKILL.md`, não pelo comando.

---

## 0. Ambiente da Tela: auditoria

### O que existe (verificado no código)
A arquitetura já é a recomendada, não a "captura pesada" que se temia:
`DXGI Desktop Duplication` → cópia e **mipmaps na placa de vídeo** → só ~120×67 px voltam para a CPU →
utilityProcess `Hydraflow Captura` → principal → janela (`screenSource.js`) amostra só os pontos sob os LEDs →
principal → motor → HID / SMBus / WLED. Quadros só chegam quando a tela muda.

### Medido agora (1920×1080, mesmo código do app, `bench-dxgi.js`)
| Métrica | Valor |
|---|---|
| Do quadro apresentado pelo Windows até os pixels na CPU (`LastPresentTime` → QPC) | **p50 0,89 ms**, p95 2,18 ms, máx. 3,6 ms |
| Quadros entregues (o conteúdo da tela mudava a ~30 Hz) | 31,4/s |
| CPU do laço de captura | 4,6% de um núcleo |
| Abrir a duplicação | 131 ms (uma vez) |

A captura em si não é o gargalo. O atraso está **depois** dela:

| Etapa | Atraso estimado (pelo código) | Causa |
|---|---|---|
| Laço de captura limitado a 30 quadros/s (`captureFps: 30`) | 0–33 ms quando o jogo passa de 30 fps | `setTimeout(loop, 1000/fps − gasto)` |
| 4 saltos de IPC: captura→principal→janela→principal→motor | ~2–6 ms, mais se a janela ou o principal estiverem ocupados | caminho passa pela janela de interface |
| Processamento na thread da interface | <1 ms, mas disputa com a renderização da UI (que está sem GPU) | `screenSource.js` roda no renderer |
| Motor espera o próprio relógio | 0–16 ms | `setInterval(renderTick, 15)` (resolução do timer do Windows ~15,6 ms) |
| Limite por dispositivo | 0–31 ms (ASUS e Wooting a 30 fps; RAM a 33 ms) | `setFrameRateTarget(30)`, `throttled()` |
| Escrita no hardware | a medir (HID ~1–4 ms; SMBus da RAM mais lento) | — |
| **Total estimado** | **média ~35–50 ms, pior caso ~90–110 ms** | |

Problemas da lista 0.1 que **existem**: latência acumulada (sim, fora da captura); processamento redundante
(não: já descarta quadro sem mudança); CPU↔GPU (não: só 32 KB por quadro); comunicação com o hardware
(parcial: relógio fixo + limite de 30 fps); cadeia contínua dependente da UI (sim: a interface fica no meio).

### Proposta
1. **Tirar a interface do caminho dos LEDs:** a amostragem por LED (tabela `gather`/`taps`, saturação, brilho,
   suavização) passa para o processo de captura, que manda as cores direto ao motor por `MessageChannelMain`.
   A janela só recebe imagem quando a prévia está visível.
2. **Motor por evento:** quadro novo → escreve no dispositivo na hora (respeitando o intervalo mínimo de cada
   controlador), sem esperar o relógio de 15 ms.
3. **Taxa de captura adaptativa:** até a taxa do monitor ou do dispositivo mais rápido (o que for menor), em vez de 30 fixo.
4. **Staging duplo com `D3D11_MAP_FLAG_DO_NOT_WAIT`** para nunca travar esperando a placa.
5. **Medição embutida:** carimbo de tempo do `LastPresentTime` até a escrita no dispositivo, por etapa, numa
   tela "Diagnóstico de latência" (os números de antes e depois saem dela).
6. Avaliados e **não recomendados agora**: Windows Graphics Capture (mais latência e chamadas WinRT pesadas via
   koffi; útil só como alternativa em notebooks com duas placas); compute shader por zona (a redução por mipmap
   já custa <1 ms; ganho marginal). Ficam documentados como plano B.

Meta: média < 20 ms do quadro na tela até a escrita no HID, e nenhum trabalho com a tela parada.

### Eventos de jogo (separado da reprodução de cores)
- Cores da tela: resolvido pela captura acima (sangue, explosões, cenas).
- Eventos específicos: o Valorant **não tem API oficial** de estado da partida e o Vanguard proíbe ler a memória
  do jogo. Caminhos seguros: (a) som (já existe, `soundReact.js`, não testado em partida real); (b) leitura de uma
  região do HUD pela própria captura (como um programa de gravação faz); (c) APIs oficiais onde existem:
  **CS2 / Dota 2 Game State Integration** e **League of Legends Live Client Data API**. Proposta: uma camada
  "Eventos de jogo" com detectores plugáveis, entregue depois do pipeline novo.

---

## 1. Animações Lo-Fi na aba Iluminação
- Ponto de entrada: `views/lighting.js` (já sabe quando o efeito ativo é o modo tela: `fx.screen`).
- Proposta: 5 cenas próprias em **SVG animado** (pixel art/vetor, estilo único do Hydraflow): estudando, ouvindo
  música, dormindo, chuva na janela, no computador. Cada uma com poucos KB, animação em `steps()` a ~8 quadros/s
  (barato mesmo sem GPU), pausada com a aba escondida ou o app minimizado. Transição por opacidade.
- Arquivos GIF podem ser exportados das mesmas cenas se você quiser tê-los como arquivo.
- Geração por IA (Skill `design`, que usa Gemini e outros) exige chave de API externa e custo: só com sua autorização.

## 2. Lentidão geral e papel de parede preto
**Papel de parede: causa encontrada no código.**
- `fullscreenAppInFront()` considera "tela cheia" qualquer janela cujo retângulo cubra o monitor. No Windows 11
  uma janela **maximizada** ultrapassa ~8 px de cada borda, então o navegador maximizado já conta como tela cheia.
- Aí a página aplica `visibility: hidden` no vídeo (fica só o fundo preto) e pausa.
- Ao voltar para a área de trabalho, a checagem roda só a cada 2 s, e o vídeo ainda precisa retomar a decodificação:
  é a tela preta de alguns segundos.
- Correção: detectar tela cheia de verdade (retângulo exato do monitor, sem moldura, ou
  `SHQueryUserNotificationState`), reagir à troca de janela em primeiro plano por evento (`SetWinEventHook`) em vez
  de a cada 2 s, e ao pausar **manter o último quadro** (sem `visibility: hidden`).

**Lentidão da interface: suspeito principal.** A janela roda com aceleração por hardware desligada, e o CSS tem
9 `backdrop-filter`, 5 `filter: blur` e 87 `box-shadow`. Em renderização por software, desfoque de fundo é caro
a cada repintura. Também chegam quadros da captura a 30/s na thread da UI (resolvido no item 0). Plano: medir com
o perfil do DevTools, depois escolher entre ligar a GPU só na janela (custa memória) ou trocar os desfoques por
fundos sólidos equivalentes quando não houver GPU.

## 3. Idiomas (pt-BR, English, Español)
- Hoje cerca de 300 frases fixas em 27 arquivos, só em português.
- Proposta, sem dependência nova: módulo `i18n` próprio (dicionários JSON por idioma, `t('chave', vars)`,
  plural e formatação com `Intl`), idioma salvo no Store, troca ao vivo (re-renderiza a view atual), menus da
  bandeja e diálogos do processo principal também traduzidos. pt-BR continua padrão.
- A infraestrutura entra **antes** das telas novas, para que os textos novos já nasçam traduzíveis.

## 4. RAM: botão de instalar que não reflete o estado
Evidências:
- `logs/memoria.log`: três inícios do auxiliar em 16 minutos (11:31, 11:40, 11:47), dois com
  `Register-ScheduledTask: The parameter is incorrect`. A tarefa hoje existe e aponta para o app instalado.
- O auxiliar está rodando agora (PID do `smbus.json` vivo) e encontra os dois pentes Corsair DDR5.

Causas prováveis no código:
1. `helperRunning()` decide "auxiliar de pé" pelo PID do `smbus.json`. Se o arquivo sobrou de um auxiliar que
   morreu sem limpar (PC desligado, processo encerrado) e o PID foi reaproveitado por outro processo, o app acha
   que está tudo certo, não inicia nada, o motor não conecta e o painel continua mostrando **Ativar**, inclusive
   depois de reiniciar o app.
2. Falha intermitente ao registrar a tarefa: cada ativação volta a pedir permissão e a ativação fica dependente
   de reinício.
3. O painel mistura duas fontes de verdade (`ram:status` por PowerShell, lento, e o evento `ram` do motor) e um
   temporizador de 20 s. Nada impede duas ativações seguidas no processo principal.

Correção proposta: verificar o auxiliar por conexão autenticada (ping), não por PID; apagar `smbus.json` órfão;
um único estado de RAM vindo do principal (máquina de estados: ausente → instalando → iniciando → conectado →
erro); trava contra ativação dupla; registro da tarefa com diagnóstico do erro; validação real com os pentes
(cores mudando no hardware) e reinício do app.

## 5. Salvar efeito no hardware
- Precisa de pesquisa de protocolo por dispositivo antes de qualquer gravação. Situação conhecida:
  - **ASUS Aura USB (placa-mãe):** o protocolo tem comando de gravar o modo na controladora. Provável, a confirmar.
  - **Corsair Vengeance DDR5:** a controladora tem modos de hardware (estático, respirar, arco-íris…). Se ficam
    gravados após desligar, **a confirmar**. Gravar em memória não volátil do pente tem risco: só testo com sua autorização.
  - **Wooting:** o SDK RGB é volátil; perfis gravados dependem do protocolo do Wootility, que não é público.
- Proposta: cada provedor declara `capabilities.hardwareSave` com os modos que o hardware aceita; o botão
  **Salvar no dispositivo** só aparece onde existe suporte real, e converte o efeito para o modo de hardware mais
  próximo, mostrando o que vai ser gravado antes de gravar.

## 6. RGB de placa de vídeo sem OpenRGB
- O OpenRGB fala com a maioria das placas pelo **I2C do próprio driver de vídeo**: NVAPI (`nvapi64.dll`) na NVIDIA
  e ADL (`atiadlxx.dll`) na AMD. As duas DLLs vêm com o driver: dá para chamar via `koffi`, sem baixar nada.
  Por cima disso, cada fabricante tem seu protocolo (ASUS Aura GPU, MSI, Gigabyte RGB Fusion, EVGA…). Algumas
  placas novas usam uma controladora USB interna (HID), que entra pelos plugins.
- Proposta: provedor `gpu` no motor (o mesmo contrato `publish/setEnabled/reload` dos outros), com lista de
  placas permitidas por ID PCI (subsystem) **antes** de qualquer escrita I2C, para não escrever em endereço errado.
- Limitação: sua placa não tem RGB, então **não dá para validar em hardware aqui**. Fica testado com dispositivo
  simulado e documentado como "não validado". O OpenRGB continua opcional, não é removido.

## 7. Biblioteca de imagens, GIFs e papéis de parede
- Hoje `wallpaper.list` guarda só o caminho do arquivo original: se ele for movido ou apagado, some da lista.
  A imagem do cooler segue a mesma regra (`cooler.image`).
- Proposta: biblioteca interna em `%APPDATA%\Hydraflow\biblioteca\` com cópia do arquivo, nome pelo hash do
  conteúdo (sem duplicatas), miniatura, tipo e tamanho; usada pelo papel de parede e pelo cooler; excluir avisa
  se o arquivo estiver em uso; migração automática da lista atual.

## 8. Otimização geral
Depende dos itens 0, 2 e 7. Primeiro se mede o estado atual (por processo: CPU, memória, GPU, com o app
minimizado, na bandeja e com cada função ligada), depois se corrige, e se mede de novo. Já identificados: captura
e amostragem fora da UI (0), papel de parede pausado de verdade (2), GIF do cooler decodificado só com cooler
conectado (já corrigido na 0.9), animações Lo-Fi pausadas quando escondidas (1).

## 9. Untangle
Rodar a Skill `untangle-codebase` **por último**, depois das funções novas, para limpar o código que ficou e não
refatorar duas vezes. A Skill exige perguntar antes quais extras fazer: **Comentários** e/ou **Testes**.

## 10. Novo ícone
- Hoje: `scripts/make-icon.js` desenha uma gota em PNG 512 px e o electron-builder gera o `.ico`.
- Proposta: conceito próprio (ex.: garota Lo-Fi de fone com reflexo RGB, simplificado para 16 px), desenhado em
  SVG, com versões ajustadas à mão para 16/24/32/48 px. PNG e `.ico` multi-tamanho gerados pelo próprio Electron
  (sem dependência nova), aplicados ao executável, instalador, atalhos, bandeja e janela.

## 11. Tela do watercooler: causa encontrada e confirmada
- No Windows o cooler aparece como `USB\VID_1B80&PID_B547` (Composite) com a interface `MI_00` como
  **porta serial COM3** ("USB Serial Device").
- `coolerLcd.js` procura `1B80:B547` só como **HID** e a porta serial só em `VID_1D6B&PID_0111`. Nenhum dos dois
  casos bate, daí "Cooler não encontrado".
- **Sonda na COM3** (115200 8N1, o `POST conn` do próprio protocolo): resposta `200` com
  `firmware V1.2.7, hardware V2.0, app V1.0.3, OS Linux, degree 270, brightness 100`. `POST power` também
  responde `200`. **O protocolo implementado funciona; só a detecção está errada.**
- ZEUS CAST não estava aberto. Porta COM no Windows é exclusiva (`CreateFile` com compartilhamento 0): se o ZEUS
  CAST estiver com a porta aberta, o Hydraflow recebe "acesso negado" (erro 5). É isso que a mensagem de
  "dispositivo ocupado" vai dizer.
- Correção: procurar as portas COM de **todas** as interfaces Gamdias conhecidas (`1B80:B547`, `1B80:B53D`,
  `1D6B:0111`, com `&MI_xx`), ler modelo e firmware da resposta do `conn` e mostrar na tela, diagnósticos
  separados (desconectado / incompatível / porta ocupada (erro 5) / sem resposta / erro de protocolo / falha no
  envio), confirmação de cada comando pela resposta `200`, e reconexão automática. Validação com imagem e GIF de
  verdade na tela, fechar e reabrir o app, e o teste do conflito com o ZEUS CAST.

---

## Ordem de execução e dependências

| Fase | Itens | Por quê nesta ordem |
|---|---|---|
| A. Base | Backup `.zip`; medições de referência (CPU/memória/latência) | Sem Git, o backup é a rede de segurança; o "antes" precisa ser medido antes de mexer |
| B. Correções com causa já encontrada | 11 (cooler), 4 (RAM), 2 (papel de parede preto) | Bugs que você sente hoje; não dependem de nada |
| C. Infraestrutura de idioma | 3 | Os textos novos das fases seguintes já nascem traduzíveis |
| D. Pipeline do Ambiente da Tela | 0 (e a medição de latência) | Mexe em captura, motor e janela ao mesmo tempo |
| E. Biblioteca | 7 | Papel de parede e cooler passam a usar a biblioteca |
| F. Hardware | 5 (capacidades + gravação), 6 (provedor GPU) | Mesmo contrato de provedor no motor; 5 depende de pesquisa e autorização |
| G. Visual | 1 (Lo-Fi), 10 (ícone), lentidão da UI (2b) | Independentes do resto |
| H. Fechamento | 8 (otimização medida), 9 (Untangle), relatório final | Precisam de tudo pronto para medir e limpar uma vez só |

## Dependências e autorizações
- **Nenhuma dependência nova é necessária** no plano acima (i18n, ícone, animações, I2C de GPU e biblioteca usam
  só o que já existe: Electron, koffi, node-hid e DLLs do Windows/driver).
- Precisam da sua decisão: enviar imagens de teste para a tela do cooler; qualquer gravação persistente na RAM ou
  na placa-mãe (item 5); uso de geração de imagem por IA externa (itens 1 e 10); extras da Untangle; ligar a GPU
  na janela principal.
- Git não está instalado: instalar seria uma alteração no sistema; o plano funciona sem ele, com backups `.zip`.

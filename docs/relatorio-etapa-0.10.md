# Relatório final — etapa 0.10 (refinamento, expansão e otimização)

19/11/2026. Detalhes técnicos de cada fase em `docs/decisoes-refatoracao.md` (fases A a H) e o plano original em
`docs/auditoria-etapa-0.10.md`. **A etapa não está concluída por inteiro:** os itens da seção 8 dependem de você
(autorização, conferência visual ou hardware que não existe neste PC).

## 1. Objetivos e resultados

| # | Objetivo | Resultado |
|---|---|---|
| 0 | Ambiente da Tela: auditoria, baixa latência, métricas | **Feito.** Atraso tela → LEDs medido de ponta a ponta (relógio do Windows): p50 104 → 17 ms, p95 166 → ~74 ms. Painel "Diagnóstico de atraso" na tela, por etapa e por dispositivo |
| 1 | Animações Lo-Fi (≥5) na Iluminação com o Ambiente da Tela ligado | **Feito.** 5 cenas próprias em SVG/CSS (estudo, música, sono, chuva, computador), troca suave, "Outra cena". 5,4% de CPU contra 75,8% da prévia ao vivo |
| 2 | Lentidão geral e papel de parede preto ao voltar à área de trabalho | **Feito.** Janela abre em 129 ms (antes 1,2–1,7 s); consultas ao sistema 200–1000 ms → 0–55 ms; modo Layout 75,8% → 28,1%. Papel de parede: janela maximizada era tratada como tela cheia; volta em 10–25 ms |
| 3 | Idiomas pt-BR / English / Español | **Feito.** Seletor em Ajustes, troca sem reiniciar, salvo, pt-BR padrão; 876 textos conferidos pelo `npm run check` (mesmas chaves, variáveis e plurais nos três) |
| 4 | Bug do botão de instalar/ativar a RAM | **Corrigido.** Arquivo de conexão velho + PID reaproveitado enganavam a checagem; app de desenvolvimento e instalado disputavam a mesma tarefa agendada (agora uma por executável). Ativação do zero com UAC: **não testada** (seção 8) |
| 5 | Salvar no dispositivo / na placa | **Feito só onde é real:** ASUS Aura (placa-mãe), WLED, placa NVIDIA com zonas. Memória Corsair e Wooting mostram por que não dá. Gravação real na ASUS: **não testada** (você preferiu adiar) |
| 6 | RGB de placa de vídeo sem OpenRGB | **Arquitetura feita** (provedor `gpu`, API oficial da NVIDIA). A RTX 5080 deste PC tem 0 zonas de LED: leitura testada, escrita não (sem hardware). I2C por fabricante e AMD: documentados, não implementados (risco sem hardware para validar) |
| 7 | Biblioteca interna de mídia | **Feito.** Cópias por conteúdo (SHA-256) em `%APPDATA%\Hydraflow\biblioteca`, duplicata recusada, miniaturas, aviso de uso antes de excluir, migração dos arquivos antigos |
| 8 | Otimização medida | **Feito** (antes/depois nas seções 5 e na fase H) |
| 9 | Organização do código (Untangle) | **Feito** (só limpeza, como você escolheu): motor em provedores, mensagens entre processos declaradas e conferidas, migrações e diagnóstico do cooler nos lugares certos, código e CSS mortos fora |
| 10 | Ícone novo em todos os formatos | **Feito.** Fone Lo-Fi com arco RGB e onda "flow"; versão simplificada para 16–32 px; `.ico` com 10 tamanhos; janela e bandeja já usam. Executável/instalador: no próximo `npm run dist` (seção 8) |
| 11 | Tela do watercooler Gamdias sem o ZEUS CAST | **Funcionando no protocolo** (seção 4); **falta você confirmar que a imagem aparece na tela** (seção 8) |

## 2. Funcionalidades implementadas
- Diagnóstico de atraso do Ambiente da Tela (por etapa e por dispositivo; tempo do SMBus vindo do auxiliar da RAM).
- Escrita HID em thread própria por dispositivo (o hardware dita o ritmo, sem travar os outros).
- Cenas Lo-Fi na Iluminação.
- Idiomas (pt-BR, English, Español) em todo o app: janela, bandeja, diálogos, mensagens do motor e do auxiliar.
- Biblioteca de mídia compartilhada por papel de parede e cooler (filtros, busca, arrastar e soltar, renomear).
- "Salvar no dispositivo" com contrato para plugins (`HardwareSaveModes`, `SaveToDevice`).
- Provedor de placas de vídeo pela API oficial da NVIDIA; painel de placas em Dispositivos.
- Tela do cooler Gamdias por conta própria (detecção, aperto de mão, imagens ao vivo, brilho, rotação, reconexão,
  diagnóstico por estado, aviso quando outro programa está com a porta).
- Pausa do papel de parede por monitor quando uma janela maximizada/tela cheia o cobre (opcional).
- Ícone novo e gerador (`npm run icon`).

## 3. Bugs corrigidos (principais)
- Cooler: comandos sem conferir a resposta da tela; porta ocupada pelo ZEUS CAST aparecia como "não encontrado".
- RAM: ativação enganada por arquivo de conexão velho; disputa de tarefa agendada entre duas instalações.
- Papel de parede preto ao voltar à área de trabalho (janela maximizada tratada como tela cheia).
- Atraso de ~100 ms no Ambiente da Tela (fila de quadros e envios repetidos); placa ASUS reenviando canais iguais.
- Reiniciar o app (troca de idioma) com o Ambiente da Tela ligado derrubava o processo principal.
- Parar e religar a captura de tela em menos de 500 ms deixava o processo novo órfão.
- Fita WLED: id com os pontos do IP fazia os ajustes dela nunca serem achados.
- HID: dispositivo sem thread de escrita ia no ritmo errado (8 ms) por um teste que era sempre verdadeiro.
- Registro do Descobrir ilegível era apagado na instalação seguinte.
- Desfoque das ilhas fixas pesando 50% de um núcleo com a prévia ao vivo na tela.
- Painel de atraso com timers duplicados que zeravam as medidas; variável escondendo o tradutor no `wled:probe`.

## 4. Testes realizados e resultados
- `npm run check` (sem hardware): plugins, 42 efeitos, protocolo da tela Gamdias, idiomas, mensagens do motor — **OK**.
- No app, com o hardware deste PC (ASUS B850-F, Wooting 60HE, 2 pentes Corsair DDR5, AURA GL360 LCD):
  - 4 dispositivos detectados após cada mudança; cores chegando a cada um com a tela piscando 60×/s
    (Wooting 17 ms, RAM ~1 ms até o auxiliar, ASUS 61 ms — p50); Rescan sem apagar as cores.
  - Cooler (11.6): detecção ✔, modelo e firmware (V1.2.7 / hw V2.0) ✔, comunicação (resposta "200") ✔, imagem de
    16 KB em 2 ms ✔, 60 quadros seguidos ✔, troca de imagem ✔, reconexão depois de desconectar e ao reabrir o app ✔,
    conflito com o ZEUS CAST identificado como "porta ocupada" sem mexer no outro programa ✔.
    **Imagem vista na tela: não conferido por mim** (não tenho câmera; seção 8).
  - Idiomas trocados ao vivo; biblioteca (importar, duplicata, miniaturas, excluir em uso); WLED gravado contra um
    WLED simulado (os 3 pedidos certos); todas as abas, editor de layout, console de dispositivo; nenhum erro no console.
- Revisão por agente do código novo contra o antigo (fase H): 4 problemas achados e corrigidos antes da entrega.

## 5. Desempenho (medido)
| Medida | Antes | Depois |
|---|---|---|
| Atraso tela → LEDs (p50 / p95) | 104 / 166 ms | 17 / ~74 ms |
| Abrir a janela | 1,2–1,7 s | 129 ms |
| Status da RAM / apps em conflito / OpenRGB | 1064 / 219 / 207 ms | 55 / 4 / 0 ms |
| Iluminação, modo Layout (CPU total) | 75,8% de um núcleo | 28,1% |
| Iluminação com o Ambiente da Tela (cena Lo-Fi) | 75,8% (prévia ao vivo) | 5,4% |
| App parado (com papel de parede de vídeo) | 8,7% | 7,6% (6% é o vídeo) |
| Captura de tela (GPU) | — | 0,3% |
Sem melhoria possível sem perder função: auxiliar da RAM sob estresse (19%, espera do hardware no driver do SMBus);
decodificação do vídeo do papel de parede.

## 6. Dependências
**Nenhuma adicionada, removida ou atualizada.** Tudo com o que o projeto já tinha (Electron 45, koffi, node-hid 3.4,
DLLs do Windows e do driver). Nenhum download, nenhuma instalação, nenhuma configuração do sistema alterada.

## 7. Limitações técnicas encontradas
- Memória Corsair: sem gravação documentada na controladora; gravar às cegas arrisca o pente.
- Wooting: SDK de RGB volátil; perfis do Wootility com protocolo não público.
- Placas de vídeo: a RTX 5080 deste PC não tem LEDs; I2C por fabricante e AMD exigem hardware para validar.
- Tela Gamdias por HID (revisões que não usam porta serial): implementada pelo protocolo do ZEUS CAST, sem cooler
  HID aqui para testar.
- A porta serial do cooler é exclusiva: com o ZEUS CAST aberto, o Hydraflow avisa e espera (não fecha o outro
  programa sem sua autorização, como pedido).
- SMBus: o tempo de cada gravação nas memórias é do hardware (~3,6 ms por pente).

## 8. Depende de você, de hardware ou de recurso externo
1. **Olhar a tela do cooler** e confirmar que a imagem escolhida aparece (o protocolo confirma o recebimento; só
   você vê o resultado).
2. **Ativar a RGB da RAM do zero no app de desenvolvimento** (pede o UAC do Windows): valida o fluxo de ativação.
3. **Gravar de verdade na placa ASUS** ("Salvar no dispositivo") — você preferiu adiar; é uma gravação persistente.
4. **Gerar o instalador** (`npm run dist`): o app instalado ainda é a 0.9.0; ícone, idiomas e tudo desta etapa só
   chegam a ele depois disso. Ao gerar, vale incluir os idiomas en/es no instalador (hoje só pt-BR).
5. Placa de vídeo com LEDs (NVIDIA com zonas, ou outro fabricante) para validar a escrita.
6. Revisão visual das regras antigas de CSS ainda sobrescritas (fase H, "ficou de fora").

## 9. Situação final
Os 12 objetivos (0 a 11) foram implementados e testados até onde este PC e as autorizações permitem; o código
está organizado (motor em provedores, mensagens conferidas automaticamente) e mais leve, sem nenhuma dependência
nova. **Faltam os 6 itens da seção 8**; os quatro primeiros são passos seus de poucos minutos. Backups de cada fase
em `%USERPROFILE%\RGBStudio-backups`.

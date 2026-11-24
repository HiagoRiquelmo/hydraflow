# Protocolo da tela dos watercoolers Gamdias (AURA GL360 LCD e família)

Levantado por análise estática do ZEUS CAST 3.4.1.2 (instalador oficial, `ZEUS CAST.exe`, .NET), sem executá-lo.
Classes de origem: `GASerialControl.SerialMessenger`, `ProtocolCommands`, `SerialTransport`, `HidTransport`,
`LcdControlApi(Options)`, `GACommonFunction.DeviceRegistry` e `USBHelper`.

## Como o cooler aparece no Windows

| Variante | Identificação | Transporte |
|---|---|---|
| Serial (USB CDC) | `VID_1D6B&PID_0111` (o "PID" `0111` no registro de dispositivos do ZEUS CAST) | porta COM, 115200 baud, 8 bits, sem paridade, 1 stop bit |
| HID | VID `0x1B80` (Gamdias), PID `0xB547` = AURA LCD Display; `0xB53D` = CHIONE LCD | relatórios HID de 1025 bytes (byte 0 = report ID 0, depois até 1024 bytes de dados, completado com zeros) |

Resolução das telas (do `DeviceRegistry`): AURA LCD e CHIONE LCD **480×480**; BOREAS LCD (`B53B`) 272×480.

## Comandos (texto)

```
POST <comando> 1\r\n
ContentType=json\r\n
ContentLength=<tamanho do JSON>\r\n
\r\n
<JSON>
```

O "protocolo novo" acrescenta `SeqNumber=<n>\r\n` antes de `ContentType`; o padrão do ZEUS CAST é o antigo (sem SeqNumber).
`POST conn\r\n\r\n` é a exceção: sem cabeçalho nem JSON.

| Comando | JSON |
|---|---|
| `POST conn` | — (aperto de mão) |
| `POST power 1` | `{"event":"resume"}` (ou `suspend`, `shutdown`, `lock-screen`, `unlock-screen`) |
| `POST timeout 1` | `{"value":<segundos>}` (0 = nunca apagar) |
| `POST brightness 1` | `{"value":<0..100>}` |
| `POST rotate 1` | `{"degree":<0/90/180/270>}` |
| `POST realtimeDisplay 1` | `{"enable":true}` — liga o modo de imagens ao vivo |

A tela responde com texto: `200\r\n` (ok) ou `400\r\n` (falha).

## Moldura de cada comando

```
0x5A | tamanho (2 bytes, big-endian) = len(texto) + 5 | texto ASCII | soma | 0x5A
```

- `soma` = soma (mod 256) dos bytes de índice 1 até o último byte do texto (os 2 do tamanho + o texto).
- Depois de montada, os bytes entre o primeiro e o último `0x5A` são "escapados":
  `0x5A` → `0x5B 0x01` e `0x5B` → `0x5B 0x02`.
- Em HID a moldura é dividida em pedaços de 1024 bytes, cada um num relatório de 1025.

## Imagens ao vivo (o que o Hydraflow usa)

Depois de `POST realtimeDisplay 1 {"enable":true}`, cada quadro é um **JPEG 480×480**:

- **Serial:** os bytes do JPEG, crus, em pedaços de até 1024 bytes (sem moldura).
- **HID:** pedaços de até 1000 bytes do JPEG, cada um com um cabeçalho de 24 bytes:

| byte | valor |
|---|---|
| 0 | `0x5C` |
| 1–2 | tamanho do pedaço + 21 (big-endian) |
| 3 | `1` |
| 4–5 | número de pedaços = `floor(tamanho do JPEG / 1000) + 1` (big-endian) |
| 6–7 | índice do pedaço, começando em 0 (big-endian) |
| 8 | `1` |
| 9–23 | `0` |
| 24… | dados |

Sequência que o ZEUS CAST manda ao conectar: `power resume` → `timestamp` → `conn` → `timeout 0` → `brightness`.

## Limites conhecidos

- Testado contra o código do ZEUS CAST, não contra o cooler: neste PC o USB da tela falha ao conectar
  ("Unknown USB Device (Port Reset Failed)", `VID_0000&PID_0001`), então nenhum programa conversa com ela.
- Fundos gravados na tela (`POST transport` + MD5) e o modo "duas telas" não foram implementados.

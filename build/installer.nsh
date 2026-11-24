; Passos extras do instalador do Hydraflow (incluído pelo electron-builder: package.json → build.nsis.include).
; Depois de copiar os arquivos, deixa o RGB das memórias pronto: o próprio app (--setup-ram) instala o driver
; oficial PawnIO e registra o auxiliar com uma única permissão do Windows, usando os arquivos que vêm no instalador
; (resources\pawnio). Se a pessoa recusar a permissão, o app instala normalmente e o botão "Ativar" continua lá.
!macro customInstall
  DetailPrint "Preparando o RGB das memorias..."
  ExecWait '"$INSTDIR\Hydraflow.exe" --setup-ram'
!macroend

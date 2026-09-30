; The template retains stable installation keys; these hooks migrate shortcuts.

!macro NSIS_HOOK_PREINSTALL
  ; The stock installer checks only the new executable name.
  !insertmacro CheckIfAppIsRunning "prismoo.exe" "${PRODUCTNAME}"
!macroend

; Only replace shortcuts which point to this installation's previous binary.
; This also runs in /UPDATE mode, where the stock installer skips new shortcuts.
!macro BoolooMigrateShortcut OLD NEW
  !insertmacro IsShortcutTarget "${OLD}" "$INSTDIR\prismoo.exe"
  Pop $0
  ${If} $0 = 1
    ClearErrors
    CreateShortcut "${NEW}" "$INSTDIR\${MAINBINARYNAME}.exe"
    ${IfNot} ${Errors}
      !insertmacro SetLnkAppUserModelId "${NEW}"
      Delete "${OLD}"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro BoolooMigrateShortcut "$SMPROGRAMS\Prismoo.lnk" "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !insertmacro BoolooMigrateShortcut "$SMPROGRAMS\$AppStartMenuFolder\Prismoo.lnk" "$SMPROGRAMS\$AppStartMenuFolder\${PRODUCTNAME}.lnk"
  !insertmacro BoolooMigrateShortcut "$DESKTOP\Prismoo.lnk" "$DESKTOP\${PRODUCTNAME}.lnk"
!macroend

!include "FileFunc.nsh"

; -- Design invariant --
; Nothing destructive may run before the user confirms the wizard (or the
; uninstall prompt). electron-builder inserts customInit in .onInit, which
; runs when the installer is merely opened -- cancelling at the welcome or
; directory page must leave the existing installation and running app
; untouched. All destructive work (stopping processes, backing up skills,
; renaming the old install dir) therefore lives in customCheckAppRunning,
; which electron-builder inserts inside the install section -- right after
; the user clicks Install and, critically, *before* uninstallOldVersion.

; Timestamp from NSIS built-ins (FileFunc ${GetTime}). The previous
; implementation spawned a PowerShell process per call just to format a
; timestamp -- with 20+ call sites that added tens of seconds per install on
; machines where security software inspects every process launch. Second
; precision is enough: phase durations are carried separately as elapsed_ms.
;
; Preserves every register (unlike the old version, which clobbered $0; the
; "copy exit codes to $R2 first" convention at call sites is kept anyway).
; OUTVAR must not be $0-$6.
!macro GetTimestamp OUTVAR
  Push $0
  Push $1
  Push $2
  Push $3
  Push $4
  Push $5
  Push $6
  !ifdef BUILD_UNINSTALLER
    ${un.GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  !else
    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
  !endif
  ; $0=day $1=month $2=year $3=day-of-week name $4=hour $5=minute $6=second
  IntFmt $0 "%02d" $0
  IntFmt $1 "%02d" $1
  IntFmt $4 "%02d" $4
  IntFmt $5 "%02d" $5
  IntFmt $6 "%02d" $6
  StrCpy $0 "$2-$1-$0 $4:$5:$6"
  Pop $6
  Pop $5
  Pop $4
  Pop $3
  Pop $2
  Pop $1
  Exch $0
  Pop ${OUTVAR}
!macroend

!macro customHeader
  ; Request admin privileges for script execution (tar extract, etc.)
  ; This does NOT change the default install path -- just ensures UAC elevation.
  RequestExecutionLevel admin

  ; Keep only the progress bar visible. The details box stays hidden and
  ; NSIS/electron-builder retains the default status text behavior.
  ShowInstDetails nevershow
!macroend

; -- Stop every process that might hold file handles in the install dir --
;
; 1. LobsterAI.exe -- the main app AND the OpenClaw gateway (ELECTRON_RUN_AS_NODE)
; 2. node.exe whose binary lives inside the LobsterAI install tree
;    (Web Search bridge server, MCP servers spawned with detached:true)
;
; Stop-Process -Force is equivalent to taskkill /F -- the processes have no
; chance to run before-quit cleanup, so file handles may linger briefly as
; "ghost handles" in the Windows kernel. We poll until no matching process
; remains before proceeding.
;
; Shared between the installer and the uninstaller via customCheckAppRunning.
!macro stopLobsterAIProcesses
  DetailPrint "[Installer] Stopping running LobsterAI processes"
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "\
    Stop-Process -Name LobsterAI -Force -ErrorAction SilentlyContinue;\
    Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*LobsterAI*\" } | Stop-Process -Force -ErrorAction SilentlyContinue;\
    for ($$i = 0; $$i -lt 15; $$i++) {\
      $$procs = @();\
      $$procs += Get-Process -Name LobsterAI -ErrorAction SilentlyContinue;\
      $$procs += Get-Process node -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like \"*LobsterAI*\" };\
      if ($$procs.Count -eq 0) { break };\
      Start-Sleep -Milliseconds 500;\
    }"'
  Pop $0
  StrCpy $R2 $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  CreateDirectory "$APPDATA\LobsterAI"
  FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $9 0 END
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=process-stop-complete exit=$R2 elapsed_ms=$5$\r$\n"
  FileClose $9
!macroend

!macro customInit
  ; Diagnostics only -- .onInit runs before the user has confirmed anything,
  ; so this macro must stay non-destructive.
  CreateDirectory "$APPDATA\LobsterAI"
  FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" w
  !insertmacro GetTimestamp $8
  FileWrite $9 "$8 phase=custom-init-start instdir=$INSTDIR appdata=$APPDATA$\r$\n"
  FileClose $9
!macroend

; Replaces electron-builder's built-in CHECK_APP_RUNNING. Inserted:
;  - installer: inside the install section, right after the user confirms,
;    before uninstallOldVersion and file extraction
;  - uninstaller: un.install section (assisted) or un.onInit (silent /S)
!macro customCheckAppRunning
  !ifndef BUILD_UNINSTALLER
    ; Silent installs (/S -- e.g. enterprise IT deployments; in-app updates
    ; use --updated mode with a visible progress page instead) have no
    ; installer UI at all, so without this the machine looks idle for minutes
    ; mid-replace. Banner is a plugin-owned window, so it shows even in
    ; silent mode. The window dies with the installer process, so no failure
    ; path can leave it behind.
    ;
    ; The text is "Updating LobsterAI, please wait..." in Chinese, written as
    ; ${U+xxxx} escapes because this file must stay pure ASCII: the darwin
    ; makensis builds used for local syntax checks reject any non-ASCII byte
    ; (the escapes are fine on the Windows build machine -- the webPackage
    ; patch ships them in production already).
    ${If} ${Silent}
      Banner::show /NOUNLOAD "${U+6B63}${U+5728}${U+66F4}${U+65B0} LobsterAI${U+FF0C}${U+8BF7}${U+7A0D}${U+5019}${U+2026}"
    ${EndIf}
  !endif

  !insertmacro stopLobsterAIProcesses

  !ifndef BUILD_UNINSTALLER
    ; -- Backup user-created skills to AppData before extraction overwrites them --
    ; Copy non-bundled skills to %APPDATA%\LobsterAI\skills-backup\ so they are
    ; preserved when NSIS extracts the new version over the existing install.
    ; The backup is restored in customInstall after extraction completes.
    ; Must run before the $INSTDIR rename below -- it reads from $INSTDIR.
    ;
    ; Quoting note: paths use \"..\" (backslash-escaped quote) -- NOT $\"..$\" --
    ; because $\"..$\" produces raw quotes that Windows CRT argv parsing consumes,
    ; leaving the path unquoted and causing PowerShell method calls to fail.
    DetailPrint "[Installer] Backing up user-created skills"
    System::Call 'kernel32::GetTickCount()i .r7'
    ClearErrors
    FileOpen $R0 "$APPDATA\LobsterAI\skill-migrate.log" w
    IfErrors BackupLogOpenFailed
      !insertmacro GetTimestamp $8
      FileWrite $R0 "$8 phase=backup-start instdir=$INSTDIR appdata=$APPDATA$\r$\n"
      Goto BackupDoExec
    BackupLogOpenFailed:
      StrCpy $R0 ""
    BackupDoExec:

    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$src    = \"$INSTDIR\resources\SKILLs\";\
      $$backup = \"$APPDATA\LobsterAI\skills-backup\";\
      $$config = \"$$src\skills.config.json\";\
      if (Test-Path $$backup) { Remove-Item -Path $$backup -Recurse -Force -ErrorAction SilentlyContinue };\
      if (Test-Path $$src) {\
        $$bundled = @(try {\
          if (Test-Path $$config) {\
            (Get-Content $$config -Raw | ConvertFrom-Json).defaults.PSObject.Properties.Name\
          }\
        } catch { });\
        $$userSkills = @(Get-ChildItem -Path $$src -Directory | Where-Object { $$bundled -notcontains $$_.Name });\
        if ($$userSkills.Count -gt 0) {\
          New-Item -ItemType Directory -Path $$backup -Force | Out-Null;\
          $$userSkills | ForEach-Object {\
            Copy-Item -Path $$_.FullName -Destination (Join-Path $$backup $$_.Name) -Recurse -Force\
          }\
        }\
      }"'
    Pop $0
    Pop $1
    StrCpy $R2 $0
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7

    StrCmp $R0 "" BackupSkipCloseLog
      !insertmacro GetTimestamp $8
      FileWrite $R0 "$8 phase=backup-end exit=$R2 elapsed_ms=$5$\r$\n"
      FileWrite $R0 "$8 phase=backup-output text=$1$\r$\n"
      FileClose $R0
    BackupSkipCloseLog:
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=skill-backup-complete exit=$R2 elapsed_ms=$5$\r$\n"
    FileClose $9

    ; -- Remove old installation directory --
    ; Rename $INSTDIR so the old uninstaller exe disappears from its registered
    ; path -- uninstallOldVersion (which runs right after this hook) cannot find
    ; it, so the old uninstaller is never invoked and the "app cannot be closed"
    ; dialog (present in old uninstallers that lack a process pre-kill) is never
    ; shown. User skills are already safe in the AppData backup above, so skill
    ; preservation does not depend on this rename succeeding.
    ;
    ; Important: never reuse a fixed "$INSTDIR.old" path. If a previous async
    ; delete leaves that directory behind, Rename fails immediately and the old
    ; uninstaller remains in place. Instead, schedule cleanup of any stale
    ; *.old* dirs, then rename to a unique per-run suffix and schedule deletion
    ; of that unique directory in the background so extraction can start
    ; immediately after the rename succeeds.
    DetailPrint "[Installer] Removing previous installation directory"
    System::Call 'kernel32::GetTickCount()i .r7'
    IfFileExists "$INSTDIR\*.*" 0 SkipOldDirRemoval
      nsExec::ExecToLog 'cmd /c for /d %D in ("$INSTDIR.old*") do @start "" /b cmd /c rd /s /q "%~fD"'
      Pop $0
      System::Call 'kernel32::GetTickCount()i .r4'
      StrCpy $3 "$INSTDIR.old.$4"
      Rename "$INSTDIR" "$3"
      IfErrors 0 RenameOK
        Goto SkipOldDirRemoval
      RenameOK:
        nsExec::ExecToLog 'cmd /c start "" /b cmd /c rd /s /q "$3"'
        Pop $0
    SkipOldDirRemoval:
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=old-install-cleanup-complete elapsed_ms=$5 renamed_path=$3 cleanup_mode=async$\r$\n"
    FileClose $9

    ; -- Windows Defender exclusions, added BEFORE any file extraction --
    ; Field data that motivated the move: on the same SSD, NSIS payload
    ; extraction took 6m39s while the tar phase -- the only part the old
    ; customInstall-time exclusions covered -- took 31s. Adding them here
    ; (user has confirmed, old dir is renamed away, nothing extracted yet)
    ; puts the payload extraction, ~90% of install time, under the same
    ; protection.
    ;
    ; Scope:
    ;  - win-resources.tar: the single biggest win (a ~2GB file whose
    ;    close-handle full scan is the worst case). Temporary: the entry is
    ;    removed again at the end of customInstall, and a successful
    ;    extraction deletes the file itself anyway.
    ;  - cfmind / python-win / app.asar.unpacked: the same permanent entries
    ;    the previous design used (runtime trees, thousands of small files).
    ;  - SKILLs is deliberately NO LONGER excluded: it is user-writable and
    ;    its content is executed by the agent, so it must stay scannable.
    ;    customInstall drops the entry older installers left behind.
    ;  - /NoDefenderExclusion skips adding anything (enterprise IT opt-out,
    ;    also passed by the app when enterprise config demands it). A failing
    ;    Add-MpPreference (e.g. locked by Intune policy) degrades the same
    ;    way: slower install, otherwise unaffected.
    ; GetOptions leaves the error flag set when the switch is absent, so:
    ; error (switch absent) -> fall through and add exclusions;
    ; no error (switch present) -> jump past the whole block.
    ${GetParameters} $R9
    ClearErrors
    ${GetOptions} $R9 "/NoDefenderExclusion" $R8
    IfErrors 0 DefenderExclusionAddSkipped

    DetailPrint "[Installer] Adding Windows Defender exclusions before extraction"
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=defender-exclusion-start$\r$\n"
    FileClose $9
    System::Call 'kernel32::GetTickCount()i .r7'
    CreateDirectory "$INSTDIR\resources\cfmind"
    CreateDirectory "$INSTDIR\resources\python-win"
    CreateDirectory "$INSTDIR\resources\SKILLs"
    nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "try { Add-MpPreference -ExclusionPath $\"$INSTDIR\resources\win-resources.tar$\",$\"$INSTDIR\resources\cfmind$\",$\"$INSTDIR\resources\python-win$\",$\"$INSTDIR\resources\app.asar.unpacked$\" -ErrorAction Stop; Write-Output \"[Installer] Windows Defender exclusions added\" } catch { Write-Output (\"[Installer] Windows Defender exclusions skipped: \" + $$_.Exception.Message) }"'
    Pop $0
    StrCpy $R2 $0
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $9 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $9 0 END
    !insertmacro GetTimestamp $8
    FileWrite $9 "$8 phase=defender-exclusion-complete exit=$R2 elapsed_ms=$5$\r$\n"
    FileClose $9
    DefenderExclusionAddSkipped:
  !endif
!macroend

!macro customInstall
  ; -- Install Timing Log --
  ; Write timestamps to help diagnose slow installation phases.
  ; Log file: %APPDATA%\LobsterAI\install-timing.log

  CreateDirectory "$APPDATA\LobsterAI"
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=nsis-extract-complete$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Preparing installation steps"

  ; -- Extract combined resource archive (win-resources.tar) --
  ; All large resource directories (cfmind/, SKILLs/, python-win/) are packed
  ; into a single tar file. NSIS 7z extracts one large file almost instantly;
  ; we then unpack the tar here using Electron's Node runtime.
  ;
  ; Defender exclusions were already added in customCheckAppRunning, before
  ; the NSIS payload extraction; the temporary/legacy entries are trimmed at
  ; the end of this macro.

  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "1")i'

  DetailPrint "[Installer] Extracting bundled resources"
  ; $R2 = current extractor exit code, $R3 = extractor id for logs.
  ; ($R2 survives GetTimestamp, which clobbers $0 -- see the macro note.)
  StrCpy $R2 ""
  StrCpy $R3 "none"

  ; -- Attempt 1: Windows built-in bsdtar (Win10 1803+) --
  ; Runs a trusted system binary instead of the freshly written app exe,
  ; which security software tends to freeze for cloud analysis on its first
  ; execution (the root cause of installers hanging at this phase).
  IfFileExists "$SYSDIR\tar.exe" 0 TarExtractElectron
  StrCpy $R3 "system-tar"
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-start extractor=system-tar tar=$INSTDIR\resources\win-resources.tar dest=$INSTDIR\resources$\r$\n"
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r7'
  nsExec::ExecToLog '"$SYSDIR\tar.exe" -xf "$INSTDIR\resources\win-resources.tar" -C "$INSTDIR\resources"'
  Pop $0
  StrCpy $R2 $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-exit extractor=system-tar exit=$R2 elapsed_ms=$5$\r$\n"
  FileClose $2
  StrCmp $R2 "error" TarExtractElectron
  IntCmp $R2 0 TarExtractVerify TarExtractElectron TarExtractElectron

  TarExtractElectron:
  ; -- Attempt 2: bundled Electron Node runtime --
  ; Wrapped in a 10-minute watchdog: if security software freezes the child
  ; before it can run, the installer must fail visibly instead of hanging
  ; forever (a killed installer leaves a half-installed app behind).
  StrCpy $R3 "electron"
  DetailPrint "[Installer] Launching bundled extractor"
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-start extractor=electron tar=$INSTDIR\resources\win-resources.tar dest=$INSTDIR\resources$\r$\n"
  FileClose $2
  System::Call 'kernel32::GetTickCount()i .r7'

  nsExec::ExecToLog 'powershell -NoProfile -NonInteractive -Command "$$p = Start-Process -FilePath \"$INSTDIR\${APP_EXECUTABLE_FILENAME}\" -ArgumentList \"`\"$INSTDIR\resources\unpack-cfmind.cjs`\" `\"$INSTDIR\resources\win-resources.tar`\" `\"$INSTDIR\resources`\" `\"$APPDATA\LobsterAI\install-timing.log`\"\" -NoNewWindow -PassThru; if ($$p.WaitForExit(600000)) { $$p.WaitForExit(); if ($$p.ExitCode -eq $$null) { exit 125 }; exit $$p.ExitCode } else { Stop-Process -Id $$p.Id -Force -ErrorAction SilentlyContinue; exit 124 }"'
  Pop $0
  StrCpy $R2 $0
  System::Call 'kernel32::GetTickCount()i .r6'
  IntOp $5 $6 - $7
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-exit extractor=electron exit=$R2 elapsed_ms=$5$\r$\n"
  FileClose $2

  ; "error" = nsExec couldn't start powershell (check before IntCmp, which
  ; converts non-numeric strings to 0 and would misidentify "error" as success)
  StrCmp $R2 "error" TarExtractProcessFailed
  StrCmp $R2 "124" TarExtractTimeout
  ; IntCmp tolerates trailing whitespace/CR that StrCmp would reject
  IntCmp $R2 0 TarExtractVerify TarExtractNonZero TarExtractNonZero

  TarExtractVerify:
  ; Success requires the OpenClaw runtime entry to actually exist -- an exit
  ; code alone must never trigger deletion of the only recovery source.
  IfFileExists "$INSTDIR\resources\cfmind\gateway-bundle.mjs" TarExtractSucceeded
  IfFileExists "$INSTDIR\resources\cfmind\openclaw.mjs" TarExtractSucceeded
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 reason=entry-missing-after-extract$\r$\n"
  FileClose $2
  ; A bogus system-tar success still gets a shot at the bundled extractor.
  ;
  ; /SD IDOK on this and the failure boxes below: NSIS shows MessageBox even
  ; in /S installs unless a silent default is declared, and the in-app silent
  ; update must never block on an orphan dialog. First-launch recovery retries
  ; the extraction either way.
  StrCmp $R3 "system-tar" TarExtractElectron
  MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction finished but the AI runtime files are still missing. LobsterAI will retry the extraction automatically on first launch. If the app still reports missing runtime files, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
  Goto TarExtractFailed

  TarExtractProcessFailed:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 elapsed_ms=$5 reason=process-start-failed$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction failed: could not start the extractor process (exit=$R2). This is usually caused by antivirus software. LobsterAI will retry the extraction automatically on first launch; if that fails too, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    Goto TarExtractFailed

  TarExtractTimeout:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 elapsed_ms=$5 reason=timeout$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction timed out after 10 minutes -- the extractor process appears to be blocked, usually by antivirus software. LobsterAI will retry the extraction automatically on first launch; if that fails too, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    Goto TarExtractFailed

  TarExtractNonZero:
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=tar-extract-error extractor=$R3 exit=$R2 elapsed_ms=$5 reason=nonzero-exit$\r$\n"
    FileClose $2
    MessageBox MB_OK|MB_ICONEXCLAMATION "Resource extraction failed (exit code $R2). LobsterAI will retry the extraction automatically on first launch; if that fails too, add the install directory to your antivirus allowlist and reinstall. Details: $APPDATA\LobsterAI\install-timing.log" /SD IDOK
    Goto TarExtractFailed

  TarExtractSucceeded:
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-complete extractor=$R3 exit=$R2$\r$\n"
  FileClose $2
  ; Completion marker, read by the app for install-integrity diagnostics.
  FileOpen $2 "$INSTDIR\resources\.win-resources-extracted" w
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 source=installer extractor=$R3$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Bundled resources extraction complete"
  ; Only a verified success may delete these: the preserved archive is what
  ; lets the app finish an interrupted extraction at first launch.
  Delete "$INSTDIR\resources\win-resources.tar"
  Delete "$INSTDIR\resources\unpack-cfmind.cjs"
  Goto TarExtractDone

  TarExtractFailed:
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=tar-extract-failed-archive-preserved extractor=$R3 exit=$R2$\r$\n"
  FileClose $2
  TarExtractDone:

  ; -- Restore user-created skills from AppData backup --
  ; The backup was created in customCheckAppRunning before extraction began.
  ; Restore any skills not already present in the new install, then clean up
  ; the backup.
  IfFileExists "$APPDATA\LobsterAI\skills-backup\*.*" 0 SkipSkillRestore
    DetailPrint "[Installer] Restoring user-created skills"
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=skill-restore-start$\r$\n"
    FileClose $2
    System::Call 'kernel32::GetTickCount()i .r7'

    nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "\
      $$backup    = \"$APPDATA\LobsterAI\skills-backup\";\
      $$newSkills = \"$INSTDIR\resources\SKILLs\";\
      Get-ChildItem -Path $$backup -Directory | ForEach-Object {\
        $$target = Join-Path $$newSkills $$_.Name;\
        if (-not (Test-Path $$target)) {\
          Copy-Item -Path $$_.FullName -Destination $$target -Recurse -Force\
        }\
      };\
      Remove-Item -Path $$backup -Recurse -Force -ErrorAction SilentlyContinue"'
    Pop $0
    Pop $1
    StrCpy $R2 $0
    System::Call 'kernel32::GetTickCount()i .r6'
    IntOp $5 $6 - $7
    FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
    FileSeek $2 0 END
    !insertmacro GetTimestamp $8
    FileWrite $2 "$8 phase=skill-restore-complete exit=$R2 elapsed_ms=$5$\r$\n"
    FileWrite $2 "$8 phase=skill-restore-output text=$1$\r$\n"
    FileClose $2
  SkipSkillRestore:

  System::Call 'Kernel32::SetEnvironmentVariable(t "ELECTRON_RUN_AS_NODE", t "")i'

  ; The unpack script is deleted in TarExtractSucceeded above; after a failed
  ; extraction it is intentionally kept alongside win-resources.tar.

  ; -- Trim temporary/legacy Defender exclusions --
  ; The win-resources.tar entry only mattered during extraction; the SKILLs
  ; entry is what older installers added permanently and must not survive an
  ; upgrade (user-writable, agent-executed -- it has to stay scannable).
  ; Unconditional (no skip-flag check): this only ever narrows exclusions.
  ; Best effort: entries that do not exist are silently ignored.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Remove-MpPreference -ExclusionPath $\"$INSTDIR\resources\win-resources.tar$\",$\"$INSTDIR\resources\SKILLs$\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $0
  Pop $1
  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=defender-exclusion-trim-complete exit=$0$\r$\n"
  FileClose $2

  FileOpen $2 "$APPDATA\LobsterAI\install-timing.log" a
  FileSeek $2 0 END
  !insertmacro GetTimestamp $8
  FileWrite $2 "$8 phase=install-complete$\r$\n"
  FileClose $2
  DetailPrint "[Installer] Installation complete"

  ${If} ${Silent}
    Banner::destroy
  ${EndIf}
!macroend

; customUnInit intentionally not defined: the uninstaller stops app processes
; through customCheckAppRunning above, which the template invokes after the
; user confirms the uninstall (assisted mode) or immediately for silent /S
; uninstalls. Merely opening the uninstaller no longer kills the running app.

!macro customUnInstall
  ; -- Remove Windows Defender Exclusion on uninstall --
  ; Clean up every exclusion any installer version may have added: the
  ; current permanent set, the SKILLs entry from older versions, and the
  ; temporary win-resources.tar entry in case an install was interrupted
  ; before its trim step ran.
  nsExec::ExecToStack 'powershell -NoProfile -NonInteractive -Command "try { Remove-MpPreference -ExclusionPath $\"$INSTDIR\resources\cfmind$\",$\"$INSTDIR\resources\python-win$\",$\"$INSTDIR\resources\SKILLs$\",$\"$INSTDIR\resources\app.asar.unpacked$\",$\"$INSTDIR\resources\win-resources.tar$\" -ErrorAction SilentlyContinue } catch {}"'
  Pop $0
  Pop $1
!macroend

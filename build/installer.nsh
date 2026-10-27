; Registers Ma3madan Play under Settings > Apps > Default apps so it can be picked as the video player.
!define VP_CAPS "Software\Clients\Media\Ma3madan Play\Capabilities"
; The app was called "Ma3madan Video Presenter" before 1.4.0.
!define VP_OLD_NAME "Ma3madan Video Presenter"

!macro customInstall
  DeleteRegKey SHCTX "Software\Clients\Media\${VP_OLD_NAME}"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "${VP_OLD_NAME}"
  WriteRegStr SHCTX "${VP_CAPS}" "ApplicationName" "Ma3madan Play"
  WriteRegStr SHCTX "${VP_CAPS}" "ApplicationDescription" "Video player and presenter for a second screen"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".mp4" "Ma3madan.Video"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".m4v" "Ma3madan.Video"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".mkv" "Ma3madan.Video"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".webm" "Ma3madan.Video"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".mov" "Ma3madan.Video"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".mp3" "Ma3madan.Audio"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".m4a" "Ma3madan.Audio"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".wav" "Ma3madan.Audio"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".aac" "Ma3madan.Audio"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".ogg" "Ma3madan.Audio"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".opus" "Ma3madan.Audio"
  WriteRegStr SHCTX "${VP_CAPS}\FileAssociations" ".flac" "Ma3madan.Audio"
  WriteRegStr SHCTX "Software\RegisteredApplications" "Ma3madan Play" "${VP_CAPS}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  ; The phone remote: phones on the same network may reach the app (on any network: a hotspot or a
  ; new Wi-Fi is often "Public"), and only from that local network.
  ; Needs an installation for all users (admin); otherwise Windows asks once, the first time.
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Ma3madan Play"'
  ; Windows' own rules for it (a 'Block' from a dismissed prompt would win over any 'Allow').
  nsExec::Exec 'netsh advfirewall firewall delete rule name=all program="$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  nsExec::Exec 'netsh advfirewall firewall add rule name="Ma3madan Play" dir=in action=allow program="$INSTDIR\${APP_EXECUTABLE_FILENAME}" enable=yes profile=any remoteip=localsubnet'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Clients\Media\Ma3madan Play"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Ma3madan Play"
  nsExec::Exec 'netsh advfirewall firewall delete rule name="Ma3madan Play"'
  ; It started with Windows (tray.js): not any more.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Ma3madan Play"
!macroend

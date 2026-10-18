; Registers Ma3madan Video Presenter under Settings > Apps > Default apps so it can be picked as the video player.
!define VP_CAPS "Software\Clients\Media\Ma3madan Video Presenter\Capabilities"

!macro customInstall
  WriteRegStr SHCTX "${VP_CAPS}" "ApplicationName" "Ma3madan Video Presenter"
  WriteRegStr SHCTX "${VP_CAPS}" "ApplicationDescription" "Video player with a presenter view for a second screen"
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
  WriteRegStr SHCTX "Software\RegisteredApplications" "Ma3madan Video Presenter" "${VP_CAPS}"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Clients\Media\Ma3madan Video Presenter"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "Ma3madan Video Presenter"
!macroend

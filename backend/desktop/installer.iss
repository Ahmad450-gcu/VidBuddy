; Inno Setup script for the VidBuddy Windows installer. Built by desktop\build.ps1.
; Installs per user (no admin prompt). Uninstalling keeps the user's downloads and library.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6F2B8C1E-4D7A-4B8E-9C55-1A7E3D9B2F40}
AppName=VidBuddy
AppVersion={#AppVersion}
AppVerName=VidBuddy {#AppVersion}
AppPublisher=VidBuddy
AppPublisherURL=https://github.com/Ahmad450-gcu/VidBuddy
AppSupportURL=https://github.com/Ahmad450-gcu/VidBuddy/issues
DefaultDirName={localappdata}\Programs\VidBuddy
DefaultGroupName=VidBuddy
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=VidBuddy-Setup-{#AppVersion}
SetupIconFile=build\vidbuddy.ico
UninstallDisplayIcon={app}\VidBuddy.exe
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "build\dist\VidBuddy\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[InstallDelete]
; drop files from the previous version so stale modules never linger
Type: filesandordirs; Name: "{app}\_internal"

[Icons]
Name: "{autoprograms}\VidBuddy"; Filename: "{app}\VidBuddy.exe"
Name: "{autodesktop}\VidBuddy"; Filename: "{app}\VidBuddy.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\VidBuddy.exe"; Description: "{cm:LaunchProgram,VidBuddy}"; Flags: nowait postinstall skipifsilent

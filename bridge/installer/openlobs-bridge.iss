; OpenLobs Bridge: Windows installer (Inno Setup 6).
; Build:  iscc /DAppVersion=0.5.0 /DDefaultServer=https://your-openlobs bridge\installer\openlobs-bridge.iss
; Silent: OpenLobs-Bridge-Setup.exe /VERYSILENT /SERVER=https://your-openlobs /CODE=ABCD2345 /ALLOWBROWSER=1
#ifndef AppVersion
  #define AppVersion "0.5.0"
#endif
#ifndef DefaultServer
  #define DefaultServer ""
#endif

[Setup]
AppId={{B3601C38-D839-4E10-ABF0-63CDE56D85A6}
AppName=OpenLobs Bridge
AppVersion={#AppVersion}
AppPublisher=Mensah Labs
; Installs for the current person only, so Windows does not ask for an administrator password.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\OpenLobs Bridge
DisableProgramGroupPage=yes
DisableDirPage=yes
OutputDir=..\..\dist
OutputBaseFilename=OpenLobs-Bridge-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=OpenLobs Bridge
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
Source: "..\..\dist\bridge-app\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{userprograms}\OpenLobs Bridge\Bridge status"; Filename: "{cmd}"; Parameters: "/k ""{app}\bridge.cmd"" status"
Name: "{userprograms}\OpenLobs Bridge\Connect to OpenLobs"; Filename: "{cmd}"; Parameters: "/k ""{app}\bridge.cmd"" connect"
Name: "{userprograms}\OpenLobs Bridge\Allow looking at web pages"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" allow browser & pause"
Name: "{userprograms}\OpenLobs Bridge\Pause everything now"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" pause & pause"
Name: "{userprograms}\OpenLobs Bridge\Resume"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" resume & pause"
Name: "{userprograms}\OpenLobs Bridge\Allow spreadsheet work in one folder"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" allow excel & pause"
Name: "{userprograms}\OpenLobs Bridge\Stop allowing spreadsheet work"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" deny excel & pause"
Name: "{userprograms}\OpenLobs Bridge\Check that spreadsheets work"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" selftest & pause"
Name: "{userprograms}\OpenLobs Bridge\Stop allowing web page looks"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" deny browser & pause"
Name: "{userprograms}\OpenLobs Bridge\Allow OpenLobs to use a browser"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" allow browser_use & pause"
Name: "{userprograms}\OpenLobs Bridge\Stop allowing browser use"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" deny browser_use & pause"
Name: "{userprograms}\OpenLobs Bridge\Sign in to sites for OpenLobs"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" browser login & pause"
Name: "{userprograms}\OpenLobs Bridge\Sign out of all sites in the OpenLobs browser"; Filename: "{cmd}"; Parameters: "/c ""{app}\bridge.cmd"" browser forget & pause"
Name: "{userprograms}\OpenLobs Bridge\Start the Bridge"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\bridge-hidden.vbs"""
Name: "{userprograms}\OpenLobs Bridge\Recent activity"; Filename: "{win}\notepad.exe"; Parameters: """{userappdata}\OpenLobsBridge\bridge.log"""
; Starts by itself when you sign in to Windows.
Name: "{userstartup}\OpenLobs Bridge"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\bridge-hidden.vbs"""

[UninstallDelete]
Type: filesandordirs; Name: "{userappdata}\OpenLobsBridge"
; The browser profile OpenLobs used (its sign-ins) goes too.
Type: filesandordirs; Name: "{localappdata}\OpenLobsBridge"

[Code]
var
  ConnectPage: TInputQueryWizardPage;
  PermissionPage: TInputOptionWizardPage;

procedure InitializeWizard;
begin
  ConnectPage := CreateInputQueryPage(wpWelcome, 'Connect to OpenLobs',
    'Where is your OpenLobs, and what is your pairing code?',
    'In OpenLobs, open the Computers page and press "Add a computer". Type the address of your OpenLobs and the code it shows. The code works once and expires after 10 minutes. You can also leave the code empty and connect later from the Start menu.');
  ConnectPage.Add('OpenLobs address (for example https://openlobs.example):', False);
  ConnectPage.Add('Pairing code:', False);
  ConnectPage.Values[0] := ExpandConstant('{param:SERVER|{#DefaultServer}}');
  ConnectPage.Values[1] := ExpandConstant('{param:CODE|}');

  PermissionPage := CreateInputOptionPage(ConnectPage.ID, 'What OpenLobs may do on this computer',
    'You decide. The Bridge only does what you allow here.', 'It can always answer a test ping. Tick this to allow one more thing:',
    False, False);
  PermissionPage.Add('Look at web pages. OpenLobs can open a page in Edge or Chrome, in an empty browser with no logins, and see a screenshot. It never clicks or types. Useful for checking a site you are building on this computer.');
  PermissionPage.Values[0] := ExpandConstant('{param:ALLOWBROWSER|0}') = '1';
end;

{ Letters and digits and a few address characters only: these end up on a command line. }
function CleanText(const S, Allowed: String): Boolean;
var I: Integer;
begin
  Result := True;
  for I := 1 to Length(S) do
    if Pos(UpperCase(S[I]), Allowed) = 0 then Result := False;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var Server, Code: String;
begin
  Result := True;
  if CurPageID = ConnectPage.ID then begin
    Server := Trim(ConnectPage.Values[0]);
    Code := Trim(ConnectPage.Values[1]);
    if (Code <> '') and (Server = '') then begin
      MsgBox('Please type the address of your OpenLobs too.', mbError, MB_OK); Result := False; Exit;
    end;
    if (Server <> '') and (not CleanText(Server, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:/.-_~')) then begin
      MsgBox('The address contains a character that is not allowed. Use something like https://openlobs.example', mbError, MB_OK); Result := False; Exit;
    end;
    if (Code <> '') and (not CleanText(Code, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-')) then begin
      MsgBox('The pairing code has only letters and numbers. Copy it again from the Computers page.', mbError, MB_OK); Result := False; Exit;
    end;
  end;
end;

procedure RunBridge(const Args, LogName: String; var ResultCode: Integer);
begin
  Exec(ExpandConstant('{cmd}'), '/C ""' + ExpandConstant('{app}\bridge.cmd') + '" ' + Args + ' > "' + ExpandConstant('{tmp}\' + LogName) + '" 2>&1"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure StopRunningBridge;
var Code: Integer;
begin
  Exec(ExpandConstant('{cmd}'), '/C taskkill /F /IM openlobs-bridge.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  StopRunningBridge;
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var Code: Integer; Server, Code2, Output: String; AnsiOut: AnsiString;
begin
  if CurStep <> ssPostInstall then Exit;
  Server := Trim(ConnectPage.Values[0]);
  Code2 := Trim(ConnectPage.Values[1]);
  if Code2 <> '' then begin
    RunBridge('pair ' + Code2 + ' --server ' + Server, 'pair.txt', Code);
    LoadStringFromFile(ExpandConstant('{tmp}\pair.txt'), AnsiOut);
    Output := Trim(String(AnsiOut));
    if Code <> 0 then begin
      Log('Pairing failed: ' + Output);
      if not WizardSilent then
        MsgBox('OpenLobs Bridge is installed, but it could not connect:' + #13#10#13#10 + Output + #13#10#13#10 +
               'Make a new code in OpenLobs, then choose "Connect to OpenLobs" in the Start menu.', mbError, MB_OK);
      Exit;
    end;
    if PermissionPage.Values[0] then RunBridge('allow browser', 'allow.txt', Code);
    { Start it now, hidden. From now on it starts when you sign in. }
    Exec(ExpandConstant('{sys}\wscript.exe'), '"' + ExpandConstant('{app}\bridge-hidden.vbs') + '"', '', SW_HIDE, ewNoWait, Code);
  end else if FileExists(ExpandConstant('{userappdata}\OpenLobsBridge\config.json')) then begin
    { An update over an existing install: it is already paired, so start it again right away. }
    Exec(ExpandConstant('{sys}\wscript.exe'), '"' + ExpandConstant('{app}\bridge-hidden.vbs') + '"', '', SW_HIDE, ewNoWait, Code);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var Code: Integer;
begin
  if CurUninstallStep = usUninstall then begin
    { Tell OpenLobs to forget this computer, then stop the Bridge. Both are best effort. }
    Exec(ExpandConstant('{cmd}'), '/C ""' + ExpandConstant('{app}\bridge.cmd') + '" disconnect"', '', SW_HIDE, ewWaitUntilTerminated, Code);
    StopRunningBridge;
  end;
end;

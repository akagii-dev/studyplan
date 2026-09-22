param(
  [Parameter(Mandatory=$true)][int]$ProcessId,
  [ValidateSet('inspect','resize','maximize','minimize','restore','close')][string]$Action = 'inspect',
  [int]$Width = 910,
  [int]$Height = 680
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WindowTestControl {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
}
'@
$null = [WindowTestControl]::SetThreadDpiAwarenessContext([IntPtr](-4))
$target = Get-Process -Id $ProcessId
$window = $target.MainWindowHandle
if ($window -eq [IntPtr]::Zero) { throw 'The test process has no visible window.' }
$client = New-Object WindowTestControl+Rect
$outer = New-Object WindowTestControl+Rect
$null = [WindowTestControl]::GetClientRect($window, [ref]$client)
$null = [WindowTestControl]::GetWindowRect($window, [ref]$outer)
$scale = [WindowTestControl]::GetDpiForWindow($window) / 96.0
switch ($Action) {
  'resize' {
    $w = [int]($Width * $scale) + ($outer.Right - $outer.Left) - $client.Right
    $h = [int]($Height * $scale) + ($outer.Bottom - $outer.Top) - $client.Bottom
    if (-not [WindowTestControl]::SetWindowPos($window, [IntPtr]::Zero, 0, 0, $w, $h, 6)) { throw 'Resize failed.' }
  }
  'maximize' { $null = [WindowTestControl]::ShowWindow($window, 3) }
  'minimize' { $null = [WindowTestControl]::ShowWindow($window, 6) }
  'restore' { $null = [WindowTestControl]::ShowWindow($window, 9) }
  'close' { $null = [WindowTestControl]::PostMessage($window, 0x0112, [IntPtr]0xF060, [IntPtr]::Zero) }
}
$null = [WindowTestControl]::GetClientRect($window, [ref]$client)
@{
  width = [Math]::Round($client.Right / $scale)
  height = [Math]::Round($client.Bottom / $scale)
  maximized = [WindowTestControl]::IsZoomed($window)
  minimized = [WindowTestControl]::IsIconic($window)
} | ConvertTo-Json -Compress

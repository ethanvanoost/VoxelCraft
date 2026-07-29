# Builds standalone.html — the entire game bundled into ONE file that runs
# from a plain double-click (file://), no server needed.
#
# How it works: browsers refuse to load *local module files* on file:// pages,
# but an *inline* module script is fine, and importing Three.js from the CDN
# is allowed (CORS). So this script concatenates every js/ module in
# dependency order, strips import/export statements, and inlines the result
# (plus the CSS) into a copy of index.html.
#
# Re-run this after changing anything in js/ or css/:
#   powershell -ExecutionPolicy Bypass -File build-standalone.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Dependency order: leaf modules first, main.js last.
$order = @(
  'js/core/config.js',
  'js/core/noise.js',
  'js/core/blocks.js',
  'js/core/textures.js',
  'js/core/recipes.js',
  'js/world/worldgen.js',
  'js/world/chunk.js',
  'js/world/world.js',
  'js/player/player.js',
  'js/player/interaction.js',
  'js/ui/inventory.js',
  'js/ui/hud.js',
  'js/ui/settings.js',
  'js/ui/commands.js',
  'js/environment/sky.js',
  'js/audio/audio.js',
  'js/core/save.js',
  'js/main.js'
)

$bundle = New-Object System.Text.StringBuilder
[void]$bundle.AppendLine("import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';")

foreach ($file in $order) {
  $code = Get-Content (Join-Path $root $file) -Raw -Encoding UTF8
  # Strip import statements (all single-line in this codebase)
  $code = [regex]::Replace($code, '(?m)^import[^\r\n]*$', '')
  # Top-level CONFIG/BLOCK destructures appear in several modules with the
  # same names; 'var' tolerates redeclaration in the merged scope.
  $code = [regex]::Replace($code, '(?m)^const (\{[^}]*\} = (CONFIG|BLOCK);)', 'var $1')
  # Strip export keywords (definitions stay, now shared via the single scope)
  $code = [regex]::Replace($code, '(?m)^export ', '')
  [void]$bundle.AppendLine("// ============ $file ============")
  [void]$bundle.AppendLine($code)
}

$html = Get-Content (Join-Path $root 'index.html') -Raw -Encoding UTF8
$css  = Get-Content (Join-Path $root 'css/style.css') -Raw -Encoding UTF8

# Inline the stylesheet
$html = $html.Replace('<link rel="stylesheet" href="css/style.css">', "<style>`n$css</style>")
# Remove the file:// redirect guard (this build IS the file:// version)
$html = [regex]::Replace($html, '(?s)// FILE-GUARD-START.*?// FILE-GUARD-END', '')
# Swap the module reference for the inline bundle
$html = $html.Replace('<script type="module" src="js/main.js"></script>',
                      "<script type=`"module`">`n$($bundle.ToString())`n</script>")
$html = $html.Replace('<title>VoxelCraft</title>', '<title>VoxelCraft (Standalone)</title>')

$out = Join-Path $root 'standalone.html'
[IO.File]::WriteAllText($out, $html, (New-Object Text.UTF8Encoding $false))
Write-Host "Built standalone.html ($([math]::Round((Get-Item $out).Length / 1KB)) KB)"

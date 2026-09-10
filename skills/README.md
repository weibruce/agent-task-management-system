# Atms Agent Skills

This directory contains Atms Agent Skills for agents that understand
`SKILL.md` directories.

## Core Install Rule

Install these skills by linking each `skills/atms-*` directory from this
source checkout into the agent's skill directory. Do not copy skill directories
for normal installs. A linked install keeps the active skills updated when the
Atms repository is pulled or switched to a newer commit.

Supported target directories:

- Codex: `${CODEX_HOME:-$HOME/.codex}/skills`
- Claude Code: `$HOME/.claude/skills`
- Atms Manager Agent: `${ATMS_HOME:-$HOME/.atms}/skills`

Manager automatically creates the Atms Manager Agent skill directory and
links missing built-in `atms-*` skills from the active checkout. Existing
entries are never replaced, so a user-owned skill with the same directory id
overrides the built-in version. Every directory containing `SKILL.md` under
this root is exposed to all Manager Agent harnesses on the next turn.

## macOS / Linux

```bash
repo=/path/to/Atms

for root in "${CODEX_HOME:-$HOME/.codex}/skills" "$HOME/.claude/skills"; do
  mkdir -p "$root"

  for skill in "$repo"/skills/atms-*; do
    [ -d "$skill" ] || continue
    name="$(basename "$skill")"
    dst="$root/$name"

    if [ -L "$dst" ]; then
      rm "$dst"
    elif [ -e "$dst" ]; then
      echo "Refusing to replace existing non-symlink skill: $dst" >&2
      continue
    fi

    ln -s "$skill" "$dst"
  done
done
```

## Windows PowerShell

Run PowerShell with Developer Mode enabled, or as Administrator if directory
symlinks are blocked by Windows policy.

```powershell
$repo = "C:\path\to\Atms"
$roots = @(
  "$env:USERPROFILE\.codex\skills",
  "$env:USERPROFILE\.claude\skills"
)

foreach ($root in $roots) {
  New-Item -ItemType Directory -Force -Path $root | Out-Null

  Get-ChildItem (Join-Path $repo "skills") -Directory -Filter "atms-*" | ForEach-Object {
    $dst = Join-Path $root $_.Name

    if ((Test-Path $dst) -and ((Get-Item $dst).LinkType)) {
      Remove-Item $dst
    } elseif (Test-Path $dst) {
      Write-Warning "Refusing to replace existing non-link skill: $dst"
      $dst = $null
    }

    if ($dst) {
      New-Item -ItemType SymbolicLink -Path $dst -Target $_.FullName | Out-Null
    }
  }
}
```

If Windows cannot create directory symlinks, use a junction as the local
fallback. It still points at the checkout and updates with the repository:

```powershell
cmd /c mklink /J "%USERPROFILE%\.claude\skills\atms-install-ops" "C:\path\to\Atms\skills\atms-install-ops"
```

Repeat the junction command for each `atms-*` skill that should be
available.

## After Installing

Restart or reload the agent host if it only discovers skills on startup.

Direct invocation examples:

- Codex: `$atms-install-ops`
- Claude Code: `/atms-install-ops`
- DAG pattern selection in Codex: `$atms-dag-patterns`
- DAG pattern selection in Claude Code: `/atms-dag-patterns`

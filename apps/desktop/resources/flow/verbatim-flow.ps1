<#
  verbatim-flow.ps1 — CardMirror ↔ Verbatim Flow bridge (Windows only).

  Reproduces, from an external process, exactly what the Verbatim Word
  add-in does to talk to Verbatim Flow (the Excel template): drive the
  STANDARD Excel object model over COM. Requires NO modification to
  Verbatim Flow — it is a passive recipient of active-cell writes.

  Invoked by apps/desktop/src/flow-bridge.ts as:
    powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass \
      -File verbatim-flow.ps1 -Verb <available|send|pull|create> \
      [-PayloadFile <json>] [-Force]

  Payload (send): { "cells": ["...", ...] } — values written DOWN the
  column from the current active cell (cell mode = one element; column
  mode = one per paragraph). Output: a single compact JSON object on
  stdout. Never quits the user's Excel; only reads/writes its cells.
#>
param(
  [Parameter(Mandatory = $true)][string]$Verb,
  [string]$PayloadFile = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Result($obj) { Write-Output ($obj | ConvertTo-Json -Compress -Depth 6) }

# = VBA GetObject(, "Excel.Application") — the RUNNING instance, no launch.
function Get-RunningExcel {
  try { return [Runtime.InteropServices.Marshal]::GetActiveObject('Excel.Application') }
  catch { return $null }
}

# = VBA: For Each w In Workbooks: If InStr(LCase(w.Name),"flow")
function Find-FlowWorkbook($xl) {
  foreach ($wb in $xl.Workbooks) {
    if ($wb.Name.ToLower().Contains('flow')) { return $wb }
  }
  return $null
}

try {
  switch ($Verb) {

    'available' {
      $xl = Get-RunningExcel
      if ($null -eq $xl) { Write-Result @{ available = $false; reason = 'excel-not-open' }; break }
      $wb = Find-FlowWorkbook $xl
      if ($null -eq $wb) { Write-Result @{ available = $false; reason = 'no-flow-workbook' }; break }
      Write-Result @{ available = $true; workbook = $wb.Name }
    }

    'send' {
      $xl = Get-RunningExcel
      if ($null -eq $xl) { Write-Result @{ ok = $false; error = 'excel-not-open' }; break }
      $wb = Find-FlowWorkbook $xl
      if ($null -eq $wb) { Write-Result @{ ok = $false; error = 'no-flow-workbook' }; break }
      $wb.Activate()
      $sheet = $wb.ActiveSheet
      if ($null -eq $sheet) { Write-Result @{ ok = $false; error = 'no-active-sheet' }; break }

      $payload = Get-Content -Raw -Encoding UTF8 -Path $PayloadFile | ConvertFrom-Json
      $cells = @($payload.cells)
      if ($cells.Count -eq 0) { Write-Result @{ ok = $true; written = 0 }; break }

      # Overwrite guard (= Verbatim's "already text where you're sending"
      # prompt) — checked on the first target cell.
      $target = $xl.ActiveCell
      if (-not $Force -and ("$($target.Value2)").Length -gt 0) {
        Write-Result @{ ok = $false; needsConfirm = $true; cell = $target.Address($false, $false) }
        break
      }

      $written = 0
      foreach ($c in $cells) {
        $xl.ActiveCell.Value2 = [string]$c
        $xl.ActiveCell.Offset(1, 0).Select() | Out-Null   # advance down one row
        $written++
      }
      Write-Result @{ ok = $true; written = $written }
    }

    'pull' {
      $xl = Get-RunningExcel
      if ($null -eq $xl) { Write-Result @{ ok = $false; error = 'excel-not-open' }; break }
      $wb = Find-FlowWorkbook $xl
      if ($null -eq $wb) { Write-Result @{ ok = $false; error = 'no-flow-workbook' }; break }
      $out = New-Object System.Collections.Generic.List[string]
      foreach ($cell in $xl.Selection.Cells) {
        $v = "$($cell.Value2)"
        if ($v.Length -gt 0) { $out.Add($v) }
      }
      Write-Result @{ ok = $true; cells = $out.ToArray() }
    }

    'create' {
      # = Verbatim CreateFlow: launch Excel, open Debate.xltm from Word's
      # user-templates folder. We can't read Word's NormalTemplate.Path
      # here, so try the conventional Office user-templates locations.
      $candidates = @()
      if ($env:APPDATA) { $candidates += (Join-Path $env:APPDATA 'Microsoft\Templates\Debate.xltm') }
      $payloadPath = ''
      if ($PayloadFile -ne '') {
        try { $payloadPath = (Get-Content -Raw -Encoding UTF8 -Path $PayloadFile | ConvertFrom-Json).templatePath } catch {}
      }
      if ($payloadPath -ne '') { $candidates = @($payloadPath) + $candidates }
      $template = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
      if ($null -eq $template) { Write-Result @{ ok = $false; error = 'template-not-found'; tried = $candidates }; break }
      $xl = New-Object -ComObject Excel.Application
      $xl.Visible = $true
      $xl.Workbooks.Add($template) | Out-Null
      Write-Result @{ ok = $true; template = $template }
    }

    default { Write-Result @{ ok = $false; error = "unknown-verb:$Verb" } }
  }
}
catch {
  Write-Result @{ ok = $false; error = $_.Exception.Message }
}

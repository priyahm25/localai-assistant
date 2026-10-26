param(
  [int]$SecondsPerCheckpoint = 20,
  [int]$SampleIntervalSeconds = 1
)

$ErrorActionPreference = 'Stop'
$packageName = 'com.localai.assistant'
$adbCommand = Get-Command adb -ErrorAction Stop
$checkpoints = @(
  'before-model-initialization',
  'after-model-initialization',
  'after-document-extraction',
  'during-inference',
  'after-summarization'
)

foreach ($checkpoint in $checkpoints) {
  [void](Read-Host "When '$checkpoint' is active, press Enter to sample process PSS for $SecondsPerCheckpoint seconds")
  $stopAt = (Get-Date).AddSeconds($SecondsPerCheckpoint)
  do {
    $dump = & $adbCommand.Source shell dumpsys meminfo $packageName 2>&1
    $totalLine = $dump | Select-String -Pattern '^\s*TOTAL\s+PSS:\s*([\d,]+)' | Select-Object -First 1
    if (-not $totalLine -or $totalLine.Matches.Count -eq 0) {
      throw "Could not read TOTAL PSS for $packageName. Confirm the app is running on a connected Android device."
    }
    $pssKb = [int64]($totalLine.Matches[0].Groups[1].Value -replace ',', '')
    [pscustomobject]@{
      timestamp = (Get-Date).ToUniversalTime().ToString('o')
      checkpoint = $checkpoint
      pssKb = $pssKb
    } | ConvertTo-Json -Compress
    Start-Sleep -Seconds $SampleIntervalSeconds
  } while ((Get-Date) -lt $stopAt)
}

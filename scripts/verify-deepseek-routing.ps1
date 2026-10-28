#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$ApiKey = $env:CHEAPBUDDY_API_KEY,
    [string]$BaseUrl = "https://api.cheapbuddy.cc",
    [string]$ModelId = "deepseek-flash",
    [string]$AliasFile = (Join-Path $PSScriptRoot "../relay/config/model-aliases.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$canonicalModelId = "deepseek-v4.1-flash-1017"
$aliases = Get-Content -LiteralPath $AliasFile -Raw -Encoding utf8 | ConvertFrom-Json -AsHashtable
if ($ModelId -cne $canonicalModelId -and (
    $aliases -isnot [System.Collections.IDictionary] -or
    $ModelId -notmatch "(?i)deepseek.*flash" -or
    [string]$aliases[$ModelId] -cne $canonicalModelId
)) {
    throw "Select the canonical Flash model or an alias from relay/config/model-aliases.json."
}
if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    throw "Set CHEAPBUDDY_API_KEY through a protected environment variable."
}

$apiBase = $BaseUrl.TrimEnd("/")
if ($apiBase -notmatch "/v1$") { $apiBase += "/v1" }
$endpoint = "$apiBase/chat/completions"
$request = @{
    Uri = $endpoint
    Method = "Post"
    Headers = @{ Authorization = "Bearer $ApiKey"; "Content-Type" = "application/json" }
    Body = (@{
        model = $ModelId
        messages = @(@{ role = "user"; content = "Reply with OK only." })
        max_tokens = 32
        stream = $false
    } | ConvertTo-Json -Depth 6 -Compress)
    TimeoutSec = 60
}

Write-Host "DeepSeek probe: one request, max_tokens=32, nonstreaming." -ForegroundColor Cyan
Write-Host "Requested model: $ModelId; expected upstream in Usage: $canonicalModelId (the response may echo the public alias)."
try {
    $response = Invoke-RestMethod @request
} catch {
    $statusCode = $null
    if ($_.Exception.PSObject.Properties["Response"] -and $_.Exception.Response) {
        $statusCode = [int]$_.Exception.Response.StatusCode
    } elseif ($_.Exception.PSObject.Properties["StatusCode"] -and $_.Exception.StatusCode) {
        $statusCode = [int]$_.Exception.StatusCode
    }
    # Avoid dumping exception payloads, request headers or credentials.
    Write-Host "Probe failed (HTTP $statusCode). Check protected request logs; no retry was sent." -ForegroundColor Red
    exit 1
}

$content = $null
if ($null -ne $response -and -not ($response.PSObject.Properties["error"] -and $response.error)) {
    $choices = @()
    if ($response.PSObject.Properties["choices"]) { $choices = @($response.choices) }
    if ($choices.Count -gt 0 -and $null -ne $choices[0] -and $choices[0].PSObject.Properties["message"]) {
        $message = $choices[0].message
        if ($null -ne $message -and $message.PSObject.Properties["content"]) { $content = $message.content }
    }
}
if ($content -isnot [string] -or [string]::IsNullOrWhiteSpace($content)) {
    Write-Host "Probe failed: 2xx without nonempty message content is not a successful model response." -ForegroundColor Red
    exit 1
}

Write-Host "Probe passed: 2xx and nonempty message content." -ForegroundColor Green
Write-Host "Check Usage for the requested alias, final upstream $canonicalModelId, actual account and recorded usage/cost."
Write-Host "Expected global order: pptoken account 8 priority 1, EcoPhase account 12 priority 2."
Write-Host "This gateway request does not prove every tier is healthy or exercise failover."
Write-Host "Accounts 3 (aiberm, 1017 unsupported) and 2 (Paid Backup, nonparticipating) must remain excluded from Flash." -ForegroundColor Yellow

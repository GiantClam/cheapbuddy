#Requires -Version 7.0
[CmdletBinding()]
param(
    [string]$SubApiBaseUrl = $env:SUB2API_BASE_URL,
    [string]$AdminApiKey = $env:SUB2API_ADMIN_API_KEY,
    [string]$AliasFile = (Join-Path $PSScriptRoot "../relay/config/model-aliases.json")
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$canonicalModelId = "deepseek-v4.1-flash-1017"

function Write-Result {
    param(
        [string]$Message,
        [ValidateSet("Gray", "Green", "Yellow", "Red", "Cyan")]
        [string]$Color = "Gray"
    )
    Write-Host $Message -ForegroundColor $Color
}

function Invoke-SubApiRequest {
    param([string]$Endpoint)

    $request = @{
        Uri = "$($SubApiBaseUrl.TrimEnd('/'))$Endpoint"
        Method = "Get"
        Headers = @{ "x-api-key" = $AdminApiKey; Accept = "application/json" }
        TimeoutSec = 30
    }
    # Preserve case-distinct model aliases in JSON objects.
    $response = Invoke-WebRequest @request
    return ($response.Content | ConvertFrom-Json -AsHashtable)
}

function Convert-ToConfigObject {
    param([object]$Value)

    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
        try { return ($Value | ConvertFrom-Json -AsHashtable) }
        catch { return $null }
    }
    return $Value
}

function Get-ConfigValue {
    param([object]$Object, [string]$Key)

    if ($null -eq $Object) { return $null }
    if ($Object -is [System.Collections.IDictionary]) { return $Object[$Key] }
    $property = $Object.PSObject.Properties[$Key]
    if ($property) { return $property.Value }
    return $null
}

$relayAliases = Convert-ToConfigObject (Get-Content -LiteralPath $AliasFile -Raw -Encoding utf8)
if ($relayAliases -isnot [System.Collections.IDictionary] -or $relayAliases.Count -eq 0) {
    throw "The relay alias file must contain a nonempty JSON object."
}
$flashModelIds = [System.Collections.Generic.List[string]]::new()
$flashModelIds.Add($canonicalModelId)
foreach ($alias in $relayAliases.Keys) {
    if ($alias -notmatch "(?i)deepseek.*flash") { continue }
    if ([string]$relayAliases[$alias] -cne $canonicalModelId) {
        throw "Relay alias '$alias' must resolve directly to $canonicalModelId."
    }
    if (-not $flashModelIds.Contains($alias)) { $flashModelIds.Add($alias) }
}
foreach ($alias in @("deepseek-flash", "deepseek/deepseek-v4.1-flash", "deepseek-4.1-flash-1017")) {
    if (-not $flashModelIds.Contains($alias)) { throw "Missing compatibility alias: $alias" }
}

if ([string]::IsNullOrWhiteSpace($SubApiBaseUrl) -or [string]::IsNullOrWhiteSpace($AdminApiKey)) {
    throw "Set SUB2API_BASE_URL and SUB2API_ADMIN_API_KEY through protected environment variables."
}

Write-Result "DeepSeek configuration audit: GET requests only; no configuration changes." "Cyan"
Write-Result "Checking $($flashModelIds.Count - 1) relay aliases plus canonical $canonicalModelId."
$checks = @(
    @{ Id = 8; Name = "pptoken"; Priority = 1 },
    @{ Id = 12; Name = "EcoPhase"; Priority = 2 },
    @{ Id = 3; Name = "aiberm"; Priority = 3 }
)
$failures = [System.Collections.Generic.List[string]]::new()
$groupIds = [System.Collections.Generic.HashSet[int]]::new()

foreach ($check in $checks) {
    try {
        $response = Invoke-SubApiRequest "/api/v1/admin/accounts/$($check.Id)"
        $details = Get-ConfigValue $response "data"
        if ($null -eq $details -or (Get-ConfigValue $details "id") -ne $check.Id) {
            throw "Missing account details."
        }
        $priority = Get-ConfigValue $details "priority"
        Write-Result "$($check.Name) account $($check.Id): global priority $priority (expected $($check.Priority))."
        if ($priority -ne $check.Priority) { $failures.Add("Account $($check.Id): incorrect global priority.") }
        if ((Get-ConfigValue $details "status") -ne "active" -or (Get-ConfigValue $details "schedulable") -ne $true) {
            $failures.Add("Account $($check.Id): must be active and schedulable.")
        }

        # Binding priorities describe DB ordering, not the ordinary scheduler tier.
        foreach ($binding in @(Get-ConfigValue $details "account_groups")) {
            $groupId = Get-ConfigValue $binding "group_id"
            if ($null -eq $groupId) { continue }
            Write-Result "  Binding group $($groupId): priority $(Get-ConfigValue $binding 'priority') (information only)."
            [void]$groupIds.Add([int]$groupId)
        }
        foreach ($groupId in @(Get-ConfigValue $details "group_ids")) {
            if ($null -ne $groupId) { [void]$groupIds.Add([int]$groupId) }
        }

        $credentials = Convert-ToConfigObject (Get-ConfigValue $details "credentials")
        $mapping = Convert-ToConfigObject (Get-ConfigValue $credentials "model_mapping")
        if ($mapping -isnot [System.Collections.IDictionary]) {
            $failures.Add("Account $($check.Id): model_mapping is not readable.")
        } else {
            foreach ($modelId in $flashModelIds) {
                if ([string](Get-ConfigValue $mapping $modelId) -cne $canonicalModelId) {
                    $failures.Add("Account $($check.Id): $modelId must map to $canonicalModelId.")
                }
            }
        }

        if ($check.Id -eq 12) {
            $costMultiplier = Get-ConfigValue $details "rate_multiplier"
            if ($null -eq $costMultiplier -or [decimal]$costMultiplier -ne [decimal]0.8) {
                $failures.Add("EcoPhase account cost rate_multiplier must be 0.8; customer group pricing is separate.")
            }
            $extra = Convert-ToConfigObject (Get-ConfigValue $details "extra")
            if ((Get-ConfigValue $extra "upstream_billing_rate_sync_enabled") -eq $true) {
                $failures.Add("EcoPhase upstream_billing_rate_sync_enabled must remain false.")
            }
        }
    } catch {
        $failures.Add("Could not read or validate account $($check.Id); inspect it through the protected admin UI.")
    }
}

# Inspect existing group permissions without changing rates, allowlists or memberships.
foreach ($groupId in $groupIds) {
    try {
        $response = Invoke-SubApiRequest "/api/v1/admin/groups/$groupId"
        $group = Get-ConfigValue $response "data"
        $allowlist = Convert-ToConfigObject (Get-ConfigValue $group "model_allowlist")
        if ($null -eq $allowlist) { throw "Missing group allowlist." }
        $allowlistEnabled = Get-ConfigValue $allowlist "enabled"
        if ($allowlistEnabled -isnot [bool]) { throw "Unreadable group allowlist state." }
        if ($allowlistEnabled) {
            $allowedModels = @(Get-ConfigValue $allowlist "models")
            foreach ($modelId in $flashModelIds) {
                if ($allowedModels -cnotcontains $modelId) {
                    $failures.Add("Group $($groupId): enabled allowlist is missing $modelId.")
                }
            }
        }
        Write-Result "Group $($groupId): existing model allowlist inspected; retail pricing untouched."
    } catch {
        $failures.Add("Could not audit group $($groupId); verify its model permissions in the protected admin UI.")
    }
}

try {
    $response = Invoke-SubApiRequest "/api/v1/admin/accounts/2"
    $backup = Get-ConfigValue $response "data"
    if ($null -eq $backup -or (Get-ConfigValue $backup "id") -ne 2) { throw "Missing account 2." }
    $credentials = Convert-ToConfigObject (Get-ConfigValue $backup "credentials")
    $mapping = Convert-ToConfigObject (Get-ConfigValue $credentials "model_mapping")
    $extra = Convert-ToConfigObject (Get-ConfigValue $backup "extra")
    $passthrough = Get-ConfigValue $extra "openai_passthrough"
    if ($passthrough -isnot [bool]) { $passthrough = Get-ConfigValue $extra "openai_oauth_passthrough" }
    if ($mapping -isnot [System.Collections.IDictionary] -or $mapping.Count -eq 0 -or $passthrough -eq $true) {
        $failures.Add("Account 2 Paid Backup: unrestricted or passthrough access could add a Flash competitor.")
    } else {
        foreach ($pattern in $mapping.Keys) {
            $matchesFlash = @($flashModelIds | Where-Object {
                $_ -ceq $pattern -or ($pattern.EndsWith("*") -and $_.StartsWith($pattern.Substring(0, $pattern.Length - 1), [StringComparison]::Ordinal))
            })
            if ($matchesFlash.Count -gt 0 -or $pattern -match "(?i)deepseek.*flash") {
                $failures.Add("Account 2 Paid Backup: remove Flash capability '$pattern' without disturbing other models.")
            }
        }
    }
} catch {
    $failures.Add("Could not audit account 2 Paid Backup for competing Flash capability.")
}

Write-Result "File aliases do not prove deployment: check RELAY_MODEL_ALIASES_FILE and any RELAY_MODEL_ALIASES override." "Yellow"
Write-Result "2026-10-28 evidence: pptoken and EcoPhase canonical probes returned content; aiberm returned 503 and remains pending provider enablement." "Yellow"
if ($failures.Count -gt 0) {
    foreach ($failure in $failures) { Write-Result "FAIL: $failure" "Red" }
    exit 2
}
Write-Result "Configuration checks passed. Provider availability and actual chosen account still require request/Usage evidence." "Green"
Write-Result "Run verify-deepseek-routing.ps1 only when a minimal billed probe is intended."

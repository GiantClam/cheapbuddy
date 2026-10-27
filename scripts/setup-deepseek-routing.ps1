[CmdletBinding()]
param(
    [string]$SubApiBaseUrl = $env:SUB2API_BASE_URL,
    [string]$AdminApiKey = $env:SUB2API_ADMIN_API_KEY
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$publicModelId = "deepseek/deepseek-v4.1-flash"
$routingModelId = "deepseek-flash"
$legacyUpstreamModelId = "deepseek-v4.1-flash"
$upstreamModelId = "deepseek-4.1-flash-1017"
$unsupportedAccountModelIds = @("deepseek-v4.1-flash-1017")

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

    $headers = @{
        "x-api-key" = $AdminApiKey
        Accept = "application/json"
    }
    $request = @{
        Uri = "$($SubApiBaseUrl.TrimEnd('/'))$Endpoint"
        Method = "Get"
        Headers = $headers
        TimeoutSec = 30
    }
    Invoke-RestMethod @request
}

function Find-Account {
    param([string]$SearchKeyword)

    $encoded = [Uri]::EscapeDataString($SearchKeyword)
    $response = Invoke-SubApiRequest -Endpoint "/api/v1/admin/accounts?search=$encoded&page_size=100"
    $items = @($response.data.items)
    if ($items.Count -eq 0) {
        return $null
    }

    $exact = @($items | Where-Object { $_.name -eq $SearchKeyword })
    if ($exact.Count -eq 1) {
        return $exact[0]
    }
    if ($items.Count -eq 1) {
        return $items[0]
    }

    throw "搜索 '$SearchKeyword' 返回多个账户，请使用更精确的名称。"
}

function Convert-ToConfigObject {
    param([object]$Value)

    if ($null -eq $Value) {
        return $null
    }
    if ($Value -is [string]) {
        if ([string]::IsNullOrWhiteSpace($Value)) {
            return $null
        }
        try {
            return $Value | ConvertFrom-Json
        } catch {
            return $null
        }
    }
    return $Value
}

function Get-ConfigValue {
    param(
        [object]$Object,
        [string]$Key
    )

    if ($null -eq $Object) {
        return $null
    }
    if ($Object -is [System.Collections.IDictionary]) {
        return $Object[$Key]
    }
    $property = $Object.PSObject.Properties[$Key]
    if ($property) {
        return $property.Value
    }
    return $null
}

if ([string]::IsNullOrWhiteSpace($SubApiBaseUrl)) {
    Write-Error "缺少 SUB2API_BASE_URL，例如 https://admin.cheapbuddy.cc。"
    exit 1
}
if ([string]::IsNullOrWhiteSpace($AdminApiKey)) {
    Write-Error "缺少 SUB2API_ADMIN_API_KEY。不要把管理员 Key 写入仓库。"
    exit 1
}

Write-Result "DeepSeek 路由配置只读审计" "Cyan"
Write-Result "该脚本不会向账户发送 PUT/PATCH 请求。" "Yellow"

$checks = @(
    @{
        Name = "ecophase-ai.com"
        Search = "ecophase"
        Priority = 1
        RequireMapping = $true
        ForbiddenMappings = $unsupportedAccountModelIds
    },
    @{
        Name = "pptoken-deepseek"
        Search = "pptoken-deepseek"
        Priority = 2
        RequireMapping = $false
    }
)

$failures = [System.Collections.Generic.List[string]]::new()

foreach ($check in $checks) {
    Write-Result ""
    Write-Result "检查 $($check.Name)" "Cyan"

    try {
        $account = Find-Account -SearchKeyword $check.Search
    } catch {
        $failures.Add($_.Exception.Message)
        Write-Result "  失败：$($_.Exception.Message)" "Red"
        continue
    }

    if ($null -eq $account) {
        $message = "未找到账户 $($check.Name)"
        $failures.Add($message)
        Write-Result "  失败：$message" "Red"
        continue
    }

    $detailsResponse = Invoke-SubApiRequest -Endpoint "/api/v1/admin/accounts/$($account.id)"
    $details = $detailsResponse.data
    if ($null -eq $details) {
        $message = "账户 $($account.name) 的详情为空"
        $failures.Add($message)
        Write-Result "  失败：$message" "Red"
        continue
    }

    Write-Result "  ID: $($details.id)"
    Write-Result "  Name: $($details.name)"
    Write-Result "  Priority: $($details.priority)"
    Write-Result "  Status: $($details.status)"
    Write-Result "  Schedulable: $($details.schedulable)"

    if ([int]$details.priority -ne [int]$check.Priority) {
        $failures.Add("$($details.name) Priority 应为 $($check.Priority)")
    }
    if ([string]$details.status -notmatch "^(?i:active)$") {
        $failures.Add("$($details.name) 不是 Active")
    }
    if (-not [bool]$details.schedulable) {
        $failures.Add("$($details.name) 不可调度")
    }

    if ($check.RequireMapping) {
        $credentials = Convert-ToConfigObject -Value $details.credentials
        $mappingValue = Get-ConfigValue -Object $credentials -Key "model_mapping"
        $mapping = Convert-ToConfigObject -Value $mappingValue

        if ($null -eq $mapping) {
            $failures.Add("$($details.name) 无法读取 credentials.model_mapping")
            Write-Result "  无法读取 credentials.model_mapping。" "Red"
            Write-Result "  请在管理后台检查完整账户配置；脚本不会猜测更新 payload。" "Yellow"
            continue
        }

        $publicTarget = [string](Get-ConfigValue -Object $mapping -Key $publicModelId)
        $routingTarget = [string](Get-ConfigValue -Object $mapping -Key $routingModelId)

        Write-Result "  $publicModelId → $publicTarget"
        Write-Result "  $routingModelId → $routingTarget"

        if ($publicTarget -ne $legacyUpstreamModelId) {
            $failures.Add("$($details.name) 应保留 $publicModelId → $legacyUpstreamModelId")
        }
        if ($routingTarget -ne $upstreamModelId) {
            $failures.Add("$($details.name) 缺少 $routingModelId → $upstreamModelId")
        }
        foreach ($forbiddenModelId in @($check.ForbiddenMappings)) {
            if ($null -ne (Get-ConfigValue -Object $mapping -Key $forbiddenModelId)) {
                $failures.Add("$($details.name) 不应配置 $forbiddenModelId 的映射")
            }
        }
    }
}

Write-Result ""
Write-Result "仍需在管理后台确认 CheapBuddy OpenAI 白名单：" "Yellow"
Write-Result "  $publicModelId"
Write-Result "  $routingModelId"
Write-Result "账户 ecophase-ai.com 应映射：$routingModelId → $upstreamModelId" "Yellow"
Write-Result "账户 ecophase-ai.com 不应映射：$($unsupportedAccountModelIds -join ', ')" "Yellow"

if ($failures.Count -gt 0) {
    Write-Result ""
    Write-Result "审计失败：" "Red"
    foreach ($failure in $failures) {
        Write-Result "  - $failure" "Red"
    }
    Write-Result "请在管理后台编辑并保存完整账户配置，然后重新运行本脚本。" "Yellow"
    exit 2
}

Write-Result ""
Write-Result "账户优先级、状态和必需的 Model Mapping 均通过审计。" "Green"
Write-Result "下一步运行 scripts/verify-deepseek-routing.ps1 做真实请求验收。" "Cyan"

[CmdletBinding()]
param(
    [string]$ApiKey = $env:CHEAPBUDDY_API_KEY,
    [string]$BaseUrl = "https://api.cheapbuddy.cc"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$publicModelId = "deepseek/deepseek-v4.1-flash"

if ([string]::IsNullOrWhiteSpace($ApiKey)) {
    Write-Error "缺少用户 API Key。请设置 CHEAPBUDDY_API_KEY，或使用 -ApiKey 传入。"
    exit 1
}

$endpoint = "$($BaseUrl.TrimEnd('/'))/v1/chat/completions"
$headers = @{
    Authorization = "Bearer $ApiKey"
    "Content-Type" = "application/json"
}
$body = @{
    model = $publicModelId
    messages = @(
        @{
            role = "user"
            content = "Reply with OK"
        }
    )
    max_tokens = 1
    stream = $false
} | ConvertTo-Json -Depth 6 -Compress

Write-Host "DeepSeek 路由验收" -ForegroundColor Cyan
Write-Host "Endpoint: $endpoint"
Write-Host "Requested Model: $publicModelId"
Write-Host "max_tokens: 1"

try {
    $request = @{
        Uri = $endpoint
        Method = "Post"
        Headers = $headers
        Body = $body
        TimeoutSec = 60
    }
    $response = Invoke-RestMethod @request
} catch {
    $statusCode = $null
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
        $statusCode = [int]$_.Exception.Response.StatusCode
    }
    if ($statusCode) {
        Write-Error "请求失败，HTTP $statusCode：$($_.Exception.Message)"
    } else {
        Write-Error "请求失败：$($_.Exception.Message)"
    }
    exit 1
}

$responseModel = if ($response.model) { [string]$response.model } else { "<not returned>" }
$content = $null
if ($response.choices -and $response.choices.Count -gt 0) {
    $content = $response.choices[0].message.content
}

Write-Host "请求成功（2xx）" -ForegroundColor Green
Write-Host "Response Model: $responseModel"
if (-not [string]::IsNullOrWhiteSpace([string]$content)) {
    Write-Host "Response: $content"
}

Write-Host ""
Write-Host "请在管理后台 Usage 中核对：" -ForegroundColor Yellow
Write-Host "  Account: ecophase-ai.com"
Write-Host "  Requested Model: $publicModelId"
Write-Host "  Final Upstream Model: deepseek-v4.1-flash"
Write-Host "  用户 Cost 和账户成本均已记录"

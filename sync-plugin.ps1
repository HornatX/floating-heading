# sync-plugin.ps1
$sourceDir = Get-Location
$scriptName = $MyInvocation.MyCommand.Name
$sourceName = "小黄蜂 X 剧本杀"   # 请改成你的实际路径中的名称
$targetName = "通用简洁插件"

# 精确排除的文件名（完全匹配）
$excludeFiles = @(
    $scriptName,          # 排除脚本自身（冗余，因 .ps1 已被整体排除）
    "data.json"           # 排除 data.json
)

if ($sourceDir.Path -notlike "*$sourceName*") {
    Write-Host "错误：当前目录不在 '$sourceName' 下，无法自动定位目标目录。" -ForegroundColor Red
    Read-Host "`n按 Enter 键退出"
    exit 1
}

$targetDir = $sourceDir.Path -replace [regex]::Escape($sourceName), $targetName

# 检查目标目录是否存在，不存在则报错退出
if (-not (Test-Path $targetDir)) {
    Write-Host "错误：目标目录不存在，无法同步。" -ForegroundColor Red
    Write-Host "目标目录路径：$targetDir" -ForegroundColor Yellow
    Read-Host "`n按 Enter 键退出"
    exit 1
}

Write-Host "`n源目录: $sourceDir" -ForegroundColor Cyan
Write-Host "目标目录: $targetDir" -ForegroundColor Cyan
Write-Host "`n开始同步...`n"

# 统计
$copyCount = 0
$skipCount = 0
$warnCount = 0

Get-ChildItem $sourceDir -Recurse -File | Where-Object {
    # 排除精确匹配的文件名
    $_.Name -notin $excludeFiles -and
    # 排除包含“副本”的文件
    $_.Name -notlike "*副本*" -and
    # 排除所有 .ps1 文件
    $_.Extension -ne '.ps1'
} | ForEach-Object {
    $srcFile = $_.FullName
    $relPath = $srcFile.Substring($sourceDir.Path.Length + 1)
    $targetFile = Join-Path $targetDir $relPath

    $targetFileDir = Split-Path $targetFile -Parent
    if (-not (Test-Path $targetFileDir)) {
        New-Item -ItemType Directory -Path $targetFileDir -Force | Out-Null
    }

    if (Test-Path $targetFile) {
        $srcTime = (Get-Item $srcFile).LastWriteTime
        $dstTime = (Get-Item $targetFile).LastWriteTime

        if ($srcTime -gt $dstTime) {
            Write-Host "复制 (源更新): $relPath" -ForegroundColor Green
            Copy-Item $srcFile $targetFile -Force
            $copyCount++
        }
        elseif ($dstTime -gt $srcTime) {
            Write-Host "⚠️ 警告: 目标文件更新，操作可能反了: $relPath" -ForegroundColor Red
            $warnCount++
        }
        else {
            Write-Host "跳过 (相同时间): $relPath" -ForegroundColor Gray
            $skipCount++
        }
    }
    else {
        Write-Host "复制 (新文件): $relPath" -ForegroundColor Green
        Copy-Item $srcFile $targetFile
        $copyCount++
    }
}

Write-Host "`n同步完成！" -ForegroundColor Green
Write-Host "统计：复制 $copyCount 个，跳过 $skipCount 个，警告 $warnCount 个" -ForegroundColor Cyan

Read-Host "`n按 Enter 键退出"
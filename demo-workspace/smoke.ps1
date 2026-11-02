<#
.SYNOPSIS
  A quick manual check of the three services over HTTP. Start them first: .\services.ps1 start
  Edit the calls to try what a ticket added. Prints the status code and body of each call.
#>
$inv = "http://localhost:8081"; $ord = "http://localhost:8082"; $ntf = "http://localhost:8083"

function Call($method, $url, $body) {
  try {
    $args_ = @{ Method = $method; Uri = $url; UseBasicParsing = $true }
    if ($body) { $args_.ContentType = "application/json"; $args_.Body = ($body | ConvertTo-Json -Compress) }
    $r = Invoke-WebRequest @args_
    Write-Host ("{0} {1} -> {2} {3}" -f $method, $url, [int]$r.StatusCode, $r.Content)
    if ($r.Content) { return ($r.Content | ConvertFrom-Json) }
  } catch {
    $code = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { "no answer" }
    Write-Host ("{0} {1} -> {2}  {3}" -f $method, $url, $code, $_.ErrorDetails.Message) -ForegroundColor Yellow
  }
}

Write-Host "== inventory"
Call POST "$inv/products" @{ sku = "SKU-1"; name = "Brick 2x4"; available = 10 } | Out-Null
Call GET  "$inv/products/SKU-1" | Out-Null
Call GET  "$inv/products/NOPE" | Out-Null

Write-Host "== orders (reserve and release need inventory-service reserve/release, added by PROJ-103; or start order-service with -Stub)"
$o = Call POST "$ord/orders" @{ sku = "SKU-1"; quantity = 2 }
if ($o) {
  Call GET  "$ord/orders/$($o.id)" | Out-Null
  Call POST "$ord/orders/$($o.id)/cancel" | Out-Null
  Call POST "$ord/orders/$($o.id)/cancel" | Out-Null   # second cancel should be 409
}
Call POST "$ord/orders" @{ sku = "SKU-1"; quantity = 0 } | Out-Null   # 400

Write-Host "== notifications"
Call POST "$ntf/notifications" @{ recipient = "a@example.com"; subject = "Hello"; body = "Hi" } | Out-Null
Call GET  "$ntf/notifications?recipient=a@example.com" | Out-Null
Call POST "$ntf/notifications" @{ recipient = "nobody"; subject = "Hello" } | Out-Null   # 400

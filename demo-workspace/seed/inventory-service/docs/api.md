# Inventory service API

Service class: `com.lego.inventory.InventoryService`. Errors are `ApiException` with an HTTP status; the HTTP layer returns that status with body `{"error": "..."}`.

## HTTP routes (port 8081)
| Operation | Route |
|---|---|
| addProduct | `POST /products` body `{sku, name, available}` |
| get | `GET /products/{sku}` |
| addStock | `POST /products/{sku}/stock` body `{quantity}` |
| list | `GET /products` |

## addProduct(sku, name, available)
- 200: the product
- 400: blank sku or name, negative available
- 409: sku already exists

## get(sku)
- 200: `{sku, name, available}`
- 404: unknown sku

## addStock(sku, quantity)
- 200: the updated product
- 400: quantity is not positive
- 404: unknown sku

## list()
All products in insertion order.

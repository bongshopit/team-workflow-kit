# Contract: order-service uses inventory-service

`com.lego.order.InventoryClient` is the only place order-service talks to inventory-service.
It mirrors `inventory-service/docs/api.md`. A change here needs a matching change there.

| Client method | inventory-service operation |
|---|---|
| `available(sku)` | `get(sku).available` |

Over HTTP (`InventoryApi`, base URL `quarkus.rest-client.inventory.url`):

| Client method | Route |
|---|---|
| `available(sku)` | `GET /products/{sku}`, reads `available` from the answer |

An error from inventory-service keeps its status (404 unknown sku). An unreachable inventory-service is 503.

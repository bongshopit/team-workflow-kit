# order-service
Orders for SKUs. Quarkus 3 REST service, Java 17, in-memory. HTTP on port 8082. Checks stock through `InventoryClient`.
Depends on: inventory-service (contract: `docs/contracts/inventory.md`).

- Run the tests: `mvn -q test` (unit tests and `@QuarkusTest` HTTP tests; inventory is a stub in tests)
- Run it with a real inventory-service on 8081: `mvn quarkus:dev`
- Run it alone: `mvn quarkus:dev -Dinventory.mode=stub` (every SKU reports 100 in stock)
- Code layout: `OrderService` holds the rules, `OrderResource` and `OrderView` are the HTTP layer, `InventoryClient` is the only way to inventory-service
  (`RestInventoryClient` over HTTP, `InMemoryInventoryClient` for the stub).
  A new operation or field needs a service change, a resource/`OrderView` change, a test and a line in `docs/api.md`.

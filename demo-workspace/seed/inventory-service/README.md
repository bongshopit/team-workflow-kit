# inventory-service
Stock levels per SKU. Quarkus 3 REST service, Java 17, in-memory. HTTP on port 8081. Contract for other services: `docs/api.md`.

- Run the tests: `mvn -q test` (unit tests and `@QuarkusTest` HTTP tests)
- Run it: `mvn quarkus:dev`, then `curl http://localhost:8081/products`
- Code layout: `InventoryService` holds the rules, `InventoryResource` is the HTTP layer, `ApiException` carries the status.
  A new operation needs a service method, a resource method, a test and a line in `docs/api.md`.

# notification-service
Sends and records notifications. Quarkus 3 REST service, Java 17, in-memory. HTTP on port 8083. Contract: `docs/api.md`.

- Run the tests: `mvn -q test`
- Run it: `mvn quarkus:dev`, then `curl "http://localhost:8083/notifications?recipient=a@example.com"`
- A new operation needs a service method, a resource method, a test and a line in `docs/api.md`.

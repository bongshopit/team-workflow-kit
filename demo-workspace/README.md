# Demo workspace

Three small Quarkus 3 REST services (Java 17, Maven, in-memory) and six test stories.

    repos/inventory-service      stock per SKU, HTTP on 8081
    repos/order-service          orders, checks stock through InventoryClient (HTTP to inventory-service), HTTP on 8082
    repos/notification-service   sends and records notifications, HTTP on 8083
    services.ps1                 start, stop and check the three services in the background
    smoke.ps1                    quick manual HTTP calls against the running services
    archive/                     patches and change folders from earlier PROJ-103 runs on the old non-Quarkus baseline
    stories/                     PROJ-101 ... PROJ-105 in the shape wf-plan produces (see stories/README.md)
    setup.mjs                    git init + baseline commit per repo; --reset returns every repo to it

## Setup
    node setup.mjs
    cd repos\order-service
    mvn -q test              # unit tests and HTTP tests pass before you start. The first run downloads Quarkus (hundreds of MB).
Set `TEAM_TEST_CMD=mvn -q test` for the shell Copilot runs in. Do this per repo.

## Run a story
Install the kit first (team.mjs, skills, agents, prompt). Open the repo in VS Code and start with `/run <story file>`.
Start with PROJ-101. Multi-repo stories (PROJ-103, PROJ-104) are run once per repo, upstream repo first.

## Reset between runs
    node setup.mjs --reset

## Verification
The baseline tests were run here with a stand-in for JUnit (Maven Central is not reachable from my sandbox): 6, 6 and 4 tests pass. I have not run `mvn test` itself, so the first `mvn -q test` on your machine is the real check. If the pom needs a different Java version, change `maven.compiler.release`.

## Try the services by hand (after a ticket is implemented)
    cd demo-workspace
    .\services.ps1 start            # add -Stub to run order-service without inventory-service
    .\services.ps1 status
    .\smoke.ps1                     # or call the routes yourself, see docs\api.md in each repo
    .\services.ps1 stop
Code changes are picked up live while a service runs (Quarkus dev mode). Tests: `mvn -q test` in each repo.
Before PROJ-103, inventory-service has no reserve or release route, so creating an order fails against it. Use `-Stub` for PROJ-101 and PROJ-105, and the real pair after PROJ-103.

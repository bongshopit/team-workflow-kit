# Demo workspace

Three small Quarkus 3 REST services (Java 17, Maven, in-memory) and six test stories.

    repos/inventory-service      stock per SKU, HTTP on 8081
    repos/order-service          orders, checks stock through InventoryClient (HTTP to inventory-service), HTTP on 8082
    repos/notification-service   sends and records notifications, HTTP on 8083
    services.ps1                 start, stop and check the three services in the background
    smoke.ps1                    quick manual HTTP calls against the running services
    seed/                        tracked copy of the three repos' baseline sources. setup.mjs copies it to repos/ on a fresh clone
    archive/                     patches and change folders from earlier PROJ-103 runs on the old non-Quarkus baseline
    stories/                     PROJ-101 ... PROJ-105 in the shape wf-plan produces (see stories/README.md)
    setup.mjs                    git init + baseline commit per repo; --reset returns every repo to it

## Setup
    node setup.mjs            # on a fresh clone this first copies seed/ to repos/, then makes the baseline git repos
    cd repos\order-service
    mvn -q test              # unit tests and HTTP tests pass before you start. The first run downloads Quarkus (hundreds of MB).
Set `TEAM_TEST_CMD=mvn -q test` for the shell Copilot runs in. Do this per repo.

## Run a story
Install the kit first (team.mjs, skills, agents, prompt). Open the repo in VS Code and start with `/run <story file>`.
Start with PROJ-101. Multi-repo stories (PROJ-103, PROJ-104) are run once per repo, upstream repo first.

## Reset between runs
    node setup.mjs --reset

## Verification
Not compiled or run by me: Maven Central is not reachable from my sandbox. The first `mvn -q test` in each repo on your machine is the real check (it downloads Quarkus). Baseline unit tests: 6 (order), 6 (inventory... see the test folders), 4 (notification), plus one HTTP test class per repo.

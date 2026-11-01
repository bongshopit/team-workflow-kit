# Demo workspace

Three small Java 17 services (Maven, JUnit 5, in-memory, no framework) and six test stories.

    repos/inventory-service      stock per SKU
    repos/order-service          orders, checks stock through InventoryClient
    repos/notification-service   sends and records notifications
    stories/                     PROJ-101 ... PROJ-105 in the shape wf-plan produces (see stories/README.md)
    setup.mjs                    git init + baseline commit per repo; --reset returns every repo to it

## Setup
    node setup.mjs
    cd repos\order-service
    mvn -q test              # 6 tests pass before you start
Set `TEAM_TEST_CMD=mvn -q test` for the shell Copilot runs in. Do this per repo.

## Run a story
Install the kit first (team.mjs, skills, agents, prompt). Open the repo in VS Code and start with `/run <story file>`.
Start with PROJ-101. Multi-repo stories (PROJ-103, PROJ-104) are run once per repo, upstream repo first.

## Reset between runs
    node setup.mjs --reset

## Verification
The baseline tests were run here with a stand-in for JUnit (Maven Central is not reachable from my sandbox): 6, 6 and 4 tests pass. I have not run `mvn test` itself, so the first `mvn -q test` on your machine is the real check. If the pom needs a different Java version, change `maven.compiler.release`.

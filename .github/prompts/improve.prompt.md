---
description: Apply one proposal from a ticket's audit to the kit, on a local branch, with tests
agent: improve
---
Apply the top proposal from the audit of: ${input:ticket:Ticket id, e.g. PROJ-101}

Load the `team-improve` skill and follow it exactly. One change only, on `local/<git user name>`, never on main.

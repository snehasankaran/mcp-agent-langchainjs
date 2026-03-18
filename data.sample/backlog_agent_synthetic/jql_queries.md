# JQL Queries (Sample)

## Backlog candidates
project = "DEMO" AND status in ("To Do","Backlog") ORDER BY priority DESC, created ASC

## In progress work
project = "DEMO" AND status = "In Progress" ORDER BY updated DESC

## Blockers
project = "DEMO" AND (labels = blocked OR status = "Blocked") ORDER BY updated DESC

## Done in last ~2 weeks (approx)
project = "DEMO" AND status = "Done" AND updated >= -14d ORDER BY updated DESC

# PROJ-103 Reserve stock when an order is placed

- Jira: PROJ-103
- Feature: PRD-47 Prevent overselling
- Story version: v1
- Repos: inventory-service, order-service
- Depends on: order-service waits for inventory-service (review or done)
- Priority: High

## Description
Today an order only checks that stock exists. Two orders can both pass the check and oversell. Orders must reserve stock when created and give it back when cancelled.

## Repo: inventory-service

### AC1 Reserve stock
- S1.1 Given a product with 10 available, when 4 are reserved, then 6 are available.
- S1.2 Given a product with 3 available, when 5 are reserved, then the request fails with 409 and available stays 3.
- S1.3 Given an unknown sku, when stock is reserved, then the request fails with 404.
- S1.4 Given a quantity of 0 or less, when stock is reserved, then the request fails with 400.

### AC2 Release stock
- S2.1 Given a product with 6 available, when 4 are released, then 10 are available.
- S2.2 Given an unknown sku, when stock is released, then the request fails with 404.

## Repo: order-service

### AC3 Creating an order reserves stock
- S3.1 Given enough stock, when an order for 2 is created, then 2 are reserved in inventory.
- S3.2 Given not enough stock, when an order is created, then it fails with 409 and no order is stored.

### AC4 Cancelling an order releases the stock once
- S4.1 Given an open order for 2, when it is cancelled, then 2 are released in inventory.
- S4.2 Given a cancelled order, when it is cancelled again, then it fails with 409 and nothing more is released.

## Contract note
`InventoryClient` in order-service and `docs/api.md` in inventory-service must describe the same operations. Update both.

## Out of scope
Reservation expiry. Partial reservations.

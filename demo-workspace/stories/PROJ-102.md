# PROJ-102 Low-stock report

- Jira: PROJ-102
- Feature: PRD-52 Stock visibility
- Story version: v1
- Repos: inventory-service
- Depends on: none
- Priority: Low

## Description
Warehouse staff want a list of products that are running low, so they can reorder.

## AC1 List products at or below a threshold
- S1.1 Given products with 2, 5 and 20 available, when the report runs with threshold 5, then the products with 2 and 5 are returned.
- S1.2 Given products with the same available count, when the report runs, then they are ordered by sku.
- S1.3 Given no product at or below the threshold, when the report runs, then an empty list is returned.

## AC2 Products are ordered by how low they are
- S2.1 Given products with 5, 2 and 3 available, when the report runs with threshold 10, then the order is 2, 3, 5.

## AC3 The threshold is validated
- S3.1 Given a negative threshold, when the report runs, then the request fails with 400.
- S3.2 Given a threshold of 0, when the report runs, then only products with 0 available are returned.

## Out of scope
Paging. Notifications about low stock.

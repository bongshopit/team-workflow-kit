# PROJ-105 Add an order note

- Jira: PROJ-105
- Feature: PRD-51 Order handling notes
- Story version: v1
- Repos: order-service
- Depends on: none
- Priority: Low

## Description
Customers can add a short note when they create an order, for example delivery instructions.

## AC1 Create an order with a note
- S1.1 Given a valid sku and quantity, when an order is created with a note, then the note is stored on the order.
- S1.2 Given no note, when an order is created, then the order has no note.

## AC2 Notes are limited to 200 characters
- S2.1 Given a note of 200 characters, when an order is created, then it succeeds.
- S2.2 Given a note of 201 characters, when an order is created, then it fails with 400 and no order is stored.

## Out of scope
Editing a note after creation.

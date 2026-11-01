# PROJ-104 Email the customer when an order ships

- Jira: PROJ-104
- Feature: PRD-49 Order updates
- Story version: v1
- Repos: order-service, notification-service
- Depends on: order-service waits for notification-service (review or done)
- Priority: Medium

## Description
Customers should get an email when their order ships.

## Repo: notification-service

### AC1 Send a shipped email
- S1.1 Given a valid customer email and an order id, when a shipped notification is sent, then it is stored with the subject "Your order has shipped".
- S1.2 Given an invalid email address, when a shipped notification is sent, then the request fails with 400.

## Repo: order-service

### AC2 Shipping an order notifies the customer
- S2.1 Given an open order with a customer email, when the order is marked as shipped, then a shipped notification is sent to that email.
- S2.2 Given a cancelled order, when it is marked as shipped, then it fails with 409 and no notification is sent.
- S2.3 Given an order that is cancelled after shipping, when the customer is notified, then the notification says the order is cancelled.

## Out of scope
SMS. Retrying failed emails.

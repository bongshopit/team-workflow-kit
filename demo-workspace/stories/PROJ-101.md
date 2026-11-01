# PROJ-101 Add cancellation reason to orders

- Jira: PROJ-101
- Feature: PRD-45 Order cancellation insights
- Story version: v1
- Repos: order-service
- Depends on: none
- Priority: Medium

## Description
Support needs to know why customers cancel orders. A cancel request may carry a reason code. The reason is shown when the order is read.
Existing callers that cancel without a reason must keep working.

Valid reason codes: CUSTOMER_REQUEST, OUT_OF_STOCK, PAYMENT_FAILED, OTHER.

## AC1 Cancel accepts an optional reason code
- S1.1 Given an open order, when it is cancelled with a valid reason code, then the order is cancelled and the reason is stored.
- S1.2 Given an open order, when it is cancelled without a reason code, then the order is cancelled and the reason is empty.

## AC2 The reason is returned with the order
- S2.1 Given a cancelled order with a reason, when the order is read, then the reason code is returned.
- S2.2 Given an open order, when the order is read, then the reason code is empty.

## AC3 Invalid cancellations are rejected
- S3.1 Given an open order, when it is cancelled with an unknown reason code, then the request fails with 400 and the order stays open.
- S3.2 Given a cancelled order, when it is cancelled again with a reason, then the request fails with 409 and the stored reason does not change.

## Out of scope
Reporting on reasons. Changing the reason after cancellation.

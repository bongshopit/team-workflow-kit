package com.lego.order;

/** What the HTTP layer returns for an order. A new field on Order is not visible over HTTP until it is added here. */
public record OrderView(String id, String sku, int quantity, String status) {
    static OrderView from(Order order) {
        return new OrderView(order.id(), order.sku(), order.quantity(), order.status());
    }
}

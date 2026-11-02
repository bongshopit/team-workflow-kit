package com.lego.order;

import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import java.util.HashMap;
import java.util.Map;

@Singleton
public class OrderService {
    private final InventoryClient inventory;
    private final Map<String, Order> orders = new HashMap<>();
    private int counter = 0;

    @Inject
    public OrderService(InventoryClient inventory) {
        this.inventory = inventory;
    }

    public Order create(String sku, int quantity) {
        if (sku == null || sku.isBlank()) throw new ApiException(400, "sku is required");
        if (quantity <= 0) throw new ApiException(400, "quantity must be positive");
        if (inventory.available(sku) < quantity) throw new ApiException(409, "insufficient stock for " + sku);
        Order order = new Order("ORD-" + (++counter), sku, quantity);
        orders.put(order.id(), order);
        return order;
    }

    public Order get(String id) {
        Order order = orders.get(id);
        if (order == null) throw new ApiException(404, "order not found: " + id);
        return order;
    }

    public Order cancel(String id) {
        Order order = get(id);
        if ("cancelled".equals(order.status())) throw new ApiException(409, "order already cancelled");
        order.markCancelled();
        return order;
    }
}

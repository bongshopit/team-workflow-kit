package com.lego.order;

/** What order-service needs from inventory-service. See docs/contracts/inventory.md. */
public interface InventoryClient {
    int available(String sku);
}

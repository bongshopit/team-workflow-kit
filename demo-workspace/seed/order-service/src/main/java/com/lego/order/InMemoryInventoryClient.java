package com.lego.order;

/** Stand-in for inventory-service: every SKU has 100 in stock. For trying order-service alone (inventory.mode=stub). */
public class InMemoryInventoryClient implements InventoryClient {
    @Override
    public int available(String sku) {
        return 100;
    }
}

package com.lego.order;

public class Order {
    private final String id;
    private final String sku;
    private final int quantity;
    private String status = "open";

    public Order(String id, String sku, int quantity) {
        this.id = id;
        this.sku = sku;
        this.quantity = quantity;
    }

    public String id() { return id; }
    public String sku() { return sku; }
    public int quantity() { return quantity; }
    public String status() { return status; }

    void markCancelled() {
        this.status = "cancelled";
    }
}

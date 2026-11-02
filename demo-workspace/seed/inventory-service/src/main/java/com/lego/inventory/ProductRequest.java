package com.lego.inventory;

/** Body of POST /products. */
public record ProductRequest(String sku, String name, int available) {
}

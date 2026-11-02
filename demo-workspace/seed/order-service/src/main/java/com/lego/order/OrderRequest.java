package com.lego.order;

/** Body of POST /orders. */
public record OrderRequest(String sku, int quantity) {
}

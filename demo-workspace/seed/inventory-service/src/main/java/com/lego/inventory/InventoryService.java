package com.lego.inventory;

import jakarta.inject.Singleton;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Singleton
public class InventoryService {
    private final Map<String, Product> products = new LinkedHashMap<>();

    public Product addProduct(String sku, String name, int available) {
        if (sku == null || sku.isBlank()) throw new ApiException(400, "sku is required");
        if (name == null || name.isBlank()) throw new ApiException(400, "name is required");
        if (available < 0) throw new ApiException(400, "available must not be negative");
        if (products.containsKey(sku)) throw new ApiException(409, "product already exists: " + sku);
        Product product = new Product(sku, name, available);
        products.put(sku, product);
        return product;
    }

    public Product get(String sku) {
        Product product = products.get(sku);
        if (product == null) throw new ApiException(404, "product not found: " + sku);
        return product;
    }

    public Product addStock(String sku, int quantity) {
        if (quantity <= 0) throw new ApiException(400, "quantity must be positive");
        Product current = get(sku);
        Product updated = new Product(sku, current.name(), current.available() + quantity);
        products.put(sku, updated);
        return updated;
    }

    public List<Product> list() {
        return new ArrayList<>(products.values());
    }
}

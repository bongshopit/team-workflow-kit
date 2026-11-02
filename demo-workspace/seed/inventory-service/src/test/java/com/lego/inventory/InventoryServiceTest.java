package com.lego.inventory;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class InventoryServiceTest {

    @Test
    void addProductAndGetIt() {
        InventoryService service = new InventoryService();
        service.addProduct("SKU-1", "Brick 2x4", 10);
        assertEquals(10, service.get("SKU-1").available());
    }

    @Test
    void duplicateProductIsConflict() {
        InventoryService service = new InventoryService();
        service.addProduct("SKU-1", "Brick 2x4", 10);
        ApiException e = assertThrows(ApiException.class, () -> service.addProduct("SKU-1", "Other", 1));
        assertEquals(409, e.status());
    }

    @Test
    void unknownProductIsNotFound() {
        InventoryService service = new InventoryService();
        ApiException e = assertThrows(ApiException.class, () -> service.get("nope"));
        assertEquals(404, e.status());
    }

    @Test
    void addStockIncreasesAvailable() {
        InventoryService service = new InventoryService();
        service.addProduct("SKU-1", "Brick 2x4", 10);
        assertEquals(15, service.addStock("SKU-1", 5).available());
    }

    @Test
    void addStockRejectsNonPositiveQuantity() {
        InventoryService service = new InventoryService();
        service.addProduct("SKU-1", "Brick 2x4", 10);
        ApiException e = assertThrows(ApiException.class, () -> service.addStock("SKU-1", 0));
        assertEquals(400, e.status());
    }

    @Test
    void listReturnsProductsInInsertionOrder() {
        InventoryService service = new InventoryService();
        service.addProduct("B", "Beta", 1);
        service.addProduct("A", "Alpha", 2);
        assertEquals("B", service.list().get(0).sku());
    }
}

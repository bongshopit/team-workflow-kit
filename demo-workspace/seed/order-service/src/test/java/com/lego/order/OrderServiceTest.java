package com.lego.order;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class OrderServiceTest {
    private final InventoryClient plentyOfStock = sku -> 100;

    @Test
    void createAndGetAnOrder() {
        OrderService service = new OrderService(plentyOfStock);
        Order order = service.create("SKU-1", 2);
        assertEquals("open", service.get(order.id()).status());
    }

    @Test
    void createFailsWhenStockIsInsufficient() {
        OrderService service = new OrderService(sku -> 1);
        ApiException e = assertThrows(ApiException.class, () -> service.create("SKU-1", 2));
        assertEquals(409, e.status());
    }

    @Test
    void createRejectsNonPositiveQuantity() {
        OrderService service = new OrderService(plentyOfStock);
        ApiException e = assertThrows(ApiException.class, () -> service.create("SKU-1", 0));
        assertEquals(400, e.status());
    }

    @Test
    void cancelAnOpenOrder() {
        OrderService service = new OrderService(plentyOfStock);
        Order order = service.create("SKU-1", 1);
        assertEquals("cancelled", service.cancel(order.id()).status());
    }

    @Test
    void cancellingTwiceIsConflict() {
        OrderService service = new OrderService(plentyOfStock);
        Order order = service.create("SKU-1", 1);
        service.cancel(order.id());
        ApiException e = assertThrows(ApiException.class, () -> service.cancel(order.id()));
        assertEquals(409, e.status());
    }

    @Test
    void unknownOrderIsNotFound() {
        OrderService service = new OrderService(plentyOfStock);
        ApiException e = assertThrows(ApiException.class, () -> service.get("nope"));
        assertEquals(404, e.status());
    }
}

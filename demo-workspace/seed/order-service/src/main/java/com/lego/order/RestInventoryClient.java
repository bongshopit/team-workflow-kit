package com.lego.order;

import jakarta.ws.rs.ProcessingException;
import jakarta.ws.rs.WebApplicationException;

/** InventoryClient that calls inventory-service over HTTP. Errors keep the upstream status. */
public class RestInventoryClient implements InventoryClient {
    private final InventoryApi api;

    public RestInventoryClient(InventoryApi api) {
        this.api = api;
    }

    @Override
    public int available(String sku) {
        try {
            return api.get(sku).available();
        } catch (WebApplicationException e) {
            int status = e.getResponse().getStatus();
            throw new ApiException(status, "inventory-service answered " + status);
        } catch (ProcessingException e) {
            throw new ApiException(503, "inventory-service is not reachable");
        }
    }
}

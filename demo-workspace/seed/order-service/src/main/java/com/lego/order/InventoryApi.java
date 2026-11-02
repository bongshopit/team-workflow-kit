package com.lego.order;

import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import org.eclipse.microprofile.rest.client.inject.RegisterRestClient;

/** The HTTP calls to inventory-service. Mirrors inventory-service/docs/api.md. Used only by RestInventoryClient. */
@RegisterRestClient(configKey = "inventory")
@Path("/products")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public interface InventoryApi {

    record Stock(String sku, String name, int available) {
    }

    @GET
    @Path("/{sku}")
    Stock get(@PathParam("sku") String sku);
}

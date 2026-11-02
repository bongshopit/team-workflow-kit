package com.lego.inventory;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/** HTTP layer. One method per service operation. Keep docs/api.md in step with it. */
@Path("/products")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class InventoryResource {
    private final InventoryService service;

    @Inject
    public InventoryResource(InventoryService service) {
        this.service = service;
    }

    @POST
    public Product add(ProductRequest request) {
        if (request == null) throw new ApiException(400, "body is required");
        return service.addProduct(request.sku(), request.name(), request.available());
    }

    @GET
    @Path("/{sku}")
    public Product get(@PathParam("sku") String sku) {
        return service.get(sku);
    }

    @POST
    @Path("/{sku}/stock")
    public Product addStock(@PathParam("sku") String sku, QuantityRequest request) {
        if (request == null) throw new ApiException(400, "body is required");
        return service.addStock(sku, request.quantity());
    }

    @GET
    public List<Product> list() {
        return service.list();
    }
}

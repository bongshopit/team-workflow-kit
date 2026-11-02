package com.lego.order;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.core.MediaType;

/** HTTP layer. One method per service operation. Keep docs/api.md in step with it. */
@Path("/orders")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class OrderResource {
    private final OrderService service;

    @Inject
    public OrderResource(OrderService service) {
        this.service = service;
    }

    @POST
    public OrderView create(OrderRequest request) {
        if (request == null) throw new ApiException(400, "body is required");
        return OrderView.from(service.create(request.sku(), request.quantity()));
    }

    @GET
    @Path("/{id}")
    public OrderView get(@PathParam("id") String id) {
        return OrderView.from(service.get(id));
    }

    @POST
    @Path("/{id}/cancel")
    public OrderView cancel(@PathParam("id") String id) {
        return OrderView.from(service.cancel(id));
    }
}

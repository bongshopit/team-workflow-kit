package com.lego.notification;

import jakarta.inject.Inject;
import jakarta.ws.rs.Consumes;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
import jakarta.ws.rs.QueryParam;
import jakarta.ws.rs.core.MediaType;
import java.util.List;

/** HTTP layer. One method per service operation. Keep docs/api.md in step with it. */
@Path("/notifications")
@Produces(MediaType.APPLICATION_JSON)
@Consumes(MediaType.APPLICATION_JSON)
public class NotificationResource {
    private final NotificationService service;

    @Inject
    public NotificationResource(NotificationService service) {
        this.service = service;
    }

    @POST
    public Notification send(NotificationRequest request) {
        if (request == null) throw new ApiException(400, "body is required");
        return service.send(request.recipient(), request.subject(), request.body());
    }

    @GET
    public List<Notification> listFor(@QueryParam("recipient") String recipient) {
        return service.listFor(recipient);
    }
}

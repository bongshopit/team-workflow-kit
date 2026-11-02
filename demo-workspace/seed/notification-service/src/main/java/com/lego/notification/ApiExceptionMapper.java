package com.lego.notification;

import jakarta.ws.rs.core.MediaType;
import jakarta.ws.rs.core.Response;
import jakarta.ws.rs.ext.ExceptionMapper;
import jakarta.ws.rs.ext.Provider;
import java.util.Map;

/** Turns an ApiException into an HTTP response with the same status. */
@Provider
public class ApiExceptionMapper implements ExceptionMapper<ApiException> {
    @Override
    public Response toResponse(ApiException e) {
        return Response.status(e.status())
                .type(MediaType.APPLICATION_JSON)
                .entity(Map.of("error", String.valueOf(e.getMessage())))
                .build();
    }
}

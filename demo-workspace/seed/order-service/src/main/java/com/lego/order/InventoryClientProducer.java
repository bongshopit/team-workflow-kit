package com.lego.order;

import jakarta.enterprise.context.ApplicationScoped;
import jakarta.enterprise.inject.Produces;
import jakarta.inject.Inject;
import jakarta.inject.Singleton;
import org.eclipse.microprofile.config.inject.ConfigProperty;
import org.eclipse.microprofile.rest.client.inject.RestClient;

/** Picks the InventoryClient from the inventory.mode setting (rest or stub). */
@ApplicationScoped
public class InventoryClientProducer {
    @ConfigProperty(name = "inventory.mode", defaultValue = "rest")
    String mode;

    @Inject
    @RestClient
    InventoryApi api;

    @Produces
    @Singleton
    InventoryClient inventoryClient() {
        return "stub".equals(mode) ? new InMemoryInventoryClient() : new RestInventoryClient(api);
    }
}

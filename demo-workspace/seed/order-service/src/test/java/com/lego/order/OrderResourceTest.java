package com.lego.order;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.is;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

/** Runs with inventory.mode=stub, so no inventory-service is needed. */
@QuarkusTest
class OrderResourceTest {

    @Test
    void createThenCancelOverHttp() {
        String id = given().contentType("application/json")
                .body("{\"sku\":\"SKU-1\",\"quantity\":2}")
                .when().post("/orders")
                .then().statusCode(200).body("status", is("open"))
                .extract().path("id");
        given().when().post("/orders/" + id + "/cancel")
                .then().statusCode(200).body("status", is("cancelled"));
        given().when().post("/orders/" + id + "/cancel")
                .then().statusCode(409);
    }

    @Test
    void unknownOrderIs404() {
        given().when().get("/orders/NOPE")
                .then().statusCode(404);
    }
}

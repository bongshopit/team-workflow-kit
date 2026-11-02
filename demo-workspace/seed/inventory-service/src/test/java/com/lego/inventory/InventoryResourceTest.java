package com.lego.inventory;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.is;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

@QuarkusTest
class InventoryResourceTest {

    @Test
    void addProductThenReadItOverHttp() {
        given().contentType("application/json")
                .body("{\"sku\":\"HTTP-1\",\"name\":\"Brick 2x4\",\"available\":10}")
                .when().post("/products")
                .then().statusCode(200).body("available", is(10));
        given().when().get("/products/HTTP-1")
                .then().statusCode(200).body("name", is("Brick 2x4"));
    }

    @Test
    void unknownProductIs404() {
        given().when().get("/products/NOPE")
                .then().statusCode(404);
    }
}

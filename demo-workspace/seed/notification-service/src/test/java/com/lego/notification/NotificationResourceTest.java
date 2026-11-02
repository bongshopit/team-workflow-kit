package com.lego.notification;

import static io.restassured.RestAssured.given;
import static org.hamcrest.Matchers.is;

import io.quarkus.test.junit.QuarkusTest;
import org.junit.jupiter.api.Test;

@QuarkusTest
class NotificationResourceTest {

    @Test
    void sendAndListOverHttp() {
        given().contentType("application/json")
                .body("{\"recipient\":\"http@example.com\",\"subject\":\"Hello\",\"body\":\"Hi\"}")
                .when().post("/notifications")
                .then().statusCode(200).body("subject", is("Hello"));
        given().queryParam("recipient", "http@example.com")
                .when().get("/notifications")
                .then().statusCode(200).body("size()", is(1));
    }

    @Test
    void badRecipientIs400() {
        given().contentType("application/json")
                .body("{\"recipient\":\"nobody\",\"subject\":\"Hello\"}")
                .when().post("/notifications")
                .then().statusCode(400);
    }
}

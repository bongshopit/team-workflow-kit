package com.lego.notification;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class NotificationServiceTest {

    @Test
    void sendStoresTheNotification() {
        NotificationService service = new NotificationService();
        service.send("a@example.com", "Hello", "Body");
        assertEquals(1, service.listFor("a@example.com").size());
    }

    @Test
    void sendRejectsRecipientWithoutAt() {
        NotificationService service = new NotificationService();
        ApiException e = assertThrows(ApiException.class, () -> service.send("nobody", "Hello", "Body"));
        assertEquals(400, e.status());
    }

    @Test
    void sendRejectsBlankSubject() {
        NotificationService service = new NotificationService();
        ApiException e = assertThrows(ApiException.class, () -> service.send("a@example.com", " ", "Body"));
        assertEquals(400, e.status());
    }

    @Test
    void listForOnlyReturnsThatRecipient() {
        NotificationService service = new NotificationService();
        service.send("a@example.com", "One", "x");
        service.send("b@example.com", "Two", "y");
        assertEquals(1, service.listFor("b@example.com").size());
    }
}

package com.lego.notification;

/** Body of POST /notifications. */
public record NotificationRequest(String recipient, String subject, String body) {
}

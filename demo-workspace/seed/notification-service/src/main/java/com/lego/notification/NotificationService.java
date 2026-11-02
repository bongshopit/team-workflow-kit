package com.lego.notification;

import jakarta.inject.Singleton;
import java.util.ArrayList;
import java.util.List;

@Singleton
public class NotificationService {
    private final List<Notification> sent = new ArrayList<>();

    public Notification send(String recipient, String subject, String body) {
        if (recipient == null || !recipient.contains("@")) throw new ApiException(400, "recipient must be an email address");
        if (subject == null || subject.isBlank()) throw new ApiException(400, "subject is required");
        Notification notification = new Notification("NTF-" + (sent.size() + 1), recipient, subject, body == null ? "" : body);
        sent.add(notification);
        return notification;
    }

    public List<Notification> listFor(String recipient) {
        List<Notification> result = new ArrayList<>();
        for (Notification n : sent) {
            if (n.recipient().equals(recipient)) result.add(n);
        }
        return result;
    }
}

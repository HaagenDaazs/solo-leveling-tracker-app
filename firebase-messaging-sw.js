// firebase-messaging-sw.js
// Place at ROOT of your project (same level as index.html)

importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyAptUL8WwEN2bu6KzzqpTpLDiAfO99L3g4",
  authDomain:        "solo-leveling-tracker-26bf0.firebaseapp.com",
  projectId:         "solo-leveling-tracker-26bf0",
  storageBucket:     "solo-leveling-tracker-26bf0.firebasestorage.app",
  messagingSenderId: "313976364226",
  appId:             "1:313976364226:web:c0abf1540cf8a8a641ef5b",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  self.registration.showNotification(title || "Solo Leveling Tracker", {
    body: body || "The dungeon calls.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: "sl-tracker",
    renotify: true,
    data: { url: "/" },
  });
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type:"window", includeUncontrolled:true }).then((list) => {
      if (list.length > 0) return list[0].focus();
      return clients.openWindow("/");
    })
  );
});

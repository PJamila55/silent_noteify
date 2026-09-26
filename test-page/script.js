let unreadCount = 0;
let floodInterval = null;

function toggleNotifPanel() {
    const panel = document.getElementById("notif-panel");
    panel.classList.toggle("active");
}

function updateBadge() {
    const badge = document.getElementById("badge");
    badge.innerText = unreadCount;
}

function addNotification(text, isInsane = false) {
    const list = document.getElementById("notif-list");
    const emptyMsg = document.getElementById("empty-msg");

    if (emptyMsg) {
        emptyMsg.style.display = "none";
    }

    const item = document.createElement("div");
    item.className = isInsane ? "notif-item insane" : "notif-item";

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

    item.innerHTML = `
        <div>${text}</div>
        <div class="notif-time">${timeString}</div>
    `;

    list.insertBefore(item, list.firstChild);

    unreadCount++;
    updateBadge();
}

function clearNotifs() {
    if (floodInterval) {
        clearInterval(floodInterval);
        floodInterval = null;
    }

    const list = document.getElementById("notif-list");
    list.innerHTML = '<p id="empty-msg" class="empty-msg">No notifications yet.</p>';

    unreadCount = 0;
    updateBadge();
}

function toggleEnlarge() {
    const btn = document.getElementById("btn-enlarge");
    btn.classList.toggle("expanded");

    if (btn.classList.contains("expanded")) {
        btn.innerText = "Shrink Me";
    } else {
        btn.innerText = "Enlarge Me";
    }
}

function openModal() {
    const modal = document.getElementById("info-modal");
    modal.classList.add("active");
}

function closeModal() {
    const modal = document.getElementById("info-modal");
    modal.classList.remove("active");
}

let toastTimeout = null;

function triggerToast(message) {
    const toast = document.getElementById("toast");
    toast.innerText = message;
    toast.classList.add("active");

    if (toastTimeout) {
        clearTimeout(toastTimeout);
    }

    toastTimeout = setTimeout(() => {
        toast.classList.remove("active");
    }, 3000);
}

function addNormalNotifs() {
    addNotification("You have mail");
    addNotification("You have mail");
    addNotification("You do NOT have mail");
    triggerToast("Added 3 notifications!");
}

function addInsaneNotifs() {
    if (floodInterval) {
        clearInterval(floodInterval);
    }

    let count = 0;
    triggerToast("FLOOD STARTED!");

    floodInterval = setInterval(() => {
        count++;
        addNotification(`INSANE ALERT #${count}: High load detected!`, true);

        if (count >= 25) {
            clearInterval(floodInterval);
            floodInterval = null;
            triggerToast("Flood completed!");
        }
    }, 80);
}

window.addEventListener("click", (e) => {
    const modal = document.getElementById("info-modal");
    if (e.target === modal) {
        closeModal();
    }

    const panel = document.getElementById("notif-panel");
    const toggleBtn = document.getElementById("notif-toggle-btn");
    if (panel && toggleBtn && !panel.contains(e.target) && !toggleBtn.contains(e.target)) {
        panel.classList.remove("active");
    }
});

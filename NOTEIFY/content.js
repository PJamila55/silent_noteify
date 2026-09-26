/**
 * Noteify — Silent Changes Announcer for NVDA
 * MADE BY TEAM : IKEA
 * -----------------------------------------------------------------------
 * Announces dynamic UI changes on a page to NVDA, with built-in flood
 * protection so a burst of notifications doesn't turn into an
 * uninterruptible wall of speech.
 *
 * KEYBOARD COMMANDS
 *   Alt+S  Check for updates (main command)
 *   Alt+M  Mute / unmute automatic announcements
 *   Alt+Y  Yes — read the notification flood, OR read the modal's contents
 *          (whichever is pending)
 *   Alt+N  No, leave a notification flood alone for now
 *   Alt+C  Close the info modal if open, and/or clear notifications
 *   Alt+H  Hear the full command list again
 */

(function () {
  "use strict";

  const REQUIRED_IDS = ["notif-list", "toast", "info-modal", "btn-enlarge"];
  const NOTIF_WINDOW_MS = 2000; // how long we wait to batch incoming notifications
  const FLOOD_THRESHOLD = 3; // 1-2 = auto-announce individually, 3+ = ask first
  const CLEAR_WINDOW_MS = 20000; // how long Alt+C stays armed for clearing after a flood read

  function hasRequiredStructure() {
    return REQUIRED_IDS.every((id) => document.getElementById(id));
  }

  function init() {
    if (!hasRequiredStructure()) return;

    const notifList = document.getElementById("notif-list");
    const toast = document.getElementById("toast");
    const infoModal = document.getElementById("info-modal");
    const btnEnlarge = document.getElementById("btn-enlarge");

    // ---------------------------------------------------------------
    // Live regions
    // ---------------------------------------------------------------
    function createLiveRegion(id, politeness) {
      let region = document.getElementById(id);
      if (region) return region;
      region = document.createElement("div");
      region.id = id;
      region.setAttribute("aria-live", politeness);
      region.setAttribute("role", politeness === "assertive" ? "alert" : "status");
      region.setAttribute("aria-atomic", "true");
      Object.assign(region.style, {
        position: "absolute",
        width: "1px",
        height: "1px",
        overflow: "hidden",
        clip: "rect(0,0,0,0)",
        whiteSpace: "nowrap",
        border: "0",
        padding: "0",
        margin: "-1px",
      });
      document.body.appendChild(region);
      return region;
    }

    const assertiveRegion = createLiveRegion("nvda-ext-assertive-region", "assertive");
    const politeRegion = createLiveRegion("nvda-ext-polite-region", "polite");

    // Small delay + clear-then-set trick so repeated/identical text still
    // registers as a fresh change for the screen reader.
    function speak(region, text) {
      if (!text) return;
      region.textContent = "";
      setTimeout(() => {
        region.textContent = text;
      }, 50);
    }

    function assertiveAnnounce(text) {
      speak(assertiveRegion, text);
    }

    // Polite announcements are queued so they never overlap each other.
    let politeQueue = [];
    let politeBusy = false;
    function queuePolite(text) {
      politeQueue.push(text);
      processPoliteQueue();
    }
    function processPoliteQueue() {
      if (politeBusy || politeQueue.length === 0) return;
      politeBusy = true;
      const text = politeQueue.shift();
      speak(politeRegion, text);
      const delay = Math.max(700, text.length * 40);
      setTimeout(() => {
        politeBusy = false;
        processPoliteQueue();
      }, delay);
    }

    // ---------------------------------------------------------------
    // State
    // ---------------------------------------------------------------
    let autoAnnounceMuted = false;
    let elapsedText = "This looks like your first visit.";
    let pendingFloodDecision = false;
    let pendingFloodItems = [];
    let pendingModalRead = false;
    let clearAvailable = false;
    let clearAvailableTimer = null;

    // ---------------------------------------------------------------
    // Last-visit tracking (per full URL) + welcome message
    // ---------------------------------------------------------------
    const storageKey = "nvdaExtLastVisit::" + location.href;

    function formatElapsed(ms) {
      const sec = Math.floor(ms / 1000);
      if (sec < 60) return sec + " second" + (sec === 1 ? "" : "s");
      const min = Math.floor(sec / 60);
      if (min < 60) return min + " minute" + (min === 1 ? "" : "s");
      const hr = Math.floor(min / 60);
      if (hr < 24) return hr + " hour" + (hr === 1 ? "" : "s");
      const day = Math.floor(hr / 24);
      return day + " day" + (day === 1 ? "" : "s");
    }

    function initVisitTracking() {
      const now = Date.now();
      try {
        chrome.storage.local.get([storageKey], (result) => {
          const lastVisit = result ? result[storageKey] : null;
          if (lastVisit) {
            elapsedText = "It has been " + formatElapsed(now - lastVisit) + " since your last visit.";
          } else {
            elapsedText = "This looks like your first visit to this page.";
          }
          chrome.storage.local.set({ [storageKey]: now });

          // Welcome message: short, not the full summary. Full details wait for Alt+S.
          setTimeout(() => {
            queuePolite(
              "Noteify ready. " +
                elapsedText +
                " Press Alt+S to check for updates, or Alt+H for all commands."
            );
          }, 400);
        });
      } catch (err) {
        // chrome.storage unavailable for some reason - degrade gracefully
        elapsedText = "Visit history isn't available right now.";
      }
    }

    // ---------------------------------------------------------------
    // Notification flood handling
    // ---------------------------------------------------------------
    let notifBuffer = [];
    let notifWindowTimer = null;

    function onNotifAdded(text) {
      notifBuffer.push({ text: text, time: Date.now() });
      if (!notifWindowTimer) {
        notifWindowTimer = setTimeout(processNotifBuffer, NOTIF_WINDOW_MS);
      }
    }

    function processNotifBuffer() {
      const items = notifBuffer;
      notifBuffer = [];
      notifWindowTimer = null;
      if (items.length === 0) return;
      if (autoAnnounceMuted) return; // fully muted: say nothing automatically, check with Alt+S instead

      if (items.length < FLOOD_THRESHOLD) {
        // 1-2 notifications: just say them.
        items.forEach((it) => queuePolite("New notification: " + it.text));
      } else {
        // 3+ notifications: don't read them out. Ask first.
        pendingFloodItems = items;
        pendingFloodDecision = true;
        assertiveAnnounce(
          "There are " +
            items.length +
            " new notifications. Would you like to hear them? Press Alt+Y for yes, or Alt+N for no."
        );
      }
    }

    function handleFloodYes() {
      if (!pendingFloodDecision) return;
      pendingFloodDecision = false;
      const items = pendingFloodItems;
      pendingFloodItems = [];
      const preview = items.slice(0, 5).map((it) => it.text).join(". ");
      const more = items.length > 5 ? " and " + (items.length - 5) + " more." : "";
      assertiveAnnounce("Reading " + items.length + " notifications. " + preview + more);
      armClearAvailable();
      setTimeout(() => {
        queuePolite("Press Alt+C to clear all notifications, or keep browsing to leave them.");
      }, 1500);
    }

    function handleFloodNo() {
      if (!pendingFloodDecision) return;
      pendingFloodDecision = false;
      pendingFloodItems = [];
      assertiveAnnounce("Okay, left as is. Press Alt+S any time to check again.");
    }

    function armClearAvailable() {
      clearAvailable = true;
      if (clearAvailableTimer) clearTimeout(clearAvailableTimer);
      clearAvailableTimer = setTimeout(() => {
        clearAvailable = false;
      }, CLEAR_WINDOW_MS);
    }

    function triggerClear() {
      let didSomething = false;

      if (infoModal.classList.contains("active")) {
        const closeBtn = infoModal.querySelector(".close-modal-btn");
        if (closeBtn) {
          closeBtn.click();
        } else {
          infoModal.classList.remove("active");
        }
        didSomething = true;
      }

      if (clearAvailable) {
        const clearBtn = document.querySelector(".clear-btn");
        if (clearBtn) {
          clearBtn.click();
        }
        clearAvailable = false;
        if (clearAvailableTimer) clearTimeout(clearAvailableTimer);
        didSomething = true;
      }

      if (didSomething) {
        assertiveAnnounce("Cleared.");
      } else {
        assertiveAnnounce("Nothing to clear right now.");
      }
    }

    function handleModalRead() {
      if (!pendingModalRead) return;
      pendingModalRead = false;
      const contentEl = infoModal.querySelector(".modal-content");
      let text = "Nothing to read.";
      if (contentEl) {
        // Read everything in the modal except the close button, so we don't announce "Close".
        const clone = contentEl.cloneNode(true);
        const btn = clone.querySelector(".close-modal-btn");
        if (btn) btn.remove();
        text = clone.textContent.replace(/\s+/g, " ").trim() || text;
      }
      assertiveAnnounce(text + " Press Alt+C to close it.");
    }

    function collectCurrentNotifTexts() {
      const nodes = notifList.querySelectorAll(".notif-item");
      return Array.from(nodes).map((node) => {
        const textEl = node.querySelector(":scope > div:first-child");
        return { text: (textEl ? textEl.textContent : node.textContent).trim() };
      });
    }

    // Watch only #notif-list, never document.body.
    const notifObserver = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (!node.classList || !node.classList.contains("notif-item")) return;
          const textEl = node.querySelector(":scope > div:first-child");
          const text = (textEl ? textEl.textContent : node.textContent).trim();
          onNotifAdded(text);
        });
      });
    });
    notifObserver.observe(notifList, { childList: true });

    // ---------------------------------------------------------------
    // Enlarge button
    // ---------------------------------------------------------------
    let wasExpanded = btnEnlarge.classList.contains("expanded");
    const enlargeObserver = new MutationObserver(() => {
      const isExpanded = btnEnlarge.classList.contains("expanded");
      if (isExpanded === wasExpanded) return;
      wasExpanded = isExpanded;
      if (!autoAnnounceMuted) {
        queuePolite(isExpanded ? "Button enlarged." : "Button back to normal size.");
      }
    });
    enlargeObserver.observe(btnEnlarge, { attributes: true, attributeFilter: ["class"] });

    // ---------------------------------------------------------------
    // Info modal
    // ---------------------------------------------------------------
    let modalOpen = infoModal.classList.contains("active");
    const modalObserver = new MutationObserver(() => {
      const isOpen = infoModal.classList.contains("active");
      if (isOpen === modalOpen) return;
      modalOpen = isOpen;
      if (isOpen) {
        pendingModalRead = true;
        if (!autoAnnounceMuted) {
          queuePolite("Information modal opened. Press Alt+Y to hear what's inside, or Alt+C to close it.");
        }
      } else {
        pendingModalRead = false;
        if (!autoAnnounceMuted) {
          queuePolite("Information modal closed.");
        }
      }
    });
    modalObserver.observe(infoModal, { attributes: true, attributeFilter: ["class"] });

    // ---------------------------------------------------------------
    // Toast
    // ---------------------------------------------------------------
    let toastActive = toast.classList.contains("active");
    const toastObserver = new MutationObserver(() => {
      const isActive = toast.classList.contains("active");
      if (isActive === toastActive) {
        return;
      }
      toastActive = isActive;
      if (isActive) {
        if (!autoAnnounceMuted) {
          queuePolite("Message: " + toast.textContent.trim());
        }
      }
    });
    toastObserver.observe(toast, { attributes: true, attributeFilter: ["class"] });

    // ---------------------------------------------------------------
    // Alt+S summary — reports current on-screen state, not history
    // ---------------------------------------------------------------
    function handleAltS() {
      const parts = [];
      parts.push(elapsedText);

      const modalOpenNow = infoModal.classList.contains("active");
      if (modalOpenNow) {
        parts.push("The information modal is currently open. Press Alt+Y to hear what's inside, or Alt+C to close it.");
        pendingModalRead = true;
      }

      const badgeEl = document.getElementById("badge");
      const unread = badgeEl ? parseInt(badgeEl.textContent, 10) || 0 : 0;
      if (unread > 0) {
        parts.push(
          unread +
            " unread notification" + (unread === 1 ? "" : "s") +
            ". Press Alt+Y to hear them, Alt+N to leave them, or Alt+C to clear them."
        );
        pendingFloodItems = collectCurrentNotifTexts();
        pendingFloodDecision = true;
        armClearAvailable();
      }

      if (!modalOpenNow && unread === 0) {
        parts.push("No modal open, no unread notifications.");
      }

      parts.push("Automatic announcements are currently " + (autoAnnounceMuted ? "muted" : "on") + ".");
      assertiveAnnounce(parts.join(" "));
    }

    function handleAltH() {
      assertiveAnnounce(
        "Commands: Alt+S, check for updates. Alt+M, mute or unmute automatic announcements. " +
          "Alt+Y and Alt+N, respond to a notification flood prompt when one appears. Alt+Y also reads out the information modal's contents when one is open. " +
          "Alt+C, close the information modal if it's open, and clear all notifications, available right after you choose to hear a flood. " +
          "Alt+H, hear this list again."
      );
    }

    // ---------------------------------------------------------------
    // Keyboard commands
    // ---------------------------------------------------------------
    document.addEventListener(
      "keydown",
      (e) => {
        if (!e.altKey || e.ctrlKey || e.metaKey) return;
        const key = e.key.toLowerCase();
        switch (key) {
          case "s":
            e.preventDefault();
            handleAltS();
            break;
          case "m":
            e.preventDefault();
            autoAnnounceMuted = !autoAnnounceMuted;
            assertiveAnnounce(
              autoAnnounceMuted ? "Automatic announcements muted." : "Automatic announcements unmuted."
            );
            break;
          case "y":
            if (pendingFloodDecision) {
              e.preventDefault();
              handleFloodYes();
            } else if (pendingModalRead) {
              e.preventDefault();
              handleModalRead();
            }
            break;
          case "n":
            if (pendingFloodDecision) {
              e.preventDefault();
              handleFloodNo();
            }
            break;
          case "c":
            e.preventDefault();
            triggerClear();
            break;
          case "h":
            e.preventDefault();
            handleAltH();
            break;
        }
      },
      true
    );

    initVisitTracking();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
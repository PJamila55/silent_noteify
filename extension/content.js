/**
 * Silent Changes Announcer for NVDA
 * -----------------------------------------------------------------------
 * Announces dynamic UI changes on a page to NVDA, with built-in flood
 * protection so a burst of notifications doesn't turn into an
 * uninterruptible wall of speech.
 *
 * SAFETY GUARD
 * This script only does anything if the page contains the specific
 * elements the test dashboard uses (#notif-list, #toast, #info-modal,
 * #btn-enlarge). On any other page it silently does nothing.
 *
 * HOW ANNOUNCEMENTS REACH NVDA
 * Two offscreen ARIA live regions are created:
 *   - "assertive" region: for things the user directly asked for
 *     (Alt+S, Alt+H, Alt+M, Alt+Y/N replies). These interrupt.
 *   - "polite" region: for automatic events (a toast firing, the button
 *     enlarging, 1-2 notifications arriving). These are queued and
 *     paced out so they never overlap each other or talk over NVDA.
 *
 * WHY THIS DOESN'T FIGHT WITH NVDA
 * MutationObservers only watch the specific elements that change
 * (#notif-list, #btn-enlarge, #info-modal, #toast) - never
 * document.body. That means the live regions this script creates (and
 * updates) can never be picked up as "a page change" and re-announced,
 * which would otherwise cause a feedback loop.
 *
 * KEYBOARD COMMANDS
 *   Alt+S  Check for updates (main command)
 *   Alt+M  Mute / unmute automatic announcements
 *   Alt+Y  Yes, read the flood of notifications (only after a flood prompt)
 *   Alt+N  No, leave the flood alone for now (only after a flood prompt)
 *   Alt+C  Clear all notifications (only available right after Alt+Y)
 *   Alt+H  Hear the full command list again
 */

(function () {
  "use strict";

  const REQUIRED_IDS = ["notif-list", "toast", "info-modal", "btn-enlarge"];
  const NOTIF_WINDOW_MS = 2000; // how long we wait to batch incoming notifications
  const FLOOD_THRESHOLD = 3; // 1-2 = auto-announce individually, 3+ = ask first
  const CLEAR_WINDOW_MS = 20000; // how long Alt+C stays armed after a flood read

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
    let stats = { notifications: 0, enlarges: 0, modals: 0, toasts: 0 };
    let elapsedText = "This looks like your first visit.";
    let pendingFloodDecision = false;
    let pendingFloodItems = [];
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
              "Silent Changes Announcer ready. " +
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
      stats.notifications++;
      if (!notifWindowTimer) {
        notifWindowTimer = setTimeout(processNotifBuffer, NOTIF_WINDOW_MS);
      }
    }

    function processNotifBuffer() {
      const items = notifBuffer;
      notifBuffer = [];
      notifWindowTimer = null;
      if (items.length === 0) return;

      if (items.length < FLOOD_THRESHOLD) {
        // 1-2 notifications: just say them, if not muted.
        if (!autoAnnounceMuted) {
          items.forEach((it) => queuePolite("New notification: " + it.text));
        }
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
      if (!clearAvailable) return;
      const clearBtn = document.querySelector(".clear-btn");
      if (clearBtn) {
        clearBtn.click();
        assertiveAnnounce("Notifications cleared.");
      } else {
        assertiveAnnounce("No clear button found on this page.");
      }
      clearAvailable = false;
      if (clearAvailableTimer) clearTimeout(clearAvailableTimer);
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
      stats.enlarges++;
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
      stats.modals++;
      if (!autoAnnounceMuted) {
        queuePolite(isOpen ? "Information modal opened." : "Information modal closed.");
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
        stats.toasts++;
        if (!autoAnnounceMuted) {
          queuePolite("Message: " + toast.textContent.trim());
        }
      }
    });
    toastObserver.observe(toast, { attributes: true, attributeFilter: ["class"] });

    // ---------------------------------------------------------------
    // Alt+S summary
    // ---------------------------------------------------------------
    function handleAltS() {
      const plural = (n) => (n === 1 ? "" : "s");
      const summary =
        elapsedText +
        " Since your last check: " +
        stats.notifications + " notification" + plural(stats.notifications) + ", " +
        stats.enlarges + " size change" + plural(stats.enlarges) + ", " +
        stats.modals + " modal event" + plural(stats.modals) + ", and " +
        stats.toasts + " pop up message" + plural(stats.toasts) + ". " +
        "Automatic announcements are currently " + (autoAnnounceMuted ? "muted" : "on") + ". " +
        "Press Alt+M to toggle, or Alt+H for the full command list.";
      assertiveAnnounce(summary);
      stats = { notifications: 0, enlarges: 0, modals: 0, toasts: 0 };
    }

    function handleAltH() {
      assertiveAnnounce(
        "Commands: Alt+S, check for updates. Alt+M, mute or unmute automatic announcements. " +
          "Alt+Y and Alt+N, respond to a notification flood prompt when one appears. " +
          "Alt+C, clear all notifications, available right after you choose to hear a flood. " +
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
            }
            break;
          case "n":
            if (pendingFloodDecision) {
              e.preventDefault();
              handleFloodNo();
            }
            break;
          case "c":
            if (clearAvailable) {
              e.preventDefault();
              triggerClear();
            }
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

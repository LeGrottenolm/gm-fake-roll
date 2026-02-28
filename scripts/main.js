// ============================================================
//  GM Fake Roll v5.0 – WFRP4e Native Test Hijack
//  Nutzt WFRP4e's eigenes Testsystem statt rohem Roll
// ============================================================
const MODULE_ID = "gm-fake-roll";

// ============================================================
//  Condition-Modifikatoren
// ============================================================
const CONDITION_MODIFIERS = {
  "fatigued":  -10, "exhausted": -20, "prone":    -20,
  "blinded":   -20, "deafened":  -10, "stunned":  -10,
  "poisoned":  -10, "diseased":  -10,
};

// ============================================================
//  Actor-Daten auslesen
// ============================================================
function getActorData() {
  const token = canvas?.tokens?.controlled?.[0];
  const actor = token?.actor;
  if (!actor) return { actorName: null, items: [], advantage: 0, conditions: [], extendedTests: [] };

  const advantage      = actor.system?.status?.advantage?.value ?? 0;
  const advantageBonus = advantage * 10;

  let conditionModifier = 0;
  const activeConditions = [];
  for (const effect of actor.effects ?? []) {
    if (effect.disabled) continue;
    for (const [statusId, mod] of Object.entries(CONDITION_MODIFIERS)) {
      const hasStatus = effect.statuses?.has(statusId)
                     ?? effect.name?.toLowerCase().includes(statusId)
                     ?? false;
      if (hasStatus) {
        conditionModifier += mod;
        activeConditions.push(`${effect.name ?? statusId} (${mod > 0 ? "+" : ""}${mod})`);
        break;
      }
    }
  }

  const totalMod = advantageBonus + conditionModifier;
  const modStr   = totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;

  const items = [];

  // Charakteristiken
  for (const [key, c] of Object.entries(actor.system?.characteristics ?? {})) {
    const base = c?.value ?? 0;
    if (base <= 0) continue;
    const label = game.i18n.localize(`WFRP4E.CharAbbrev.${key.toUpperCase()}`) || key.toUpperCase();
    items.push({
      id:       `char_${key}`,
      name:     `${label} (${base}${totalMod !== 0 ? ` ${modStr}` : ""} = ${Math.max(1, base + totalMod)})`,
      value:    Math.max(1, base + totalMod),
      type:     "characteristic",
      charKey:  key,
      isMagic:  false,
    });
  }

  // Fertigkeiten
  actor.items
    .filter(i => i.type === "skill")
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(i => {
      const base    = i.system?.total?.value ?? 0;
      const isMagic = i.name.toLowerCase().includes("language (magick)")
                   || i.name.toLowerCase().includes("channelling");
      items.push({
        id:      i.id,
        name:    `${i.name} (${base}${totalMod !== 0 ? ` ${modStr}` : ""} = ${Math.max(1, base + totalMod)})`,
        value:   Math.max(1, base + totalMod),
        type:    "skill",
        isMagic,
      });
    });

  // Waffen
  const RANGED = ["bow","crossbow","blackpowder","throwing","engineering","entangling"];
  actor.items
    .filter(i => i.type === "weapon")
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(i => {
      const isRanged = RANGED.includes(i.system?.weaponGroup?.value ?? "");
      const charKey  = isRanged ? "bs" : "ws";
      const base     = actor.system?.characteristics?.[charKey]?.value ?? 0;
      items.push({
        id:      i.id,
        name:    `⚔️ ${i.name} (${isRanged ? "BS" : "WS"}: ${base}${totalMod !== 0 ? ` ${modStr}` : ""} = ${Math.max(1, base + totalMod)})`,
        value:   Math.max(1, base + totalMod),
        type:    "weapon",
        isMagic: false,
      });
    });

  // Extended Tests
  const extendedTests = actor.items
    .filter(i => i.type === "extendedTest")
    .map(i => ({ id: i.id, name: i.name, current: i.system?.SL?.current ?? 0, target: i.system?.SL?.target ?? 0 }));

  return { actorName: actor.name, advantage, conditions: activeConditions, items, extendedTests };
}

// ============================================================
//  Ziel-Daten
// ============================================================
function getTargetData(rollerValue) {
  const targetToken = [...(game.user?.targets ?? [])][0]
                   ?? canvas?.tokens?.controlled?.[1];
  const actor = targetToken?.actor;
  if (!actor) return null;

  const firstChar = Object.values(actor.system?.characteristics ?? {})[0];
  const targetVal = firstChar?.value ?? 0;
  const diff      = (rollerValue ?? 0) - targetVal;

  let comparison;
  if (diff > 0)      comparison = `⚔️ Würfelnder hat Vorteil (+${diff})`;
  else if (diff < 0) comparison = `🛡️ Ziel hat Vorteil (${diff})`;
  else               comparison = `⚖️ Gleichstand – höherer Fertigkeitswert gewinnt`;

  return { targetName: actor.name, targetComparison: comparison };
}

// ============================================================
//  SL berechnen
// ============================================================
function calcSL(rollResult, skillValue) {
  const tens = (n) => Math.floor(Math.min(n, 100) / 10);
  return tens(skillValue) - tens(rollResult);
}

// ============================================================
//  Preset-Berechnung
// ============================================================
function calcPreset(mode, sv) {
  sv = Math.max(1, Math.min(110, sv));
  switch (mode) {
    case "crit-success": {
      const vd = [11,22,33,44,55,66,77,88,99].filter(d => d <= Math.min(sv, 100));
      if (vd.length && Math.random() > 0.4) return vd[Math.floor(Math.random() * vd.length)];
      return Math.floor(Math.random() * Math.min(5, sv)) + 1;
    }
    case "success": {
      const min = Math.min(10, sv), max = Math.min(sv, 95);
      return min >= max ? max : Math.floor(Math.random() * (max - min + 1)) + min;
    }
    case "fail": {
      const min = Math.min(sv + 1, 95), max = Math.min(95, sv + 20);
      return min >= max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
    }
    case "crit-fail": {
      const bd = [11,22,33,44,55,66,77,88,99].filter(d => d > Math.min(sv, 100));
      if (bd.length && Math.random() > 0.5) return bd[Math.floor(Math.random() * bd.length)];
      return Math.floor(Math.random() * 5) + 96;
    }
    default: return 50;
  }
}

// ============================================================
//  KERN: WFRP4e Test hijacken
//  Registriert einen einmaligen Hook der das Roll-Ergebnis
//  VOR der WFRP4e-Auswertung überschreibt
// ============================================================
async function performFakeRoll(actor, itemId, itemType, desiredTotal, flavor, gmNote, isMagic) {

  // GM-Notiz
  if (gmNote) {
    console.log(
      `%c[GM Fake Roll | ${new Date().toLocaleTimeString()}] ${flavor || "–"} → ${gmNote}`,
      "color:#f4a460; font-style:italic;"
    );
  }

  // Miscast-Warnung
  if (isMagic && desiredTotal >= 96) {
    console.warn(
      `%c[GM Fake Roll | ⚠️ MISCAST] ${flavor || "Zauberwurf"} → W100: ${desiredTotal}`,
      "color:#ff6b6b; font-weight:bold;"
    );
  }

  // ── Einmaliger Hook: Fängt den nächsten WFRP4e-Test ab ────
  // Der Hook wird NUR EINMAL ausgeführt und dann automatisch entfernt
  const hookId = Hooks.once("wfrp4e:preRollTest", (rollData) => {
    // Würfelergebnis überschreiben
    rollData.roll = desiredTotal;

    // Flavor-Text setzen falls angegeben
    if (flavor) rollData.testData = rollData.testData ?? {};
  });

  // ── WFRP4e-Test am Actor auslösen ─────────────────────────
  try {
    if (itemType === "weapon") {
      const weapon = actor.items.get(itemId);
      if (!weapon) throw new Error(`Waffe ${itemId} nicht gefunden`);
      await actor.setupWeapon(weapon, { skipTargeting: false });

    } else if (itemType === "skill") {
      const skill = actor.items.get(itemId);
      if (!skill) throw new Error(`Fertigkeit ${itemId} nicht gefunden`);
      await actor.setupSkill(skill);

    } else if (itemType === "characteristic") {
      // charKey aus der ID extrahieren (format: "char_ws")
      const charKey = itemId.replace("char_", "");
      await actor.setupCharacteristic(charKey);
    }

  } catch (err) {
    // Hook wieder entfernen wenn etwas schiefläuft
    Hooks.off("wfrp4e:preRollTest", hookId);
    ui.notifications.error(`[GM Fake Roll] Fehler beim Auslösen des Tests: ${err.message}`);
    console.error("[GM Fake Roll]", err);
  }
}

// ============================================================
//  Dialog-Listener
// ============================================================
function attachDialogListeners(element) {
  const root = (typeof element?.get === "function") ? element[0] : element;

  const itemSelect     = root.querySelector("#fkr-skill-select");
  const resultInput    = root.querySelector("#fkr-result");
  const presetBtns     = root.querySelectorAll(".fkr-preset");
  const slDisplay      = root.querySelector("#fkr-sl-display");
  const miscastWarning = root.querySelector("#fkr-miscast-warning");

  const getActiveMode = () =>
    root.querySelector(".fkr-preset.fkr-active")?.dataset?.mode ?? "success";

  const updateSLDisplay = () => {
    if (!slDisplay) return;
    const sv     = parseInt(itemSelect?.value ?? "45", 10);
    const result = parseInt(resultInput?.value ?? "50", 10);
    const sl     = calcSL(result, sv);
    const color  = sl >= 0 ? "#90ee90" : "#e8a87c";
    slDisplay.innerHTML =
      `<span style="color:${color}; font-weight:bold; font-size:1.1em;">
        SL: ${sl >= 0 ? "+" : ""}${sl}
      </span>`;
    if (miscastWarning) {
      const opt     = itemSelect?.options?.[itemSelect.selectedIndex];
      const isMagic = opt?.dataset?.isMagic === "true";
      miscastWarning.style.display = (isMagic && result >= 96) ? "block" : "none";
    }
  };

  itemSelect?.addEventListener("change", () => {
    resultInput.value = calcPreset(getActiveMode(), parseInt(itemSelect.value, 10) || 45);
    updateSLDisplay();
  });

  resultInput?.addEventListener("input", updateSLDisplay);

  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => { b.classList.remove("fkr-active"); b.style.opacity = "0.65"; });
      btn.classList.add("fkr-active");
      btn.style.opacity = "1";
      resultInput.value = calcPreset(btn.dataset.mode, parseInt(itemSelect?.value ?? "45", 10));
      updateSLDisplay();
    });
  });

  root.querySelector(".fkr-preset[data-mode='success']")?.click();
}

// ============================================================
//  Submit-Handler
// ============================================================
async function handleSubmit(element) {
  const root = (typeof element?.get === "function") ? element[0] : element;

  const itemSelect  = root.querySelector("#fkr-skill-select");
  const selectedOpt = itemSelect?.options?.[itemSelect.selectedIndex];

  const result   = parseInt(root.querySelector("#fkr-result")?.value, 10);
  const flavor   = root.querySelector("#fkr-flavor")?.value?.trim()  ?? "";
  const gmNote   = root.querySelector("#fkr-gmnote")?.value?.trim()  ?? "";
  const itemId   = selectedOpt?.dataset?.itemId   ?? null;
  const itemType = selectedOpt?.dataset?.itemType ?? null;
  const isMagic  = selectedOpt?.dataset?.isMagic  === "true";

  const actor = canvas?.tokens?.controlled?.[0]?.actor;
  if (!actor) {
    ui.notifications.warn("[GM Fake Roll] Kein Token selektiert!");
    return;
  }
  if (!itemId || !itemType) {
    ui.notifications.warn("[GM Fake Roll] Kein gültiges Item ausgewählt!");
    return;
  }

  await performFakeRoll(actor, itemId, itemType, result, flavor, gmNote, isMagic);
}

// ============================================================
//  Dialog öffnen
// ============================================================
async function openFakeRollDialog() {
  if (!game.user.isGM) return;

  const actorData  = getActorData();
  const targetData = getTargetData(actorData.items[0]?.value ?? 45);

  const content = await renderTemplate(
    `modules/${MODULE_ID}/templates/fake-roll-dialog.hbs`,
    { ...actorData, ...(targetData ?? {}) }
  );

  if (foundry.applications?.api?.DialogV2) {
    await foundry.applications.api.DialogV2.wait({
      window:      { title: "🎲 GM: Verdeckter Würfelwurf" },
      content,
      rejectClose: false,
      render:      (_event, dialog) => attachDialogListeners(dialog.element),
      buttons: [
        {
          action:   "roll",
          label:    "Würfeln",
          icon:     "fas fa-dice-d20",
          default:  true,
          callback: (_event, _button, dialog) => handleSubmit(dialog.element),
        },
        { action: "cancel", label: "Abbrechen", icon: "fas fa-times" },
      ],
    });
  } else {
    new Dialog({
      title:   "🎲 GM: Verdeckter Würfelwurf",
      content,
      buttons: {
        roll:   { icon: '<i class="fas fa-dice-d20"></i>', label: "Würfeln", callback: handleSubmit },
        cancel: { icon: '<i class="fas fa-times"></i>',   label: "Abbrechen" },
      },
      default: "roll",
      render:  (html) => attachDialogListeners(html[0]),
    }, { width: 420 }).render(true);
  }
}

// ============================================================
//  Toolbar-Button
// ============================================================
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tokenLayer = Array.isArray(controls)
    ? controls.find(c => c.name === "token")
    : controls.tokens;
  if (!tokenLayer) return;

  const entry = {
    name: "gm-fake-roll", title: "GM: Verdeckter Würfelwurf",
    icon: "fas fa-user-secret", visible: true, button: true,
    onChange: openFakeRollDialog,
  };

  if (Array.isArray(tokenLayer.tools)) tokenLayer.tools.push(entry);
  else tokenLayer.tools["gm-fake-roll"] = entry;
});

// ============================================================
//  Ready
// ============================================================
Hooks.once("ready", () => {
  if (!game.user.isGM) return;

  game.keybindings?.register(MODULE_ID, "openDialog", {
    name: "GM Fake Roll öffnen", hint: "Öffnet den Dialog für verdeckte WFRP4e-Würfe",
    editable: [{ key: "KeyR", modifiers: ["Shift"] }],
    onDown: () => { openFakeRollDialog(); return true; },
  });

  game.gmFakeRoll = { open: openFakeRollDialog, roll: performFakeRoll };
  console.log(`%c${MODULE_ID} v5.0 | WFRP4e Native Hook bereit.`, "color:#7ec8e3; font-weight:bold;");
});

// ============================================================
//  GM Fake Roll v4.2 – Fixes: Doppel-Dialog, Speaker, Waffen
// ============================================================
const MODULE_ID = "gm-fake-roll";

const getDieClass = () => foundry.dice?.terms?.Die ?? Die;

const CONDITION_MODIFIERS = {
  "fatigued":  -10,
  "exhausted": -20,
  "prone":     -20,
  "blinded":   -20,
  "deafened":  -10,
  "stunned":   -10,
  "poisoned":  -10,
  "diseased":  -10,
};

// ============================================================
//  Actor-Daten auslesen
// ============================================================
function getActorData() {
  const token = canvas?.tokens?.controlled?.[0];
  const actor = token?.actor;
  if (!actor) return { actorName: null, skills: [], advantage: 0, conditions: [], extendedTests: [] };

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

  const buildEntry = (name, base, isMagic = false) => {
    const totalMod  = advantageBonus + conditionModifier;
    const effective = Math.max(1, base + totalMod);
    return {
      name, base, value: effective, modifier: totalMod, isMagic,
      modifierStr: totalMod >= 0 ? `+${totalMod}` : `${totalMod}`,
    };
  };

  const list = [];

  // Charakteristiken
  for (const [key, c] of Object.entries(actor.system?.characteristics ?? {})) {
    const base = c?.value ?? c?.total ?? 0;
    if (base <= 0) continue;
    const label = game.i18n.localize(`WFRP4E.CharAbbrev.${key.toUpperCase()}`) || key.toUpperCase();
    list.push(buildEntry(label, base, false));
  }

  // Fertigkeiten
  actor.items
    .filter(i => i.type === "skill")
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(i => {
      const base    = i.system?.total?.value ?? i.system?.advances?.value ?? 0;
      const isMagic = i.name.toLowerCase().includes("language (magick)")
                   || i.name.toLowerCase().includes("channelling");
      list.push(buildEntry(i.name, base, isMagic));
    });

  // FIX 3: Waffen
  const RANGED_GROUPS = ["bow", "crossbow", "blackpowder", "throwing", "engineering", "entangling"];
  actor.items
    .filter(i => i.type === "weapon")
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(i => {
      const weaponGroup = i.system?.weaponGroup?.value ?? "";
      const isRanged    = RANGED_GROUPS.includes(weaponGroup);
      const charKey     = isRanged ? "bs" : "ws";
      const charBase    = actor.system?.characteristics?.[charKey]?.value ?? 0;
      list.push({
        ...buildEntry(`⚔️ ${i.name} (${isRanged ? "BS" : "WS"})`, charBase, false),
      });
    });

  // Extended Tests
  const extendedTests = actor.items
    .filter(i => i.type === "extendedTest")
    .map(i => ({
      id:      i.id,
      name:    i.name,
      current: i.system?.SL?.current ?? 0,
      target:  i.system?.SL?.target  ?? 0,
    }));

  return { actorName: actor.name, advantage, conditions: activeConditions, skills: list, extendedTests };
}

// ============================================================
//  Ziel-Daten
// ============================================================
function getTargetData(rollerSkillValue) {
  const targetToken = [...(game.user?.targets ?? [])][0]
                   ?? canvas?.tokens?.controlled?.[1];
  const actor = targetToken?.actor;
  if (!actor) return null;

  const chars     = actor.system?.characteristics ?? {};
  const firstChar = Object.values(chars)[0];
  const targetVal = firstChar?.value ?? 0;
  const diff      = (rollerSkillValue ?? 0) - targetVal;

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
function calcPreset(mode, effectiveSkillValue) {
  const sv = Math.max(1, Math.min(110, effectiveSkillValue));

  switch (mode) {
    case "crit-success": {
      const validDoubles = [11,22,33,44,55,66,77,88,99].filter(d => d <= Math.min(sv, 100));
      if (validDoubles.length > 0 && Math.random() > 0.4)
        return validDoubles[Math.floor(Math.random() * validDoubles.length)];
      return Math.floor(Math.random() * Math.min(5, sv)) + 1;
    }
    case "success": {
      const min = Math.min(10, sv);
      const max = Math.min(sv, 95);
      return min >= max ? max : Math.floor(Math.random() * (max - min + 1)) + min;
    }
    case "fail": {
      const min = Math.min(sv + 1, 95);
      const max = Math.min(95, sv + 20);
      return min >= max ? min : Math.floor(Math.random() * (max - min + 1)) + min;
    }
    case "crit-fail": {
      const badDoubles = [11,22,33,44,55,66,77,88,99].filter(d => d > Math.min(sv, 100));
      if (badDoubles.length > 0 && Math.random() > 0.5)
        return badDoubles[Math.floor(Math.random() * badDoubles.length)];
      return Math.floor(Math.random() * 5) + 96;
    }
    default: return 50;
  }
}

// ============================================================
//  Würfelergebnis manipulieren
// ============================================================
function distributeResult(diceTerms, targetSum) {
  const Die   = getDieClass();
  const slots = diceTerms
    .filter(t => t instanceof Die)
    .flatMap(t => t.results.map(r => ({ r, faces: t.faces })));

  if (!slots.length) return;

  const minT = slots.length;
  const maxT = slots.reduce((s, sl) => s + sl.faces, 0);
  let remaining = Math.min(Math.max(targetSum, minT), maxT) - minT;

  for (const sl of slots) { sl.r.result = 1; sl.r.active = true; delete sl.r.discarded; }
  for (const sl of [...slots].sort(() => Math.random() - 0.5)) {
    if (remaining <= 0) break;
    const add = Math.min(remaining, sl.faces - 1);
    sl.r.result += add;
    remaining   -= add;
  }
}

// ============================================================
//  Extended Test aktualisieren
// ============================================================
async function updateExtendedTest(actor, extendedTestId, rollResult, skillValue) {
  if (!extendedTestId || !actor) return;
  const item = actor.items.get(extendedTestId);
  if (!item) return;

  const sl       = calcSL(rollResult, skillValue);
  const newSL    = (item.system?.SL?.current ?? 0) + sl;
  const targetSL = item.system?.SL?.target ?? 0;

  await item.update({ "system.SL.current": newSL });

  const msg = newSL >= targetSL
    ? `✅ Ziel erreicht! (${newSL}/${targetSL} SL)`
    : `Fortschritt: ${newSL}/${targetSL} SL (${sl >= 0 ? "+" : ""}${sl} diese Runde)`;

  console.log(`%c[GM Fake Roll | ${item.name}] ${msg}`, "color:#7ec8e3;");
  ui.notifications.info(`[GM Fake Roll] ${item.name}: ${msg}`);
}

// ============================================================
//  Kern-Funktion
// ============================================================
async function performFakeRoll(formula, desiredTotal, rollMode, flavor, gmNote, actorId, extendedTestId, skillValue, isMagic) {
  if (!Roll.validate(formula))
    return ui.notifications.error(`[GM Fake Roll] Ungültige Formel: "${formula}"`);

  // FIX 2: Actor frisch holen für Speaker
  const actor   = (actorId ? game.actors.get(actorId) : null)
               ?? canvas?.tokens?.controlled?.[0]?.actor;
  const speaker = actor
    ? ChatMessage.getSpeaker({ actor })
    : ChatMessage.getSpeaker();

  const Die       = getDieClass();
  const roll      = await new Roll(formula).evaluate();
  const diceTerms = roll.terms.filter(t => t instanceof Die);

  if (diceTerms.length > 0) {
    const currentDiceSum = diceTerms
      .flatMap(t => t.results.filter(r => r.active))
      .reduce((s, r) => s + r.result, 0);
    distributeResult(diceTerms, desiredTotal - (roll.total - currentDiceSum));
    try {
      roll._total = desiredTotal;
    } catch {
      Object.defineProperty(roll, "_total", { value: desiredTotal, writable: true });
    }
  }

  let flavorText = flavor || null;
  if (skillValue) {
    const sl    = calcSL(desiredTotal, skillValue);
    const slStr = sl >= 0 ? `+${sl}` : `${sl}`;
    flavorText  = flavor ? `${flavor} (SL: ${slStr})` : `SL: ${slStr}`;
  }

  if (isMagic && desiredTotal >= 96) {
    console.warn(
      `%c[GM Fake Roll | ⚠️ MISCAST] ${flavor || "Zauberwurf"} → W100: ${desiredTotal}`,
      "color:#ff6b6b; font-weight:bold;"
    );
  }

  if (gmNote) {
    console.log(
      `%c[GM Fake Roll | ${new Date().toLocaleTimeString()}] ${flavor || "–"} → ${gmNote}`,
      "color:#f4a460; font-style:italic;"
    );
  }

  // FIX 2: speaker mitübergeben
  await roll.toMessage(
    { flavor: flavorText, speaker },
    { rollMode, create: true }
  );

  if (extendedTestId && actorId && skillValue) {
    const freshActor = game.actors.get(actorId)
                    ?? canvas?.tokens?.controlled?.[0]?.actor;
    if (freshActor) await updateExtendedTest(freshActor, extendedTestId, desiredTotal, skillValue);
  }
}

// ============================================================
//  Dialog-Listener
// ============================================================
function attachDialogListeners(element) {
  const root = (typeof element?.get === "function") ? element[0] : element;

  const skillSelect    = root.querySelector("#fkr-skill-select");
  const resultInput    = root.querySelector("#fkr-result");
  const presetBtns     = root.querySelectorAll(".fkr-preset");
  const slDisplay      = root.querySelector("#fkr-sl-display");
  const miscastWarning = root.querySelector("#fkr-miscast-warning");

  const getActiveMode = () =>
    root.querySelector(".fkr-preset.fkr-active")?.dataset?.mode ?? "success";

  const updateSLDisplay = () => {
    if (!slDisplay) return;
    const sv     = parseInt(skillSelect?.value ?? "45", 10);
    const result = parseInt(resultInput?.value  ?? "50", 10);
    const sl     = calcSL(result, sv);
    const color  = sl >= 0 ? "#90ee90" : "#e8a87c";
    slDisplay.innerHTML =
      `<span style="color:${color}; font-weight:bold; font-size:1.1em;">
        SL: ${sl >= 0 ? "+" : ""}${sl}
      </span>`;

    if (miscastWarning) {
      const opt     = skillSelect?.options?.[skillSelect.selectedIndex];
      const isMagic = opt?.dataset?.isMagic === "true";
      miscastWarning.style.display = (isMagic && result >= 96) ? "block" : "none";
    }
  };

  skillSelect?.addEventListener("change", () => {
    resultInput.value = calcPreset(getActiveMode(), parseInt(skillSelect.value, 10) || 45);
    updateSLDisplay();
  });

  resultInput?.addEventListener("input", updateSLDisplay);

  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      presetBtns.forEach(b => { b.classList.remove("fkr-active"); b.style.opacity = "0.65"; });
      btn.classList.add("fkr-active");
      btn.style.opacity = "1";
      resultInput.value = calcPreset(btn.dataset.mode, parseInt(skillSelect?.value ?? "45", 10));
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

  const skillSelect = root.querySelector("#fkr-skill-select");
  const selectedOpt = skillSelect?.options?.[skillSelect.selectedIndex];

  const result         = parseInt(root.querySelector("#fkr-result")?.value,  10);
  const flavor         = root.querySelector("#fkr-flavor")?.value?.trim()   ?? "";
  const gmNote         = root.querySelector("#fkr-gmnote")?.value?.trim()   ?? "";
  const mode           = root.querySelector("#fkr-mode")?.value             ?? "publicroll";
  const skillValue     = parseInt(skillSelect?.value, 10)                   || null;
  const extendedTestId = root.querySelector("#fkr-extended-select")?.value  || null;
  const isMagic        = selectedOpt?.dataset?.isMagic === "true";
  const actorId        = canvas?.tokens?.controlled?.[0]?.actor?.id         ?? null;

  await performFakeRoll("1d100", result, mode, flavor, gmNote, actorId, extendedTestId, skillValue, isMagic);
}

// ============================================================
//  Dialog öffnen
// ============================================================
async function openFakeRollDialog() {
  if (!game.user.isGM) return;

  const actorData  = getActorData();
  const targetData = getTargetData(actorData.skills[0]?.value ?? 45);

  const content = await renderTemplate(
    `modules/${MODULE_ID}/templates/fake-roll-dialog.hbs`,
    { ...actorData, ...(targetData ?? {}) }
  );

  if (foundry.applications?.api?.DialogV2) {
    await foundry.applications.api.DialogV2.wait({
      window:      { title: "🎲 GM: Verdeckter Würfelwurf" },
      content,
      rejectClose: false,
      render:  (_event, dialog) => attachDialogListeners(dialog.element),
      buttons: [
        {
          action:   "roll",
          label:    "Würfeln",
          icon:     "fas fa-dice-d20",
          default:  true,
          callback: (_event, _button, dialog) => handleSubmit(dialog.element),
        },
        {
          action: "cancel",
          label:  "Abbrechen",
          icon:   "fas fa-times",
        },
      ],
    });
  } else {
    new Dialog({
      title:   "🎲 GM: Verdeckter Würfelwurf",
      content,
      buttons: {
        roll:   { icon: '<i class="fas fa-dice-d20"></i>', label: "Würfeln",    callback: handleSubmit },
        cancel: { icon: '<i class="fas fa-times"></i>',   label: "Abbrechen" },
      },
      default: "roll",
      render:  (html) => attachDialogListeners(html[0]),
    }, { width: 420 }).render(true);
  }
}

// ============================================================
//  Toolbar-Button – FIX 1: nur onChange, kein onClick mehr
// ============================================================
Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;
  const tokenLayer = Array.isArray(controls)
    ? controls.find(c => c.name === "token")
    : controls.tokens;
  if (!tokenLayer) return;

  const entry = {
    name:     "gm-fake-roll",
    title:    "GM: Verdeckter Würfelwurf",
    icon:     "fas fa-user-secret",
    visible:   true,
    button:    true,
    onChange:  openFakeRollDialog,  // FIX: onClick entfernt
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
    name:     "GM Fake Roll öffnen",
    hint:     "Öffnet den Dialog für verdeckte WFRP4e-Würfe",
    editable: [{ key: "KeyR", modifiers: ["Shift"] }],
    onDown:   () => { openFakeRollDialog(); return true; },
  });

  game.gmFakeRoll = { open: openFakeRollDialog, roll: performFakeRoll };

  console.log(
    `%c${MODULE_ID} v4.2 | WFRP4e bereit. Shift+R zum Öffnen.`,
    "color:#7ec8e3; font-weight:bold;"
  );
});

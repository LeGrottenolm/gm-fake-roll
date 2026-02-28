// ============================================================
//  GM Fake Roll v5.0 – WFRP4e Native Test Hijack
//  Nutzt WFRP4e's eigenes Testsystem statt rohem Roll
// ============================================================
const MODULE_ID = "gm-fake-roll";

// ============================================================
//  Condition-Modifikatoren
// ============================================================
const CONDITION_MODIFIERS = {
  "fatigued":  -10, "exhausted": -20, "prone":   -20,
  "blinded":   -20, "deafened":  -10, "stunned": -10,
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
      id:      `char_${key}`,
      name:    `${label} (${base}${totalMod !== 0 ? ` ${modStr}` : ""} = ${Math.max(1, base + totalMod)})`,
      value:   Math.max(1, base + totalMod),
      type:    "characteristic",
      charKey: key,
      isMagic: false,
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
    .map(i => ({
      id:      i.id,
      name:    i.name,
      current: i.system?.SL?.current ?? 0,
      target:  i.system?.SL?.target  ?? 0,
    }));

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
// ============================================================
async function performFakeRoll(actor, itemId, itemType, desiredTotal, flavor, gmNote, isMagic) {

  if (gmNote) {
    console.log(
      `%c[GM Fake Roll | ${new Date().toLocaleTimeString()}] ${flavor || "–"} → ${gmNote}`,
      "color:#f4a460; font-style:italic;"
    );
  }

  if (isMagic && desiredTotal >= 96) {
    console.warn(
      `%c[GM Fake Roll | ⚠️ MISCAST] ${flavor || "Zauberwurf"} → W100: ${desiredTotal}`,
      "color:#ff6b6b; font-weight:bold;"
    );

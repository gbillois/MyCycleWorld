// Profils de matériel choisis dans le menu « Appareils » : filtres Bluetooth du sélecteur et textes.
//   zwift     : home trainer (FTMS ou Cycling Power) + manettes Zwift Play
//   technogym : vélos, elliptiques et rameurs Technogym (FTMS), reconnus aussi par leur nom
//   ble       : n'importe quelle machine Bluetooth standard (FTMS, Cycling Power)
// Module pur (testé dans tests/hardware.test.js).

const FTMS = 0x1826;
const CPS = 0x1818;

// Débuts de noms Bluetooth des machines Technogym. Vérifiés dans qdomyos-zwift (bluetooth.cpp) :
// « MYRUN » (tapis), « MYCYCLING » et « BIKE 1, BIKE 2… » (vélos), « TREADMILL » (Technogym Run).
// Supposés : « Technogym », « SKILL » (Skillrow, Skillbike), « EXCITE ».
// Ajoutés d'après qdomyos-zwift : « MYELLIPTICAL », « MYCYCLE », « RUN EXCITE », « Group Cycle ».
export const TECHNOGYM_NAME_PREFIXES = ['Technogym', 'TECHNOGYM', 'MYCYCLING', 'MYRUN', 'BIKE ', 'Treadmill', 'TREADMILL', 'Skill', 'SKILL', 'Excite', 'EXCITE', 'MYELLIPTICAL', 'MYCYCLE', 'RUN EXCITE', 'Group Cycle', 'GROUP CYCLE'];
// Identifiant Bluetooth SIG de Technogym SpA (0x026D), annoncé dans les données fabricant.
export const TECHNOGYM_COMPANY_ID = 0x026d;

export const HARDWARE = {
  zwift: {
    id: 'zwift',
    label: 'Zwift',
    machine: 'home trainer',
    connectLabel: 'Connecter le home trainer',
    filters: [{ services: [FTMS] }, { services: [CPS] }],
    hint: 'Home trainer connecté (Wahoo, Tacx, Elite, Zwift Hub…) et manettes Zwift Play.',
  },
  technogym: {
    id: 'technogym',
    label: 'Technogym',
    machine: 'machine Technogym',
    connectLabel: 'Connecter la machine Technogym',
    filters: [
      { services: [FTMS] },
      { services: [CPS] },
      { manufacturerData: [{ companyIdentifier: TECHNOGYM_COMPANY_ID }] },
      ...TECHNOGYM_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
    ],
    hint: 'Vélo, elliptique ou rameur Technogym. Sur la console, connecte-toi (compte mywellness si demandé) et active le Bluetooth vers les applis. Le rameur se réveille quand on tire la poignée ; si rien n’arrive, démarre une séance libre.',
  },
  ble: {
    id: 'ble',
    label: 'BLE standard',
    machine: 'machine Bluetooth',
    connectLabel: 'Connecter une machine Bluetooth',
    filters: [{ services: [FTMS] }, { services: [CPS] }],
    hint: 'Toute machine Bluetooth standard : FTMS (vélo, elliptique, rameur) ou capteur de puissance.',
  },
};

export const HARDWARE_ORDER = ['zwift', 'technogym', 'ble'];

export function hardwareById(id) {
  return HARDWARE[id] || HARDWARE.zwift;
}

// Le nom annoncé ressemble-t-il à une machine Technogym ?
export function looksTechnogym(name = '') {
  return TECHNOGYM_NAME_PREFIXES.some((p) => name.startsWith(p));
}

// Cardio : montres et ceintures qui n'annoncent pas toujours le service cardio avant la connexion
// (montres Garmin en « diffusion FC », Polar, Wahoo TICKR, COROS, Suunto…). Valable dans tous les profils.
export const HEART_RATE_NAME_PREFIXES = ['Forerunner', 'fenix', 'Fenix', 'FENIX', 'Venu', 'vivoactive', 'vívoactive', 'Epix', 'epix', 'Instinct', 'Enduro', 'Garmin', 'HRM', 'Polar', 'TICKR', 'Wahoo TICKR', 'COROS', 'Suunto', 'WHOOP', 'Scosche', 'RHYTHM', 'Coospo', 'CooSpo', 'Magene', 'XOSS', 'Decathlon'];

export function looksHeartRate(name = '') {
  return HEART_RATE_NAME_PREFIXES.some((p) => name.startsWith(p));
}

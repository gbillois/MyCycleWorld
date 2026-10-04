# MyCycleWorld

Un jeu de course façon kart sur un vrai vélo : home trainer connecté, ceinture cardio et manettes Zwift Play, directement dans le navigateur (Web Bluetooth : Chrome ou Edge sur PC/Mac/Android, l'appli gratuite [Bluefy](https://apps.apple.com/app/bluefy-web-ble-browser/id1492822055) sur iPad).

**Site : https://gbillois.github.io/MyCycleWorld/**

- `index.html` : guide pas à pas pour tout connecter, version PC Windows ou iPad (avec vérification automatique de l'appareil)
- `diag/` : page de diagnostic du matériel (`?demo=1` pour des appareils simulés)
- `src/ble/` : modules Bluetooth réutilisables
  - `trainer.js` : home trainer FTMS (puissance, cadence, vitesse, pente, ERG) avec repli sur Cycling Power
  - `heart-rate.js` : ceinture cardio standard
  - `zwift.js` : manettes Zwift Play (firmware 1.x et 2.x), Zwift Click et Zwift Ride
  - `mock.js` : appareils simulés pour développer sans vélo
- `src/core/` : vitesses virtuelles (`gears.js`) et boutons des manettes transformés en touches clavier (`keymap.js`)

## Développer

Aucun build. Servir le dossier en local (le Bluetooth exige https ou localhost) :

```sh
npx http-server -p 8080 -c-1
# puis http://localhost:8080/diag/?demo=1
node --test tests/*.test.js
```

## Vitesses virtuelles

Le vélo reste sur un seul pignon réel. Chaque vitesse virtuelle décale la pente envoyée au trainer en mode simulation FTMS :
`pente envoyée = pente du terrain × difficulté + (vitesse − 12) × pas`.

## Crédits

Le protocole des manettes Zwift n'est pas documenté officiellement. Les informations de protocole viennent du travail de rétro-ingénierie de la communauté :
[SwiftControl / BikeControl](https://github.com/jonasbark/swiftcontrol) (Jonas Bark),
[zwiftplay](https://github.com/ajchellew/zwiftplay) (ajchellew) et le blog de Makinolo.
Le code de ce dépôt est une implémentation originale (aucun code copié). Pour FTMS et l'approche des vitesses virtuelles : [qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) et [Auuki](https://github.com/dvmarinoff/Auuki) comme références.

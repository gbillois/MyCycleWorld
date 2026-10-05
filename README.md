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
- `src/core/steering.js` : direction réaliste du vélo (il s'incline, tourne puis se redresse ; inclinaison naturelle dans les virages)
- `game/` : le jeu 3D. Écran titre façon jeu (navigable au clavier et aux manettes Zwift), graphismes **détaillés** (`scenery.js`, `rider.js` : ombres, ciel peint, lac, village, prairies) ou **simples** (style d'origine, plus léger), au choix dans Options. `?quality=high|medium|low` force le niveau de détail. Trois circuits (`courses.js`) : **Vallée Verte** (lac, village, ferme et animaux), **Col des Chalets** (grandes montées et descentes, village de chalets) et **Côte des Dunes** (passerelle en bois puis route de sable, plus dure à pédaler : résistance au roulement en jeu et pente équivalente envoyée au trainer). `?course=vallee|col|plage` choisit le circuit, `?laps=` le nombre de tours. Menu : **Jouer** puis Vélo, Elliptique ou Rameur, puis le niveau (miniatures). **Options** contient une page de connexion par matériel : **Zwift** (home trainer + manettes Zwift Play), **Technogym** (vélo, elliptique, rameur ; filtres par nom et identifiant fabricant 0x026D, d'après qdomyos-zwift et TrackMyIndoorWorkout) et **Bluetooth standard**, chacune avec un test de connexion, une console Bluetooth, le test du pilotage et un **inspecteur BLE** (`src/ble/inspector.js`) qui enregistre les octets bruts de toutes les caractéristiques d'une machine non standard (journal téléchargeable). FTMS : Indoor Bike Data, Rower Data et Cross Trainer Data sont décodés (`src/ble/trainer.js`) ; sur elliptique et rameur, la pente devient un niveau de résistance. **Pilote automatique** (Options > Direction) pour les machines sans boutons : le vélo suit la route, prend les boîtes, évite les bananes et utilise les objets. **Mode rameur** (`src/core/rowing.js`, `game/rowing-scene.js`) : bassin d'aviron de 500 m ou 1 000 m, 5 adversaires, vitesse tirée de la puissance comme sur un ergomètre (P = 2.8 v³). `?demo=1` simule aussi un rameur et un elliptique Technogym.

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

## Application native iPhone / iPad

Le port SwiftUI + CoreBluetooth se trouve dans [`ios/`](ios/README.md). Ouvrir `ios/MyCycleWorld.xcodeproj` dans Xcode. L'onglet **Jeu** affiche le jeu web branché sur le Bluetooth natif de l'appli ; le cockpit inclut un mode démo et le guide de livraison TestFlight est dans le README iOS. L'onglet **Appareils** reprend les profils du jeu (Zwift, Technogym, BLE standard), décode aussi les elliptiques et rameurs FTMS (la pente du jeu y devient un niveau de résistance) et propose le test de connexion, la console Bluetooth partageable et un inspecteur BLE natif. Le pont (`game/native.js`, protocole 1 révision 1) transmet au jeu le type de machine, la cadence de coups, l'allure, la distance et le profil choisi.

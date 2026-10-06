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
- `game/` : le jeu 3D. Écran titre façon jeu (navigable au clavier et aux manettes Zwift), graphismes **détaillés** (`scenery.js`, `rider.js` : ombres, ciel peint, lac, village, prairies) ou **simples** (style d'origine, plus léger), au choix dans Options. `?quality=high|medium|low` force le niveau de détail. Graphismes détaillés : ciel, brume et ambiance par thème, terrain texturé, forêts et herbe animées par le vent avec niveaux de détail (`atmosphere.js`, `nature.js`), eau réfléchissante (`water.js`), post-traitement filmique (`post.js`), bâtiments stylisés (`buildings.js`, `architecture.js`, `building-textures.js` : maisons de campagne, ferme, chalets à balcons sculptés, église à bulbe, fontaine et café, cabines de plage, poste de secours, hangar à bateaux, tribune, portiques, passerelle de corde ; textures de matières peintes dans un Worker, occlusion cuite, fumées de cheminée, détails masqués au loin), cyclistes et rameurs animés par squelette (`figure.js`, `rider.js`, `boat.js`). Fluidité : 60 images/s au plus et résolution adaptative (`src/core/framerate.js`) ; `?fps=1` affiche le compteur, `?fixedres=1` fige la résolution (captures). Trois circuits (`courses.js`) : **Vallée Verte** (lac, village, ferme et animaux), **Col des Chalets** (grandes montées et descentes, village de chalets) et **Côte des Dunes** (passerelle en bois puis route de sable, plus dure à pédaler : résistance au roulement en jeu et pente équivalente envoyée au trainer). `?course=vallee|col|plage` choisit le circuit, `?laps=` le nombre de tours. Menu : **Jouer** puis Vélo, Elliptique ou Rameur, puis le niveau (miniatures). **Options** contient une page de connexion par matériel : **Zwift** (home trainer + manettes Zwift Play), **Technogym** (vélo, elliptique, rameur ; filtres par nom et identifiant fabricant 0x026D, d'après qdomyos-zwift et TrackMyIndoorWorkout) et **Bluetooth standard**, chacune avec un test de connexion, une console Bluetooth, le test du pilotage et un **inspecteur BLE** (`src/ble/inspector.js`) qui enregistre les octets bruts de toutes les caractéristiques d'une machine non standard (journal téléchargeable). FTMS : Indoor Bike Data, Rower Data et Cross Trainer Data sont décodés (`src/ble/trainer.js`) ; sur elliptique et rameur, la pente devient un niveau de résistance. **Pilote automatique** (Options > Direction) pour les machines sans boutons : le vélo suit la route, prend les boîtes, évite les bananes et utilise les objets. **Mode rameur** (`src/core/rowing.js`, `game/rowing-scene.js`) : bassin d'aviron de 500 m ou 1 000 m, 5 adversaires, vitesse tirée de la puissance comme sur un ergomètre (P = 2.8 v³). **Kayak cross** (Jouer > Rameur, `src/core/kayak.js`, `game/rivers.js`, `game/kayak-scene.js`, `game/kayak.js`, `game/kayak-mode.js`) : descente de rivière sinueuse (Rivière des Gorges, Rapides du Torrent) avec courant, rapides en eau blanche, falaises, rochers et cinq adversaires ; kayak plus petit et kayakiste animé (pagaie double, coups alternés au rythme des coups de rame), vitesse 18 % au-dessus de la formule de l'aviron à puissance égale. Portes de slalom (+2 s par porte manquée), **portes sprint** annoncées en coups environ 15 s avant, effort jugé sur les meilleurs coups de la zone par rapport à la médiane de ses propres coups de la dernière minute (+12 % au rameur, +25 % ailleurs ; ralenti doux, passage normal ou turbo selon la marge), **porte glisse** sous une passerelle basse (arrêter de ramer), objets turbo, tourbillon et bouclier. Le pilote automatique suit les portes et vise les boîtes ; ← → reprennent la main ; sans machine, Maj + ↑ (ou tapoter plus vite) pour sprinter. `?demo=1` simule aussi un rameur et un elliptique Technogym.

## Son

Tout le son est synthétisé dans le navigateur (`game/audio/`, Web Audio), sans aucun fichier audio ni bibliothèque. Les sons ponctuels sont calculés dans un Worker (`render-worker.js`, repli sur le fil principal sans Worker module) puis joués comme échantillons ; les nappes et les sons du joueur sont des nœuds Web Audio modulés à chaque image (aucun nœud créé par image).

- **Démarrage** : un seul `AudioContext`, créé au premier geste (clic, touche, `touchend` pour iOS et la WKWebView de l'appli). Rien ne joue avant. Suspendu quand la page est cachée, quand le son est coupé ou le volume général à 0 ; reprise automatique après une interruption iOS. Sur iOS 17+, `navigator.audioSession.type = 'ambient'` : la musique de l'utilisateur (podcast, playlist) continue.
- **Options > Son** : coupure générale (touche **M** au clavier) et cinq curseurs indépendants, enregistrés dans `localStorage` (`mycycleworld.audio`) : général 80 %, musique 50 %, ambiance 70 %, effets 80 %, interface 60 %. Souris, doigt, ou ← → au clavier et aux manettes (▲ ▼ changent de ligne).
- **Mixage** (`engine.js`) : bus musique, ambiance, effets, interface ; ambiance et effets passent par le « monde » (passe-bas et atténuation pendant la pause) et par une réverbération à réponse impulsionnelle générée par décor (échos de vallée au Col des Chalets) ; compresseur, limiteur et écrêteur doux en sortie (crête < 1). Sources 3D (HRTF en qualité haute sur ordinateur, panoramique simple ailleurs), écoute qui suit la caméra, 36 voix au plus, sources lointaines débranchées.
- **Ambiances** (`ambience.js`, `spots.js` pour les emplacements tirés du décor) :
  - Vallée Verte : vent léger et feuillage, criquets et grillons, merle, pinson, rouge-gorge, mésange, hirondelle, alouette, coucou au loin, bourdon qui passe ; à la ferme : vaches, moutons qui se répondent, chevaux, coq.
  - Col des Chalets : vent en rafales qui siffle, chocards, marmottes et rapace avec l'écho des parois, torrent au fond du vallon, sonnailles des trois troupeaux (douze cloches différentes, vaches qui broutent ou marchent), volée de la cloche de l'église en arrivant au village puis quelques coups, fontaine.
  - Côte des Dunes : vagues qui déferlent par cycles irréguliers le long du rivage (montée, éclatement, écume qui se retire), grondement de la mer plus fort près de la plage, goélands, cigales dans les dunes, brouhaha de la plage, vent du large ; lattes de la passerelle et sable sous les roues.
  - Lac (rameur) : clapotis, roseaux, rousserolles, foulques, canards près des berges, coucou au loin, tribune d'arrivée qui s'anime quand la tête de course approche.
  - Rivière (kayak) : rapides, grondement de l'eau vive, gerbes, cincle plongeur.
  - Spectateurs au départ et dans les montées : brouhaha, cris et « allez ! » scandés, sifflets et applaudissements qui enflent au passage du coureur, clameur à l'arrivée.
- **Joueur** (`player.js`) : roulement selon le revêtement (chuintement de l'asphalte, craquements dans l'herbe, résonance creuse et claquement des lattes de la passerelle, souffle mou du sable), roue libre qui cliquette quand on arrête de pédaler, transmission rythmée par la cadence, vent qui monte avec la vitesse, souffle de l'effort dans les côtes, turbo, changement de vitesse. Rameur : éclaboussures à l'attaque, glouglou de la propulsion, dégagé et gouttes, dame de nage, siège qui coulisse, eau sous la coque, synchronisés sur la phase du coup d'aviron. Adversaires proches : pneus et chaîne, coups d'aviron, dépassements.
- **Effets du jeu** : bips 3-2-1 et corne de départ, roulette de la boîte à objet, turbo, banane posée et glissade, souffle de dépassement, carillon de tour, jingle du dernier tour, fanfare d'arrivée, jingle des résultats (victoire, podium ou arrivée), sons du menu (focus, validation, retour, ouverture d'écran).
- **Musique** (`music-gen.js`, `music.js`) : chaque niveau tire de sa graine sa tonalité, son tempo et sa grille (indie à la guitare en prairie, cloches aériennes en montagne, marimba tropical sur la côte, électro qui pousse au lac) ; thème calme au menu. Programmateur en avance sur l'horloge audio (25 ms, 100 ms d'avance). Les couches suivent l'effort et la course (batterie au sprint, au turbo et au dernier tour) et le filtre s'ouvre avec la vitesse.

### Brancher un autre mode (kayak)

```js
audio.update({ dt, mode: 'kayak', state, camera, player: { speed } }); // ambiance rivière, eau sous la coque
audio.sfx('paddle', { side: 'left' });   // coup de pagaie gauche ou droite (side: 'right')
audio.sfx('gate-pass');                  // porte franchie
audio.sfx('gate-miss');                  // porte manquée
audio.sfx('sprint-gate');                // porte de sprint réussie
audio.sfx('sprint-fail');                // sprint raté
const w = audio.sfx('whirlpool', { duration: 3 }); // tourbillon (w.stop() pour l'arrêter plus tôt)
audio.setScene('river');                 // décor d'ambiance d'un mode autre que vélo / rameur (null pour rendre la main)
```

Options communes de `sfx(nom, options)` : `gain`, `rate`, `pan`, `pos: { x, y, z }` (source 3D), `when`, `bus`. Autres noms : `beep`, `go`, `horn`, `whistle`, `pickup`, `turbo`, `banana`, `skid`, `bump`, `whoosh`, `lap`, `final-lap`, `fanfare`, `win`, `podium`, `finish-other`, `gear`, `splash`, `kayak-splash`, `cow`, `sheep`, `duck`, `gull`, `church-bell`.

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

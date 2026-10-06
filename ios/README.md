# MyCycleWorld pour iPhone et iPad

Application **SwiftUI + CoreBluetooth**, iOS/iPadOS 17 minimum. L'appli s'ouvre sur le jeu 3D publié sur GitHub Pages, en plein écran dans une WebView reliée au Bluetooth natif. Le cockpit et les connexions Bluetooth sont natifs et s'ouvrent depuis les Options du jeu. Aucun serveur applicatif ni dépendance Swift externe. Internet est nécessaire pour charger le jeu.

Ouvrir `MyCycleWorld.xcodeproj`, choisir le scheme **MyCycleWorld**, puis un iPhone/iPad ou un simulateur. Le Bluetooth doit être testé sur un appareil physique ; le **mode démo** (Options du jeu > Réglages de l'appli) permet de tester le cockpit sur simulateur. L’argument de lancement `--demo` l’active directement.

## Jeu et réglages de l'appli

L'appli s'ouvre directement sur le jeu web (`game/`) en plein écran, sans barre d'onglets : la WebView occupe tout l'écran et la page gère les zones sûres (`viewport-fit=cover`). Elle est branchée sur le Bluetooth de l'appli : les mesures du trainer, de la ceinture et des manettes viennent du cockpit natif, jamais de Web Bluetooth (absent des WebView iOS).

Les écrans natifs s'ouvrent depuis les **Options** du jeu, dans une feuille par-dessus la partie (bouton « Fermer » ou glisser vers le bas) : la WebView reste chargée, rien ne se recharge et les connexions Bluetooth restent ouvertes. « Connecter Zwift / Technogym / Bluetooth standard » choisit ce profil et ouvre **Appareils** (recherche, connexion, test de connexion, console Bluetooth, inspecteur BLE) ; « Réglages de l'appli » ouvre l'accueil des réglages (Appareils, Cockpit, Journal Bluetooth, Inspecteur BLE, mode démo, confidentialité, version). Code : `ContentView.swift` (`NativeRouter`, `AppSettingsView`).

- Le jeu est chargé depuis le site publié (`https://gbillois.github.io/MyCycleWorld/game/`) : une mise à jour du jeu arrive dans l'appli sans nouveau build. Internet est nécessaire (le jeu charge aussi Three.js depuis un CDN). Sans connexion, un écran propose de réessayer.
- Pont : `GameView.swift` (WebView, état envoyé 4 fois par seconde et à chaque changement de vitesse) et `Core/GameBridge.swift` (décodage des ordres, JSON de l'état, testé dans `Tests/GameBridgeTests.swift`). Côté web : `game/native.js`, protocole version 1 décrit en tête du fichier. La **révision 1** (`minor: 1`) ajoute des champs facultatifs, ignorés par un jeu plus ancien : `hardware` (zwift, technogym, ble), `machineKind` (bike, cross, rower, treadmill, power), `strokeRate`, `strokeCount`, `distance`, `pace` (s/500 m), `stepRate` et `resistance`. Sans `machineKind`, le jeu suppose un vélo. La **révision 2** (`minor: 2`) ajoute `capabilities` dans l'état (`["openNative"]`) et la commande `openNative { screen, profile? }` (screen : settings, devices, cockpit, inspector, log ; écran inconnu = accueil des réglages ; profil inconnu ignoré). Compatibilité : une appli plus ancienne n'annonce rien et le jeu garde sa page « Connecter » ; une page plus ancienne (révision < 2, ou muette 10 s après le chargement) fait apparaître un bouton natif ⚙ en haut à droite pour garder les réglages accessibles. Seule la page principale de gbillois.github.io peut envoyer des ordres.
- Le jeu envoie la **pente du terrain avant vitesses virtuelles** ; l'appli applique ses propres vitesses (les boutons latéraux des manettes passent par l'appli et la vitesse s'affiche dans le jeu). Sur un elliptique ou un rameur (pas de mode simulation), l'appli convertit la pente ressentie en **niveau de résistance** comme le jeu web : t = (pente + 4) / 16 borné à [0, 1], niveau = min + (max − min) × (0,15 + 0,7 t), avec la plage publiée par la machine (0 à 20 sinon), seulement si la machine accepte une consigne de résistance. Les autres boutons des manettes deviennent des touches du jeu (◀ ▶ pour se déplacer, etc.).
- « Jouer » prend le contrôle du trainer ; en pause ou à l'accueil, il repasse à plat. Si le contrôle est perdu en course, relancer « Jouer » ou utiliser « Prendre le contrôle » dans le cockpit.
- Seule la page du jeu publiée peut envoyer des ordres au Bluetooth (origine vérifiée), et seuls cinq ordres sont acceptés, avec valeurs bornées.
- Mode démo de l'appli : le jeu utilise les mesures simulées.
- Limite connue : le jeu n'est pas embarqué dans l'appli, il faut donc du réseau au lancement.

## Fonctions portées

- **Profils de matériel** (écran Appareils, comme dans le jeu web) : **Zwift** (home trainer FTMS ou Cycling Power et manettes Zwift), **Technogym** (vélo, elliptique, rameur ; reconnus aussi sans service annoncé, par l'identifiant fabricant 0x026D ou le nom : MYCYCLING, MYRUN, BIKE n, TREADMILL, SKILL…) et **BLE standard** (toute machine FTMS ou Cycling Power). Le profil filtre la liste et adapte les textes ; il est transmis au jeu.
- Recherche BLE au premier plan pendant 30 secondes, sélection explicite du rôle, déconnexion et reconnexion manuelle. Un trainer, une ceinture et plusieurs manettes simultanées.
- FTMS Indoor Bike Data, **Rower Data** (cadence de coups en 0,5 coup/min, nombre de coups, distance, allure s/500 m, puissance, résistance, cardio…) et **Cross Trainer Data** (drapeaux sur 24 bits, vitesse, distance, pas/min, résistance, puissance…). Type de machine détecté selon la caractéristique présente (vélo, rameur, elliptique, tapis, capteur de puissance). Rameur sans puissance : estimée depuis l'allure (P = 2,8 / (allure/500)³) ; elliptique : cadence = pas/min ÷ 2. Décodeurs identiques au web (`Core/BLEProtocol.swift`, `Core/Machine.swift`, mêmes vecteurs que `tests/rowing.test.js` dans `Tests/MachineTests.swift`). Repli Cycling Power pour puissance/cadence ; gestion du bouclage des compteurs et mesures périmées.
- Prise de contrôle refusée ou sans réponse (fréquent sur Technogym) : la machine reste lue en **lecture seule**, sans déconnexion. Niveau de résistance codé sur un octet (FTMS 1.0, comme le web), deux octets si la valeur dépasse 25,5 ou si la machine refuse la forme courte.
- **Test de connexion** (Appareils) : type de machine, services, paquets reçus et âge du dernier, mesures en direct, pilotage possible ou non, bouton « Tester le pilotage » (vélo : pente 6 % pendant 5 s puis 0 ; elliptique/rameur : résistance 70 % puis 30 %). **Console Bluetooth** défilante, copiable et partageable.
- **Inspecteur BLE natif** (Appareils > Inspecteur BLE) : recherche de tous les appareils sans filtre, connexion, découverte de tous les services (y compris propriétaires, CoreBluetooth n'a pas besoin de liste), lecture de chaque caractéristique lisible (hex + ASCII), abonnement à chaque notify/indicate avec octets bruts (30 premiers paquets puis 1 sur 20), journal copiable et partageable.
- Heart Rate : formats 8/16 bits, contact peau et batterie. La ceinture choisie est prioritaire sur le cardio du trainer.
- FTMS : découverte des fonctions/plages, prise de contrôle, démarrage, pente, ERG, résistance et arrêt. Une seule commande en vol, attente de l’acquittement GATT **et** de la réponse FTMS, abandon des consignes obsolètes et déconnexion en cas de délai dépassé. Aucun pilotage automatique à la connexion.
- Vitesses virtuelles 1–24, neutre 12, décalage de pente de 1 % par vitesse, pente finale bornée à −10/+20 %. Les vitesses ne s’appliquent qu’en mode simulation.
- Zwift Play fw1, Ride/Play fw2 et Click : RideOn après abonnement aux deux canaux, boutons, palettes, batterie et vibration. Les boutons latéraux changent les vitesses ; les autres restent disponibles au diagnostic (pas d’émulation de clavier système iOS).
- Cockpit adaptatif iPhone/iPad, courbe des deux dernières minutes, démo, journal partageable manuellement. Pas d’enregistrement de séance persistant.

Le protocole Zwift est un port du protocole communautaire déjà implémenté dans `src/ble/zwift.js`, avec les mêmes limites de firmware. Aucun chiffrement Zwift propriétaire supplémentaire n’est implémenté. La compatibilité réelle doit être vérifiée avec chaque modèle/firmware.

Le pilotage se fait au premier plan. Pas de restauration Bluetooth en arrière-plan ni de reconnexion automatique avec reprise de résistance. Le bouton Arrêter envoie la commande FTMS Stop ; il ne remplace pas l’arrêt matériel du trainer.

## Tests

Depuis la racine du dépôt :

```sh
node --test tests/*.test.js
swift test --package-path ios --scratch-path /tmp/mycycleworld-swift-tests
xcodebuild -project ios/MyCycleWorld.xcodeproj -scheme MyCycleWorld \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/mycycleworld-simulator CODE_SIGNING_ALLOWED=NO build
```

Les 48 tests Swift couvrent les protocoles Bluetooth (dont rameur et elliptique FTMS), la fusion des mesures, la pente convertie en résistance, les profils de matériel, les files de commandes et le pont du jeu (ordres, bornes, JSON et boutons). Les 74 tests JavaScript couvrent aussi le côté web du pont. Ils ne remplacent pas le test radio sur iPhone/iPad.

Xcode Cloud exécute les tests Swift avec `ci_scripts/ci_post_clone.sh` avant chaque archive. Un échec bloque la livraison TestFlight. Pour reproduire cette étape localement : `./ios/ci_scripts/ci_post_clone.sh`.

Les scripts `scripts/generate-project.py` et `scripts/generate-icon.swift` permettent de régénérer le projet et l’icône sans installation d’outils supplémentaires. Le `.xcodeproj` est déjà livré : aucune génération n’est nécessaire pour l’ouvrir. Si tu changes l’équipe ou le Bundle ID dans Xcode, adapte aussi le générateur et ExportOptions avant une régénération/export en ligne de commande.

## Livraison TestFlight

Configuration initiale : **com.gbillois.MyCycleWorld**, version **1.0**, build **1**, équipe **JQ4Z5PXR5K** (identifiant trouvé dans le certificat Apple Development local). Ce Bundle ID reste à enregistrer/vérifier dans ton compte Apple.

1. Dans **Xcode → Settings → Accounts**, connecter le compte membre de l’Apple Developer Program. Un certificat local seul ne suffit pas. Dans le projet, **Signing & Capabilities**, choisir la bonne équipe et laisser **Automatically manage signing** activé.
2. Dans [App Store Connect](https://appstoreconnect.apple.com/), créer la fiche iOS **MyCycleWorld**, langue principale français, Bundle ID identique au projet, SKU par exemple `mycycleworld-ios`. Si le nom est déjà pris, choisir un nom disponible. Enregistrer d’abord l’identifiant explicite dans Certificates, Identifiers & Profiles si nécessaire.
3. Vérifier l’application sur un appareil réel avec la courte recette ci-dessous.
4. Sélectionner **Any iOS Device (arm64)** puis **Product → Archive**, ou lancer :

   ```sh
   ./ios/scripts/archive.sh
   # Pour une autre configuration :
   TEAM_ID=TON_EQUIPE BUNDLE_ID=ton.identifiant BUILD_NUMBER=2 ./ios/scripts/archive.sh
   ```

5. Dans Organizer : **Distribute App → App Store Connect → Upload**. Laisser Xcode gérer la signature. L’archive doit être signée ; une archive compilée avec `CODE_SIGNING_ALLOWED=NO` n’est pas distribuable.
6. Attendre le traitement Apple, puis ouvrir **App Store Connect → MyCycleWorld → TestFlight** et affecter le build à un groupe de testeurs internes. Installer avec TestFlight sur iPhone/iPad.

Alternative pour envoyer une archive signée (après avoir vérifié l’équipe dans `ExportOptions.plist`) :

```sh
xcodebuild -exportArchive -archivePath ios/build/MyCycleWorld.xcarchive \
  -exportOptionsPlist ios/ExportOptions.plist -exportPath ios/build/export \
  -allowProvisioningUpdates
```

Pour chaque nouvel envoi, incrémenter le numéro de build. Le manifeste de confidentialité indique aucune collecte ni tracking ; les mesures restent uniquement en mémoire. `ITSAppUsesNonExemptEncryption=false` correspond à cette application sans chiffrement propriétaire.

Pour tester ce soir, privilégier ton propre compte comme testeur interne. Le traitement Apple reste nécessaire ; le premier build destiné aux testeurs externes passe par TestFlight App Review et son délai ne peut pas être garanti.

Sources Apple : [envoi des builds](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/), [testeurs internes](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/), [TestFlight](https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/).

### Livraison automatique

Le workflow Xcode Cloud **main vers TestFlight** archive l'app à chaque `push` sur `main` et la distribue au groupe interne **MyCycleGroup**. Configuration et suivi : [`XCODE_CLOUD.md`](XCODE_CLOUD.md). Le délai dépend de la compilation et du traitement Apple.

### Recette sur appareil réel

Jeu : voir en plus les contrôles ci-dessous.

- Lancer l'appli avec Internet coupé : l'écran d'erreur apparaît, avec « Réglages de l'appli » ; avec Internet, « Réessayer » charge le jeu.
- Options du jeu > « Connecter Technogym » : l'écran Appareils s'ouvre en profil Technogym ; « Fermer » ramène au jeu au même endroit, sans rechargement, appareils toujours connectés. « Réglages de l'appli » ouvre l'accueil des réglages.
- Connecter trainer, ceinture et manettes dans Appareils, revenir dans Jeu : l'accueil affiche leur état.
- Lancer une course : les watts, la cadence et le cardio du jeu suivent ceux du cockpit ; la résistance monte dans la côte et redescend à plat en pause.
- Changer de vitesse avec un bouton latéral de manette et avec les boutons +/− du jeu : une seule vitesse à la fois, identique dans le jeu et dans le cockpit.
- ◀ ▶ des manettes déplacent le cycliste ; une peau de banane touchée fait vibrer les manettes.
- Couper une manette en course : le cycliste ne reste pas bloqué d'un côté.

- Refuser puis autoriser le Bluetooth dans Réglages ; vérifier le message affiché et relancer la recherche.
- Connecter le trainer, puis la ceinture et chaque manette. Vérifier watts/cadence/vitesse/cardio et l’absence de données figées après coupure.
- Prendre le contrôle, appliquer une petite pente, changer une vitesse, tester un ERG modéré puis Arrêter. Vérifier la confirmation dans le journal et la réaction réelle du trainer.
- Vérifier un appui puis relâchement de chaque bouton Zwift, les vitesses et la vibration. Couper/rallumer une manette et la reconnecter.
- Couper le trainer pendant une commande ; vérifier que la file est annulée et que la reconnexion exige une nouvelle prise de contrôle.
- Vérifier portrait/paysage sur iPhone et iPad, puis installer le même build via TestFlight.

### Texte pour TestFlight

**Description bêta** : Cockpit vélo natif pour home trainer FTMS, ceinture cardio Bluetooth et manettes Zwift. Affichage puissance, cadence, vitesse et cardio ; pilotage pente/ERG/résistance et vitesses virtuelles. Mode démo inclus sans matériel.

**À tester** : Connexion et reconnexion des appareils, exactitude des mesures, confirmation des commandes FTMS, boutons/manettes et comportement des vitesses virtuelles. Préciser modèle et firmware avec tout signalement et joindre le journal via Options du jeu → Réglages de l'appli → Journal Bluetooth → Partager.

**Notes pour la revue** : Aucun compte de connexion requis. Pour explorer sans matériel : Appareils → Mode démo. Les commandes sont alors simulées. Pour les mesures réelles, un périphérique Bluetooth compatible est nécessaire. Aucune donnée n’est envoyée à un serveur.

## Validation locale du 4 octobre 2026

Voir `VALIDATION.md` pour les résultats et limites constatés sur cette machine, et [`REFERENCES.md`](REFERENCES.md) pour la comparaison des dépôts et les corrections qui en découlent.

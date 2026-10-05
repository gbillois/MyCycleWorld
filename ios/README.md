# MyCycleWorld pour iPhone et iPad

Application native **SwiftUI + CoreBluetooth**, iOS/iPadOS 17 minimum. Aucune dépendance externe, aucun serveur et aucune WebView. Le site web existant reste indépendant.

Ouvrir `MyCycleWorld.xcodeproj`, choisir le scheme **MyCycleWorld**, puis un iPhone/iPad ou un simulateur. Le Bluetooth doit être testé sur un appareil physique ; le **mode démo** permet de tester le cockpit sur simulateur. L’argument de lancement `--demo` l’active directement.

## Onglet Jeu

L'onglet **Jeu** affiche le jeu web (`game/`) dans une WebView et le branche sur le Bluetooth de l'appli : les mesures du trainer, de la ceinture et des manettes viennent du cockpit natif, jamais de Web Bluetooth (absent des WebView iOS). On connecte donc les appareils dans l'onglet **Appareils**, puis on joue.

- Le jeu est chargé depuis le site publié (`https://gbillois.github.io/MyCycleWorld/game/`) : une mise à jour du jeu arrive dans l'appli sans nouveau build. Internet est nécessaire (le jeu charge aussi Three.js depuis un CDN). Sans connexion, un écran propose de réessayer.
- Pont : `GameView.swift` (WebView, état envoyé 4 fois par seconde et à chaque changement de vitesse) et `Core/GameBridge.swift` (décodage des ordres, JSON de l'état, testé dans `Tests/GameBridgeTests.swift`). Côté web : `game/native.js`, protocole version 1 décrit en tête du fichier.
- Le jeu envoie la **pente du terrain avant vitesses virtuelles** ; l'appli applique ses propres vitesses (les boutons latéraux des manettes passent par l'appli et la vitesse s'affiche dans le jeu). Les autres boutons des manettes deviennent des touches du jeu (◀ ▶ pour se déplacer, etc.).
- « Jouer » prend le contrôle du trainer ; en pause, à l'accueil ou en quittant l'onglet, il repasse à plat. Si le contrôle est perdu en course, relancer « Jouer » ou utiliser « Prendre le contrôle » dans le cockpit.
- Seule la page du jeu publiée peut envoyer des ordres au Bluetooth (origine vérifiée), et seuls cinq ordres sont acceptés, avec valeurs bornées.
- Mode démo de l'appli : le jeu utilise les mesures simulées.
- Limite connue : le jeu n'est pas embarqué dans l'appli, il faut donc du réseau au lancement.

## Fonctions portées

- Recherche BLE au premier plan pendant 30 secondes, sélection explicite du rôle, déconnexion et reconnexion manuelle. Un trainer, une ceinture et plusieurs manettes simultanées.
- FTMS Indoor Bike Data : puissance, vitesse, cadence, résistance et cardio intégré. Repli Cycling Power pour puissance/cadence ; gestion du bouclage des compteurs et mesures périmées.
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

Les 16 tests Swift couvrent la gestion des écritures Zwift quand le lien est occupé, l’identification des modèles, les trames de référence JS, paquets tronqués, varints malformés, cadence, vitesses, commandes FTMS et ordre des acquittements. Ils ne remplacent pas le test radio sur iPhone/iPad.

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

Pour que chaque `push` sur `main` qui touche `ios/` parte tout seul sur TestFlight, voir [`XCODE_CLOUD.md`](XCODE_CLOUD.md) (réglage unique dans Xcode, dont le numéro de build à fixer avant le premier build cloud).

### Recette sur appareil réel

Jeu (onglet Jeu) : voir en plus les contrôles ci-dessous.

- Ouvrir l'onglet Jeu avec Internet coupé : l'écran d'erreur apparaît ; avec Internet, « Réessayer » charge le jeu.
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

**À tester** : Connexion et reconnexion des appareils, exactitude des mesures, confirmation des commandes FTMS, boutons/manettes et comportement des vitesses virtuelles. Préciser modèle et firmware avec tout signalement et joindre le journal via Diagnostic → Partager.

**Notes pour la revue** : Aucun compte de connexion requis. Pour explorer sans matériel : Appareils → Mode démo. Les commandes sont alors simulées. Pour les mesures réelles, un périphérique Bluetooth compatible est nécessaire. Aucune donnée n’est envoyée à un serveur.

## Validation locale du 4 octobre 2026

Voir `VALIDATION.md` pour les résultats et limites constatés sur cette machine, et [`REFERENCES.md`](REFERENCES.md) pour la comparaison des dépôts et les corrections qui en découlent.

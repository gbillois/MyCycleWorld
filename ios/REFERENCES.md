# Revue des références Bluetooth et TestFlight

Recherche et lecture des sources le 4 octobre 2026. Les fichiers distants ont été consultés comme références ; aucune bibliothèque tierce n’a été ajoutée au projet.

| Dépôt | Utilité pour MyCycleWorld | Décision |
| --- | --- | --- |
| [OpenBikeControl/bikecontrol](https://github.com/OpenBikeControl/bikecontrol) (ancien SwiftControl) | Implémentation actuelle des générations Play, Play fw2, Ride, Click et Click v2 ; identification dans les annonces, handshake et différences de firmware. | Référence principale pour les manettes. Écritures sans réponse et diagnostic du modèle repris comme comportements du protocole. Pas de promesse de compatibilité avec tous les firmwares. |
| [cagnulein/qdomyos-zwift](https://github.com/cagnulein/qdomyos-zwift) | Pilotage FTMS et nombreux écarts propres aux modèles ; implémentations iOS et commandes Zwift. | Confirme l’intérêt de sérialiser les écritures. Les contournements propres à un trainer ne sont pas appliqués à tous les appareils. |
| [michallaskowski/FTMSTrainer](https://github.com/michallaskowski/FTMSTrainer) | Exemple Swift/RxBluetoothKit qui attend à la fois l’écriture GATT et l’indication FTMS, avec timeout. | Ce principe est déjà présent dans notre file FTMS et testé. Certains encodeurs de cette ancienne bibliothèque sont incomplets : ne pas les utiliser comme définition du protocole. |
| [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay) | Analyse historique des services, caractéristiques et échanges chiffrés Zwift. | Utile pour expliquer les limites du simple handshake RideOn. N’établit pas à lui seul la compatibilité des firmwares actuels. |
| [fastlane/fastlane](https://github.com/fastlane/fastlane) et [pilot](https://docs.fastlane.tools/actions/pilot/) | Automatisation de l’envoi TestFlight avec authentification Apple ID ou clé API App Store Connect. | Option pour une future automatisation. Ne résout pas à lui seul l’absence de compte/profil de signature ; le parcours Xcode existant reste disponible. |

## Constats et corrections appliquées

1. **Écritures Zwift** : BikeControl et QZ utilisent Write Without Response. Le port natif privilégie désormais ce mode lorsqu’il est annoncé. Si CoreBluetooth n’accepte momentanément plus d’écriture, une FIFO conserve RideOn/vibration et reprend au callback `peripheralIsReady`. Le repli Write With Response reste sérialisé et surveillé par un timeout.
2. **Diagnostic matériel** : décodage du type d’appareil dans les données constructeur Zwift `0x094A`, affichage du modèle et du firmware Device Information. Click v2 est identifié avec une mention indiquant que son activation spécifique n’est pas implémentée.
3. **Service masqué ou absent** : l’app peut conserver la connexion pour lire les informations du périphérique et afficher une explication, au lieu de perdre le diagnostic en se déconnectant immédiatement. Un service absent ne prouve pas à lui seul que le firmware est verrouillé.
4. **État réel des manettes** : « RideOn reçu » est distinct de « Boutons reçus ». Les trames inconnues sont échantillonnées dans le journal, une fois par type, pour aider au diagnostic. Aucun échange chiffré/protocole d’activation additionnel n’a été ajouté.
5. **Tests** : trois nouveaux tests couvrent la conservation des messages quand le lien est occupé, l’ordre des acquittements, la vidange à la déconnexion, la limite de file et les annonces constructeur valides/incomplètes. Total : 16 tests Swift réussis.

## Sources exactes consultées

- BikeControl, commit `a581cb4e4d62df5036c09a4608023a5320bf167c` : [transport/handshake](https://github.com/OpenBikeControl/bikecontrol/blob/a581cb4e4d62df5036c09a4608023a5320bf167c/lib/bluetooth/devices/zwift/zwift_device.dart), [identifiants](https://github.com/OpenBikeControl/bikecontrol/blob/a581cb4e4d62df5036c09a4608023a5320bf167c/lib/bluetooth/devices/zwift/constants.dart), [Ride et firmware](https://github.com/OpenBikeControl/bikecontrol/blob/a581cb4e4d62df5036c09a4608023a5320bf167c/lib/bluetooth/devices/zwift/zwift_ride.dart), [licence](https://github.com/OpenBikeControl/bikecontrol/blob/a581cb4e4d62df5036c09a4608023a5320bf167c/LICENSE).
- QZ, commit `c73b43c3040958c0c6b487b66f287f1a7bc8271d` : [FTMS](https://github.com/cagnulein/qdomyos-zwift/blob/c73b43c3040958c0c6b487b66f287f1a7bc8271d/src/devices/ftmsbike/ftmsbike.cpp), [transport Zwift](https://github.com/cagnulein/qdomyos-zwift/blob/c73b43c3040958c0c6b487b66f287f1a7bc8271d/src/zwift_play/zwiftclickremote.cpp).
- FTMSTrainer, commit `c5340ab1c885a14525000d05833b5ae0969ec2ae` : [attente des deux acquittements](https://github.com/michallaskowski/FTMSTrainer/blob/c5340ab1c885a14525000d05833b5ae0969ec2ae/Sources/FTMSTrainer/FTMSConnectedTrainer.swift), [encodeurs examinés](https://github.com/michallaskowski/FTMSTrainer/blob/c5340ab1c885a14525000d05833b5ae0969ec2ae/Sources/FTMSModels/Commands.swift).
- zwiftplay, commit `f1c1fe42ca84df2ef3df23d4132ecc0a4aad9e56` : [analyse du protocole](https://github.com/ajchellew/zwiftplay/blob/f1c1fe42ca84df2ef3df23d4132ecc0a4aad9e56/README.md).
- Apple : [capacité d’écriture sans réponse](https://developer.apple.com/documentation/corebluetooth/cbperipheral/cansendwritewithoutresponse), [callback de reprise](https://developer.apple.com/documentation/corebluetooth/cbperipheraldelegate/peripheralisready(tosendwritewithoutresponse:)).

Les sources ont des licences différentes : BikeControl publie actuellement une licence non commerciale, QZ est GPLv3, FTMSTrainer MIT ; aucune licence n’est identifiée par les métadonnées GitHub de zwiftplay. La consultation ne signifie pas que leur code peut être incorporé indistinctement à l’application.

## Limites qui restent à lever

Les tests valident les paquets et la logique de file, pas la radio ni les comportements de chaque firmware. Une séance sur le home trainer et les manettes de l’utilisateur reste nécessaire. Le modèle/firmware exact n’a pas encore été fourni.

Le dernier essai de signature a échoué avec « No Accounts » et aucun profil pour `com.gbillois.MyCycleWorld`. Aucun build n’a été envoyé à App Store Connect. Les dépôts Bluetooth ne résolvent pas cette configuration Apple.

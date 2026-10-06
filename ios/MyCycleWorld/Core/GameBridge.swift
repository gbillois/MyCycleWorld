import Foundation

// Pont entre l'appli et le jeu web (WebView). Cette partie ne dépend que de Foundation : elle est testée
// avec `swift test`. Le côté JavaScript est dans game/native.js (protocole version 1, révision 2 :
// révision 1 = champs facultatifs pour les elliptiques et rameurs ; révision 2 = l'appli annonce ses
// commandes en plus (capabilities) et le jeu peut ouvrir les écrans natifs depuis ses Options).
// Chaque ajout est facultatif : un jeu plus ancien l'ignore, une appli plus ancienne aussi.

/// Appui ou relâchement d'un bouton de manette Zwift, à transmettre au jeu.
struct ButtonEvent: Equatable {
    let button: String
    let down: Bool
}

/// Écran natif que le jeu peut ouvrir par-dessus lui (Options du jeu > Réglages de l'appli).
enum NativeScreen: String, CaseIterable, Identifiable, Hashable {
    /// Accueil des réglages : liens vers les autres écrans, mode démo, confidentialité.
    case settings
    /// Profil matériel, recherche et connexion Bluetooth, test de connexion.
    case devices
    /// Mesures en direct et pilotage manuel du trainer.
    case cockpit
    /// Inspecteur BLE (octets bruts de n'importe quel appareil).
    case inspector
    /// Journal Bluetooth et partage du diagnostic.
    case log

    var id: String { rawValue }
}

/// Ordre envoyé par le jeu. Tout ce qui n'est pas reconnu est refusé : le contenu vient d'une page web.
enum GameCommand: Equatable {
    /// La page est chargée. `minor` = révision du protocole qu'elle parle (0 si elle ne le dit pas).
    case ready(minor: Int)
    /// Pente du terrain en %, avant vitesses virtuelles (l'appli applique les siennes).
    case grade(Double)
    case shift(Int)
    case takeControl
    case vibrate
    /// Ouvrir un écran natif, en choisissant d'abord le profil matériel s'il est donné.
    case openNative(NativeScreen, profile: HardwareProfile?)

    /// Commandes que cette appli comprend en plus du protocole 1 d'origine, annoncées au jeu dans l'état.
    static let capabilities = ["openNative"]
    static let gradeRange: ClosedRange<Double> = -25...30

    init?(body: Any) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return nil }
        switch type {
        case "ready":
            let minor = GameCommand.number(dict["minor"]).flatMap { $0.isFinite && $0 >= 0 && $0 < 1000 ? Int($0) : nil }
            self = .ready(minor: minor ?? 0)
        case "takeControl":
            self = .takeControl
        case "vibrate":
            self = .vibrate
        case "grade":
            guard let value = GameCommand.number(dict["value"]), value.isFinite else { return nil }
            self = .grade(min(GameCommand.gradeRange.upperBound, max(GameCommand.gradeRange.lowerBound, value)))
        case "shift":
            guard let delta = GameCommand.number(dict["delta"]), delta.isFinite, delta != 0 else { return nil }
            self = .shift(delta < 0 ? -1 : 1)
        case "openNative":
            // Écran absent ou inconnu (jeu plus récent que l'appli) : l'accueil des réglages, d'où tout est accessible.
            let screen = (dict["screen"] as? String).flatMap(NativeScreen.init(rawValue:)) ?? .settings
            let profile = (dict["profile"] as? String).flatMap(HardwareProfile.init(rawValue:))
            self = .openNative(screen, profile: profile)
        default:
            return nil
        }
    }

    private static func number(_ value: Any?) -> Double? {
        if let d = value as? Double { return d }
        if let i = value as? Int { return Double(i) }
        if let n = value as? NSNumber { return n.doubleValue }
        return nil
    }
}

/// État envoyé au jeu : mesures, appareils connectés et vitesse virtuelle.
struct GameState: Encodable, Equatable {
    struct Trainer: Encodable, Equatable {
        var connected: Bool
        var controllable: Bool
        var controlled: Bool
        var controlReady: Bool
        var name: String?
        var status: String
    }
    struct Heart: Encodable, Equatable {
        var connected: Bool
        var name: String?
    }

    var v = 1
    /// Révision du protocole 1 : 1 = champs machine ci-dessous (facultatifs, absents quand inconnus),
    /// 2 = liste `capabilities`.
    var minor = 2
    /// Commandes facultatives que l'appli comprend (par exemple « openNative ») : le jeu n'affiche les
    /// entrées correspondantes que si elles y figurent.
    var capabilities: [String] = GameCommand.capabilities
    var demo: Bool
    var trainer: Trainer
    var hr: Heart
    var controllers: [String]
    var power: Int?
    var cadence: Double?
    var speed: Double?
    var heartRate: Int?
    var gear: Int
    /// Profil matériel choisi dans l'appli : zwift | technogym | ble.
    var hardware: String?
    /// Type de machine : bike | cross | rower | treadmill | power.
    var machineKind: String?
    /// Rameur : coups/min, nombre de coups, allure en s/500 m. Elliptique : pas/min.
    var strokeRate: Double?
    var strokeCount: Int?
    var distance: Int?
    var pace: Int?
    var stepRate: Int?
    var resistance: Double?

    /// JSON de l'état, ou nil si une valeur n'est pas encodable (par exemple un NaN).
    func json() -> String? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/// Scripts JavaScript envoyés à la page du jeu.
enum GameScript {
    static func state(_ state: GameState) -> String? {
        guard let json = state.json() else { return nil }
        return "window.mcwNative&&window.mcwNative.state(\(json))"
    }

    /// Le nom du bouton est inséré dans du code JavaScript : on n'accepte que lettres, chiffres et « _ ».
    static func button(_ event: ButtonEvent) -> String? {
        let name = event.button
        guard !name.isEmpty, name.count <= 32,
              name.unicodeScalars.allSatisfy({ ($0.value < 128) && (CharacterSet.alphanumerics.contains($0) || $0 == "_") })
        else { return nil }
        return "window.mcwNative&&window.mcwNative.button('\(name)',\(event.down ? "true" : "false"))"
    }
}

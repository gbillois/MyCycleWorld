import Foundation

// Pont entre l'appli et le jeu web (WebView). Cette partie ne dépend que de Foundation : elle est testée
// avec `swift test`. Le côté JavaScript est dans game/native.js (protocole version 1).

/// Appui ou relâchement d'un bouton de manette Zwift, à transmettre au jeu.
struct ButtonEvent: Equatable {
    let button: String
    let down: Bool
}

/// Ordre envoyé par le jeu. Tout ce qui n'est pas reconnu est refusé : le contenu vient d'une page web.
enum GameCommand: Equatable {
    case ready
    /// Pente du terrain en %, avant vitesses virtuelles (l'appli applique les siennes).
    case grade(Double)
    case shift(Int)
    case takeControl
    case vibrate

    static let gradeRange: ClosedRange<Double> = -25...30

    init?(body: Any) {
        guard let dict = body as? [String: Any], let type = dict["type"] as? String else { return nil }
        switch type {
        case "ready":
            self = .ready
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
    var demo: Bool
    var trainer: Trainer
    var hr: Heart
    var controllers: [String]
    var power: Int?
    var cadence: Double?
    var speed: Double?
    var heartRate: Int?
    var gear: Int

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

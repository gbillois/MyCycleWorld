import Foundation

// Mode debug FTMS (Appareils > Test de connexion) : chaque paquet de la machine est écrit dans la console
// Bluetooth avec TOUS ses champs, y compris ceux que l'appli n'utilise pas (moyennes, énergie, temps…), ses
// drapeaux et les octets en trop ou manquants. Sert à comprendre une machine « reconnue mais muette ».
// Décodage d'après la spécification Fitness Machine Service 1.0 ; module pur, testé dans Tests/FTMSDebugTests.swift.

enum FTMSDebug {
    enum Kind { case u8, u16, s16, u24, u32 }

    struct Field {
        let name: String
        let kind: Kind
        var scale = 1.0
        var unit = ""
        var size: Int {
            switch kind {
            case .u8: return 1
            case .u16, .s16: return 2
            case .u24: return 3
            case .u32: return 4
            }
        }
    }

    /// Champs présents quand le bit `bit` des drapeaux vaut 1 (ou 0 si `whenClear`, cas du bit « More Data »).
    struct Group {
        let bit: Int
        var whenClear = false
        let fields: [Field]
    }

    private static func f(_ name: String, _ kind: Kind, _ scale: Double = 1, _ unit: String = "") -> Field {
        Field(name: name, kind: kind, scale: scale, unit: unit)
    }
    private static let energy = [f("énergie totale", .u16, 1, "kcal"), f("énergie par heure", .u16, 1, "kcal/h"), f("énergie par minute", .u8, 1, "kcal/min")]

    static let indoorBike: [Group] = [
        Group(bit: 0, whenClear: true, fields: [f("vitesse inst.", .u16, 0.01, "km/h")]),
        Group(bit: 1, fields: [f("vitesse moy.", .u16, 0.01, "km/h")]),
        Group(bit: 2, fields: [f("cadence inst.", .u16, 0.5, "tr/min")]),
        Group(bit: 3, fields: [f("cadence moy.", .u16, 0.5, "tr/min")]),
        Group(bit: 4, fields: [f("distance totale", .u24, 1, "m")]),
        Group(bit: 5, fields: [f("résistance", .s16)]),
        Group(bit: 6, fields: [f("puissance inst.", .s16, 1, "W")]),
        Group(bit: 7, fields: [f("puissance moy.", .s16, 1, "W")]),
        Group(bit: 8, fields: energy),
        Group(bit: 9, fields: [f("cardio", .u8, 1, "bpm")]),
        Group(bit: 10, fields: [f("MET", .u8, 0.1)]),
        Group(bit: 11, fields: [f("temps écoulé", .u16, 1, "s")]),
        Group(bit: 12, fields: [f("temps restant", .u16, 1, "s")]),
    ]

    static let rower: [Group] = [
        Group(bit: 0, whenClear: true, fields: [f("cadence de coups", .u8, 0.5, "coups/min"), f("nombre de coups", .u16)]),
        Group(bit: 1, fields: [f("cadence de coups moy.", .u8, 0.5, "coups/min")]),
        Group(bit: 2, fields: [f("distance totale", .u24, 1, "m")]),
        Group(bit: 3, fields: [f("allure inst.", .u16, 1, "s/500 m")]),
        Group(bit: 4, fields: [f("allure moy.", .u16, 1, "s/500 m")]),
        Group(bit: 5, fields: [f("puissance inst.", .s16, 1, "W")]),
        Group(bit: 6, fields: [f("puissance moy.", .s16, 1, "W")]),
        Group(bit: 7, fields: [f("résistance", .s16)]),
        Group(bit: 8, fields: energy),
        Group(bit: 9, fields: [f("cardio", .u8, 1, "bpm")]),
        Group(bit: 10, fields: [f("MET", .u8, 0.1)]),
        Group(bit: 11, fields: [f("temps écoulé", .u16, 1, "s")]),
        Group(bit: 12, fields: [f("temps restant", .u16, 1, "s")]),
    ]

    /// Elliptique : drapeaux sur 3 octets ; le bit 15 (sens du mouvement) n'ajoute pas de champ.
    static let crossTrainer: [Group] = [
        Group(bit: 0, whenClear: true, fields: [f("vitesse inst.", .u16, 0.01, "km/h")]),
        Group(bit: 1, fields: [f("vitesse moy.", .u16, 0.01, "km/h")]),
        Group(bit: 2, fields: [f("distance totale", .u24, 1, "m")]),
        Group(bit: 3, fields: [f("pas par minute", .u16, 1, "pas/min"), f("pas par minute moy.", .u16, 1, "pas/min")]),
        Group(bit: 4, fields: [f("foulées", .u16, 0.1)]),
        Group(bit: 5, fields: [f("dénivelé positif", .u16, 1, "m"), f("dénivelé négatif", .u16, 1, "m")]),
        Group(bit: 6, fields: [f("inclinaison", .s16, 0.1, "%"), f("angle de rampe", .s16, 0.1, "°")]),
        Group(bit: 7, fields: [f("résistance", .s16, 0.1)]),
        Group(bit: 8, fields: [f("puissance inst.", .s16, 1, "W")]),
        Group(bit: 9, fields: [f("puissance moy.", .s16, 1, "W")]),
        Group(bit: 10, fields: energy),
        Group(bit: 11, fields: [f("cardio", .u8, 1, "bpm")]),
        Group(bit: 12, fields: [f("MET", .u8, 0.1)]),
        Group(bit: 13, fields: [f("temps écoulé", .u16, 1, "s")]),
        Group(bit: 14, fields: [f("temps restant", .u16, 1, "s")]),
    ]

    static let treadmill: [Group] = [
        Group(bit: 0, whenClear: true, fields: [f("vitesse inst.", .u16, 0.01, "km/h")]),
        Group(bit: 1, fields: [f("vitesse moy.", .u16, 0.01, "km/h")]),
        Group(bit: 2, fields: [f("distance totale", .u24, 1, "m")]),
        Group(bit: 3, fields: [f("inclinaison", .s16, 0.1, "%"), f("angle de rampe", .s16, 0.1, "°")]),
        Group(bit: 4, fields: [f("dénivelé positif", .u16, 0.1, "m"), f("dénivelé négatif", .u16, 0.1, "m")]),
        Group(bit: 5, fields: [f("allure inst.", .u8, 0.1, "km/min")]),
        Group(bit: 6, fields: [f("allure moy.", .u8, 0.1, "km/min")]),
        Group(bit: 7, fields: energy),
        Group(bit: 8, fields: [f("cardio", .u8, 1, "bpm")]),
        Group(bit: 9, fields: [f("MET", .u8, 0.1)]),
        Group(bit: 10, fields: [f("temps écoulé", .u16, 1, "s")]),
        Group(bit: 11, fields: [f("temps restant", .u16, 1, "s")]),
        Group(bit: 12, fields: [f("force sur la bande", .s16, 1, "N"), f("puissance", .s16, 1, "W")]),
    ]

    /// Cycling Power Measurement : la puissance est toujours là, puis les champs optionnels les plus courants.
    static let cyclingPower: [Group] = [
        Group(bit: 0, fields: [f("équilibre gauche/droite", .u8, 0.5, "%")]),
        Group(bit: 2, fields: [f("couple cumulé", .u16, 1.0 / 32, "N·m")]),
        Group(bit: 4, fields: [f("tours de roue", .u32), f("dernier tour de roue", .u16, 1.0 / 2048, "s")]),
        Group(bit: 5, fields: [f("tours de pédalier", .u16), f("dernier tour de pédalier", .u16, 1.0 / 1024, "s")]),
    ]

    static let featureNames = ["vitesse moy.", "cadence", "distance totale", "inclinaison", "dénivelé", "allure", "pas", "résistance",
                               "foulées", "énergie", "cardio", "MET", "temps écoulé", "temps restant", "puissance",
                               "force sur la bande et puissance", "données utilisateur"]
    static let targetNames = ["vitesse", "inclinaison", "résistance", "puissance (ERG)", "cardio", "énergie", "pas", "foulées",
                              "distance", "durée", "temps en 2 zones", "temps en 3 zones", "temps en 5 zones",
                              "simulation vélo (pente)", "circonférence de roue", "étalonnage", "cadence"]
    static let trainingStatus = ["autre", "au repos", "échauffement", "intervalle facile", "intervalle intense", "récupération",
                                 "isométrique", "contrôle cardio", "test de forme", "vitesse trop basse", "vitesse trop haute",
                                 "retour au calme", "contrôle en watts", "mode manuel (Quick Start)", "avant séance", "après séance"]

    static func hex(_ b: [UInt8]) -> String { b.map { String(format: "%02x", $0) }.joined(separator: " ") }

    private static func read(_ field: Field, _ b: [UInt8], at i: Int) -> Double {
        switch field.kind {
        case .u8: return Double(b[i])
        case .u16: return Double(Int(b[i]) | Int(b[i + 1]) << 8)
        case .s16: return Double(Int16(bitPattern: UInt16(b[i]) | UInt16(b[i + 1]) << 8))
        case .u24: return Double(Int(b[i]) | Int(b[i + 1]) << 8 | Int(b[i + 2]) << 16)
        case .u32: return Double(UInt32(b[i]) | UInt32(b[i + 1]) << 8 | UInt32(b[i + 2]) << 16 | UInt32(b[i + 3]) << 24)
        }
    }

    private static func format(_ field: Field, _ raw: Double) -> String {
        let value = raw * field.scale
        let text = field.scale == 1 ? String(Int(value)) : String(format: field.scale < 0.1 ? "%.2f" : "%.1f", value)
        return "\(field.name) \(text)\(field.unit.isEmpty ? "" : " " + field.unit)"
    }

    /// Champs d'un paquet à drapeaux (`flagBytes` octets en tête), dans l'ordre de la spécification.
    /// `fixed` : champs toujours présents juste après les drapeaux (puissance de Cycling Power).
    static func fields(_ b: [UInt8], flagBytes: Int, groups: [Group], fixed: [Field] = []) -> [String] {
        guard b.count >= flagBytes else { return ["TRONQUÉ : \(b.count) octet(s), drapeaux sur \(flagBytes) attendus"] }
        var flags = 0
        for k in 0..<flagBytes { flags |= Int(b[k]) << (8 * k) }
        let bits = (0..<(flagBytes * 8)).filter { flags & (1 << $0) != 0 }
        var out = [String(format: "drapeaux 0x%0\(flagBytes * 2)X", flags) + " (bits " + (bits.isEmpty ? "aucun" : bits.map(String.init).joined(separator: ",")) + ")"]
        var i = flagBytes
        let present = fixed.map { (group: -1, field: $0) } + groups.filter { g in (flags & (1 << g.bit) != 0) != g.whenClear }.flatMap { g in g.fields.map { (group: g.bit, field: $0) } }
        for (_, field) in present {
            guard i + field.size <= b.count else {
                out.append("TRONQUÉ : « \(field.name) » attendait \(field.size) octet(s), il en reste \(b.count - i)")
                return out
            }
            out.append(format(field, read(field, b, at: i)))
            i += field.size
        }
        if i < b.count { out.append("octets en trop : \(hex(Array(b[i...])))") }
        return out
    }

    /// Une ligne lisible pour un paquet d'une caractéristique (UUID court en majuscules ou minuscules).
    static func describe(_ id: String, _ b: [UInt8]) -> String {
        let uuid = id.uppercased()
        let name: String
        var parts: [String]
        switch uuid {
        case "2AD2": name = "Indoor Bike Data"; parts = fields(b, flagBytes: 2, groups: indoorBike)
        case "2AD1": name = "Rower Data"; parts = fields(b, flagBytes: 2, groups: rower)
        case "2ACE": name = "Cross Trainer Data"; parts = fields(b, flagBytes: 3, groups: crossTrainer)
        case "2ACD": name = "Treadmill Data"; parts = fields(b, flagBytes: 2, groups: treadmill)
        case "2A63": name = "Cycling Power"; parts = fields(b, flagBytes: 2, groups: cyclingPower, fixed: [f("puissance inst.", .s16, 1, "W")])
        case "2ACC":
            name = "Fitness Machine Feature"
            if b.count >= 8 {
                let m = Int(b[0]) | Int(b[1]) << 8 | Int(b[2]) << 16 | Int(b[3]) << 24
                let t = Int(b[4]) | Int(b[5]) << 8 | Int(b[6]) << 16 | Int(b[7]) << 24
                let list = { (names: [String], v: Int) in names.indices.filter { v & (1 << $0) != 0 }.map { names[$0] }.joined(separator: ", ") }
                parts = ["mesures : " + list(featureNames, m), "consignes : " + list(targetNames, t)]
            } else { parts = ["TRONQUÉ"] }
        case "2AD3":
            name = "Training Status"
            parts = b.count >= 2 ? ["état : " + (Int(b[1]) < trainingStatus.count ? trainingStatus[Int(b[1])] : "code \(b[1])")] : ["TRONQUÉ"]
        case "2ADA":
            name = "Fitness Machine Status"
            let codes: [UInt8: String] = [0x01: "remise à zéro", 0x02: "arrêt ou pause par l'utilisateur", 0x03: "arrêt par la clé de sécurité",
                                          0x04: "démarrage ou reprise par l'utilisateur", 0x07: "nouvelle résistance", 0x08: "nouvelle puissance",
                                          0x12: "nouvelle simulation (pente)", 0xFF: "contrôle perdu"]
            parts = b.first.map { [codes[$0] ?? String(format: "code 0x%02X", $0)] } ?? ["vide"]
        case "2AD9":
            name = "Control Point"
            let results: [UInt8: String] = [1: "OK", 2: "non pris en charge", 3: "paramètre invalide", 4: "échec", 5: "contrôle refusé"]
            parts = b.count >= 3 && b[0] == 0x80
                ? [String(format: "réponse à 0x%02X : ", b[1]) + (results[b[2]] ?? "code \(b[2])")]
                : ["commande"]
        case "2AD6", "2AD4", "2AD5", "2AD8", "2AD7":
            let ranges: [String: (String, Field)] = [
                "2AD6": ("Plage de résistance", f("", .s16, 0.1)), "2AD4": ("Plage de vitesse", f("", .u16, 0.01, "km/h")),
                "2AD5": ("Plage d'inclinaison", f("", .s16, 0.1, "%")), "2AD8": ("Plage de puissance", f("", .s16, 1, "W")),
                "2AD7": ("Plage de cardio", f("", .u8, 1, "bpm")),
            ]
            let (title, field) = ranges[uuid]!
            name = title
            let n = field.size
            parts = b.count >= 3 * n
                ? ["min", "max", "pas"].enumerated().map { k, label in label + " " + format(field, read(field, b, at: k * n)).trimmingCharacters(in: .whitespaces) }
                : ["TRONQUÉ"]
        default:
            name = uuid
            parts = []
        }
        return "\(name) [\(uuid)] \(b.count) o : \(hex(b))" + (parts.isEmpty ? "" : " → " + parts.joined(separator: " · "))
    }
}

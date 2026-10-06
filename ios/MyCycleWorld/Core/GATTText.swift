import Foundation

// Textes du journal Bluetooth et de l'inspecteur BLE (comme src/ble/bytes.js et src/ble/inspector.js).
enum GATTText {
    static let known: [String: String] = [
        "1800": "Generic Access",
        "1801": "Generic Attribute",
        "180a": "Device Information",
        "180d": "Heart Rate",
        "180f": "Battery",
        "1816": "Cycling Speed & Cadence",
        "1818": "Cycling Power",
        "1826": "Fitness Machine (FTMS)",
        "1814": "Running Speed & Cadence",
        "181c": "User Data",
        "2acd": "Treadmill Data",
        "2ace": "Cross Trainer Data",
        "2ad1": "Rower Data",
        "a913bfc0-929e-11e5-b928-0002a5d5c51b": "Technogym (propriétaire)",
        "ae4a2645-916e-4d6b-8884-500b6a2e244c": "Technogym (propriétaire)",
        "0000fd00-ebae-4526-9511-8357c35d7be2": "Technogym (propriétaire, console)",
        "6e400001-b5a3-f393-e0a9-e50e24dcca9e": "Nordic UART",
        "fc82": "Zwift (FW2 / Ride)",
        "2a19": "Battery Level",
        "2a24": "Model Number",
        "2a25": "Serial Number",
        "2a26": "Firmware Revision",
        "2a27": "Hardware Revision",
        "2a28": "Software Revision",
        "2a29": "Manufacturer Name",
        "2a37": "Heart Rate Measurement",
        "2a5d": "Sensor Location",
        "2a53": "RSC Measurement",
        "2a54": "RSC Feature",
        "2a5b": "CSC Measurement",
        "2a5c": "CSC Feature",
        "2a63": "Cycling Power Measurement",
        "2a65": "Cycling Power Feature",
        "2a66": "Cycling Power Control Point",
        "2acc": "Fitness Machine Feature",
        "2ad2": "Indoor Bike Data",
        "2ad3": "Training Status",
        "2ad6": "Supported Resistance Level Range",
        "2ad8": "Supported Power Range",
        "2ad9": "Fitness Machine Control Point",
        "2ada": "Fitness Machine Status",
        "00000001-19ca-4651-86e5-fa29dcdd09d1": "Zwift (service)",
        "00000002-19ca-4651-86e5-fa29dcdd09d1": "Zwift Async (notify)",
        "00000003-19ca-4651-86e5-fa29dcdd09d1": "Zwift Sync RX (write)",
        "00000004-19ca-4651-86e5-fa29dcdd09d1": "Zwift Sync TX (indicate)",
    ]

    /// UUID court si c'est un UUID Bluetooth SIG (« 0000xxxx-0000-1000-8000-00805f9b34fb »), en minuscules.
    static func short(_ uuid: String) -> String {
        let u = uuid.lowercased()
        let base = "-0000-1000-8000-00805f9b34fb"
        if u.count == 36, u.hasPrefix("0000"), u.hasSuffix(base) {
            return String(u.dropFirst(4).prefix(4))
        }
        return u
    }

    /// « Rower Data [2ad1] », ou l'UUID seul s'il est inconnu.
    static func name(_ uuid: String) -> String {
        let s = short(uuid)
        if let name = known[s] { return "\(name) [\(s)]" }
        return s
    }

    /// Nom seul, sans l'UUID entre crochets (liste de services du test de connexion).
    static func plainName(_ uuid: String) -> String {
        known[short(uuid)] ?? short(uuid)
    }

    static func hex(_ bytes: [UInt8]) -> String {
        bytes.map { String(format: "%02x", $0) }.joined(separator: " ")
    }

    /// Texte lisible si les octets sont de l'ASCII imprimable (noms, numéros de série, versions), sinon nil.
    static func ascii(_ bytes: [UInt8]) -> String? {
        guard !bytes.isEmpty, bytes.allSatisfy({ ($0 >= 32 && $0 < 127) || $0 == 0 }) else { return nil }
        let text = String(decoding: bytes.filter { $0 != 0 }, as: UTF8.self).trimmingCharacters(in: .whitespaces)
        return text.isEmpty ? nil : text
    }

    static func properties(read: Bool, write: Bool, writeWithoutResponse: Bool, notify: Bool, indicate: Bool) -> String {
        [("read", read), ("write", write), ("writeWithoutResponse", writeWithoutResponse), ("notify", notify), ("indicate", indicate)]
            .filter { $0.1 }.map { $0.0 }.joined(separator: ",")
    }
}

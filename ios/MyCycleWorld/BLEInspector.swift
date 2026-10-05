import Foundation
import CoreBluetooth
import Combine

/// Appareil vu par l'inspecteur (tous les appareils Bluetooth, sans filtre de service).
struct InspectorDevice: Identifiable {
    let id: UUID
    var name: String
    var rssi: Int
    var details: String
}

/// Inspecteur BLE (comme src/ble/inspector.js) : pour une machine qui ne parle pas, ou pas tout à fait, le FTMS
/// standard. Se connecte à n'importe quel appareil, découvre tous ses services (CoreBluetooth n'a pas besoin de
/// liste, contrairement à Web Bluetooth), lit tout ce qui est lisible et s'abonne à tout ce qui notifie, en
/// journalisant les octets bruts : 30 premiers paquets de chaque caractéristique, puis 1 sur 20.
final class BLEInspector: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    @Published private(set) var bluetoothState = "Bluetooth non démarré"
    @Published private(set) var scanning = false
    @Published private(set) var found: [InspectorDevice] = []
    @Published private(set) var target: String?
    @Published private(set) var connected = false
    @Published private(set) var characteristicCount = 0
    @Published private(set) var packets = 0
    @Published private(set) var logs: [String] = []

    private struct Entry {
        var name: String
        var sampler = PacketSampler(first: 30, every: 20)
        var packets = 0
        var last = ""
    }

    private var central: CBCentralManager?
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var current: CBPeripheral?
    private var entries: [String: Entry] = [:]
    private var pendingReads: Set<String> = []
    private var wantScan = false
    private var scanTimer: Timer?

    var text: String { (["MyCycleWorld iOS · inspecteur BLE", bluetoothState] + logs).joined(separator: "\n") }
    var running: Bool { connected }

    func log(_ message: String) {
        logs.append("\(Date().formatted(date: .omitted, time: .standard))  \(message)")
        if logs.count > 3000 { logs.removeFirst(logs.count - 3000) }
    }
    func clearLog() { logs.removeAll() }

    func scan() {
        wantScan = true
        if central == nil { central = CBCentralManager(delegate: self, queue: .main); return }
        guard central?.state == .poweredOn else { return }
        wantScan = false
        found = []
        central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanning = true
        log("Recherche de tous les appareils Bluetooth (20 s)…")
        scanTimer?.invalidate()
        scanTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in self?.stopScan() }
    }
    func stopScan() {
        wantScan = false
        central?.stopScan()
        scanning = false
        scanTimer?.invalidate()
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn: bluetoothState = "Bluetooth prêt"
        case .poweredOff: bluetoothState = "Active le Bluetooth dans Réglages."
        case .unauthorized: bluetoothState = "Autorise le Bluetooth dans Réglages → MyCycleWorld."
        case .unsupported: bluetoothState = "Bluetooth indisponible ici."
        default: bluetoothState = "Initialisation Bluetooth…"
        }
        if central.state == .poweredOn {
            if wantScan { scan() }
        } else {
            scanning = false
            connected = false
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name ?? "(sans nom)"
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []).map { GATTText.plainName($0.uuidString) }
        let manufacturer = Array(advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data ?? Data())
        var details: [String] = []
        if !services.isEmpty { details.append("Services : " + services.joined(separator: ", ")) }
        if let company = HardwareProfile.companyID(manufacturer) {
            details.append(String(format: "Fabricant 0x%04X : ", company) + GATTText.hex(Array(manufacturer.dropFirst(2).prefix(16))))
        }
        if let connectable = advertisementData[CBAdvertisementDataIsConnectable] as? Bool, !connectable { details.append("non connectable") }
        peripherals[peripheral.identifier] = peripheral
        let device = InspectorDevice(id: peripheral.identifier, name: name, rssi: RSSI.intValue, details: details.joined(separator: " · "))
        if let index = found.firstIndex(where: { $0.id == device.id }) { found[index] = device } else { found.append(device) }
        found.sort { $0.rssi > $1.rssi }
    }

    /// Se connecte à l'appareil choisi et lance l'inspection complète.
    func inspect(_ id: UUID) {
        guard let central, let peripheral = peripherals[id] else { return }
        stop()
        stopScan()
        entries = [:]
        pendingReads = []
        packets = 0
        characteristicCount = 0
        current = peripheral
        target = found.first(where: { $0.id == id })?.name ?? peripheral.name ?? "appareil"
        peripheral.delegate = self
        log("Appareil : « \(target ?? "") » id=\(id.uuidString)")
        central.connect(peripheral)
    }

    func stop() {
        guard let current, current.state != .disconnected else { return }
        central?.cancelPeripheralConnection(current)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard peripheral === current else { return }
        connected = true
        log("Connecté. Découverte de tous les services…")
        peripheral.discoverServices(nil)
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard peripheral === current else { return }
        connected = false
        log("Connexion impossible\(error.map { " : " + $0.localizedDescription } ?? "").")
    }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard peripheral === current else { return }
        connected = false
        log("Déconnecté\(error.map { " (" + $0.localizedDescription + ")" } ?? ""). Résumé : \(summary())")
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if let error { log("Services illisibles : \(error.localizedDescription)"); return }
        let services = peripheral.services ?? []
        log("\(services.count) service(s), propriétaires compris :")
        for service in services {
            log("• Service \(GATTText.name(service.uuid.uuidString))")
            peripheral.discoverCharacteristics(nil, for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        let serviceName = GATTText.name(service.uuid.uuidString)
        if let error { log("  caractéristiques de \(serviceName) illisibles : \(error.localizedDescription)"); return }
        for c in service.characteristics ?? [] {
            let key = BLEInspector.key(c)
            let p = c.properties
            let props = GATTText.properties(read: p.contains(.read), write: p.contains(.write), writeWithoutResponse: p.contains(.writeWithoutResponse),
                                            notify: p.contains(.notify), indicate: p.contains(.indicate))
            let name = GATTText.name(c.uuid.uuidString)
            entries[key] = Entry(name: name)
            log("  - \(name) (\(props.isEmpty ? "aucune propriété" : props)) · service \(serviceName)")
            if p.contains(.read) {
                pendingReads.insert(key)
                peripheral.readValue(for: c)
            }
            if p.contains(.notify) || p.contains(.indicate) { peripheral.setNotifyValue(true, for: c) }
        }
        characteristicCount = entries.count
        log("Écoute en cours : fais tourner la machine (pédale, rame, démarre une séance). \(entries.count) caractéristique(s).")
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        let name = GATTText.name(characteristic.uuid.uuidString)
        if let error { log("      abonnement refusé (\(name)) : \(error.localizedDescription)"); return }
        log("      abonné (\(characteristic.properties.contains(.notify) ? "notify" : "indicate")) : \(name)")
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        let key = BLEInspector.key(characteristic)
        let wasRead = pendingReads.remove(key) != nil
        var entry = entries[key] ?? Entry(name: GATTText.name(characteristic.uuid.uuidString))
        if let error {
            log("      \(wasRead ? "lecture refusée" : "erreur") (\(entry.name)) : \(error.localizedDescription)")
            return
        }
        let bytes = Array(characteristic.value ?? Data())
        let hex = GATTText.hex(bytes)
        entry.last = hex
        if wasRead {
            let ascii = GATTText.ascii(bytes).map { "  « \($0) »" } ?? ""
            log("      lu (\(entry.name)) : \(hex.isEmpty ? "(vide)" : hex)\(ascii)")
        } else {
            entry.packets += 1
            packets += 1
            if entry.sampler.sample() { log("\(entry.name) #\(entry.packets) : \(hex)") }
        }
        entries[key] = entry
    }

    func summary() -> String {
        let parts = entries.values.filter { $0.packets > 0 }.sorted { $0.name < $1.name }.map { "\($0.name) : \($0.packets) paquets, dernier \($0.last)" }
        return parts.isEmpty ? "aucun paquet reçu" : parts.joined(separator: " | ")
    }

    private static func key(_ c: CBCharacteristic) -> String {
        "\(c.service?.uuid.uuidString ?? "?")/\(c.uuid.uuidString)"
    }
}

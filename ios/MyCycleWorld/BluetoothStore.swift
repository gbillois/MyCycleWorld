import Foundation
import CoreBluetooth
import Combine

private enum UUIDs {
    static let ftms = CBUUID(string: "1826"), cps = CBUUID(string: "1818"), hr = CBUUID(string: "180D")
    static let zwift = CBUUID(string: "00000001-19CA-4651-86E5-FA29DCDD09D1"), zwift2 = CBUUID(string: "FC82")
    static let async = CBUUID(string: "00000002-19CA-4651-86E5-FA29DCDD09D1")
    static let rx = CBUUID(string: "00000003-19CA-4651-86E5-FA29DCDD09D1")
    static let tx = CBUUID(string: "00000004-19CA-4651-86E5-FA29DCDD09D1")
    static let services = [ftms, cps, hr, zwift, zwift2, CBUUID(string: "180F"), CBUUID(string: "180A")]
}

enum DeviceRole: String, CaseIterable, Identifiable {
    case trainer = "Home trainer", heart = "Ceinture cardio", controller = "Manette Zwift"
    var id: String { rawValue }
    var icon: String { self == .trainer ? "bicycle" : self == .heart ? "heart.fill" : "gamecontroller.fill" }
}
struct DeviceRow: Identifiable {
    var id: UUID
    var name: String
    var rssi: Int
    var state: String
    var connected: Bool
    var busy: Bool
    var battery: Int?
    var role: DeviceRole?
    var buttons: String
    var details: String
}
struct PowerSample: Identifiable {
    let id = UUID()
    let date: Date
    let watts: Int
}
private final class Connection {
    let peripheral: CBPeripheral
    var name: String
    var rssi: Int
    var role: DeviceRole?
    var state = "Disponible"
    var battery: Int?
    var chars: [CBUUID: CBCharacteristic] = [:]
    var buttons: Set<String> = []
    var model: ZwiftModel?
    var deviceModel: String?
    var firmware: String?
    var seenUnknownTypes: Set<UInt8> = []
    var writes = PeripheralWriteQueue()
    var writeTimer: Timer?
    var handshakeSent = false
    var handshake = false
    var connectionTimer: Timer?
    func cancelWrites() { writes.clear(); writeTimer?.invalidate(); writeTimer = nil }
    init(_ peripheral: CBPeripheral, name: String, rssi: Int) {
        self.peripheral = peripheral; self.name = name; self.rssi = rssi
    }
}

final class BluetoothStore: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    @Published private(set) var bluetoothState = "Bluetooth non démarré"
    @Published private(set) var poweredOn = false
    @Published private(set) var scanning = false
    @Published private(set) var devices: [DeviceRow] = []
    @Published private(set) var metrics = BikeReading()
    @Published private(set) var heartContact: Bool?
    @Published private(set) var logs: [String] = []
    @Published private(set) var history: [PowerSample] = []
    @Published private(set) var demo = false
    @Published private(set) var controlReady = false
    @Published private(set) var controlled = false
    @Published private(set) var simulationSupported = false
    @Published private(set) var ergSupported = false
    @Published private(set) var resistanceSupported = false
    @Published private(set) var powerRange = 0.0...1000.0
    @Published private(set) var resistanceRange = 0.0...100.0
    @Published private(set) var gears = VirtualGears()
    @Published private(set) var controlStatus = "Connecte un home trainer pour commencer."
    @Published private(set) var lastAction = "Aucun bouton reçu"
    @Published private(set) var mode = "Simulation"
    @Published var terrain = 0.0
    @Published var targetWatts = 150.0
    @Published var targetResistance = 10.0
    private var central: CBCentralManager?
    private var connections: [UUID: Connection] = [:]
    private var trainerID: UUID?
    private var heartID: UUID?
    private var scanTimer: Timer?
    private var tickTimer: Timer?
    private var commandTimer: Timer?
    private var queue = ControlQueue()
    private var crank = CrankCadence()
    private var ftmsPower = false, ftmsCadence = false
    private var lastPower: Date?, lastCadence: Date?, lastSpeed: Date?, lastHeart: Date?
    private var demoTick = 0
    private var requestScan = false
    private var supportedPowerStep = 1.0, supportedResistanceStep = 0.1
    var activeConnectionCount: Int { devices.filter(\.connected).count }
    var report: String { (["MyCycleWorld iOS 1.0 (1)", "Mode : \(demo ? "DÉMO" : "Bluetooth réel")", bluetoothState] + logs).joined(separator: "\n") }

    override init() {
        super.init()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        if ProcessInfo.processInfo.arguments.contains("--demo") { setDemo(true) }
    }
    func log(_ message: String) {
        logs.append("\(Date().formatted(date: .omitted, time: .standard))  \(message)")
        if logs.count > 500 { logs.removeFirst(logs.count - 500) }
    }
    func clearLog() { logs.removeAll() }
    func scan() {
        guard !demo else { return }
        requestScan = true
        if central == nil { central = CBCentralManager(delegate: self, queue: .main); return }
        guard poweredOn else { return }
        requestScan = false
        // Foreground broad scan also discovers Zwift manufacturer-only advertisements.
        central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanning = true
        log("Recherche Bluetooth (30 s). Réveille les appareils et ferme les autres applis de vélo.")
        scanTimer?.invalidate()
        scanTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in self?.stopScan() }
    }
    func stopScan() { requestScan = false; central?.stopScan(); scanning = false; scanTimer?.invalidate() }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        poweredOn = central.state == .poweredOn
        switch central.state {
        case .poweredOn: bluetoothState = "Bluetooth prêt"
        case .poweredOff: bluetoothState = "Active le Bluetooth dans Réglages."
        case .unauthorized: bluetoothState = "Autorise le Bluetooth dans Réglages → MyCycleWorld."
        case .unsupported: bluetoothState = "Bluetooth indisponible ici. Utilise le mode démo sur simulateur."
        case .resetting: bluetoothState = "Bluetooth en cours de redémarrage…"
        default: bluetoothState = "Initialisation Bluetooth…"
        }
        if poweredOn && requestScan { scan() }
        if !poweredOn && !demo {
            scanning = false
            for c in connections.values { c.connectionTimer?.invalidate(); c.cancelWrites(); c.state = "Déconnecté"; c.chars = [:]; c.buttons = [] }
            resetTrainer(); heartID = nil; metrics = BikeReading(); refresh()
        }
        log(bluetoothState)
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name ?? "Appareil sans nom"
        let advertised = advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []
        let manufacturer = Array(advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data ?? Data())
        let zwift = name.localizedCaseInsensitiveContains("zwift") || (manufacturer.count >= 2 && manufacturer[0] == 0x4a && manufacturer[1] == 9)
        let c = connections[peripheral.identifier] ?? Connection(peripheral, name: name, rssi: RSSI.intValue)
        c.rssi = RSSI.intValue; c.name = name
        c.model = ZwiftModel.fromManufacturerData(manufacturer) ?? c.model
        if c.role == nil {
            if zwift || advertised.contains(UUIDs.zwift) || advertised.contains(UUIDs.zwift2) { c.role = .controller }
            else if advertised.contains(UUIDs.ftms) || advertised.contains(UUIDs.cps) { c.role = .trainer }
            else if advertised.contains(UUIDs.hr) { c.role = .heart }
        }
        connections[peripheral.identifier] = c
        refresh()
    }
    func connect(_ id: UUID, role: DeviceRole) {
        guard !demo, poweredOn, let c = connections[id], c.peripheral.state == .disconnected else { return }
        if role == .trainer, let old = trainerID, old != id { disconnect(old) }
        if role == .heart, let old = heartID, old != id { disconnect(old) }
        c.cancelWrites(); c.seenUnknownTypes = []; c.deviceModel = nil; c.firmware = nil
        c.role = role; c.state = "Connexion…"; c.chars = [:]; c.buttons = []; c.handshakeSent = false; c.handshake = false
        if role == .trainer { resetTrainer(); trainerID = id }
        if role == .heart { heartID = id; heartContact = nil; metrics.heartRate = nil }
        c.peripheral.delegate = self
        central?.connect(c.peripheral)
        c.connectionTimer?.invalidate()
        c.connectionTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            guard let self, c.peripheral.state == .connecting else { return }
            self.log("Connexion expirée : \(c.name)"); self.disconnect(id)
        }
        log("Connexion à \(c.name) — \(role.rawValue)"); refresh()
    }
    func disconnect(_ id: UUID) {
        guard let c = connections[id] else { return }
        c.connectionTimer?.invalidate(); c.cancelWrites(); c.buttons = []; c.state = "Déconnexion…"
        if trainerID == id { resetTrainer() }
        if heartID == id { heartID = nil; metrics.heartRate = nil; heartContact = nil }
        central?.cancelPeripheralConnection(c.peripheral); refresh()
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard let c = connections[peripheral.identifier] else { return }
        c.connectionTimer?.invalidate(); c.state = "Découverte des services…"
        peripheral.discoverServices(UUIDs.services); refresh()
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) { disconnected(peripheral, error) }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) { disconnected(peripheral, error) }
    private func disconnected(_ peripheral: CBPeripheral, _ error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        c.connectionTimer?.invalidate(); c.cancelWrites(); c.state = "Déconnecté"; c.chars = [:]; c.buttons = []; c.handshakeSent = false; c.handshake = false
        if trainerID == peripheral.identifier { resetTrainer() }
        if heartID == peripheral.identifier { heartID = nil; metrics.heartRate = nil; heartContact = nil }
        log("\(c.name) déconnecté\(error.map { ": " + $0.localizedDescription } ?? ""). Reconnexion manuelle disponible."); refresh()
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        if let error { fail(c, error.localizedDescription); return }
        let services = peripheral.services ?? []
        let required = c.role == .trainer ? [UUIDs.ftms, UUIDs.cps] : c.role == .heart ? [UUIDs.hr] : [UUIDs.zwift2, UUIDs.zwift]
        guard services.contains(where: { required.contains($0.uuid) }) else {
            if c.role == .controller {
                c.state = "Service Zwift absent — compatibilité du firmware à vérifier"
                log("\(c.name) : \(c.state). Certains modèles récents nécessitent une activation spécifique non implémentée ici.")
                // Retain the connection long enough to read model/firmware even when the custom service is hidden.
                for service in services where [CBUUID(string: "180A"), CBUUID(string: "180F")].contains(service.uuid) {
                    peripheral.discoverCharacteristics(nil, for: service)
                }
                refresh()
            } else { fail(c, "Service attendu absent pour ce type d’appareil.") }
            return
        }
        let preferredZwift = services.contains(where: { $0.uuid == UUIDs.zwift2 }) ? UUIDs.zwift2 : UUIDs.zwift
        for service in services {
            if [UUIDs.zwift, UUIDs.zwift2].contains(service.uuid) && (c.role != .controller || service.uuid != preferredZwift) { continue }
            peripheral.discoverCharacteristics(nil, for: service)
        }
        c.state = "Connecté"; refresh()
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        if let error { log("\(c.name) : \(error.localizedDescription)"); return }
        for char in service.characteristics ?? [] {
            c.chars[char.uuid] = char
            let id = char.uuid.uuidString.uppercased()
            let notify = c.role == .trainer ? ["2AD2", "2A63", "2ADA", "2AD9", "2A37"] : c.role == .heart ? ["2A37"] : [UUIDs.async.uuidString, UUIDs.tx.uuidString]
            if notify.contains(id), char.properties.contains(.notify) || char.properties.contains(.indicate) { peripheral.setNotifyValue(true, for: char) }
            if ["2ACC", "2AD6", "2AD8", "2A19", "2A24", "2A26", "2A29"].contains(id), char.properties.contains(.read) { peripheral.readValue(for: char) }
        }
        if c.role == .controller, [UUIDs.zwift, UUIDs.zwift2].contains(service.uuid),
           [UUIDs.async, UUIDs.rx, UUIDs.tx].contains(where: { c.chars[$0] == nil }) {
            c.state = "Caractéristiques Zwift incomplètes"; log("\(c.name) : \(c.state)")
        }
        tryHandshake(c)
        if c.role == .trainer, service.uuid == UUIDs.ftms, c.chars[CBUUID(string: "2AD9")] == nil { controlStatus = "Trainer connecté en lecture seule." }
        refresh()
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        if let error {
            log("Abonnement \(characteristic.uuid) : \(error.localizedDescription)")
            if c.role == .controller { c.state = "Échec d’abonnement Zwift"; refresh() }
            return
        }
        if peripheral.identifier == trainerID && characteristic.uuid == CBUUID(string: "2AD9") {
            controlReady = characteristic.isNotifying && characteristic.properties.contains(.write)
            controlStatus = controlReady ? "Prêt. Prends le contrôle pour piloter la résistance." : "Contrôle FTMS indisponible."
        }
        tryHandshake(c)
    }
    private func tryHandshake(_ c: Connection) {
        guard c.role == .controller, !c.handshakeSent, c.chars[UUIDs.async]?.isNotifying == true,
              c.chars[UUIDs.tx]?.isNotifying == true, let rx = c.chars[UUIDs.rx] else { return }
        c.handshakeSent = true; c.state = "Initialisation RideOn…"
        writeZwift(ZwiftProtocol.rideOn, to: c, char: rx)
        c.connectionTimer?.invalidate()
        c.connectionTimer = Timer.scheduledTimer(withTimeInterval: 4, repeats: false) { [weak self] _ in
            guard self?.connections[c.peripheral.identifier] === c, !c.handshake, c.peripheral.state == .connected else { return }
            c.state = "RideOn sans réponse — essaie un bouton"
            self?.log("\(c.name) : RideOn sans réponse. Firmware à vérifier sur matériel."); self?.refresh()
        }
        refresh()
    }
    private func writeZwift(_ bytes: [UInt8], to c: Connection, char: CBCharacteristic) {
        guard char.properties.contains(.writeWithoutResponse) || char.properties.contains(.write) else {
            c.state = "Écriture Zwift indisponible"; log(c.state); refresh(); return
        }
        guard c.writes.enqueue(bytes) else { log("\(c.name) : file d’écriture pleine."); return }
        pumpZwift(c)
    }
    private func pumpZwift(_ c: Connection) {
        guard c.peripheral.state == .connected, let char = c.chars[UUIDs.rx] else { return }
        let withoutResponse = char.properties.contains(.writeWithoutResponse)
        while let bytes = c.writes.next(writable: !withoutResponse || c.peripheral.canSendWriteWithoutResponse) {
            guard bytes.count <= c.peripheral.maximumWriteValueLength(for: withoutResponse ? .withoutResponse : .withResponse) else {
                c.cancelWrites(); log("\(c.name) : commande trop longue pour le lien BLE."); return
            }
            c.peripheral.writeValue(Data(bytes), for: char, type: withoutResponse ? .withoutResponse : .withResponse)
            if withoutResponse { c.writes.didWrite() }
            else {
                c.writeTimer?.invalidate()
                c.writeTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
                    guard let self, self.connections[c.peripheral.identifier] === c else { return }
                    self.log("\(c.name) : écriture sans acquittement. Reconnexion nécessaire.")
                    self.disconnect(c.peripheral.identifier)
                }
                return
            }
        }
    }
    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        if let c = connections[peripheral.identifier] { pumpZwift(c) }
    }
    func vibrate(_ id: UUID) {
        guard let c = connections[id], c.peripheral.state == .connected, let char = c.chars[UUIDs.rx] else { return }
        writeZwift(ZwiftProtocol.vibrate, to: c, char: char)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard !demo, let c = connections[peripheral.identifier] else { return }
        if let error { log("Lecture \(characteristic.uuid) : \(error.localizedDescription)"); return }
        let b = Array(characteristic.value ?? Data()), id = characteristic.uuid.uuidString.uppercased(), now = Date()
        do {
            if characteristic.uuid == UUIDs.async || characteristic.uuid == UUIDs.tx { try receiveZwift(b, c); return }
            if id == "2A19", let battery = b.first { c.battery = Int(battery); refresh(); return }
            if ["2A24", "2A26", "2A29"].contains(id) {
                let value = String(bytes: b, encoding: .utf8)?.trimmingCharacters(in: .controlCharacters)
                if id == "2A24" { c.deviceModel = value }
                if id == "2A26" { c.firmware = value }
                log("\(c.name) \(id) : \(value ?? "—")"); refresh(); return
            }
            if id == "2A37", peripheral.identifier == heartID || (peripheral.identifier == trainerID && heartID == nil) {
                let h = try BLEProtocol.heartRate(b); metrics.heartRate = h.bpm; heartContact = h.contact; lastHeart = now; return
            }
            guard peripheral.identifier == trainerID else { return }
            switch id {
            case "2AD2":
                let d = try BLEProtocol.indoorBike(b)
                if let v = d.power { metrics.power = v; ftmsPower = true; lastPower = now }
                if let v = d.cadence { metrics.cadence = v; ftmsCadence = true; lastCadence = now }
                if let v = d.speed { metrics.speed = v; lastSpeed = now }
                if let v = d.resistance { metrics.resistance = v }
                if let v = d.heartRate, heartID == nil { metrics.heartRate = v; lastHeart = now }
            case "2A63":
                let d = try BLEProtocol.cyclingPower(b)
                if !ftmsPower { metrics.power = d.power; lastPower = now }
                if !ftmsCadence, let revs = d.revs, let time = d.time {
                    metrics.cadence = crank.update(revs: revs, time: time, now: now.timeIntervalSinceReferenceDate); lastCadence = now
                }
            case "2ACC":
                guard b.count >= 8 else { throw PacketError.truncated }
                let flags = UInt32(b[4]) | UInt32(b[5]) << 8 | UInt32(b[6]) << 16 | UInt32(b[7]) << 24
                simulationSupported = flags & (1 << 13) != 0; ergSupported = flags & 8 != 0; resistanceSupported = flags & 4 != 0
                log("Fonctions : pente \(simulationSupported), ERG \(ergSupported), résistance \(resistanceSupported)")
            case "2AD6", "2AD8":
                var r = ByteReader(b); let lo = try r.i16(), hi = try r.i16(), step = try r.u16()
                guard lo <= hi else { throw PacketError.invalid }
                if id == "2AD8" { powerRange = Double(lo)...Double(hi); supportedPowerStep = Double(max(1, step)); targetWatts = min(powerRange.upperBound, max(powerRange.lowerBound, targetWatts)) }
                else { resistanceRange = Double(lo) / 10...Double(hi) / 10; supportedResistanceStep = Double(max(1, step)) / 10; targetResistance = min(resistanceRange.upperBound, max(resistanceRange.lowerBound, targetResistance)) }
            case "2AD9": queue.response(b); finishCommand()
            case "2ADA":
                log("Statut trainer : \(b.map { String(format: "%02x", $0) }.joined(separator: " "))")
                if b.first == 0xff || b.first == 1 || b.first == 3 || b.first == 2 {
                    controlled = false
                    if let pending = queue.pending, pending.first != 8 {
                        // End this GATT session so a delayed response cannot acknowledge a new request.
                        disconnect(peripheral.identifier)
                        controlStatus = "Contrôle perdu pendant une commande. Reconnecte le trainer."
                    } else if queue.pending == nil {
                        queue.clear(); commandTimer?.invalidate()
                        controlStatus = "Trainer arrêté ou contrôle perdu. Reprends le contrôle manuellement."
                    }
                }
            default: break
            }
        } catch { log("Paquet \(id) ignoré : tronqué ou invalide (\(b.count) octets).") }
    }
    private func receiveZwift(_ b: [UInt8], _ c: Connection) throws {
        if b.starts(with: ZwiftProtocol.rideOn) {
            guard b.count >= 8 else { log("\(c.name) : réponse RideOn tronquée."); return }
            c.handshake = true; c.connectionTimer?.invalidate()
            c.state = "RideOn reçu — appuie sur un bouton pour vérifier"
            log("\(c.name) : RideOn reçu, version \(b[6]).\(b[7]). Le décodage des boutons reste à confirmer.")
            refresh(); return
        }
        if b.first == 0x19 {
            let f = try ZwiftProtocol.fields(Array(b.dropFirst()))
            if let n = (f.last(where: { $0.number == 2 }) ?? f.last(where: { $0.number == 1 }))?.value, n <= 100 { c.battery = Int(n); refresh() }; return
        }
        if b.first == 0xfe { c.buttons = []; c.state = "Contrôle manette perdu"; log(c.state); refresh(); return }
        guard let buttons = try ZwiftProtocol.buttons(b) else {
            if let type = b.first, type != 0x15, c.seenUnknownTypes.insert(type).inserted {
                let sample = b.prefix(24).map { String(format: "%02x", $0) }.joined(separator: " ")
                log("\(c.name) : trame inconnue (\(b.count) octets) \(sample). Protocole/firmware à vérifier.")
            }
            return
        }
        c.state = "Boutons reçus"; c.connectionTimer?.invalidate()
        let down = buttons.pressed.subtracting(c.buttons)
        if c.buttons != buttons.pressed { log("\(c.name) : \(buttons.pressed.sorted().joined(separator: ", "))") }
        c.buttons = buttons.pressed
        for button in down.sorted() {
            lastAction = button
            if ["R_SHIFT", "R_SHIFT2"].contains(button) { shift(1) }
            if ["L_SHIFT", "L_SHIFT2"].contains(button) { shift(-1) }
        }
        refresh()
    }
    func takeControl() {
        if demo { controlled = true; controlStatus = "Contrôle simulé actif"; return }
        guard controlReady, !controlled, queue.pending == nil else { return }
        enqueue([0]); enqueue([7])
    }
    func applySimulation() {
        guard controlled, simulationSupported else { return }
        if demo { mode = "Simulation" }
        enqueue(BLEProtocol.simulation(grade: gears.grade(terrain)))
    }
    func applyERG() {
        guard controlled, ergSupported else { return }
        if demo { mode = "ERG" }
        let value = quantize(targetWatts, range: powerRange, step: supportedPowerStep)
        targetWatts = value; enqueue(BLEProtocol.targetPower(Int(value.rounded())))
    }
    func applyResistance() {
        guard controlled, resistanceSupported else { return }
        if demo { mode = "Résistance" }
        let value = quantize(targetResistance, range: resistanceRange, step: supportedResistanceStep)
        targetResistance = value; enqueue(BLEProtocol.resistance(value))
    }
    private func quantize(_ value: Double, range: ClosedRange<Double>, step: Double) -> Double {
        min(range.upperBound, max(range.lowerBound, range.lowerBound + ((value - range.lowerBound) / step).rounded() * step))
    }
    func shift(_ delta: Int) { gears.shift(delta); if mode == "Simulation" { applySimulation() } }
    func stopTrainer() {
        if demo { controlled = false; controlStatus = "Simulation arrêtée"; return }
        guard controlled else { return }
        queue.stop(); pump()
    }
    private func enqueue(_ bytes: [UInt8]) {
        if demo { controlStatus = "Démo · \(mode) · commande simulée"; return }
        queue.enqueue(bytes); pump()
    }
    private func pump() {
        guard let id = trainerID, let c = connections[id], c.peripheral.state == .connected,
              let cp = c.chars[CBUUID(string: "2AD9")], cp.isNotifying, let bytes = queue.next() else { return }
        controlStatus = "Commande en cours…"
        log("FTMS → \(bytes.map { String(format: "%02x", $0) }.joined(separator: " "))")
        c.peripheral.writeValue(Data(bytes), for: cp, type: .withResponse)
        commandTimer?.invalidate()
        commandTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            guard let self else { return }
            self.log("Délai FTMS dépassé. Déconnexion pour éviter une réponse tardive attribuée à une autre commande.")
            self.disconnect(id)
            self.controlStatus = "Trainer sans réponse. Reconnecte-le."
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            log("Écriture \(characteristic.uuid) : \(error.localizedDescription)")
            if (characteristic.uuid == CBUUID(string: "2AD9") && peripheral.identifier == trainerID) || characteristic.uuid == UUIDs.rx { disconnect(peripheral.identifier) }
            return
        }
        if characteristic.uuid == UUIDs.rx, let c = connections[peripheral.identifier] {
            c.writeTimer?.invalidate(); c.writes.didWrite(); pumpZwift(c)
        }
        if characteristic.uuid == CBUUID(string: "2AD9"), peripheral.identifier == trainerID { queue.didWrite(); finishCommand() }
    }
    private func finishCommand() {
        guard let response = queue.completed() else { return }
        commandTimer?.invalidate()
        if response.result == 1 {
            if response.opcode == 0 { controlled = true }
            if response.opcode == 0x11 { mode = "Simulation" }
            if response.opcode == 5 { mode = "ERG" }
            if response.opcode == 4 { mode = "Résistance" }
            if response.opcode == 8 { controlled = false; queue.clear() }
            controlStatus = response.opcode == 8 ? "Trainer arrêté" : "Commande confirmée par le trainer"
        } else {
            let names: [UInt8: String] = [2: "Opération non prise en charge", 3: "Paramètre invalide", 4: "Échec du trainer", 5: "Contrôle refusé"]
            controlStatus = names[response.result] ?? "Erreur FTMS \(response.result)"
            if response.opcode == 0 || response.opcode == 7 || response.result == 5 { controlled = false }
            queue.clear()
        }
        log(controlStatus); pump()
    }
    private func fail(_ c: Connection, _ message: String) { log("\(c.name) : \(message)"); disconnect(c.peripheral.identifier) }
    private func resetTrainer() {
        trainerID = nil; queue.clear(); commandTimer?.invalidate(); controlled = false; controlReady = false
        simulationSupported = false; ergSupported = false; resistanceSupported = false
        metrics.power = nil; metrics.cadence = nil; metrics.speed = nil; metrics.resistance = nil
        if heartID == nil { metrics.heartRate = nil }
        ftmsPower = false; ftmsCadence = false; crank = CrankCadence(); history = []
        powerRange = 0...1000; resistanceRange = 0...100; supportedPowerStep = 1; supportedResistanceStep = 0.1
        controlStatus = "Connecte un home trainer pour commencer."
    }
    private func refresh() {
        devices = connections.values.map { c in
            DeviceRow(id: c.peripheral.identifier, name: c.name, rssi: c.rssi, state: c.state,
                      connected: c.peripheral.state == .connected, busy: c.peripheral.state == .connecting || c.peripheral.state == .disconnecting,
                      battery: c.battery, role: c.role, buttons: c.buttons.sorted().joined(separator: " · "),
                      details: [c.model?.rawValue, c.deviceModel, c.firmware.map { "Firmware " + $0 }, c.model?.compatibilityNote].compactMap { $0 }.joined(separator: " · "))
        }.sorted { ($0.connected ? 0 : 1, $0.role == nil ? 1 : 0, $0.name, $0.id.uuidString) < ($1.connected ? 0 : 1, $1.role == nil ? 1 : 0, $1.name, $1.id.uuidString) }
    }
    func setDemo(_ enabled: Bool) {
        stopScan()
        for c in connections.values { c.connectionTimer?.invalidate(); c.cancelWrites(); if c.peripheral.state != .disconnected { central?.cancelPeripheralConnection(c.peripheral) } }
        connections.removeAll(); devices = []; resetTrainer(); heartID = nil; metrics = BikeReading(); heartContact = nil
        demo = enabled; gears = VirtualGears(); terrain = 0; mode = "Simulation"; demoTick = 0
        if enabled { controlReady = true; simulationSupported = true; ergSupported = true; resistanceSupported = true; controlStatus = "Démo prête · aucun appareil réel connecté"; tick() }
        log(enabled ? "Mode démo activé — mesures simulées" : "Mode Bluetooth réel activé")
    }
    private func tick() {
        if demo {
            demoTick += 1
            let wave = sin(Double(demoTick) / 7)
            metrics = BikeReading(speed: 28 + wave * 3, cadence: 85 + wave * 7, power: Int((mode == "ERG" && controlled ? targetWatts : 180) + wave * 25), heartRate: Int(125 + wave * 8))
        } else {
            let now = Date()
            if let lastPower, now.timeIntervalSince(lastPower) > 5 { metrics.power = nil; ftmsPower = false }
            if let lastCadence, now.timeIntervalSince(lastCadence) > 5 { metrics.cadence = nil; ftmsCadence = false }
            if let lastSpeed, now.timeIntervalSince(lastSpeed) > 5 { metrics.speed = nil }
            if let lastHeart, now.timeIntervalSince(lastHeart) > 5 { metrics.heartRate = nil; heartContact = nil }
        }
        if let power = metrics.power { history.append(PowerSample(date: Date(), watts: power)) }
        if history.count > 120 { history.removeFirst(history.count - 120) }
    }
}

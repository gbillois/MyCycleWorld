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
    static let trainerServices = [ftms, cps, hr, CBUUID(string: "180F"), CBUUID(string: "180A")]
    static let controlPoint = CBUUID(string: "2AD9")
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
    /// Rôle choisi à la connexion ; `suggested` vient de l'annonce et du profil matériel.
    var role: DeviceRole?
    var suggested: DeviceRole?
    var advertised: [String] = []
    var manufacturer: [UInt8] = []
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
    private static let profileKey = "mycycleworld.hw"
    /// Types mémorisés par machine (identifiant CoreBluetooth) : choisi à la main ou dernier détecté.
    private static let chosenKindsKey = "mycycleworld.kind.chosen"
    private static let seenKindsKey = "mycycleworld.kind.seen"
    /// Dernière machine et dernière ceinture connectées (identifiant et nom), pour la reconnexion.
    private static let knownTrainerKey = "mycycleworld.known.trainer"
    private static let knownHeartKey = "mycycleworld.known.heart"
    static let pilotIdle = "Tester le pilotage"

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
    /// La machine a refusé la prise de contrôle (ou n'a pas répondu) : lecture seule jusqu'à la reconnexion.
    @Published private(set) var readOnly = false
    @Published private(set) var simulationSupported = false
    @Published private(set) var ergSupported = false
    @Published private(set) var resistanceSupported = false
    @Published private(set) var powerRange = 0.0...1000.0
    @Published private(set) var resistanceRange = 0.0...100.0
    /// Plage publiée par la machine (nil si elle ne la donne pas : le jeu suppose alors 0 à 20, comme le web).
    @Published private(set) var resistanceLevels: LevelRange?
    @Published private(set) var gears = VirtualGears()
    @Published private(set) var controlStatus = "Connecte un home trainer pour commencer."
    @Published private(set) var lastAction = "Aucun bouton reçu"
    @Published private(set) var mode = "Simulation"
    /// Profil matériel (Zwift, Technogym, BLE standard) : filtre de la liste et textes de l'onglet Appareils.
    @Published private(set) var profile: HardwareProfile
    /// Type de la machine connectée : celui choisi pour cette machine s'il y en a un, sinon celui détecté
    /// d'après sa caractéristique de données (mémorisé par machine pour les connexions suivantes).
    @Published private(set) var machineKind: MachineKind?
    /// Type détecté à la connexion, et type choisi à la main pour la machine connectée (nil = automatique).
    @Published private(set) var detectedKind: MachineKind?
    @Published private(set) var kindOverride: MachineKind?
    /// Noms de la dernière machine et de la dernière ceinture connues (reconnexion depuis le jeu).
    @Published private(set) var knownTrainerName: String?
    @Published private(set) var knownHeartName: String?
    /// Une reconnexion automatique attend qu'un appareil connu se réveille.
    @Published private(set) var waitingReconnect = false
    @Published private(set) var trainerServices: [String] = []
    @Published private(set) var trainerPackets = 0
    @Published private(set) var trainerLastPacket: Date?
    @Published private(set) var pilotStatus = BluetoothStore.pilotIdle
    @Published private(set) var pilotRunning = false
    @Published var terrain = 0.0
    @Published var targetWatts = 150.0
    @Published var targetResistance = 10.0
    /// Appuis et relâchements des boutons Zwift, pour le jeu (voir GameView).
    let buttonEvents = PassthroughSubject<ButtonEvent, Never>()
    private var central: CBCentralManager?
    private var connections: [UUID: Connection] = [:]
    private var trainerID: UUID?
    private var heartID: UUID?
    private var scanTimer: Timer?
    private var tickTimer: Timer?
    private var commandTimer: Timer?
    private var pilotTimer: Timer?
    private var queue = ControlQueue()
    private var feed = TrainerFeed()
    private var heart: Int?, lastHeart: Date?
    private var gradeResistance = GradeResistance()
    private var encoder = ResistanceEncoder()
    private var lastSent: [UInt8]?
    private var lastResistanceLevel: Double?
    private var pilotResults: [UInt8] = []
    private var dataSampler = PacketSampler(first: 5, every: 200)
    /// Caractéristiques hors standard : quelques paquets bruts de chacune, pour le journal.
    private var otherSamplers: [String: PacketSampler] = [:]
    /// Abonnement aux données de la machine : instant, et avertissement « aucune donnée » déjà donné.
    private var subscribedAt: Date?
    private var noDataWarned = false
    private var demoTick = 0
    private var demoDistance = 0.0
    private var requestScan = false
    /// Reconnexion demandée avant que le Bluetooth soit prêt.
    private var requestReconnect = false
    /// Appareils en attente de reconnexion automatique (connexion sans délai : iOS la mène à bien dès que
    /// l'appareil réapparaît, même des minutes plus tard).
    private var waiting: Set<UUID> = [] { didSet { waitingReconnect = !waiting.isEmpty } }
    /// Déconnexions voulues (bouton, échec, délai) : pas de reconnexion automatique après celles-là.
    private var intentional: Set<UUID> = []
    private var supportedPowerStep = 1.0, supportedResistanceStep = 0.1
    var activeConnectionCount: Int { devices.filter(\.connected).count }
    var trainerRow: DeviceRow? { devices.first { $0.role == .trainer && $0.connected } }
    /// Comment la pente du jeu est appliquée (simulation, résistance, ou rien en lecture seule).
    var gradeControl: GradeControl {
        readOnly ? .none : GradeControl.choose(kind: machineKind, simulation: simulationSupported, resistance: resistanceSupported)
    }
    var canTestPilot: Bool { demo || (trainerID != nil && controlReady && gradeControl != .none) }
    var report: String {
        (["MyCycleWorld iOS 1.0 (1)", "Mode : \(demo ? "DÉMO" : "Bluetooth réel")", "Profil : \(profile.label)",
          "Machine : \(machineKind?.label ?? "aucune")", bluetoothState] + logs).joined(separator: "\n")
    }

    override init() {
        profile = HardwareProfile(rawValue: UserDefaults.standard.string(forKey: BluetoothStore.profileKey) ?? "") ?? .zwift
        super.init()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.tick() }
        if ProcessInfo.processInfo.arguments.contains("--demo") { setDemo(true) }
        knownTrainerName = known(BluetoothStore.knownTrainerKey)?.name
        knownHeartName = known(BluetoothStore.knownHeartKey)?.name
        // Machine ou ceinture déjà connue : connexion en attente dès le lancement, aboutit quand elle se réveille.
        if !demo, knownTrainerName != nil || knownHeartName != nil {
            requestReconnect = true
            central = CBCentralManager(delegate: self, queue: .main)
        }
    }
    func log(_ message: String) {
        logs.append("\(Date().formatted(date: .omitted, time: .standard))  \(message)")
        if logs.count > 2000 { logs.removeFirst(logs.count - 2000) }
    }
    func clearLog() { logs.removeAll() }
    func setProfile(_ value: HardwareProfile) {
        guard value != profile else { return }
        profile = value
        UserDefaults.standard.set(value.rawValue, forKey: BluetoothStore.profileKey)
        for c in connections.values { c.suggested = value.role(name: c.name, services: c.advertised, manufacturer: c.manufacturer) }
        if demo { machineKind = value == .technogym ? .rower : .bike; demoDistance = 0 }
        log("Profil matériel : \(value.label)")
        refresh()
    }
    func scan() {
        guard !demo else { return }
        requestScan = true
        if central == nil { central = CBCentralManager(delegate: self, queue: .main); return }
        guard poweredOn else { return }
        requestScan = false
        // Foreground broad scan also discovers Zwift manufacturer-only and Technogym name-only advertisements.
        central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        scanning = true
        log("Recherche Bluetooth (30 s), profil \(profile.label). Réveille les appareils et ferme les autres applis de vélo.")
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
        if poweredOn && requestReconnect { requestReconnect = false; reconnectKnown() }
        if !poweredOn && !demo {
            scanning = false
            for c in connections.values { c.connectionTimer?.invalidate(); c.cancelWrites(); c.state = "Déconnecté"; c.chars = [:]; c.buttons = [] }
            resetTrainer(); heartID = nil; heart = nil; heartContact = nil; metrics = BikeReading(); refresh()
            waiting = []; requestReconnect = true // reconnexion quand le Bluetooth revient
        }
        log(bluetoothState)
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name ?? "Appareil sans nom"
        let advertised = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []).map { $0.uuidString.uppercased() }
        let manufacturer = Array(advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data ?? Data())
        let c = connections[peripheral.identifier] ?? Connection(peripheral, name: name, rssi: RSSI.intValue)
        c.rssi = RSSI.intValue; c.name = name
        if !advertised.isEmpty { c.advertised = advertised }
        if !manufacturer.isEmpty { c.manufacturer = manufacturer }
        c.model = ZwiftModel.fromManufacturerData(manufacturer) ?? c.model
        c.suggested = profile.role(name: name, services: c.advertised, manufacturer: c.manufacturer) ?? c.suggested
        connections[peripheral.identifier] = c
        refresh()
    }
    /// `auto` : reconnexion d'un appareil connu, sans délai d'expiration (iOS attend qu'il se réveille).
    func connect(_ id: UUID, role: DeviceRole, auto: Bool = false) {
        guard !demo, poweredOn, let c = connections[id], c.peripheral.state == .disconnected else { return }
        intentional.remove(id)
        if role == .trainer, let old = trainerID, old != id { disconnect(old) }
        if role == .heart, let old = heartID, old != id { disconnect(old) }
        c.cancelWrites(); c.seenUnknownTypes = []; c.deviceModel = nil; c.firmware = nil
        c.role = role; c.state = "Connexion…"; c.chars = [:]; c.buttons = []; c.handshakeSent = false; c.handshake = false
        if role == .trainer {
            resetTrainer(); trainerID = id
            // Type mémorisé pour cette machine : connu du jeu dès la connexion.
            kindOverride = savedKind(for: id, key: BluetoothStore.chosenKindsKey)
            detectedKind = savedKind(for: id, key: BluetoothStore.seenKindsKey)
            applyKind()
            if let kind = machineKind { log("Type mémorisé pour cette machine : \(kind.label)\(kindOverride != nil ? " (choisi)" : "")") }
        }
        if role == .heart { heartID = id; heartContact = nil; heart = nil; updateMetrics() }
        c.peripheral.delegate = self
        central?.connect(c.peripheral)
        c.connectionTimer?.invalidate()
        if auto {
            waiting.insert(id)
            c.state = "En attente : réveille l’appareil"
            log("Reconnexion automatique de \(c.name) : elle aboutira dès que l’appareil se réveille (un coup de rame, de pédale…).")
            refresh(); return
        }
        waiting.remove(id)
        c.connectionTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: false) { [weak self] _ in
            guard let self, c.peripheral.state == .connecting else { return }
            self.log("Connexion expirée : \(c.name)"); self.disconnect(id)
        }
        log("Connexion à \(c.name) : \(profile.label(for: role))"); refresh()
    }
    func disconnect(_ id: UUID) {
        guard let c = connections[id] else { return }
        intentional.insert(id)
        if waiting.remove(id) != nil, c.peripheral.state == .connecting {
            // Reconnexion en attente annulée : iOS ne prévient pas toujours.
            central?.cancelPeripheralConnection(c.peripheral)
            if trainerID == id { resetTrainer() }
            if heartID == id { heartID = nil }
            c.state = "Déconnecté"; intentional.remove(id); refresh(); return
        }
        c.connectionTimer?.invalidate(); c.cancelWrites(); c.buttons = []; c.state = "Déconnexion…"
        if trainerID == id { resetTrainer() }
        if heartID == id { heartID = nil; heart = nil; heartContact = nil; updateMetrics() }
        central?.cancelPeripheralConnection(c.peripheral); refresh()
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard let c = connections[peripheral.identifier] else { return }
        waiting.remove(peripheral.identifier)
        if c.role == .trainer || c.role == .heart { rememberKnown(c) }
        c.connectionTimer?.invalidate(); c.state = "Découverte des services…"
        // Machine : tous les services, pour le test de connexion (CoreBluetooth n'a pas besoin de liste).
        peripheral.discoverServices(c.role == .trainer ? nil : UUIDs.services); refresh()
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) { disconnected(peripheral, error) }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) { disconnected(peripheral, error) }
    private func disconnected(_ peripheral: CBPeripheral, _ error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        let id = peripheral.identifier
        let wanted = intentional.remove(id) != nil
        let role = c.role
        waiting.remove(id)
        c.connectionTimer?.invalidate(); c.cancelWrites(); c.state = "Déconnecté"; c.chars = [:]; c.buttons = []; c.handshakeSent = false; c.handshake = false
        if trainerID == peripheral.identifier { resetTrainer() }
        if heartID == peripheral.identifier { heartID = nil; heart = nil; heartContact = nil; updateMetrics() }
        // Machine ou ceinture perdue sans qu'on l'ait demandé (rameur qui se met en veille, hors de portée) :
        // connexion remise en attente, elle reviendra toute seule dès que l'appareil se réveille.
        if !wanted, !demo, poweredOn, let role, role == .trainer || role == .heart {
            log("\(c.name) déconnecté\(error.map { ": " + $0.localizedDescription } ?? "").")
            refresh()
            Timer.scheduledTimer(withTimeInterval: 1.5, repeats: false) { [weak self] _ in
                guard let self, self.connections[id] === c, c.peripheral.state == .disconnected, !self.intentional.contains(id) else { return }
                if role == .trainer, let other = self.trainerID, other != id { return }
                if role == .heart, let other = self.heartID, other != id { return }
                self.connect(id, role: role, auto: true)
            }
            return
        }
        log("\(c.name) déconnecté\(error.map { ": " + $0.localizedDescription } ?? ""). Reconnexion manuelle disponible."); refresh()
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        if let error { fail(c, error.localizedDescription); return }
        let services = peripheral.services ?? []
        if c.role == .trainer && peripheral.identifier == trainerID {
            trainerServices = services.map { GATTText.plainName($0.uuid.uuidString) }
            log("Services : \(services.map { GATTText.name($0.uuid.uuidString) }.joined(separator: ", "))")
            let ftms = services.contains { $0.uuid == UUIDs.ftms }, cps = services.contains { $0.uuid == UUIDs.cps }
            log("FTMS : \(ftms ? "oui" : "non") · Cycling Power : \(cps ? "oui" : "non") · Cardio intégré : \(services.contains { $0.uuid == UUIDs.hr } ? "oui" : "non")")
        }
        let required = c.role == .trainer ? [UUIDs.ftms, UUIDs.cps] : c.role == .heart ? [UUIDs.hr] : [UUIDs.zwift2, UUIDs.zwift]
        guard services.contains(where: { required.contains($0.uuid) }) else {
            if c.role == .controller {
                c.state = "Service Zwift absent : compatibilité du firmware à vérifier"
                log("\(c.name) : \(c.state). Certains modèles récents nécessitent une activation spécifique non implémentée ici.")
                // Retain the connection long enough to read model/firmware even when the custom service is hidden.
                for service in services where [CBUUID(string: "180A"), CBUUID(string: "180F")].contains(service.uuid) {
                    peripheral.discoverCharacteristics(nil, for: service)
                }
                refresh()
            } else if c.role == .trainer {
                fail(c, "ni FTMS ni Cycling Power : machine non standard (protocole propriétaire ?). Lance l’inspecteur BLE (Appareils > Inspecteur BLE) et partage son journal.")
            } else { fail(c, "Service attendu absent pour ce type d’appareil.") }
            return
        }
        let preferredZwift = services.contains(where: { $0.uuid == UUIDs.zwift2 }) ? UUIDs.zwift2 : UUIDs.zwift
        for service in services {
            if [UUIDs.zwift, UUIDs.zwift2].contains(service.uuid) && (c.role != .controller || service.uuid != preferredZwift) { continue }
            // Machine : tous les services, y compris propriétaires (Technogym) et capteurs vélo / course.
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
            let notify = c.role == .heart ? ["2A37"] : [UUIDs.async.uuidString, UUIDs.tx.uuidString]
            let canNotify = char.properties.contains(.notify) || char.properties.contains(.indicate)
            // Machine : abonnement à tout ce qui se notifie (données FTMS, capteurs, services propriétaires) :
            // certaines consoles n'envoient leurs mesures que sur une partie de ces caractéristiques.
            if canNotify, c.role == .trainer || notify.contains(id) { peripheral.setNotifyValue(true, for: char) }
            if ["2ACC", "2AD6", "2AD8", "2A19", "2A24", "2A26", "2A29"].contains(id), char.properties.contains(.read) { peripheral.readValue(for: char) }
        }
        if c.role == .controller, [UUIDs.zwift, UUIDs.zwift2].contains(service.uuid),
           [UUIDs.async, UUIDs.rx, UUIDs.tx].contains(where: { c.chars[$0] == nil }) {
            c.state = "Caractéristiques Zwift incomplètes"; log("\(c.name) : \(c.state)")
        }
        tryHandshake(c)
        if c.role == .trainer && peripheral.identifier == trainerID {
            let kind = MachineKind.detect(characteristics: Set(c.chars.keys.map { $0.uuidString.uppercased() }))
            if kind != detectedKind, let kind {
                detectedKind = kind
                log("Type de machine détecté : \(kind.label)\(kind == .power ? " (Cycling Power)" : " (FTMS)")")
                if kind == .treadmill { log("Tapis de course : puissance estimée depuis la vitesse et la pente.") }
                remember(kind, for: peripheral.identifier, key: BluetoothStore.seenKindsKey)
                applyKind()
            }
            if service.uuid == UUIDs.ftms, c.chars[UUIDs.controlPoint] == nil {
                controlStatus = "Machine connectée en lecture seule (pas de Control Point FTMS)."
                log(controlStatus)
            }
        }
        refresh()
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard let c = connections[peripheral.identifier] else { return }
        if let error {
            log("Abonnement \(GATTText.name(characteristic.uuid.uuidString)) : \(error.localizedDescription)")
            if c.role == .controller { c.state = "Échec d’abonnement Zwift"; refresh() }
            return
        }
        if peripheral.identifier == trainerID && c.role == .trainer {
            log("Abonné : \(GATTText.name(characteristic.uuid.uuidString))")
            if ["2AD2", "2AD1", "2ACE", "2ACD", "2A63", "2A53"].contains(characteristic.uuid.uuidString.uppercased()), subscribedAt == nil {
                subscribedAt = Date()
            }
        }
        if peripheral.identifier == trainerID && characteristic.uuid == UUIDs.controlPoint {
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
            c.state = "RideOn sans réponse : essaie un bouton"
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
    /// Fait vibrer toutes les manettes Zwift connectées (peau de banane dans le jeu).
    func vibrateControllers() {
        for (id, c) in connections where c.role == .controller { vibrate(id) }
    }
    func vibrate(_ id: UUID) {
        guard let c = connections[id], c.peripheral.state == .connected, let char = c.chars[UUIDs.rx] else { return }
        writeZwift(ZwiftProtocol.vibrate, to: c, char: char)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard !demo, let c = connections[peripheral.identifier] else { return }
        if let error { log("Lecture \(GATTText.name(characteristic.uuid.uuidString)) : \(error.localizedDescription)"); return }
        let b = Array(characteristic.value ?? Data()), id = characteristic.uuid.uuidString.uppercased(), now = Date()
        do {
            if characteristic.uuid == UUIDs.async || characteristic.uuid == UUIDs.tx { try receiveZwift(b, c); return }
            if id == "2A19", let battery = b.first { c.battery = Int(battery); refresh(); return }
            if ["2A24", "2A26", "2A29"].contains(id) {
                let value = String(bytes: b, encoding: .utf8)?.trimmingCharacters(in: .controlCharacters)
                if id == "2A24" { c.deviceModel = value }
                if id == "2A26" { c.firmware = value }
                log("\(c.name) \(GATTText.plainName(id)) : \(value ?? "-")"); refresh(); return
            }
            if id == "2A37", peripheral.identifier == heartID || (peripheral.identifier == trainerID && heartID == nil) {
                let h = try BLEProtocol.heartRate(b); heart = h.bpm; heartContact = h.contact; lastHeart = now; updateMetrics(); return
            }
            guard peripheral.identifier == trainerID else { return }
            switch id {
            case "2AD2", "2AD1", "2ACE", "2ACD":
                if dataSampler.sample() { log("\(GATTText.plainName(id)) : \(GATTText.hex(b))") }
                let kind: MachineKind
                let d: BikeReading
                switch id {
                case "2AD1": kind = .rower; d = try BLEProtocol.rower(b)
                case "2ACE": kind = .cross; d = try BLEProtocol.crossTrainer(b)
                case "2ACD": kind = .treadmill; d = try BLEProtocol.treadmill(b)
                default: kind = .bike; d = try BLEProtocol.indoorBike(b)
                }
                for change in feed.ftms(d, kind: kind, now: now.timeIntervalSinceReferenceDate) { log(change) }
                packetReceived(now)
            case "2A53":
                if dataSampler.sample() { log("Running Speed and Cadence : \(GATTText.hex(b))") }
                let d = try BLEProtocol.runningSpeed(b)
                for change in feed.runningSpeed(speed: d.speed, cadence: d.cadence, now: now.timeIntervalSinceReferenceDate) { log(change) }
                packetReceived(now)
            case "2A63":
                if dataSampler.sample() { log("Cycling Power : \(GATTText.hex(b))") }
                let d = try BLEProtocol.cyclingPower(b)
                for change in feed.cyclingPower(power: d.power, revs: d.revs, time: d.time, now: now.timeIntervalSinceReferenceDate) { log(change) }
                packetReceived(now)
            case "2ACC":
                guard b.count >= 8 else { throw PacketError.truncated }
                let flags = UInt32(b[4]) | UInt32(b[5]) << 8 | UInt32(b[6]) << 16 | UInt32(b[7]) << 24
                simulationSupported = flags & (1 << 13) != 0; ergSupported = flags & 8 != 0; resistanceSupported = flags & 4 != 0
                log("Consignes FTMS : pente \(simulationSupported ? "oui" : "non"), ERG \(ergSupported ? "oui" : "non"), résistance \(resistanceSupported ? "oui" : "non")")
            case "2AD6", "2AD8":
                if id == "2AD8" {
                    var r = ByteReader(b); let lo = try r.i16(), hi = try r.i16(), step = try r.u16()
                    guard lo <= hi else { throw PacketError.invalid }
                    powerRange = Double(lo)...Double(hi); supportedPowerStep = Double(max(1, step)); targetWatts = min(powerRange.upperBound, max(powerRange.lowerBound, targetWatts))
                } else {
                    let range = try BLEProtocol.resistanceRange(b)
                    resistanceLevels = range
                    resistanceRange = range.min...range.max; supportedResistanceStep = max(0.1, range.step)
                    targetResistance = min(resistanceRange.upperBound, max(resistanceRange.lowerBound, targetResistance))
                    log("Plage de résistance : \(MachineText.number(range.min)) à \(MachineText.number(range.max)) (pas \(MachineText.number(range.step)))")
                }
            case "2AD9": queue.response(b); finishCommand()
            case "2ADA":
                log("Statut machine : \(GATTText.hex(b))")
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
            default:
                // Caractéristique hors standard (service propriétaire, capteur de vitesse et cadence…) :
                // quelques paquets bruts dans le journal pour comprendre une machine qui n'envoie rien en FTMS.
                guard !["2A19", "2A24", "2A26", "2A29", "2A37"].contains(id) else { break }
                var sampler = otherSamplers[id] ?? PacketSampler(first: 4, every: 500)
                if sampler.sample() { log("Données \(GATTText.name(characteristic.uuid.uuidString)) : \(GATTText.hex(b))") }
                otherSamplers[id] = sampler
            }
        } catch { log("Paquet \(GATTText.name(id)) ignoré : tronqué ou invalide (\(b.count) octets : \(GATTText.hex(b))).") }
    }
    private func packetReceived(_ now: Date) {
        trainerPackets = feed.packets
        trainerLastPacket = now
        updateMetrics()
    }
    /// Mesures affichées : celles de la machine, avec le cardio de la ceinture quand elle est connectée.
    private func updateMetrics() {
        var m = feed.data
        if heartID != nil { m.heartRate = heart } else if let heart { m.heartRate = heart }
        metrics = m
    }
    private func receiveZwift(_ b: [UInt8], _ c: Connection) throws {
        if b.starts(with: ZwiftProtocol.rideOn) {
            guard b.count >= 8 else { log("\(c.name) : réponse RideOn tronquée."); return }
            c.handshake = true; c.connectionTimer?.invalidate()
            c.state = "RideOn reçu : appuie sur un bouton pour vérifier"
            log("\(c.name) : RideOn reçu, version \(b[6]).\(b[7]). Le décodage des boutons reste à confirmer.")
            refresh(); return
        }
        if b.first == 0x19 {
            let f = try ZwiftProtocol.fields(Array(b.dropFirst()))
            if let n = (f.last(where: { $0.number == 2 }) ?? f.last(where: { $0.number == 1 }))?.value, n <= 100 { c.battery = Int(n); refresh() }; return
        }
        if b.first == 0xfe {
            for button in c.buttons.sorted() { buttonEvents.send(ButtonEvent(button: button, down: false)) }
            c.buttons = []; c.state = "Contrôle manette perdu"; log(c.state); refresh(); return
        }
        guard let buttons = try ZwiftProtocol.buttons(b) else {
            if let type = b.first, type != 0x15, c.seenUnknownTypes.insert(type).inserted {
                let sample = b.prefix(24).map { String(format: "%02x", $0) }.joined(separator: " ")
                log("\(c.name) : trame inconnue (\(b.count) octets) \(sample). Protocole/firmware à vérifier.")
            }
            return
        }
        c.state = "Boutons reçus"; c.connectionTimer?.invalidate()
        let down = buttons.pressed.subtracting(c.buttons)
        let up = c.buttons.subtracting(buttons.pressed)
        if c.buttons != buttons.pressed { log("\(c.name) : \(buttons.pressed.sorted().joined(separator: ", "))") }
        c.buttons = buttons.pressed
        for button in up.sorted() { buttonEvents.send(ButtonEvent(button: button, down: false)) }
        for button in down.sorted() {
            lastAction = button
            buttonEvents.send(ButtonEvent(button: button, down: true))
            if ["R_SHIFT", "R_SHIFT2"].contains(button) { shift(1) }
            if ["L_SHIFT", "L_SHIFT2"].contains(button) { shift(-1) }
        }
        refresh()
    }
    func takeControl() {
        if demo { controlled = true; controlStatus = "Contrôle simulé actif"; return }
        guard controlReady, !readOnly, !controlled, queue.pending == nil else { return }
        enqueue([0]); enqueue([7])
    }
    func applySimulation() {
        guard controlled, simulationSupported else { return }
        if demo { mode = "Simulation" }
        enqueue(BLEProtocol.simulation(grade: gears.grade(terrain)))
    }
    /// Pente du jeu (avant vitesses virtuelles) : simulation pour un vélo, niveau de résistance pour
    /// un elliptique ou un rameur (même calcul que setResistanceForGrade côté web).
    func applyGameGrade(_ grade: Double) {
        terrain = grade
        switch gradeControl {
        case .simulation: applySimulation()
        case .resistance: applyGradeResistance()
        case .none: break
        }
    }
    private func applyGradeResistance() {
        guard controlled, resistanceSupported,
              let level = gradeResistance.next(grade: gears.grade(terrain), range: resistanceLevels) else { return }
        if demo { mode = "Résistance"; targetResistance = level }
        sendResistance(level)
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
        targetResistance = value; sendResistance(value)
    }
    private func sendResistance(_ level: Double) {
        lastResistanceLevel = level
        enqueue(encoder.encode(level))
    }
    private func quantize(_ value: Double, range: ClosedRange<Double>, step: Double) -> Double {
        min(range.upperBound, max(range.lowerBound, range.lowerBound + ((value - range.lowerBound) / step).rounded() * step))
    }
    func shift(_ delta: Int) {
        gears.shift(delta)
        switch gradeControl {
        case .simulation: if mode == "Simulation" { applySimulation() }
        case .resistance: applyGradeResistance()
        case .none: break
        }
    }
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
              let cp = c.chars[UUIDs.controlPoint], cp.isNotifying, let bytes = queue.next() else { return }
        controlStatus = "Commande en cours…"
        lastSent = bytes
        log("FTMS → \(GATTText.hex(bytes))")
        c.peripheral.writeValue(Data(bytes), for: cp, type: .withResponse)
        commandTimer?.invalidate()
        commandTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            guard let self else { return }
            if let op = self.queue.pending?.first, op == 0 || op == 7 {
                // Certaines machines (Technogym notamment) ignorent la demande de contrôle : on reste en lecture seule.
                // Une réponse tardive ne peut pas valider une autre commande : les réponses sont associées à l'opcode.
                if op == 0 {
                    self.queue.clear()
                    self.controlled = false; self.readOnly = true
                    self.controlStatus = "Pas de réponse à la demande de contrôle : lecture seule, la résistance ne sera pas pilotée."
                } else {
                    self.queue.abandon()
                    self.controlStatus = "Démarrage sans réponse : pilotage quand même actif."
                }
                self.log(self.controlStatus)
                self.pump()
                return
            }
            self.log("Délai FTMS dépassé. Déconnexion pour éviter une réponse tardive attribuée à une autre commande.")
            self.disconnect(id)
            self.controlStatus = "Trainer sans réponse. Reconnecte-le."
        }
    }
    func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
        if let error {
            log("Écriture \(GATTText.name(characteristic.uuid.uuidString)) : \(error.localizedDescription)")
            if (characteristic.uuid == UUIDs.controlPoint && peripheral.identifier == trainerID) || characteristic.uuid == UUIDs.rx { disconnect(peripheral.identifier) }
            return
        }
        if characteristic.uuid == UUIDs.rx, let c = connections[peripheral.identifier] {
            c.writeTimer?.invalidate(); c.writes.didWrite(); pumpZwift(c)
        }
        if characteristic.uuid == UUIDs.controlPoint, peripheral.identifier == trainerID { queue.didWrite(); finishCommand() }
    }
    private func finishCommand() {
        guard let response = queue.completed() else { return }
        commandTimer?.invalidate()
        if response.result != 1, response.opcode == 4, let sent = lastSent, encoder.refused(sent, result: response.result), let level = lastResistanceLevel {
            // Niveau sur un octet refusé : certaines machines attendent la forme sur deux octets.
            log("Niveau de résistance sur 1 octet refusé : nouvel essai sur 2 octets.")
            queue.enqueue(encoder.encode(level)); pump(); return
        }
        if pilotRunning && [0x04, 0x11].contains(response.opcode) { pilotResults.append(response.result) }
        let names: [UInt8: String] = [2: "opération non prise en charge", 3: "paramètre invalide", 4: "échec de la machine", 5: "contrôle refusé"]
        if response.result == 1 {
            if response.opcode == 0 { controlled = true; gradeResistance.reset() }
            if response.opcode == 0x11 { mode = "Simulation" }
            if response.opcode == 5 { mode = "ERG" }
            if response.opcode == 4 { mode = "Résistance" }
            if response.opcode == 8 { controlled = false; queue.clear() }
            controlStatus = response.opcode == 8 ? "Trainer arrêté" : "Commande confirmée par la machine"
        } else if response.opcode == 0 {
            // Request Control refusé (fréquent sur Technogym) : on continue en lecture seule.
            controlled = false; readOnly = true; queue.clear()
            controlStatus = "Contrôle refusé (\(names[response.result] ?? "code \(response.result)")) : lecture seule, la résistance ne sera pas pilotée."
        } else if response.opcode == 7 {
            // Start refusé : le jeu web l'ignore aussi, le pilotage reste possible.
            controlStatus = "Démarrage refusé (\(names[response.result] ?? "code \(response.result)")) : pilotage quand même actif."
        } else {
            let titles: [UInt8: String] = [2: "Opération non prise en charge", 3: "Paramètre invalide", 4: "Échec du trainer", 5: "Contrôle refusé"]
            controlStatus = titles[response.result] ?? "Erreur FTMS \(response.result)"
            if response.result == 5 { controlled = false }
            queue.clear()
        }
        log(controlStatus); pump()
    }

    // MARK: Test du pilotage

    /// Un peu plus dur pendant 5 s, puis retour : pente 6 % puis 0 pour un vélo, résistance 70 % puis 30 % sinon.
    func testPilot() {
        guard !pilotRunning else { return }
        pilotRunning = true
        pilotResults = []
        if demo {
            pilotStatus = "Plus dur pendant 5 s…"
            pilotTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in self?.finishPilot("Pilotage OK ✓ (démo)") }
            return
        }
        guard canTestPilot else { finishPilot("Échec : pilotage impossible (\(readOnly ? "lecture seule" : "aucune consigne prise en charge"))"); return }
        pilotStatus = "Prise de contrôle…"
        log("Test du pilotage : début")
        if !controlled { takeControl() }
        waitForControl(until: Date().addingTimeInterval(7))
    }
    private func waitForControl(until deadline: Date) {
        pilotTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: false) { [weak self] _ in
            guard let self, self.pilotRunning else { return }
            if self.controlled { self.pilotHard() }
            else if self.readOnly || self.trainerID == nil || Date() > deadline { self.finishPilot("Échec : \(self.controlStatus)") }
            else { self.waitForControl(until: deadline) }
        }
    }
    private func pilotCommand(hard: Bool) -> Bool {
        switch gradeControl {
        case .simulation: enqueue(BLEProtocol.simulation(grade: hard ? 6 : 0)); return true
        case .resistance: sendResistance((resistanceLevels ?? .fallback).level(at: hard ? 0.7 : 0.3)); return true
        case .none: return false
        }
    }
    private func pilotHard() {
        guard pilotCommand(hard: true) else { finishPilot("Échec : la machine n’accepte ni pente ni résistance"); return }
        pilotStatus = "Plus dur pendant 5 s…"
        pilotTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in
            guard let self, self.pilotRunning else { return }
            _ = self.pilotCommand(hard: false)
            self.pilotStatus = "Retour à la normale…"
            self.pilotTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in
                guard let self, self.pilotRunning else { return }
                if self.pilotResults.isEmpty { self.finishPilot("Échec : pas de réponse de la machine") }
                else if self.pilotResults.allSatisfy({ $0 == 1 }) { self.finishPilot("Pilotage OK ✓") }
                else { self.finishPilot("Échec : \(self.controlStatus)") }
            }
        }
    }
    private func finishPilot(_ text: String) {
        pilotStatus = text
        log("Test du pilotage : \(text)")
        // Le jeu renverra sa consigne : on oublie le dernier niveau envoyé.
        gradeResistance.reset()
        pilotTimer?.invalidate()
        pilotTimer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: false) { [weak self] _ in
            self?.pilotRunning = false
            self?.pilotStatus = BluetoothStore.pilotIdle
        }
    }

    /// Reconnecte la dernière machine et la dernière ceinture connues (bouton du jeu, lancement de l'appli) :
    /// connexions en attente, sans délai, qui aboutissent dès que les appareils se réveillent.
    func reconnectKnown() {
        guard !demo else { return }
        guard let central, poweredOn else {
            requestReconnect = true
            if central == nil { central = CBCentralManager(delegate: self, queue: .main) }
            return
        }
        for (key, role) in [(BluetoothStore.knownTrainerKey, DeviceRole.trainer), (BluetoothStore.knownHeartKey, DeviceRole.heart)] {
            guard let k = known(key) else { continue }
            if let c = connections[k.id], c.peripheral.state != .disconnected { continue }
            if connections[k.id] == nil {
                guard let p = central.retrievePeripherals(withIdentifiers: [k.id]).first else {
                    log("\(k.name) : appareil introuvable, relance une recherche."); continue
                }
                connections[k.id] = Connection(p, name: k.name, rssi: 0)
            }
            connect(k.id, role: role, auto: true)
        }
        refresh()
    }
    private struct Known: Codable {
        var id: UUID
        var name: String
    }
    private func known(_ key: String) -> Known? {
        UserDefaults.standard.data(forKey: key).flatMap { try? JSONDecoder().decode(Known.self, from: $0) }
    }
    private func rememberKnown(_ c: Connection) {
        let key = c.role == .heart ? BluetoothStore.knownHeartKey : BluetoothStore.knownTrainerKey
        guard let data = try? JSONEncoder().encode(Known(id: c.peripheral.identifier, name: c.name)) else { return }
        UserDefaults.standard.set(data, forKey: key)
        if c.role == .heart { knownHeartName = c.name } else { knownTrainerName = c.name }
    }

    /// Type choisi à la main pour la machine connectée (nil = automatique), mémorisé pour cette machine.
    func setKindOverride(_ kind: MachineKind?) {
        guard let id = trainerID else { return }
        kindOverride = kind
        remember(kind, for: id, key: BluetoothStore.chosenKindsKey)
        log(kind.map { "Type de machine choisi : \($0.label) (mémorisé pour cette machine)" } ?? "Type de machine : automatique")
        applyKind()
    }
    private func remember(_ kind: MachineKind?, for id: UUID, key: String) {
        var saved = UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
        saved[id.uuidString] = kind?.rawValue
        UserDefaults.standard.set(saved, forKey: key)
    }
    private func savedKind(for id: UUID, key: String) -> MachineKind? {
        let saved = UserDefaults.standard.dictionary(forKey: key) as? [String: String] ?? [:]
        return saved[id.uuidString].flatMap(MachineKind.init(rawValue:))
    }
    /// Type utilisé par le jeu et la résistance : choisi, sinon détecté.
    private func applyKind() {
        let kind = kindOverride ?? detectedKind
        if kind != machineKind { machineKind = kind }
    }
    /// Type de la machine (choisi, sinon dernier détecté) avant même la découverte des services.
    func rememberedKind(for id: UUID) -> MachineKind? {
        savedKind(for: id, key: BluetoothStore.chosenKindsKey) ?? savedKind(for: id, key: BluetoothStore.seenKindsKey)
    }

    private func fail(_ c: Connection, _ message: String) { log("\(c.name) : \(message)"); disconnect(c.peripheral.identifier) }
    private func resetTrainer() {
        trainerID = nil; queue.clear(); commandTimer?.invalidate(); controlled = false; controlReady = false; readOnly = false
        simulationSupported = false; ergSupported = false; resistanceSupported = false
        feed = TrainerFeed(); dataSampler = PacketSampler(first: 5, every: 200)
        machineKind = nil; detectedKind = nil; kindOverride = nil; trainerServices = []; trainerPackets = 0; trainerLastPacket = nil
        otherSamplers = [:]; subscribedAt = nil; noDataWarned = false
        gradeResistance.reset(); encoder = ResistanceEncoder(); lastSent = nil; lastResistanceLevel = nil
        if pilotRunning { pilotTimer?.invalidate(); pilotRunning = false; pilotStatus = BluetoothStore.pilotIdle }
        if heartID == nil { heart = nil; heartContact = nil }
        updateMetrics(); history = []
        powerRange = 0...1000; resistanceRange = 0...100; resistanceLevels = nil; supportedPowerStep = 1; supportedResistanceStep = 0.1
        controlStatus = "Connecte un home trainer pour commencer."
    }
    private func refresh() {
        devices = connections.values.map { c in
            DeviceRow(id: c.peripheral.identifier, name: c.name, rssi: c.rssi, state: c.state,
                      connected: c.peripheral.state == .connected, busy: c.peripheral.state == .connecting || c.peripheral.state == .disconnecting,
                      battery: c.battery, role: c.role ?? c.suggested, buttons: c.buttons.sorted().joined(separator: " · "),
                      details: [c.model?.rawValue, c.deviceModel, c.firmware.map { "Firmware " + $0 }, c.model?.compatibilityNote].compactMap { $0 }.joined(separator: " · "))
        }.sorted { ($0.connected ? 0 : 1, $0.role == nil ? 1 : 0, $0.name, $0.id.uuidString) < ($1.connected ? 0 : 1, $1.role == nil ? 1 : 0, $1.name, $1.id.uuidString) }
    }
    func setDemo(_ enabled: Bool) {
        stopScan()
        for c in connections.values { c.connectionTimer?.invalidate(); c.cancelWrites(); if c.peripheral.state != .disconnected { central?.cancelPeripheralConnection(c.peripheral) } }
        connections.removeAll(); devices = []; resetTrainer(); heartID = nil; heart = nil; metrics = BikeReading(); heartContact = nil
        waiting = []; intentional = []
        demo = enabled; gears = VirtualGears(); terrain = 0; mode = "Simulation"; demoTick = 0; demoDistance = 0
        if enabled {
            controlReady = true; simulationSupported = true; ergSupported = true; resistanceSupported = true
            // Démo Technogym : un rameur simulé (comme le jeu web en démo).
            machineKind = profile == .technogym ? .rower : .bike
            trainerServices = ["Fitness Machine (FTMS)", "Device Information"]
            controlStatus = "Démo prête · aucun appareil réel connecté"; tick()
        }
        log(enabled ? "Mode démo activé : mesures simulées" : "Mode Bluetooth réel activé")
        if !enabled { reconnectKnown() } // retour au réel : machine et ceinture connues en attente
    }
    private func tick() {
        if demo {
            demoTick += 1
            let wave = sin(Double(demoTick) / 7)
            if machineKind == .rower {
                let watts = Int(180 + wave * 25)
                let pace = 500 * pow(2.8 / Double(watts), 1.0 / 3)
                demoDistance += 500 / pace
                let rate = ((26 + wave * 2) * 2).rounded() / 2
                metrics = BikeReading(cadence: rate, power: watts, heartRate: Int(128 + wave * 8), strokeRate: rate,
                                      strokeCount: demoTick * 26 / 60, distance: Int(demoDistance), pace: Int(pace.rounded()))
            } else {
                metrics = BikeReading(speed: 28 + wave * 3, cadence: 85 + wave * 7, power: Int((mode == "ERG" && controlled ? targetWatts : 180) + wave * 25), heartRate: Int(125 + wave * 8))
            }
            trainerPackets = demoTick
            trainerLastPacket = Date()
        } else {
            let now = Date()
            var changed = feed.expire(now: now.timeIntervalSinceReferenceDate)
            if let at = subscribedAt, !noDataWarned, trainerPackets == 0, now.timeIntervalSince(at) > 8 {
                noDataWarned = true
                log("Connecté mais aucune donnée reçue depuis 8 s. Sur une machine Technogym, démarre une séance sur la console (Start, Quick Start ou Entraînement libre) puis pédale ou marche : la console n'envoie ses mesures que pendant un exercice. Si rien n'arrive, envoie ce journal.")
                controlStatus = "Aucune donnée : démarre une séance sur la console de la machine."
            }
            if let lastHeart, now.timeIntervalSince(lastHeart) > 5, heart != nil { heart = nil; heartContact = nil; changed = true }
            if changed { updateMetrics() }
        }
        if let power = metrics.power { history.append(PowerSample(date: Date(), watts: power)) }
        if history.count > 120 { history.removeFirst(history.count - 120) }
    }
}

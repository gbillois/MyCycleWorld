import Foundation
import CoreBluetooth
import Combine

/// Machine entendue à l'instant (annonce Bluetooth), sur la carte ou non.
struct GymHeard: Identifiable, Equatable {
    let id: UUID
    var name: String
    var rssi: Int
    var kind: MachineKind?
    /// Figure sur le plan du lieu par défaut ou d'un autre lieu.
    var mapped: Bool
}

/// Cartographie en cours : lieu, stations déjà faites et station en cours d'écoute.
struct GymSurveyState: Equatable {
    var placeID: UUID
    var stations = 0
    /// Station en cours : début de l'écoute et position touchée sur le plan (m).
    var recordingSince: Date?
    var recordingX = 0.0
    var recordingY = 0.0
    /// Machines entendues à la dernière station.
    var heardLast = 0
}

/// Identification de sa machine par le mouvement (voir Core/GymIdentify.swift), suivie par l'écran du lieu et le jeu.
struct GymIdentifyState: Equatable {
    enum Phase: String { case connecting, calm, go, found, failed }
    var phase: Phase
    var text: String
    var candidates = 0
    var found: UUID?
    var foundName: String?
}

/// Cartographie des salles (voir Core/GymMap.swift) : lieux enregistrés, recherche Bluetooth avec la force du
/// signal (RSSI) de chaque annonce, stations de mesure et identification du type des machines (connexion de
/// quelques secondes, lecture des services FTMS, déconnexion ; aucune commande n'est envoyée à la machine).
/// Utilise son propre CBCentralManager, comme l'inspecteur : les connexions du jeu (BluetoothStore) n'en
/// dépendent pas.
final class GymStore: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    private static let key = "mycycleworld.gym"
    /// Durée d'écoute d'une station (le joueur reste immobile).
    static let stationSeconds = 5.0
    /// Une machine qui n'a rien annoncé depuis ce délai n'est plus « autour ».
    static let nearbyTimeout = 6.0
    private static let ftms = CBUUID(string: "1826")
    private static let probeServices = [CBUUID(string: "1826"), CBUUID(string: "1818"), CBUUID(string: "1814"), CBUUID(string: "180A")]

    @Published private(set) var book: GymBook
    @Published private(set) var bluetoothState = "Bluetooth non démarré"
    @Published private(set) var poweredOn = false
    @Published private(set) var scanning = false
    /// Machines entendues ces dernières secondes, la plus proche (signal le plus fort) d'abord.
    @Published private(set) var nearby: [GymHeard] = []
    @Published private(set) var survey: GymSurveyState?
    /// Nom de la machine en cours d'identification (connexion de quelques secondes).
    @Published private(set) var probing: String?
    /// Machine sur laquelle le téléphone est posé (signal nettement plus fort que tous les autres), sinon nil.
    @Published private(set) var contact: GymHeard?
    /// Identification par le mouvement en cours ou terminée (nil : aucune).
    @Published private(set) var identifyState: GymIdentifyState?
    /// Montrer aussi les appareils Bluetooth qui ne ressemblent pas à une machine (machine non standard).
    @Published var includeAll = false { didSet { refreshNearby() } }
    @Published private(set) var logs: [String] = []

    /// Type lu sur une machine : transmis à BluetoothStore (type connu dès la connexion du jeu).
    var kindDetected: ((UUID, MachineKind) -> Void)?
    /// Type choisi à la main sur la carte (nil = automatique).
    var kindChosen: ((UUID, MachineKind?) -> Void)?
    /// Machine connectée ou attendue par le jeu : on ne la sonde pas.
    var isInUse: ((UUID) -> Bool)?

    private struct Entry {
        var peripheral: CBPeripheral
        var name: String
        var samples: [(date: Date, rssi: Int)] = []
        var kind: MachineKind?
        var kindSource: GymKindSource?
        var machine: Bool
        var lastSeen: Date
    }
    private struct Recording {
        var x: Double
        var y: Double
        var samples: [UUID: [Int]] = [:]
    }
    private final class Probe {
        let id: UUID
        let peripheral: CBPeripheral
        var characteristics: Set<String> = []
        var pendingServices = 0
        var model: String?
        var waitingModel = false
        var timer: Timer?
        init(id: UUID, peripheral: CBPeripheral) { self.id = id; self.peripheral = peripheral }
    }

    private var central: CBCentralManager?
    private var reasons: Set<String> = []
    private var heard: [UUID: Entry] = [:]
    private var recording: Recording?
    private var stationTimer: Timer?
    private var probeQueue: [UUID] = []
    private var probed: Set<UUID> = []
    private var probe: Probe?
    private var refreshTimer: Timer?
    /// Identification par le mouvement : connexions en lecture seule aux machines les plus proches.
    private final class Link {
        let id: UUID
        let peripheral: CBPeripheral
        let name: String
        let rssi: Int
        var characteristics: Set<String> = []
        var subscribed = false
        init(id: UUID, peripheral: CBPeripheral, name: String, rssi: Int) { self.id = id; self.peripheral = peripheral; self.name = name; self.rssi = rssi }
    }
    private var links: [UUID: Link] = [:]
    private var tracker = MotionTracker()
    private var identifyTimer: Timer?
    /// Nombre de machines écoutées pendant l'identification (les plus proches).
    static let identifyCandidates = 5

    override init() {
        book = UserDefaults.standard.data(forKey: GymStore.key).flatMap { try? JSONDecoder().decode(GymBook.self, from: $0) } ?? GymBook()
        super.init()
    }

    var payload: GymPayload {
        var p = GymPayload(book: book, nearby: nearby.map { GymPayload.Nearby(id: $0.id.uuidString, name: $0.name, kind: $0.kind?.rawValue, rssi: $0.rssi) },
                           scanning: scanning)
        p.contact = contact?.id.uuidString
        if let s = identifyState {
            p.identify = GymPayload.Identify(phase: s.phase.rawValue, text: s.text, found: s.found?.uuidString, foundName: s.foundName,
                                             kind: s.found.flatMap { id in book.place(containing: id)?.machine(id)?.kind ?? heard[id]?.kind }?.rawValue)
        }
        return p
    }
    var text: String { (["MyCycleWorld iOS · cartographie des salles", bluetoothState] + logs).joined(separator: "\n") }

    func log(_ message: String) {
        logs.append("\(Date().formatted(date: .omitted, time: .standard))  \(message)")
        if logs.count > 1000 { logs.removeFirst(logs.count - 1000) }
    }

    // MARK: Lieux et machines

    private func save() {
        if let data = try? JSONEncoder().encode(book) { UserDefaults.standard.set(data, forKey: GymStore.key) }
    }

    @discardableResult
    func addPlace(name: String, width: Double, depth: Double) -> UUID {
        let id = book.add(name: name.trimmingCharacters(in: .whitespaces).isEmpty ? "Ma salle" : name, width: width, depth: depth)
        save(); log("Lieu ajouté : \(book.place(id)?.name ?? name)")
        return id
    }
    func renamePlace(_ id: UUID, _ name: String) {
        let clean = name.trimmingCharacters(in: .whitespaces)
        guard !clean.isEmpty else { return }
        book.update(id) { $0.name = clean }; save()
    }
    func resizePlace(_ id: UUID, width: Double, depth: Double) {
        book.update(id) { $0.resize(width: width, depth: depth) }; save()
    }
    func setDefault(_ id: UUID) { book.defaultID = id; save() }
    func deletePlace(_ id: UUID) {
        if survey?.placeID == id { stopSurvey() }
        book.remove(id); save()
    }
    /// Nom donné à la machine, enregistré tel que tapé (les espaces de fin sont ignorés à l'affichage).
    func setLabel(_ machine: UUID, in place: UUID, _ label: String) {
        book.update(place) { p in p.update(machine) { $0.label = label.isEmpty ? nil : String(label.prefix(60)) } }; save()
    }
    /// Type choisi à la main (nil = automatique : on le relira sur la machine).
    func setKind(_ machine: UUID, in place: UUID, _ kind: MachineKind?) {
        let fallback = heard[machine].flatMap { e in e.kind.map { ($0, e.kindSource ?? .name) } }
        book.update(place) { p in
            p.update(machine) { m in
                if let kind { m.kind = kind; m.kindSource = .chosen } else {
                    m.kind = nil; m.kindSource = nil
                    if let fallback { m.offer(kind: fallback.0, source: fallback.1) }
                }
            }
        }
        if kind == nil { probed.remove(machine) }
        save()
        kindChosen?(machine, kind)
    }
    func pin(_ machine: UUID, in place: UUID, x: Double, y: Double) {
        book.update(place) { $0.pin(machine, x: x, y: y) }; save()
    }
    func unpin(_ machine: UUID, in place: UUID) {
        book.update(place) { $0.unpin(machine) }; save()
    }
    /// Ajoute une machine entendue (bouton « Ajouter au plan » d'une machine pas encore cartographiée).
    func addHeard(_ machine: UUID, to place: UUID) {
        guard let e = heard[machine] else { return }
        book.update(place) { p in
            p.ignored.removeAll { $0 == machine }
            p.see(id: machine, name: e.name, at: e.lastSeen)
            p.update(machine) { $0.offer(kind: e.kind, source: e.kindSource ?? .name) }
        }
        save(); queueProbe(machine)
    }
    func removeMachine(_ machine: UUID, from place: UUID) {
        book.update(place) { $0.remove(machine) }; save()
    }
    /// Oublie les machines retirées de ce lieu : la prochaine cartographie peut les rajouter.
    func restoreIgnored(in place: UUID) {
        book.update(place) { $0.ignored = [] }; save()
    }

    // MARK: Écoute

    /// Écoute des machines autour pour une raison donnée (cartographie, choix de la machine dans le jeu,
    /// recherche de la machine la plus proche) ; la recherche s'arrête quand plus personne n'écoute.
    func listen(_ reason: String, _ on: Bool) {
        if on { reasons.insert(reason) } else { reasons.remove(reason) }
        updateScan()
    }
    var listening: Bool { !reasons.isEmpty }

    private func updateScan() {
        if reasons.isEmpty {
            central?.stopScan(); scanning = false
            refreshTimer?.invalidate(); refreshTimer = nil
            return
        }
        if central == nil { central = CBCentralManager(delegate: self, queue: .main); return }
        guard poweredOn else { return }
        // Doublons acceptés : chaque annonce donne un nouveau RSSI (au premier plan seulement).
        central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        if !scanning { log("Écoute des machines autour.") }
        scanning = true
        if refreshTimer == nil {
            refreshTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshNearby() }
        }
    }

    /// Arrête tout (appli en arrière-plan) : cartographie terminée, écoute coupée.
    func suspend() {
        if survey != nil { stopSurvey() }
        if identifyState != nil { cancelIdentify() }
        reasons.removeAll()
        updateScan()
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        poweredOn = central.state == .poweredOn
        switch central.state {
        case .poweredOn: bluetoothState = "Bluetooth prêt"
        case .poweredOff: bluetoothState = "Active le Bluetooth dans Réglages."
        case .unauthorized: bluetoothState = "Autorise le Bluetooth dans Réglages → MyCycleWorld."
        case .unsupported: bluetoothState = "Bluetooth indisponible ici (simulateur ?)."
        default: bluetoothState = "Initialisation Bluetooth…"
        }
        if poweredOn { updateScan(); nextProbe() } else {
            scanning = false
            if let p = probe { p.timer?.invalidate(); probe = nil; probing = nil }
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let rssi = RSSI.intValue
        guard rssi < 0, rssi > -105 else { return } // 127 : RSSI indisponible
        let id = peripheral.identifier
        let name = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? peripheral.name ?? heard[id]?.name ?? ""
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []).map { $0.uuidString.uppercased() }
        let manufacturer = Array(advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data ?? Data())
        let serviceData = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data] ?? [:]
        let ftmsData = serviceData[GymStore.ftms].map { Array($0) }
        // Machine : FTMS ou Cycling Power annoncé, données FTMS, fabricant Technogym ou nom de machine Technogym.
        let looksMachine = ftmsData != nil || HardwareProfile.technogym.role(name: name, services: services, manufacturer: manufacturer) == .trainer
        let now = Date()
        var e = heard[id] ?? Entry(peripheral: peripheral, name: name, machine: looksMachine, lastSeen: now)
        if !name.isEmpty { e.name = name }
        e.machine = e.machine || looksMachine
        e.lastSeen = now
        e.samples.append((now, rssi))
        e.samples.removeAll { now.timeIntervalSince($0.date) > 10 }
        if let data = ftmsData, let kind = GymKindGuess.ftmsServiceData(data) { e.kind = kind; e.kindSource = .advertised }
        else if e.kind == nil, let kind = GymKindGuess.name(e.name) { e.kind = kind; e.kindSource = .name }
        heard[id] = e
        if recording != nil, e.machine || includeAll || book.contains(machine: id) {
            recording?.samples[id, default: []].append(rssi)
        }
    }

    /// Machines autour : RSSI médian des 3 dernières secondes, nom et type de la carte s'ils y sont.
    private func refreshNearby() {
        let now = Date()
        heard = heard.filter { now.timeIntervalSince($0.value.lastSeen) < 60 || $0.key == probe?.id }
        var list: [GymHeard] = []
        for (id, e) in heard where now.timeIntervalSince(e.lastSeen) < GymStore.nearbyTimeout {
            let mapped = book.place(containing: id)?.machine(id)
            guard e.machine || includeAll || mapped != nil else { continue }
            let recent = e.samples.filter { now.timeIntervalSince($0.date) < 3 }.map { $0.rssi }
            guard let rssi = GymSignal.median(recent.isEmpty ? e.samples.suffix(1).map { $0.rssi } : recent) else { continue }
            list.append(GymHeard(id: id, name: mapped?.title ?? (e.name.isEmpty ? "Appareil sans nom" : e.name), rssi: Int(rssi.rounded()),
                                 kind: mapped?.kind ?? e.kind, mapped: mapped != nil))
        }
        list.sort { $0.rssi != $1.rssi ? $0.rssi > $1.rssi : $0.id.uuidString < $1.id.uuidString }
        if list != nearby { nearby = list }
        // Téléphone posé sur une console : cette machine domine tous les autres signaux.
        let touching = GymIdentify.byContact(list.map { (id: $0.id, rssi: $0.rssi) }).flatMap { id in list.first { $0.id == id } }
        if touching?.id != contact?.id { contact = touching; if let touching { log("Téléphone posé sur \(touching.name) (\(touching.rssi) dBm).") } }
    }

    // MARK: Cartographie

    /// Commence une cartographie. `restart` : on repart de zéro (positions automatiques effacées, machines,
    /// noms et positions posées à la main gardés) ; sinon on complète les mesures (salle qui a changé).
    func startSurvey(_ placeID: UUID, restart: Bool) {
        guard book.place(placeID) != nil else { return }
        if survey != nil { stopSurvey() }
        book.update(placeID) { p in
            if restart {
                p.sessions = []
                for i in p.machines.indices where !p.machines[i].pinned { p.machines[i].x = nil; p.machines[i].y = nil; p.machines[i].error = nil }
            }
            p.sessions.append(GymSession(date: Date()))
        }
        save()
        survey = GymSurveyState(placeID: placeID)
        probed = []
        log("Cartographie \(restart ? "initiale" : "mise à jour") : \(book.place(placeID)?.name ?? "")")
        listen("survey", true)
    }

    func stopSurvey() {
        if recording != nil { finishStation() }
        if let s = survey {
            book.update(s.placeID) { p in if p.sessions.last?.stations.isEmpty == true { p.sessions.removeLast() } }
            save()
            log("Cartographie terminée : \(s.stations) stations.")
        }
        survey = nil
        listen("survey", false)
    }

    /// Le joueur est à (x, y) sur le plan : écoute de quelques secondes, puis position des machines recalculée.
    func record(x: Double, y: Double) {
        guard let s = survey, let place = book.place(s.placeID) else { return }
        if recording != nil { finishStation() }
        let px = min(place.width, max(0, x)), py = min(place.depth, max(0, y))
        recording = Recording(x: px, y: py)
        survey?.recordingSince = Date(); survey?.recordingX = px; survey?.recordingY = py
        stationTimer?.invalidate()
        stationTimer = Timer.scheduledTimer(withTimeInterval: GymStore.stationSeconds, repeats: false) { [weak self] _ in self?.finishStation() }
    }

    /// Annule la station en cours (le joueur a touché le mauvais endroit).
    func cancelStation() {
        stationTimer?.invalidate(); recording = nil; survey?.recordingSince = nil
    }

    private func finishStation() {
        stationTimer?.invalidate()
        guard let r = recording, let s = survey else { recording = nil; return }
        recording = nil
        var rssi: [String: Double] = [:]
        var seen: [(UUID, String, MachineKind?, GymKindSource?)] = []
        for (id, values) in r.samples {
            guard let m = GymSignal.median(values), let e = heard[id] else { continue }
            rssi[id.uuidString] = m
            seen.append((id, e.name, e.kind, e.kindSource))
        }
        let now = Date()
        book.update(s.placeID) { p in
            var kept: [String: Double] = [:]
            for (id, name, kind, source) in seen where p.see(id: id, name: name, at: now) {
                p.update(id) { $0.offer(kind: kind, source: source ?? .name) }
                kept[id.uuidString] = rssi[id.uuidString]
            }
            if p.sessions.isEmpty { p.sessions.append(GymSession(date: now)) }
            p.sessions[p.sessions.count - 1].stations.append(GymStation(x: r.x, y: r.y, rssi: kept))
            p.relocate()
        }
        save()
        survey?.stations += 1
        survey?.heardLast = rssi.count
        survey?.recordingSince = nil
        log(String(format: "Station %d (%.1f m, %.1f m) : %d machines entendues.", survey?.stations ?? 0, r.x, r.y, rssi.count))
        // Machines dont le type n'est pas encore lu : connexion de quelques secondes, une à la fois.
        if let place = book.place(s.placeID) {
            for m in place.machines where (m.kindSource?.rank ?? -1) < GymKindSource.detected.rank { queueProbe(m.id) }
        }
    }

    // MARK: Identifier sa machine par le mouvement

    /// Écoute (lecture seule) des machines les plus proches, période calme, puis « vas-y » : la machine qui
    /// démarre à ce moment-là est celle du joueur. Les autres sont libérées tout de suite après.
    func startIdentify() {
        endLinks()
        listen("identify", true)
        refreshNearby()
        guard poweredOn, let central else {
            identifyState = GymIdentifyState(phase: .failed, text: "Bluetooth pas encore prêt : réessaie dans un instant.")
            listen("identify", false)
            return
        }
        let candidates = nearby.filter { h in
            isInUse?(h.id) != true && heard[h.id]?.peripheral.state == .disconnected
        }.prefix(GymStore.identifyCandidates)
        guard !candidates.isEmpty else {
            identifyState = GymIdentifyState(phase: .failed, text: "Aucune machine libre entendue autour de toi. Approche-toi de ta machine, réveille-la, puis recommence.")
            listen("identify", false)
            return
        }
        // Une identification du type en cours est interrompue (elle reprendra plus tard).
        if let p = probe {
            p.timer?.invalidate(); probe = nil; probing = nil; probed.remove(p.id)
            if p.peripheral.state != .disconnected { central.cancelPeripheralConnection(p.peripheral) }
        }
        tracker = MotionTracker()
        for h in candidates {
            guard let e = heard[h.id] else { continue }
            links[h.id] = Link(id: h.id, peripheral: e.peripheral, name: h.name, rssi: h.rssi)
            e.peripheral.delegate = self
            central.connect(e.peripheral)
        }
        identifyState = GymIdentifyState(phase: .connecting, text: "Écoute des \(links.count) machines les plus proches… Ne bouge pas.", candidates: links.count)
        log("Identification par le mouvement : \(links.values.map(\.name).sorted().joined(separator: ", ")).")
        identifyTimer?.invalidate()
        identifyTimer = Timer.scheduledTimer(withTimeInterval: 5, repeats: false) { [weak self] _ in self?.beginCalm() }
    }

    /// Annule l'identification (ou efface son résultat) et libère les machines écoutées.
    func cancelIdentify() {
        endLinks()
        identifyState = nil
    }

    private func beginCalm() {
        guard identifyState?.phase == .connecting else { return }
        identifyTimer?.invalidate()
        identifyState?.phase = .calm
        identifyState?.text = "Ne bouge plus pendant 2 secondes…"
        identifyTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in self?.goSignal() }
    }

    private func goSignal() {
        guard identifyState?.phase == .calm else { return }
        tracker.prompt(at: Date().timeIntervalSinceReferenceDate)
        identifyState?.phase = .go
        identifyState?.text = "Vas-y : commence à pédaler, ramer ou marcher !"
        identifyTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: false) { [weak self] _ in
            guard let self, self.identifyState?.phase == .go else { return }
            let busy = self.tracker.busy.count
            self.fail(busy > 0
                      ? "Aucune machine n’a démarré au signal (\(busy) déjà en mouvement : si c’est la tienne, arrête-toi, puis recommence)."
                      : "Aucune machine n’a démarré au signal. Ta machine est peut-être en veille ou trop loin : réveille-la, rapproche-toi et recommence.")
        }
    }

    private func identified(_ id: UUID) {
        guard identifyState?.phase == .go, let link = links[id] else { return }
        let kind = MachineKind.detect(characteristics: link.characteristics)
        let name = book.place(containing: id)?.machine(id)?.title ?? link.name
        endLinks()
        identifyState = GymIdentifyState(phase: .found, text: "C’est \(name) ✓", candidates: 0, found: id, foundName: name)
        log("Machine identifiée par le mouvement : \(name).")
        if let kind {
            for place in book.places where place.machine(id) != nil {
                book.update(place.id) { $0.update(id) { m in m.offer(kind: kind, source: .detected) } }
            }
            heard[id]?.kind = kind; heard[id]?.kindSource = .detected
            save()
            kindDetected?(id, kind)
        }
    }

    private func fail(_ text: String) {
        endLinks()
        identifyState = GymIdentifyState(phase: .failed, text: text)
        log("Identification : \(text)")
    }

    private func dropLink(_ id: UUID) {
        links.removeValue(forKey: id)
        guard let phase = identifyState?.phase, phase != .found, phase != .failed else { return }
        if links.isEmpty { fail("Connexion impossible aux machines autour. Rapproche-toi de ta machine et recommence.") }
        else if phase == .connecting, links.values.allSatisfy(\.subscribed) { beginCalm() }
    }

    /// Libère toutes les machines écoutées (sans toucher au résultat affiché).
    private func endLinks() {
        identifyTimer?.invalidate(); identifyTimer = nil
        let old = links
        links = [:]
        for l in old.values where l.peripheral.state != .disconnected { central?.cancelPeripheralConnection(l.peripheral) }
        listen("identify", false)
        nextProbe()
    }

    // MARK: Identification du type (connexion courte)

    private func queueProbe(_ id: UUID) {
        guard !probed.contains(id), !probeQueue.contains(id), probe?.id != id, heard[id] != nil else { return }
        probeQueue.append(id)
        nextProbe()
    }

    private func nextProbe() {
        guard probe == nil, links.isEmpty, poweredOn, let central else { return }
        while !probeQueue.isEmpty {
            let id = probeQueue.removeFirst()
            guard let e = heard[id], e.peripheral.state == .disconnected, isInUse?(id) != true,
                  Date().timeIntervalSince(e.lastSeen) < 15 else { continue }
            probed.insert(id)
            let p = Probe(id: id, peripheral: e.peripheral)
            probe = p
            probing = e.name.isEmpty ? "machine" : e.name
            e.peripheral.delegate = self
            central.connect(e.peripheral)
            p.timer = Timer.scheduledTimer(withTimeInterval: 10, repeats: false) { [weak self] _ in self?.finishProbe(p) }
            return
        }
        probing = nil
    }

    private func finishProbe(_ p: Probe) {
        guard probe === p else { return }
        p.timer?.invalidate()
        probe = nil
        if p.peripheral.state != .disconnected { central?.cancelPeripheralConnection(p.peripheral) }
        let name = heard[p.id]?.name ?? "machine"
        if let kind = MachineKind.detect(characteristics: p.characteristics) {
            for place in book.places where place.machine(p.id) != nil {
                book.update(place.id) { pl in pl.update(p.id) { m in m.offer(kind: kind, source: .detected); if let model = p.model { m.model = model } } }
            }
            heard[p.id]?.kind = kind; heard[p.id]?.kindSource = .detected
            save()
            kindDetected?(p.id, kind)
            log("\(name) : \(kind.label) (lu sur la machine)\(p.model.map { ", modèle " + $0 } ?? "")")
        } else {
            log("\(name) : type non lu (\(p.characteristics.isEmpty ? "pas de réponse" : "ni FTMS ni puissance")). Choisis-le à la main si besoin.")
        }
        nextProbe()
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        if links[peripheral.identifier] != nil { peripheral.discoverServices([GymStore.ftms, CBUUID(string: "1818"), CBUUID(string: "1814")]); return }
        guard let p = probe, p.id == peripheral.identifier else { return }
        peripheral.discoverServices(GymStore.probeServices)
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        if links[peripheral.identifier] != nil { dropLink(peripheral.identifier); return }
        if let p = probe, p.id == peripheral.identifier { finishProbe(p) }
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        if links[peripheral.identifier] != nil { dropLink(peripheral.identifier); return }
        if let p = probe, p.id == peripheral.identifier { finishProbe(p) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        if links[peripheral.identifier] != nil {
            let services = peripheral.services ?? []
            if error != nil || services.isEmpty { dropLink(peripheral.identifier); return }
            for service in services { peripheral.discoverCharacteristics(nil, for: service) }
            return
        }
        guard let p = probe, p.id == peripheral.identifier else { return }
        let services = peripheral.services ?? []
        guard error == nil, !services.isEmpty else { finishProbe(p); return }
        p.pendingServices = services.count
        for service in services { peripheral.discoverCharacteristics(nil, for: service) }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        if let l = links[peripheral.identifier] {
            for char in service.characteristics ?? [] {
                let id = char.uuid.uuidString.uppercased()
                l.characteristics.insert(id)
                if GymIdentify.dataCharacteristics.contains(id), char.properties.contains(.notify) || char.properties.contains(.indicate) {
                    peripheral.setNotifyValue(true, for: char)
                    l.subscribed = true
                }
            }
            // Toutes les machines écoutées : la période calme commence sans attendre.
            if identifyState?.phase == .connecting, links.values.allSatisfy(\.subscribed) { beginCalm() }
            return
        }
        guard let p = probe, p.id == peripheral.identifier else { return }
        for char in service.characteristics ?? [] {
            let id = char.uuid.uuidString.uppercased()
            p.characteristics.insert(id)
            if id == "2A24", char.properties.contains(.read) { p.waitingModel = true; peripheral.readValue(for: char) }
        }
        p.pendingServices -= 1
        guard p.pendingServices <= 0 else { return }
        if p.waitingModel {
            // Modèle (Device Information) : on l'attend au plus 2 s.
            p.timer?.invalidate()
            p.timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: false) { [weak self] _ in self?.finishProbe(p) }
        } else { finishProbe(p) }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        if links[peripheral.identifier] != nil {
            guard error == nil, let value = characteristic.value,
                  let moving = GymIdentify.moving(characteristic: characteristic.uuid.uuidString, bytes: Array(value)) else { return }
            tracker.record(peripheral.identifier, moving: moving, at: Date().timeIntervalSinceReferenceDate)
            if let winner = tracker.winner(rssi: links.mapValues(\.rssi)) { identified(winner) }
            return
        }
        guard let p = probe, p.id == peripheral.identifier, characteristic.uuid.uuidString.uppercased() == "2A24" else { return }
        if error == nil, let value = characteristic.value {
            p.model = String(bytes: value, encoding: .utf8)?.trimmingCharacters(in: .controlCharacters.union(.whitespaces))
        }
        if p.pendingServices <= 0 { finishProbe(p) } else { p.waitingModel = false }
    }
}

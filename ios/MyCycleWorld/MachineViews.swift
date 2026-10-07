import SwiftUI
import UIKit

// Écran Appareils (Options du jeu > Réglages de l'appli) : test de connexion, console Bluetooth et
// inspecteur BLE (comme les pages « Connecter Zwift / Technogym / Bluetooth standard » du jeu web).

/// Ligne du test de connexion : libellé, valeur et couleur (vert = bon, rouge = à vérifier).
private struct TestRow: Identifiable {
    enum Tone { case plain, ok, bad }
    let label: String
    let value: String
    var tone: Tone = .plain
    var id: String { label }
    var color: Color { tone == .ok ? .green : tone == .bad ? .red : .primary }
}

/// Section « Test de connexion » : type de machine, services, paquets reçus, mesures en direct et pilotage.
struct ConnectionTestSection: View {
    @EnvironmentObject private var store: BluetoothStore

    var body: some View {
        Section {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(rows(now: context.date)) { row in
                        HStack(alignment: .firstTextBaseline, spacing: 10) {
                            Text(row.label).foregroundStyle(.secondary).frame(width: 88, alignment: .leading)
                            Text(row.value).foregroundStyle(row.color).frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .font(.callout)
                    }
                }
                .padding(.vertical, 4)
            }
            if store.trainerRow != nil {
                // Type de la machine : automatique (détecté) ou choisi, mémorisé pour cette machine.
                Picker("Type de machine", selection: Binding(get: { store.kindOverride }, set: { store.setKindOverride($0) })) {
                    Text(autoKindLabel).tag(MachineKind?.none)
                    ForEach([MachineKind.bike, .cross, .rower, .treadmill], id: \.self) { kind in
                        Text(kind.label).tag(Optional(kind))
                    }
                }
            }
            Button { store.testPilot() } label: {
                Label(store.pilotStatus, systemImage: "slider.horizontal.3")
            }
            .disabled(!store.canTestPilot || store.pilotRunning)
            Toggle(isOn: Binding(get: { store.ftmsDebug }, set: { store.setFTMSDebug($0) })) {
                Label("Mode debug FTMS", systemImage: "ladybug")
            }
            if store.ftmsDebug {
                ShareLink(item: store.report) { Label("Partager le journal debug (\(store.logs.count) lignes)", systemImage: "square.and.arrow.up") }
            }
            NavigationLink {
                StoreConsoleView().nativeCloseButton()
            } label: {
                Label("Console Bluetooth (\(store.logs.count))", systemImage: "terminal")
            }
            NavigationLink {
                InspectorView().nativeCloseButton()
            } label: {
                Label("Inspecteur BLE", systemImage: "magnifyingglass")
            }
        } header: {
            Text("Test de connexion")
        } footer: {
            Text(verbatim: "« Tester le pilotage » durcit la machine pendant 5 s puis revient : pente 6 % puis 0 pour un vélo, résistance 70 % puis 30 % pour un elliptique ou un rameur. Mode debug FTMS : chaque paquet de la machine est noté avec tous ses champs (même ceux que l’appli n’utilise pas), toutes ses caractéristiques sont listées et lues, et les mesures retenues sont notées chaque seconde. Active-le, connecte la machine, attends 10 s sans bouger, puis pédale 1 minute en changeant d’allure, et partage le journal.")
        }
    }

    /// « Automatique (Vélo) » : type détecté entre parenthèses.
    private var autoKindLabel: String {
        guard let kind = store.detectedKind else { return "Automatique" }
        return "Automatique (" + kind.label + ")"
    }

    private func rows(now: Date) -> [TestRow] {
        let name: String
        if let trainer = store.trainerRow {
            name = [trainer.name, trainer.details].filter { !$0.isEmpty }.joined(separator: " · ")
        } else if store.demo {
            name = "Démo (\(store.machineKind?.label ?? "Vélo"), simulé)"
        } else {
            return [TestRow(label: "Machine", value: "aucune connectée pour l’instant")]
        }
        var rows = [TestRow(label: "Machine", value: name)]
        rows.append(TestRow(label: "Connexion", value: "connectée", tone: .ok))
        if let kind = store.machineKind {
            let how = store.kindOverride != nil ? " (choisi)" : kind == .power ? " (Cycling Power)" : " (FTMS)"
            rows.append(TestRow(label: "Type", value: kind.label + how + (kind == .treadmill ? " · puissance estimée" : ""), tone: .ok))
        } else {
            rows.append(TestRow(label: "Type", value: "inconnu (aucune donnée FTMS ni puissance)", tone: .bad))
        }
        rows.append(TestRow(label: "Services", value: store.trainerServices.isEmpty ? "(liste indisponible)" : store.trainerServices.joined(separator: ", ")))
        if let last = store.trainerLastPacket, store.trainerPackets > 0 {
            let age = max(0, now.timeIntervalSince(last))
            rows.append(TestRow(label: "Données", value: "\(store.trainerPackets) paquets, dernier il y a \(MachineText.age(age))", tone: age < 3 ? .ok : .bad))
        } else {
            var value = "aucune pour l’instant : regarde l’écran de la machine (accepter la connexion ? se connecter ?), sinon démarre une séance (Start), puis pédale, marche ou tire la poignée"
            if store.trainerBadPackets > 0 {
                value = "\(store.trainerBadPackets) paquets reçus dans un format inattendu : partage la console Bluetooth"
            } else if store.trainerOtherPackets > 0 {
                value = "rien en FTMS, mais \(store.trainerOtherPackets) paquets sur un service propriétaire : partage la console Bluetooth"
            }
            rows.append(TestRow(label: "Données", value: value, tone: .bad))
        }
        rows.append(TestRow(label: "Mesures", value: MachineText.measures(store.metrics)))
        rows.append(pilotRow)
        return rows
    }

    private var pilotRow: TestRow {
        if store.readOnly { return TestRow(label: "Pilotage", value: "non : la machine a refusé le contrôle, lecture seule") }
        guard store.controlReady else { return TestRow(label: "Pilotage", value: "non : lecture seule") }
        var targets: [String] = []
        if store.simulationSupported { targets.append("pente") }
        if store.ergSupported { targets.append("ERG") }
        if store.resistanceSupported { targets.append("résistance") }
        let mode: String
        switch store.gradeControl {
        case .simulation: mode = "le jeu envoie la pente"
        case .resistance: mode = "le jeu règle la résistance"
        case .none: mode = "le jeu ne peut rien régler"
        }
        let list = targets.isEmpty ? "" : " (\(targets.joined(separator: ", ")))"
        return TestRow(label: "Pilotage", value: "oui\(list) · \(mode)\(store.controlled ? " · contrôle pris" : "")", tone: store.gradeControl == .none ? .plain : .ok)
    }
}

/// Console du journal Bluetooth de l'appli (connexions, services, paquets, commandes FTMS).
struct StoreConsoleView: View {
    @EnvironmentObject private var store: BluetoothStore
    var body: some View {
        LogConsoleView(title: "Console Bluetooth", lines: store.logs, text: store.report, clear: { store.clearLog() })
    }
}

/// Journal de l'inspecteur BLE.
private struct InspectorConsoleView: View {
    @EnvironmentObject private var inspector: BLEInspector
    var body: some View {
        LogConsoleView(title: "Journal de l’inspecteur", lines: inspector.logs, text: inspector.text, clear: { inspector.clearLog() })
    }
}

/// Console de journal : défilement automatique, texte sélectionnable, copie et partage.
struct LogConsoleView: View {
    let title: String
    let lines: [String]
    let text: String
    let clear: () -> Void
    @State private var copied = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 3) {
                    if lines.isEmpty {
                        Text("La console affichera ici tout ce qui se passe en Bluetooth (services trouvés, paquets reçus, commandes envoyées).")
                            .font(.callout).foregroundStyle(.secondary)
                    }
                    ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                        Text(line)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id(index)
                    }
                }
                .padding()
            }
            .onAppear {
                if !lines.isEmpty { proxy.scrollTo(lines.count - 1, anchor: .bottom) }
            }
            .onChange(of: lines.count) { _, count in
                if count > 0 { proxy.scrollTo(count - 1, anchor: .bottom) }
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button {
                    UIPasteboard.general.string = text
                    copied = true
                } label: {
                    Label(copied ? "Copié" : "Copier", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                ShareLink(item: text) { Label("Partager", systemImage: "square.and.arrow.up") }
                Button(role: .destructive) { clear() } label: { Label("Effacer", systemImage: "trash") }
            }
        }
    }
}

/// Inspecteur BLE : tous les appareils, tous les services, octets bruts dans un journal partageable.
struct InspectorView: View {
    @EnvironmentObject private var inspector: BLEInspector

    var body: some View {
        List {
            Section {
                Text("Pour une machine non standard (pas de FTMS, données bizarres) : se connecte à n’importe quel appareil, lit tout ce qui est lisible et enregistre les octets bruts de chaque caractéristique. Fais tourner la machine pendant une minute, puis partage le journal.")
                    .font(.callout)
                Label(inspector.bluetoothState, systemImage: "antenna.radiowaves.left.and.right")
                Button {
                    inspector.scanning ? inspector.stopScan() : inspector.scan()
                } label: {
                    HStack {
                        Text(inspector.scanning ? "Arrêter la recherche" : "Rechercher tous les appareils")
                        Spacer()
                        if inspector.scanning { ProgressView() }
                    }
                }
            }
            if let target = inspector.target {
                Section("Inspection") {
                    Text(inspector.connected
                         ? "Écoute de « \(target) » : \(inspector.characteristicCount) caractéristiques, \(inspector.packets) paquets reçus."
                         : "« \(target) » : déconnecté. \(inspector.packets) paquets reçus.")
                    if inspector.connected {
                        Button("Arrêter", role: .destructive) { inspector.stop() }
                    }
                }
            }
            Section {
                NavigationLink {
                    InspectorConsoleView().nativeCloseButton()
                } label: {
                    Label("Journal (\(inspector.logs.count) lignes)", systemImage: "terminal")
                }
            }
            Section("Appareils à proximité (\(inspector.found.count))") {
                if inspector.found.isEmpty {
                    Text("Aucun appareil pour l’instant. Lance une recherche.").foregroundStyle(.secondary)
                }
                ForEach(inspector.found) { device in
                    Button {
                        inspector.inspect(device.id)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(device.name).font(.headline)
                            Text("\(device.rssi) dBm\(device.details.isEmpty ? "" : " · " + device.details)")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
        }
        .navigationTitle("Inspecteur BLE")
        .onDisappear { inspector.stopScan() }
    }
}

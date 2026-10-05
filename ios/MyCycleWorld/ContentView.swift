import SwiftUI
import Charts

struct ContentView: View {
    @EnvironmentObject private var store: BluetoothStore
    var body: some View {
        TabView {
            GameView().tabItem { Label("Jeu", systemImage: "flag.checkered") }
            DashboardView().tabItem { Label("Cockpit", systemImage: "gauge.with.dots.needle.67percent") }
            DevicesView().tabItem { Label("Appareils", systemImage: "antenna.radiowaves.left.and.right") }
            LogView().tabItem { Label("Diagnostic", systemImage: "waveform.path.ecg") }
        }
    }
}

private struct DashboardView: View {
    @EnvironmentObject private var store: BluetoothStore
    @Environment(\.horizontalSizeClass) private var sizeClass
    @Environment(\.dynamicTypeSize) private var typeSize
    private var columns: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 12), count: typeSize.isAccessibilitySize ? 1 : sizeClass == .regular ? 4 : 2) }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    HStack {
                        Label(store.demo ? "DÉMO · données simulées" : "BLUETOOTH · mesures en direct", systemImage: store.demo ? "play.circle.fill" : "dot.radiowaves.left.and.right")
                            .font(.caption.weight(.bold)).foregroundStyle(store.demo ? .orange : .mint)
                        Spacer()
                    }
                    if !store.demo && store.activeConnectionCount == 0 {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("Ton vélo. Ton cockpit.").font(.title2.bold())
                            Text("Connecte ton home trainer et tes accessoires dans Appareils, ou explore le cockpit en mode démo.")
                                .foregroundStyle(.secondary)
                            Button("Essayer le mode démo") { store.setDemo(true) }.buttonStyle(.borderedProminent)
                        }.card()
                    }
                    LazyVGrid(columns: columns, spacing: 12) {
                        MetricCard(title: "Puissance", value: store.metrics.power.map(String.init) ?? "—", unit: "W", icon: "bolt.fill", color: .mint)
                        MetricCard(title: "Cadence", value: store.metrics.cadence.map { String(format: "%.0f", $0) } ?? "—", unit: "tr/min", icon: "arrow.triangle.2.circlepath", color: .cyan)
                        MetricCard(title: "Vitesse", value: store.metrics.speed.map { String(format: "%.1f", $0) } ?? "—", unit: "km/h", icon: "speedometer", color: .blue)
                        MetricCard(title: "Cardio", value: store.metrics.heartRate.map(String.init) ?? "—", unit: "bpm", icon: "heart.fill", color: .pink)
                    }
                    if store.heartContact == false { Label("Ceinture : contact peau absent", systemImage: "exclamationmark.circle").foregroundStyle(.orange) }
                    VStack(alignment: .leading, spacing: 12) {
                        HStack { Text("Puissance").font(.headline); Spacer(); Text("2 dernières minutes").font(.caption).foregroundStyle(.secondary) }
                        if store.history.isEmpty {
                            ContentUnavailableView("En attente de mesures", systemImage: "waveform.path", description: Text("Les valeurs apparaîtront quand tu pédaleras."))
                                .frame(height: 160)
                        } else {
                            Chart(store.history) { sample in
                                AreaMark(x: .value("Temps", sample.date), y: .value("Watts", sample.watts)).foregroundStyle(.mint.opacity(0.12))
                                LineMark(x: .value("Temps", sample.date), y: .value("Watts", sample.watts)).foregroundStyle(.mint)
                            }.chartYScale(domain: 0...max(300, (store.history.map(\.watts).max() ?? 300) + 50))
                                .chartXAxis(.hidden).frame(height: 160)
                                .accessibilityLabel("Courbe de puissance sur les deux dernières minutes")
                        }
                    }.card()
                    controls
                    VStack(alignment: .leading, spacing: 8) {
                        Label("Manettes", systemImage: "gamecontroller.fill").font(.headline)
                        Text(store.lastAction).font(.callout.monospaced()).foregroundStyle(.secondary)
                        Text("Les boutons latéraux changent les vitesses virtuelles en mode simulation. Les autres boutons sont visibles dans Appareils et Diagnostic.").font(.caption).foregroundStyle(.secondary)
                    }.card()
                }.padding().frame(maxWidth: 1000)
                    .frame(maxWidth: .infinity)
            }.background(Color(.systemGroupedBackground)).navigationTitle("MyCycleWorld")
        }
    }
    private var controls: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack { Text("Pilotage du trainer").font(.headline); Spacer(); Text(store.mode).font(.caption.bold()).foregroundStyle(.mint) }
            Text(store.controlStatus).font(.callout).foregroundStyle(.secondary).accessibilityIdentifier("controlStatus")
            if !store.controlled {
                Button("Prendre le contrôle") { store.takeControl() }.buttonStyle(.borderedProminent).disabled(!store.controlReady)
            }
            HStack {
                Button { store.shift(-1) } label: { Image(systemName: "minus").frame(width: 38, height: 32) }.accessibilityLabel("Vitesse inférieure")
                Spacer()
                VStack { Text("VITESSE VIRTUELLE").font(.caption2.bold()).foregroundStyle(.secondary); Text("\(store.gears.gear) / 24").font(.title2.bold().monospacedDigit()) }
                Spacer()
                Button { store.shift(1) } label: { Image(systemName: "plus").frame(width: 38, height: 32) }.accessibilityLabel("Vitesse supérieure")
            }.buttonStyle(.bordered).disabled(!store.controlled || !store.simulationSupported || store.mode != "Simulation")
            if store.simulationSupported {
                VStack(alignment: .leading) {
                    Text("Terrain : \(store.terrain, specifier: "%.1f") % · Ressenti : \(store.gears.grade(store.terrain), specifier: "%.1f") %").font(.callout)
                    Slider(value: $store.terrain, in: -10...15, step: 0.5).accessibilityLabel("Pente du terrain")
                    Button("Appliquer la pente") { store.applySimulation() }.buttonStyle(.bordered)
                }.disabled(!store.controlled)
            }
            if store.ergSupported {
                VStack(alignment: .leading) {
                    Text("ERG : \(store.targetWatts, specifier: "%.0f") W").font(.callout)
                    if store.powerRange.lowerBound < store.powerRange.upperBound {
                        Slider(value: $store.targetWatts, in: store.powerRange, step: 1).accessibilityLabel("Puissance cible ERG")
                    }
                    Button("Appliquer ERG") { store.applyERG() }.buttonStyle(.bordered)
                }.disabled(!store.controlled)
            }
            if store.resistanceSupported {
                DisclosureGroup("Résistance manuelle") {
                    Text("Niveau : \(store.targetResistance, specifier: "%.1f")")
                    if store.resistanceRange.lowerBound < store.resistanceRange.upperBound {
                        Slider(value: $store.targetResistance, in: store.resistanceRange, step: 0.1).accessibilityLabel("Résistance cible")
                    }
                    Button("Appliquer la résistance") { store.applyResistance() }.buttonStyle(.bordered)
                }.disabled(!store.controlled)
            }
            Button(role: .destructive) { store.stopTrainer() } label: { Label("Arrêter le trainer", systemImage: "stop.circle.fill").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered).disabled(!store.controlled)
            Text("Les changements s’appliquent après confirmation du trainer. Garde l’app au premier plan pendant la séance.").font(.caption).foregroundStyle(.secondary)
        }.card()
    }
}
private struct MetricCard: View {
    let title: String, value: String, unit: String, icon: String
    let color: Color
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(title, systemImage: icon).font(.subheadline.weight(.medium)).foregroundStyle(color)
            Text(value).font(.system(size: 42, weight: .bold, design: .rounded)).monospacedDigit().minimumScaleFactor(0.6).lineLimit(1)
            Text(unit).font(.caption).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity, alignment: .leading).card()
            .accessibilityElement(children: .ignore).accessibilityLabel("\(title), \(value) \(unit)")
    }
}
private struct DevicesView: View {
    @EnvironmentObject private var store: BluetoothStore
    @State private var showAll = false
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Toggle("Mode démo", isOn: Binding(get: { store.demo }, set: { store.setDemo($0) }))
                } footer: { Text("La démo déconnecte les appareils réels et affiche des mesures simulées.") }
                if !store.demo {
                    Section {
                        Label(store.bluetoothState, systemImage: "antenna.radiowaves.left.and.right")
                        Button { store.scanning ? store.stopScan() : store.scan() } label: {
                            HStack { Text(store.scanning ? "Arrêter la recherche" : "Rechercher les appareils"); Spacer(); if store.scanning { ProgressView() } }
                        }
                        Toggle("Afficher aussi les appareils non reconnus", isOn: $showAll)
                    } footer: { Text("Réveille le trainer, porte la ceinture et appuie sur les manettes. Ferme Zwift et les autres applis connectées. Choisis chaque manette séparément.") }
                    Section("Appareils à proximité") {
                        let visible = store.devices.filter { showAll || $0.role != nil }
                        if visible.isEmpty { Text("Aucun appareil détecté. Lance une recherche.").foregroundStyle(.secondary) }
                        ForEach(visible) { device in
                            VStack(alignment: .leading, spacing: 8) {
                                Label(device.name, systemImage: device.role?.icon ?? "antenna.radiowaves.left.and.right").font(.headline)
                                Text("\(device.state) · \(device.rssi) dBm\(device.battery.map { " · Batterie \($0) %" } ?? "")").font(.caption).foregroundStyle(.secondary)
                                if !device.details.isEmpty { Text(device.details).font(.caption).foregroundStyle(.secondary) }
                                if !device.buttons.isEmpty { Text(device.buttons).font(.caption.monospaced()).foregroundStyle(.mint) }
                                if device.connected || device.busy {
                                    HStack {
                                        Button(device.busy ? "Annuler" : "Déconnecter", role: .destructive) { store.disconnect(device.id) }
                                        if device.connected && device.role == .controller { Button("Vibrer") { store.vibrate(device.id) } }
                                    }.buttonStyle(.bordered)
                                } else {
                                    Menu("Connecter comme…") {
                                        ForEach(DeviceRole.allCases) { role in Button(role.rawValue) { store.connect(device.id, role: role) } }
                                    }.buttonStyle(.bordered)
                                }
                            }.padding(.vertical, 6)
                        }
                    }
                } else {
                    Section { Label("Trainer, cadence et cardio simulés", systemImage: "play.circle.fill").foregroundStyle(.orange)
                        Text("Les boutons + / − du cockpit permettent de tester les vitesses virtuelles.") }
                }
                Section("Confidentialité") {
                    Text("Les mesures et le journal restent en mémoire sur cet appareil. Aucun compte, serveur, suivi publicitaire ni HealthKit. Le partage du diagnostic est manuel.").font(.callout)
                }
            }.navigationTitle("Appareils")
        }
    }
}
private struct LogView: View {
    @EnvironmentObject private var store: BluetoothStore
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("FTMS · Cycling Power · Heart Rate · Zwift Play / Click / Ride").font(.callout)
                    Text("Le protocole Zwift est repris du dépôt web et dépend du firmware. En cas de problème, partage ce journal avec le modèle et la version du firmware.").font(.caption).foregroundStyle(.secondary)
                }
                Section("Journal · \(store.logs.count) événements") {
                    if store.logs.isEmpty { Text("Le journal est vide.").foregroundStyle(.secondary) }
                    ForEach(Array(store.logs.enumerated().reversed()), id: \.offset) { _, line in Text(line).font(.caption.monospaced()).textSelection(.enabled) }
                }
            }.navigationTitle("Diagnostic")
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { ShareLink(item: store.report) { Label("Partager", systemImage: "square.and.arrow.up") } }
                    ToolbarItem(placement: .topBarLeading) { Button("Effacer") { store.clearLog() } }
                }
        }
    }
}
private extension View {
    func card() -> some View { frame(maxWidth: .infinity, alignment: .leading).padding(16).background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20)) }
}

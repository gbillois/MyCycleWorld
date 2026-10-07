import SwiftUI

// Cartographie des salles (Options du jeu > Réglages de l'appli > Salles de sport) : lieux, plan de chaque
// lieu, cartographie en marchant dans la salle, machines (nom, type, position) et machine la plus proche.
// Données et calculs : GymStore.swift et Core/GymMap.swift.

extension MachineKind {
    /// Pictogramme SF Symbols du type de machine.
    var symbol: String {
        switch self {
        case .bike: return "bicycle"
        case .rower: return "figure.rower"
        case .cross: return "figure.elliptical"
        case .treadmill: return "figure.run"
        case .power: return "bolt.fill"
        }
    }
    var color: Color {
        switch self {
        case .bike: return .mint
        case .rower: return .blue
        case .cross: return .purple
        case .treadmill: return .orange
        case .power: return .yellow
        }
    }
}

extension GymKindSource {
    var text: String {
        switch self {
        case .chosen: return "choisi"
        case .detected: return "lu sur la machine"
        case .advertised: return "annoncé par la machine"
        case .name: return "deviné d’après le nom"
        }
    }
}

private extension Optional where Wrapped == MachineKind {
    var symbol: String { self?.symbol ?? "questionmark" }
    var color: Color { self?.color ?? .gray }
    var label: String { self?.label ?? "Type inconnu" }
}

/// Liste des lieux.
struct GymPlacesView: View {
    @EnvironmentObject private var gym: GymStore
    @State private var adding = false

    var body: some View {
        List {
            Section {
                Text("Dans une salle, des dizaines de machines parlent Bluetooth. Crée le plan de ta salle en la parcourant : l’appli repère chaque machine, lit son type (vélo, rameur, elliptique, tapis) et la place sur le plan. Ensuite, au lancement d’un niveau, tu touches ta machine sur la carte : le jeu s’y connecte dès qu’elle se réveille et la course part quand elle envoie ses données.")
                    .font(.callout)
            }
            Section {
                if gym.book.places.isEmpty {
                    Text("Aucun lieu pour l’instant.").foregroundStyle(.secondary)
                }
                ForEach(gym.book.places) { place in
                    NavigationLink {
                        GymPlaceView(placeID: place.id).nativeCloseButton()
                    } label: {
                        GymPlaceRow(place: place, isDefault: gym.book.defaultPlace?.id == place.id)
                    }
                }
                Button { adding = true } label: { Label("Ajouter un lieu", systemImage: "plus.circle.fill") }
            } header: {
                Text("Lieux")
            } footer: {
                Text("Plusieurs lieux possibles (salle du bureau, club, hôtel…). Le lieu par défaut s’ouvre en premier au lancement d’un niveau ; les autres restent accessibles d’un geste.")
            }
        }
        .navigationTitle("Salles de sport")
        .sheet(isPresented: $adding) {
            GymPlaceForm(title: "Nouveau lieu", name: gym.book.places.isEmpty ? "Ma salle" : "", width: 20, depth: 12,
                         isDefault: gym.book.places.isEmpty) { name, width, depth, isDefault in
                let id = gym.addPlace(name: name, width: width, depth: depth)
                if isDefault { gym.setDefault(id) }
            }
        }
    }
}

private struct GymPlaceRow: View {
    let place: GymPlace
    let isDefault: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack {
                Text(place.name).font(.headline)
                if isDefault {
                    Text("par défaut").font(.caption2.bold()).padding(.horizontal, 6).padding(.vertical, 2)
                        .background(Color.mint.opacity(0.2), in: Capsule()).foregroundStyle(.mint)
                }
            }
            Text("\(place.machines.count) machine\(place.machines.count > 1 ? "s" : "") · \(place.stationCount) station\(place.stationCount > 1 ? "s" : "") de mesure · \(Int(place.width)) × \(Int(place.depth)) m")
                .font(.caption).foregroundStyle(.secondary)
        }
    }
}

/// Création ou modification d'un lieu : nom, dimensions, lieu par défaut.
private struct GymPlaceForm: View {
    let title: String
    @State var name: String
    @State var width: Double
    @State var depth: Double
    @State var isDefault: Bool
    let save: (String, Double, Double, Bool) -> Void
    @Environment(\.dismiss) private var dismiss

    init(title: String, name: String, width: Double, depth: Double, isDefault: Bool, save: @escaping (String, Double, Double, Bool) -> Void) {
        self.title = title
        _name = State(initialValue: name)
        _width = State(initialValue: width)
        _depth = State(initialValue: depth)
        _isDefault = State(initialValue: isDefault)
        self.save = save
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Nom") { TextField("Salle du bureau, club…", text: $name) }
                Section {
                    Stepper("Largeur : \(Int(width)) m", value: $width, in: GymPlace.sizeRange, step: 1)
                    Stepper("Profondeur : \(Int(depth)) m", value: $depth, in: GymPlace.sizeRange, step: 1)
                } header: {
                    Text("Dimensions approximatives")
                } footer: {
                    Text("Le plan est un rectangle vu de dessus, l’entrée en bas. Compte environ 1 m par grand pas. Une estimation suffit : les machines sont replacées dans ce rectangle.")
                }
                Section { Toggle("Lieu par défaut", isOn: $isDefault) }
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Annuler") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Enregistrer") { save(name, width, depth, isDefault); dismiss() }
                }
            }
        }
    }
}

/// Plan d'un lieu : cartographie, machine la plus proche, machines et réglages du lieu.
struct GymPlaceView: View {
    let placeID: UUID
    @EnvironmentObject private var gym: GymStore
    @EnvironmentObject private var store: BluetoothStore
    @State private var selected: UUID?
    /// Machine à poser à la main : le prochain toucher du plan la place.
    @State private var placing: UUID?
    @State private var live = false
    @State private var editing = false
    @State private var askRestart = false
    @State private var askDelete = false

    private var place: GymPlace? { gym.book.place(placeID) }
    private var surveying: Bool { gym.survey?.placeID == placeID }
    /// Machine la plus proche à l'instant, si elle est sur ce plan.
    private var nearestHere: UUID? {
        guard let first = gym.nearby.first, place?.machine(first.id) != nil else { return nil }
        return first.id
    }

    var body: some View {
        Group {
            if let place {
                List {
                    mapSection(place)
                    if let id = selected, let machine = place.machine(id) { machineSection(place, machine) }
                    surveySection(place)
                    nearestSection(place)
                    machinesSection(place)
                    placeSection(place)
                }
            } else {
                ContentUnavailableView("Lieu supprimé", systemImage: "map")
            }
        }
        .navigationTitle(place?.name ?? "Lieu")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: live) { _, on in gym.listen("nearest", on) }
        .onChange(of: gym.identifyState?.found) { _, found in
            // Machine identifiée par le mouvement : sélectionnée ; pas encore sur le plan, on l'ajoute et on la pose.
            guard let found, let place else { return }
            if place.machine(found) == nil { gym.addHeard(found, to: place.id); placing = found }
            selected = found
        }
        .onChange(of: gym.contact?.id) { _, id in
            // Téléphone posé sur une console : cette machine est sélectionnée.
            guard let id, let place, place.machine(id) != nil, placing == nil else { return }
            selected = id
        }
        .onDisappear {
            gym.listen("nearest", false)
            if gym.identifyState != nil { gym.cancelIdentify() }
            if surveying { gym.stopSurvey() }
        }
        .sheet(isPresented: $editing) {
            if let place {
                GymPlaceForm(title: "Modifier le lieu", name: place.name, width: place.width, depth: place.depth,
                             isDefault: gym.book.defaultPlace?.id == place.id) { name, width, depth, isDefault in
                    gym.renamePlace(place.id, name)
                    gym.resizePlace(place.id, width: width, depth: depth)
                    if isDefault { gym.setDefault(place.id) }
                }
            }
        }
        .confirmationDialog("Recommencer la cartographie ?", isPresented: $askRestart, titleVisibility: .visible) {
            Button("Recommencer de zéro", role: .destructive) { gym.startSurvey(placeID, restart: true) }
        } message: {
            Text("Les mesures précédentes sont effacées. Les machines, leurs noms, leurs types et les positions posées à la main sont gardés.")
        }
        .confirmationDialog("Supprimer ce lieu ?", isPresented: $askDelete, titleVisibility: .visible) {
            Button("Supprimer", role: .destructive) { gym.deletePlace(placeID) }
        }
    }

    // MARK: Plan

    @ViewBuilder private func mapSection(_ place: GymPlace) -> some View {
        Section {
            GymMapCanvas(place: place, selected: selected, nearest: (live || gym.scanning) ? nearestHere : nil,
                         survey: surveying ? gym.survey : nil) { x, y in tap(place, x: x, y: y) }
                .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            Text(mapHint(place)).font(.callout).foregroundStyle(placing != nil || surveying ? Color.mint : Color.secondary)
            if placing != nil {
                Button("Annuler le placement", role: .cancel) { placing = nil }
            }
        }
    }

    private func mapHint(_ place: GymPlace) -> String {
        if let id = placing { return "Touche le plan à l’endroit où se trouve « \(place.machine(id)?.title ?? "la machine") »." }
        if surveying {
            if gym.survey?.recordingSince != nil { return "Écoute en cours : ne bouge plus quelques secondes…" }
            return "Touche le plan là où tu te tiens, puis ne bouge plus pendant 5 s."
        }
        if place.machines.isEmpty { return "Lance la cartographie initiale pour repérer les machines." }
        return "Touche une machine pour la voir, la renommer, la déplacer ou t’y connecter."
    }

    private func tap(_ place: GymPlace, x: Double, y: Double) {
        if let id = placing {
            gym.pin(id, in: place.id, x: x, y: y)
            selected = id
            placing = nil
            return
        }
        if surveying { gym.record(x: x, y: y); return }
        // Machine la plus proche du toucher (à moins de 1,5 m ou 8 % du plan).
        let reach = max(1.5, max(place.width, place.depth) * 0.08)
        let hit = place.machines.compactMap { m -> (UUID, Double)? in
            guard let mx = m.x, let my = m.y else { return nil }
            return (m.id, hypot(mx - x, my - y))
        }.min { $0.1 < $1.1 }
        selected = hit.flatMap { $0.1 <= reach ? $0.0 : nil }
    }

    // MARK: Machine sélectionnée

    @ViewBuilder private func machineSection(_ place: GymPlace, _ machine: GymMachine) -> some View {
        Section {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text(machine.title).font(.headline)
                    Text(machineDetail(machine)).font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: machine.kind.symbol).foregroundStyle(machine.kind.color)
            }
            TextField("Nom affiché (ex. Rameur près de la fenêtre)", text: Binding(
                get: { machine.label ?? "" },
                set: { gym.setLabel(machine.id, in: place.id, $0) }))
            Picker("Type", selection: Binding(
                get: { machine.kindSource == .chosen ? machine.kind : nil },
                set: { gym.setKind(machine.id, in: place.id, $0) })) {
                Text(verbatim: autoLabel(machine)).tag(MachineKind?.none)
                ForEach([MachineKind.bike, .cross, .rower, .treadmill], id: \.self) { kind in
                    Label(kind.label, systemImage: kind.symbol).tag(Optional(kind))
                }
            }
            Button { placing = machine.id } label: { Label("Placer à la main sur le plan", systemImage: "hand.point.up.left") }
            if machine.pinned {
                Button { gym.unpin(machine.id, in: place.id) } label: { Label("Rendre la position automatique", systemImage: "wand.and.stars") }
            }
            Button {
                store.useMachine(machine.id, name: machine.title, kind: machine.kind)
            } label: {
                Label(store.currentTrainerID == machine.id ? (store.trainerWaiting ? "En attente de son réveil…" : "Connectée") : "Se connecter maintenant",
                      systemImage: "antenna.radiowaves.left.and.right")
            }
            .disabled(store.currentTrainerID == machine.id)
            Button(role: .destructive) {
                gym.removeMachine(machine.id, from: place.id); selected = nil
            } label: { Label("Retirer du plan", systemImage: "trash") }
        } header: {
            HStack {
                Text("Machine")
                Spacer()
                Button("Fermer") { selected = nil }.font(.caption)
            }
        } footer: {
            Text("« Se connecter maintenant » attend la machine : réveille-la (un coup de pédale, de rame…). Au lancement d’un niveau, le jeu le fait pour toi.")
        }
    }

    /// « Automatique (Rameur) » : type trouvé sans choix du joueur, entre parenthèses.
    private func autoLabel(_ m: GymMachine) -> String {
        guard m.kindSource != .chosen, let kind = m.kind else { return "Automatique" }
        return "Automatique (" + kind.label + ")"
    }

    private func machineDetail(_ m: GymMachine) -> String {
        var parts = [m.kind.label + (m.kindSource.map { " (\($0.text))" } ?? "")]
        if m.label != nil { parts.append(m.name) }
        if let model = m.model, !model.isEmpty { parts.append(model) }
        if m.pinned { parts.append("posée à la main") } else if let e = m.error { parts.append(String(format: "± %.0f m", max(1, e))) } else { parts.append("pas encore placée") }
        if let seen = m.lastSeen { parts.append("vue " + seen.formatted(.relative(presentation: .named))) }
        return parts.joined(separator: " · ")
    }

    // MARK: Cartographie

    @ViewBuilder private func surveySection(_ place: GymPlace) -> some View {
        Section {
            if !gym.poweredOn && gym.listening {
                Label(gym.bluetoothState, systemImage: "exclamationmark.triangle").foregroundStyle(.orange)
            }
            if surveying, let s = gym.survey {
                if let since = s.recordingSince {
                    TimelineView(.periodic(from: since, by: 0.25)) { context in
                        ProgressView(value: min(1, context.date.timeIntervalSince(since) / GymStore.stationSeconds)) {
                            Text("Station \(s.stations + 1) : écoute des machines…")
                        }
                    }
                } else {
                    Text(verbatim: surveyStatus(place, s))
                }
                if let name = gym.probing {
                    Label("Lecture du type : \(name)…", systemImage: "magnifyingglass").font(.callout).foregroundStyle(.secondary)
                }
                if s.recordingSince != nil {
                    Button("Annuler cette station") { gym.cancelStation() }
                }
                Button { gym.stopSurvey() } label: { Label("Terminer la cartographie", systemImage: "checkmark.circle.fill") }
                    .buttonStyle(.borderedProminent)
            } else if place.stationCount == 0 {
                Button { gym.startSurvey(placeID, restart: true) } label: { Label("Cartographie initiale", systemImage: "figure.walk") }
                    .buttonStyle(.borderedProminent)
            } else {
                Button { gym.startSurvey(placeID, restart: false) } label: { Label("Mettre à jour la cartographie", systemImage: "arrow.triangle.2.circlepath") }
                Button { askRestart = true } label: { Label("Recommencer de zéro", systemImage: "arrow.counterclockwise") }
            }
            Toggle("Inclure tous les appareils Bluetooth", isOn: $gym.includeAll)
        } header: {
            Text("Cartographie")
        } footer: {
            Text(surveying
                 ? "Fais le tour de la salle et passe aussi par le milieu : une station tous les 3 ou 4 pas. Plus il y a de stations autour d’une machine, plus sa position est juste (2 à 4 m en général : les corps et le métal brouillent le signal). Chaque machine est lue quelques secondes pour connaître son type, sans rien changer à son réglage. Une machine en veille n’émet rien : réveille celles qui manquent."
                 : "Mettre à jour : de nouvelles mesures replacent les machines déplacées et ajoutent les nouvelles. Une machine déjà utilisée avec le téléphone d’un autre sportif n’émet pas : elle apparaîtra à la prochaine mise à jour. « Tous les appareils » montre aussi les machines qui ne ressemblent pas à une machine de sport.")
        }
    }

    private func surveyStatus(_ place: GymPlace, _ s: GymSurveyState) -> String {
        let plural = { (n: Int, word: String) -> String in "\(n) \(word)\(n > 1 ? "s" : "")" }
        var text = plural(s.stations, "station") + " · " + plural(place.machines.count, "machine") + " sur le plan"
        if s.stations > 0 { text += " · " + plural(s.heardLast, "machine") + " entendue" + (s.heardLast > 1 ? "s" : "") + " à la dernière station" }
        return text
    }

    // MARK: Machine la plus proche

    @ViewBuilder private func nearestSection(_ place: GymPlace) -> some View {
        Section {
            if let touching = gym.contact {
                Label("Téléphone posé sur « \(touching.name) »", systemImage: "hand.tap.fill").foregroundStyle(.mint)
            }
            identifyRow(place)
            Toggle("Afficher la machine la plus proche", isOn: $live)
            if live || gym.scanning {
                if gym.nearby.isEmpty {
                    Text("Aucune machine entendue pour l’instant. Réveille la tienne.").foregroundStyle(.secondary)
                }
                ForEach(gym.nearby.prefix(4)) { heard in
                    HStack {
                        Image(systemName: heard.kind.symbol).foregroundStyle(heard.kind.color).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(heard.name)
                            Text("\(GymSignal.proximity(heard.rssi)) · \(heard.rssi) dBm\(heard.mapped ? "" : " · pas sur le plan")")
                                .font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if place.machine(heard.id) != nil {
                            Button("Voir") { selected = heard.id }.buttonStyle(.bordered)
                        } else {
                            Button("Ajouter") {
                                gym.addHeard(heard.id, to: place.id); selected = heard.id; placing = heard.id
                            }.buttonStyle(.bordered)
                        }
                    }
                }
            }
        } header: {
            Text("Trouver ma machine")
        } footer: {
            Text("Trois façons, de la plus sûre à la plus rapide : « Identifier par le mouvement » (la machine qui démarre au signal est la tienne, celles déjà utilisées par d’autres sont écartées), téléphone posé à plat sur la console (son signal domine tous les autres), ou la machine la plus proche, qui clignote sur le plan.")
        }
    }

    /// « Identifier par le mouvement » et son déroulé (écoute, calme, signal, résultat).
    @ViewBuilder private func identifyRow(_ place: GymPlace) -> some View {
        if let s = gym.identifyState {
            HStack(spacing: 10) {
                switch s.phase {
                case .found: Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
                case .failed: Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                case .go: Image(systemName: "figure.rower").foregroundStyle(.mint)
                default: ProgressView()
                }
                Text(s.text).font(s.phase == .go ? .headline : .callout)
            }
            if s.phase == .found || s.phase == .failed {
                Button { gym.startIdentify() } label: { Label("Recommencer", systemImage: "arrow.clockwise") }
            } else {
                Button("Annuler", role: .cancel) { gym.cancelIdentify() }
            }
        } else {
            Button { gym.startIdentify() } label: { Label("Identifier par le mouvement", systemImage: "figure.rower") }
                .buttonStyle(.borderedProminent)
        }
    }

    // MARK: Machines

    @ViewBuilder private func machinesSection(_ place: GymPlace) -> some View {
        Section("Machines (\(place.machines.count))") {
            if place.machines.isEmpty {
                Text("Aucune machine repérée pour l’instant.").foregroundStyle(.secondary)
            }
            ForEach(sortedMachines(place)) { m in
                Button { selected = m.id } label: {
                    HStack {
                        Image(systemName: m.kind.symbol).foregroundStyle(m.kind.color).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(m.title).foregroundStyle(.primary)
                            Text(machineDetail(m)).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        if selected == m.id { Image(systemName: "checkmark").foregroundStyle(.mint) }
                    }
                }
            }
        }
    }

    /// Machines par type (vélos, elliptiques, rameurs…), puis par nom ; type inconnu à la fin.
    private func sortedMachines(_ place: GymPlace) -> [GymMachine] {
        place.machines.sorted { a, b in
            let ka = a.kind?.label ?? "~", kb = b.kind?.label ?? "~"
            return ka != kb ? ka < kb : a.title.localizedStandardCompare(b.title) == .orderedAscending
        }
    }

    // MARK: Lieu

    @ViewBuilder private func placeSection(_ place: GymPlace) -> some View {
        Section("Lieu") {
            if gym.book.defaultPlace?.id == place.id {
                Label("Lieu par défaut", systemImage: "star.fill").foregroundStyle(.mint)
            } else {
                Button { gym.setDefault(place.id) } label: { Label("En faire le lieu par défaut", systemImage: "star") }
            }
            Button { editing = true } label: { Label("Nom et dimensions (\(Int(place.width)) × \(Int(place.depth)) m)", systemImage: "pencil") }
            if !place.ignored.isEmpty {
                Button { gym.restoreIgnored(in: place.id) } label: {
                    Label("Autoriser à nouveau les \(place.ignored.count) machine\(place.ignored.count > 1 ? "s" : "") retirée\(place.ignored.count > 1 ? "s" : "")", systemImage: "arrow.uturn.backward")
                }
            }
            NavigationLink {
                LogConsoleView(title: "Journal de la cartographie", lines: gym.logs, text: gym.text, clear: {}).nativeCloseButton()
            } label: { Label("Journal de la cartographie (\(gym.logs.count))", systemImage: "terminal") }
            Button(role: .destructive) { askDelete = true } label: { Label("Supprimer ce lieu", systemImage: "trash") }
        }
    }
}

/// Plan vu de dessus : quadrillage (1 m, 5 m), entrée en bas, stations de mesure, machines avec leur
/// incertitude, machine sélectionnée et machine la plus proche (qui clignote).
struct GymMapCanvas: View {
    let place: GymPlace
    var selected: UUID?
    var nearest: UUID?
    var survey: GymSurveyState?
    let onTap: (Double, Double) -> Void

    var body: some View {
        GeometryReader { geo in
            let scale = min(geo.size.width / place.width, geo.size.height / place.depth)
            TimelineView(.periodic(from: .now, by: 0.25)) { context in
                Canvas { ctx, size in draw(&ctx, scale: scale, time: context.date.timeIntervalSinceReferenceDate) }
            }
            .contentShape(Rectangle())
            .onTapGesture(coordinateSpace: .local) { point in
                onTap(Double(point.x / scale), Double(point.y / scale))
            }
        }
        .aspectRatio(place.width / place.depth, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Plan de \(place.name) : \(place.machines.filter(\.placed).count) machines placées")
    }

    private func draw(_ ctx: inout GraphicsContext, scale: Double, time: Double) {
        let w = place.width * scale, h = place.depth * scale
        let room = Path(roundedRect: CGRect(x: 0, y: 0, width: w, height: h), cornerRadius: 10)
        ctx.fill(room, with: .color(Color(.secondarySystemBackground)))
        // Quadrillage : chaque mètre, plus marqué tous les 5 m.
        var minor = Path(), major = Path()
        for i in 1..<max(2, Int(place.width.rounded(.up))) {
            let x = Double(i) * scale
            if x >= w { break }
            var line = Path(); line.move(to: CGPoint(x: x, y: 0)); line.addLine(to: CGPoint(x: x, y: h))
            if i % 5 == 0 { major.addPath(line) } else { minor.addPath(line) }
        }
        for j in 1..<max(2, Int(place.depth.rounded(.up))) {
            let y = Double(j) * scale
            if y >= h { break }
            var line = Path(); line.move(to: CGPoint(x: 0, y: y)); line.addLine(to: CGPoint(x: w, y: y))
            if j % 5 == 0 { major.addPath(line) } else { minor.addPath(line) }
        }
        ctx.stroke(minor, with: .color(.primary.opacity(0.05)), lineWidth: 0.5)
        ctx.stroke(major, with: .color(.primary.opacity(0.14)), lineWidth: 1)
        ctx.stroke(room, with: .color(.primary.opacity(0.35)), lineWidth: 1.5)
        // Entrée en bas, échelle en bas à gauche.
        let door = Path(CGRect(x: w / 2 - 22, y: h - 3, width: 44, height: 3))
        ctx.fill(door, with: .color(.mint))
        ctx.draw(Text("Entrée").font(.caption2.bold()).foregroundColor(.mint), at: CGPoint(x: w / 2, y: h - 12))
        ctx.draw(Text("5 m").font(.caption2).foregroundColor(.secondary), at: CGPoint(x: 8 + 2.5 * scale, y: h - 20))
        var bar = Path(); bar.move(to: CGPoint(x: 8, y: h - 10)); bar.addLine(to: CGPoint(x: 8 + 5 * scale, y: h - 10))
        ctx.stroke(bar, with: .color(.secondary), lineWidth: 2)

        // Stations de mesure (la dernière séance plus visible).
        for (k, session) in place.sessions.enumerated() {
            let last = k == place.sessions.count - 1
            for s in session.stations {
                let r = last ? 3.0 : 2.0
                ctx.fill(Path(ellipseIn: CGRect(x: s.x * scale - r, y: s.y * scale - r, width: 2 * r, height: 2 * r)),
                         with: .color(.secondary.opacity(last ? 0.6 : 0.3)))
            }
        }

        // Machines : incertitude, pastille, pictogramme, nom.
        let radius = 13.0
        for m in place.machines {
            guard let mx = m.x, let my = m.y else { continue }
            let c = CGPoint(x: mx * scale, y: my * scale)
            let color = m.kind?.color ?? .gray
            if let e = m.error, !m.pinned {
                let er = min(max(w, h) / 2, max(radius, e * scale))
                ctx.fill(Path(ellipseIn: CGRect(x: c.x - er, y: c.y - er, width: 2 * er, height: 2 * er)), with: .color(color.opacity(0.10)))
            }
            if m.id == nearest {
                let pulse = 0.5 + 0.5 * sin(time * 6)
                let pr = radius + 5 + 4 * pulse
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - pr, y: c.y - pr, width: 2 * pr, height: 2 * pr)), with: .color(.orange), lineWidth: 3)
            }
            let dot = Path(ellipseIn: CGRect(x: c.x - radius, y: c.y - radius, width: 2 * radius, height: 2 * radius))
            ctx.fill(dot, with: .color(color))
            if m.id == selected {
                ctx.stroke(Path(ellipseIn: CGRect(x: c.x - radius - 3, y: c.y - radius - 3, width: 2 * radius + 6, height: 2 * radius + 6)),
                           with: .color(.primary), lineWidth: 2.5)
            }
            var icon = ctx.resolve(Image(systemName: m.kind?.symbol ?? "questionmark"))
            icon.shading = .color(.white)
            ctx.draw(icon, in: CGRect(x: c.x - 8, y: c.y - 8, width: 16, height: 16))
            ctx.draw(Text(m.title).font(.caption2.weight(m.id == selected ? .bold : .regular)).foregroundColor(.primary),
                     at: CGPoint(x: c.x, y: c.y + radius + 8))
        }

        // Station en cours : le joueur, et un arc qui se remplit pendant l'écoute.
        if let s = survey, let since = s.recordingSince {
            let c = CGPoint(x: s.recordingX * scale, y: s.recordingY * scale)
            let progress = min(1, (time - since.timeIntervalSinceReferenceDate) / GymStore.stationSeconds)
            var arc = Path()
            arc.addArc(center: c, radius: 16, startAngle: .degrees(-90), endAngle: .degrees(-90 + 360 * progress), clockwise: false)
            ctx.stroke(arc, with: .color(.mint), style: StrokeStyle(lineWidth: 4, lineCap: .round))
            let person = ctx.resolve(Image(systemName: "figure.stand"))
            ctx.draw(person, in: CGRect(x: c.x - 9, y: c.y - 9, width: 18, height: 18))
        }
    }
}

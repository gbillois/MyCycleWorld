import SwiftUI
import AVFoundation

@main
struct MyCycleWorldApp: App {
    @StateObject private var store: BluetoothStore
    @StateObject private var inspector = BLEInspector()
    @StateObject private var gym: GymStore
    @Environment(\.scenePhase) private var phase

    init() {
        // Cartographie des salles et Bluetooth du jeu : types lus sur les machines partagés, machines de salle
        // jamais reprises toutes seules au lancement, machine du jeu jamais sondée par la cartographie.
        let store = BluetoothStore()
        let gym = GymStore()
        store.isGymMachine = { [weak gym] id in gym?.book.contains(machine: id) ?? false }
        gym.kindDetected = { [weak store] id, kind in store?.rememberDetectedKind(kind, for: id) }
        gym.kindChosen = { [weak store] id, kind in store?.rememberChosenKind(kind, for: id) }
        gym.isInUse = { [weak store] id in store?.currentTrainerID == id }
        _store = StateObject(wrappedValue: store)
        _gym = StateObject(wrappedValue: gym)
        // Son du jeu (Web Audio dans la vue web) : audible même en mode silencieux, et mélangé à la
        // musique ou au podcast que l'utilisateur écoute déjà (sans la couper).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(store).environmentObject(inspector).environmentObject(gym)
                .tint(.mint)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = store.demo || store.activeConnectionCount > 0 }
                .onChange(of: phase) { _, phase in
                    UIApplication.shared.isIdleTimerDisabled = phase == .active && (store.demo || store.activeConnectionCount > 0)
                    if phase != .active { store.stopScan(); inspector.stopScan(); gym.suspend() }
                }
                .onChange(of: store.activeConnectionCount) { _, count in UIApplication.shared.isIdleTimerDisabled = count > 0 }
                .onChange(of: store.demo) { _, demo in UIApplication.shared.isIdleTimerDisabled = demo || store.activeConnectionCount > 0 }
        }
    }
}

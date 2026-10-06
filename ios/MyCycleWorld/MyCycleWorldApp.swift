import SwiftUI
import AVFoundation

@main
struct MyCycleWorldApp: App {
    @StateObject private var store = BluetoothStore()
    @StateObject private var inspector = BLEInspector()
    @Environment(\.scenePhase) private var phase

    init() {
        // Son du jeu (Web Audio dans la vue web) : audible même en mode silencieux, et mélangé à la
        // musique ou au podcast que l'utilisateur écoute déjà (sans la couper).
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(store).environmentObject(inspector)
                .tint(.mint)
                .onAppear { UIApplication.shared.isIdleTimerDisabled = store.demo || store.activeConnectionCount > 0 }
                .onChange(of: phase) { _, phase in
                    UIApplication.shared.isIdleTimerDisabled = phase == .active && (store.demo || store.activeConnectionCount > 0)
                    if phase != .active { store.stopScan(); inspector.stopScan() }
                }
                .onChange(of: store.activeConnectionCount) { _, count in UIApplication.shared.isIdleTimerDisabled = count > 0 }
                .onChange(of: store.demo) { _, demo in UIApplication.shared.isIdleTimerDisabled = demo || store.activeConnectionCount > 0 }
        }
    }
}

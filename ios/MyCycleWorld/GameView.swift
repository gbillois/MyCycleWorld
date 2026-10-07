import SwiftUI
import WebKit
import Combine

/// Écran principal de l'appli : le jeu web MyCycleWorld en plein écran dans une WebView, branché sur le
/// Bluetooth de l'appli. Le jeu est chargé depuis le site publié : une mise à jour du jeu arrive sans nouveau
/// build de l'appli. Les écrans natifs (appareils, cockpit, diagnostic) s'ouvrent depuis les Options du jeu.
struct GameView: View {
    @EnvironmentObject private var store: BluetoothStore
    @EnvironmentObject private var gym: GymStore
    /// Ouvre un écran natif par-dessus le jeu (la WebView reste chargée dessous).
    let openNative: (NativeScreen) -> Void
    @State private var loadFailed = false
    @State private var reloadToken = 0
    /// Révision du protocole annoncée par la page (nil tant qu'elle n'est pas prête).
    @State private var pageMinor: Int?

    init(openNative: @escaping (NativeScreen) -> Void) {
        self.openNative = openNative
    }

    /// Page publiée d'avant la révision 2 (sans entrée « Réglages de l'appli » dans ses Options) : un bouton
    /// natif garde les réglages accessibles.
    private var legacyPage: Bool { (pageMinor ?? 2) < 2 }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            // La page gère elle-même les zones sûres (viewport-fit=cover et env(safe-area-inset-*)) : la
            // WebView occupe tout l'écran, sous la barre d'état et l'indicateur d'accueil.
            GameWebView(store: store, gym: gym, reloadToken: reloadToken,
                        onLoaded: { loaded in
                            loadFailed = !loaded
                            if !loaded { pageMinor = nil; return }
                            // Page chargée mais muette (script en erreur, page inattendue) : après 10 s, le
                            // bouton natif apparaît pour que les réglages restent accessibles.
                            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                                if pageMinor == nil && !loadFailed { pageMinor = 0 }
                            }
                        },
                        onReady: { minor in pageMinor = minor },
                        onOpenNative: openNative)
                .ignoresSafeArea()
            if loadFailed {
                VStack(spacing: 12) {
                    Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                    Text("Impossible de charger le jeu").font(.headline)
                    Text("Le jeu est chargé depuis Internet. Vérifie la connexion Wi-Fi puis réessaie.")
                        .font(.callout).multilineTextAlignment(.center)
                    Button("Réessayer") { loadFailed = false; reloadToken += 1 }.buttonStyle(.borderedProminent)
                    Button { openNative(.settings) } label: {
                        Label("Réglages de l'appli", systemImage: "gearshape")
                    }
                    .buttonStyle(.bordered)
                }
                .padding(24)
                .foregroundStyle(.white)
            } else if legacyPage {
                VStack {
                    HStack {
                        Spacer()
                        Button { openNative(.settings) } label: {
                            Image(systemName: "gearshape.fill").font(.title3).padding(6)
                        }
                        .buttonStyle(.bordered)
                        .accessibilityLabel("Réglages de l'appli")
                    }
                    Spacer()
                }
                .padding(12)
            }
        }
        .statusBarHidden(true)
        .persistentSystemOverlays(.hidden)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
        .onDisappear {
            UIApplication.shared.isIdleTimerDisabled = store.demo || store.activeConnectionCount > 0
            // En quittant le jeu, le trainer repasse à plat (résistance « plat » pour un elliptique ou un rameur).
            store.applyGameGrade(0)
        }
    }
}

private struct GameWebView: UIViewRepresentable {
    let store: BluetoothStore
    let gym: GymStore
    let reloadToken: Int
    let onLoaded: (Bool) -> Void
    let onReady: (Int) -> Void
    let onOpenNative: (NativeScreen) -> Void

    func makeCoordinator() -> GameBridge {
        GameBridge(store: store, gym: gym, onLoaded: onLoaded, onReady: onReady, onOpenNative: onOpenNative)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(context.coordinator, name: GameBridge.handlerName)
        configuration.allowsInlineMediaPlayback = true
        let web = WKWebView(frame: .zero, configuration: configuration)
        web.isOpaque = false
        web.backgroundColor = .black
        web.scrollView.backgroundColor = .black
        web.scrollView.isScrollEnabled = false
        web.scrollView.bounces = false
        // Pas de zoom : on tapote vite l'écran pour pédaler, un double tapotement ne doit jamais agrandir le jeu.
        web.scrollView.minimumZoomScale = 1
        web.scrollView.maximumZoomScale = 1
        web.scrollView.bouncesZoom = false
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.navigationDelegate = context.coordinator
        #if DEBUG
        web.isInspectable = true
        #endif
        context.coordinator.attach(web)
        return web
    }

    func updateUIView(_ web: WKWebView, context: Context) {
        context.coordinator.reload(ifTokenChanged: reloadToken)
    }

    static func dismantleUIView(_ web: WKWebView, coordinator: GameBridge) {
        coordinator.detach()
    }
}

/// Pont entre la WebView du jeu et le Bluetooth de l'appli (protocole décrit dans game/native.js).
/// Le jeu envoie des ordres (pente, vitesses, vibration, ouverture d'un écran natif, machine choisie sur la
/// carte) ; l'appli lui envoie l'état, les boutons Zwift et la carte des salles.
final class GameBridge: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let handlerName = "mcw"
    static let host = "gbillois.github.io"
    static let gameURL = URL(string: "https://gbillois.github.io/MyCycleWorld/game/")!

    private let store: BluetoothStore
    private let gym: GymStore
    private var lastGym: String?
    private let onLoaded: (Bool) -> Void
    private let onReady: (Int) -> Void
    private let onOpenNative: (NativeScreen) -> Void
    private weak var webView: WKWebView?
    private var ready = false
    private var lastSent: String?
    private var timer: Timer?
    private var cancellables = Set<AnyCancellable>()
    private var loadedToken = 0

    init(store: BluetoothStore, gym: GymStore, onLoaded: @escaping (Bool) -> Void, onReady: @escaping (Int) -> Void,
         onOpenNative: @escaping (NativeScreen) -> Void) {
        self.store = store
        self.gym = gym
        self.onLoaded = onLoaded
        self.onReady = onReady
        self.onOpenNative = onOpenNative
        super.init()
    }

    func attach(_ web: WKWebView) {
        webView = web
        load()
        timer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.push() }
        store.buttonEvents
            .receive(on: DispatchQueue.main)
            .sink { [weak self] event in self?.send(button: event) }
            .store(in: &cancellables)
        // Une vitesse changée avec une manette doit apparaître tout de suite dans le jeu.
        store.$gears
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.push() }
            .store(in: &cancellables)
        // Carte des salles : au chargement et à chaque changement (lieux, machines, machines autour).
        gym.objectWillChange
            .debounce(for: .milliseconds(150), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.pushGym() }
            .store(in: &cancellables)
    }

    func detach() {
        timer?.invalidate()
        timer = nil
        cancellables.removeAll()
        gym.listen("game", false)
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: GameBridge.handlerName)
        webView?.navigationDelegate = nil
        webView = nil
    }

    func load() {
        ready = false
        lastSent = nil
        lastGym = nil
        gym.listen("game", false)
        if gym.identifyState != nil { gym.cancelIdentify() }
        webView?.load(URLRequest(url: GameBridge.gameURL))
    }

    func reload(ifTokenChanged token: Int) {
        guard token != loadedToken else { return }
        loadedToken = token
        load()
    }

    // MARK: Appli -> jeu

    private func makeState() -> GameState {
        let rows = store.devices
        let trainer = rows.first { $0.role == .trainer && $0.connected }
        let belt = rows.first { $0.role == .heart && $0.connected }
        let m = store.metrics
        var state = GameState(
            demo: store.demo,
            trainer: GameState.Trainer(connected: trainer != nil, controllable: store.gradeControl != .none,
                                       controlled: store.controlled, controlReady: store.controlReady && !store.readOnly,
                                       name: trainer?.name, status: store.controlStatus,
                                       id: store.currentTrainerID?.uuidString, waiting: store.currentTrainerID == nil ? nil : store.trainerWaiting),
            hr: GameState.Heart(connected: belt != nil, name: belt?.name),
            controllers: rows.filter { $0.role == .controller && $0.connected }.map { $0.name },
            power: m.power,
            cadence: m.cadence,
            speed: m.speed,
            heartRate: m.heartRate,
            gear: store.gears.gear)
        // Protocole 1, révision 1 : machine (elliptique, rameur) et profil matériel.
        state.hardware = store.profile.rawValue
        state.machineKind = (trainer != nil || store.demo) ? store.machineKind?.rawValue : nil
        state.strokeRate = m.strokeRate
        state.strokeCount = m.strokeCount
        state.distance = m.distance
        state.pace = m.pace
        state.stepRate = m.stepRate
        state.resistance = m.resistance
        // Révision 3 : appareils déjà connus, pour le bouton « Reconnecter » du jeu.
        if store.knownTrainerName != nil || store.knownHeartName != nil {
            state.reconnect = GameState.Reconnect(trainer: store.knownTrainerName, hr: store.knownHeartName, waiting: store.waitingReconnect)
        }
        return state
    }

    private func push(force: Bool = false) {
        guard ready, let webView, let script = GameScript.state(makeState()) else { return }
        if !force && script == lastSent { return }
        lastSent = script
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func pushGym(force: Bool = false) {
        guard ready, let webView, let script = GameScript.gym(gym.payload) else { return }
        if !force && script == lastGym { return }
        lastGym = script
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func send(button event: ButtonEvent) {
        guard ready, let webView, let script = GameScript.button(event) else { return }
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    // MARK: Jeu -> appli

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        // Seule la page du jeu publiée a le droit de piloter le Bluetooth.
        guard message.name == GameBridge.handlerName,
              message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.host == GameBridge.host,
              let command = GameCommand(body: message.body) else { return }
        handle(command)
    }

    private func handle(_ command: GameCommand) {
        switch command {
        case .ready(let minor):
            ready = true
            lastSent = nil
            push(force: true)
            pushGym(force: true)
            onReady(minor)
        case .grade(let grade):
            // Pente du terrain avant vitesses virtuelles : l'appli applique les siennes. Elliptique ou rameur :
            // la pente devient un niveau de résistance.
            store.applyGameGrade(grade)
        case .shift(let delta):
            store.shift(delta)
        case .takeControl:
            if store.controlReady && !store.controlled { store.takeControl() }
        case .vibrate:
            store.vibrateControllers()
        case .openNative(let screen, let profile):
            // Options du jeu > « Connecter Technogym » : le profil change d'abord (le jeu le reçoit dans l'état),
            // puis l'écran natif s'ouvre par-dessus le jeu.
            if let profile { store.setProfile(profile) }
            onOpenNative(screen)
        case .reconnect:
            // Pause ou choix du niveau : « Reconnecter » la machine (rameur qui s'est mis en veille…).
            store.reconnectKnown()
        case .useMachine(let id, let kind):
            // Machine choisie sur la carte au lancement d'un niveau : connexion en attente, le jeu attend ses données.
            let mapped = gym.book.place(containing: id)?.machine(id)
            let name = mapped?.title ?? gym.nearby.first(where: { $0.id == id })?.name ?? "Machine"
            store.useMachine(id, name: name, kind: kind ?? mapped?.kind)
        case .releaseMachine:
            store.releaseMachine()
        case .gymScan(let active):
            // Écran « Sur quelle machine ? » du jeu : machines autour et la plus proche en direct.
            gym.listen("game", active)
            if !active, gym.identifyState != nil { gym.cancelIdentify() }
        case .identify(let active):
            // « Identifier par le mouvement » : la machine qui démarre au signal est celle du joueur.
            if active { gym.startIdentify() } else { gym.cancelIdentify() }
        }
    }

    // MARK: Navigation

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let allowed = url.scheme == "about" || (url.scheme == "https" && url.host == GameBridge.host)
        decisionHandler(allowed ? .allow : .cancel)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onLoaded(true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        ready = false
        onLoaded(false)
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        ready = false
        onLoaded(false)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        load()
    }
}
